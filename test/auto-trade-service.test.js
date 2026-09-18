const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryAutoTradeStore } = require('../auto-trade-store');
const { createAutoTradeService } = require('../auto-trade-service');

const SIGNING_KEY = 'test-signing-key-that-is-longer-than-thirty-two-bytes';

async function setup() {
  let currentTime = 1_790_000_000_000;
  const store = new MemoryAutoTradeStore();
  const service = createAutoTradeService({
    store,
    commandSigningKey: SIGNING_KEY,
    now: () => currentTime
  });
  const userId = '11111111-1111-4111-8111-111111111111';
  const provisioned = await service.provisionDemoPod(userId, 'Test Secure Pod');
  await service.heartbeat(provisioned.token, {
    accountMask: '****1234',
    serverMask: '****Demo',
    brokerMask: '****Stellar',
    tradeMode: 'DEMO',
    terminalTradeAllowed: true,
    accountTradeAllowed: true,
    expertTradeAllowed: true,
    connectorVersion: '1.0.0',
    terminalBuild: '5000',
    symbolSpecs: [{
      symbol: 'XAUUSD', tickSize: 0.01, tickValue: 1,
      volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01
    }],
    positions: []
  });
  return {
    store, service, userId, token: provisioned.token,
    advance(ms) { currentTime += ms; }
  };
}

test('pod token is one-time and public state exposes masked identity only', async () => {
  const { store, service, userId, token } = await setup();
  const state = await service.state(userId);
  assert.equal(state.pod.accountMask, '****1234');
  assert.equal(state.pod.serverMask, '****Demo');
  assert.equal(state.connection.ready, true);
  assert.equal(JSON.stringify(state).includes(token), false);
  assert.equal(JSON.stringify(state).includes('tokenHash'), false);
  assert.equal(JSON.stringify([...store.podsByUser.values()]).includes(token), false);
});

test('ON waits for pod acknowledgement and STOP preserves open position management', async () => {
  const { service, userId, token } = await setup();
  await service.saveSettings(userId, {
    capitalUsd: 100,
    lotPerLayer: 0.01,
    layers: 3,
    symbols: ['XAUUSD'],
    riskAcknowledged: true
  });

  let state = await service.turnOn(userId, { confirmation: 'AKTIFKAN DEMO' });
  assert.equal(state.control.desiredState, 'ON');
  assert.equal(state.control.effectiveState, 'ARMING');
  assert.equal(state.control.canEnter, false);

  const onCommand = await service.nextCommand(token);
  assert.equal(onCommand.command.type, 'SYSTEM_ON');
  assert.match(onCommand.command.signature, /^[a-f0-9]{64}$/);
  assert.match(onCommand.command.signedEnvelope, /^[A-Za-z0-9_-]+$/);
  await service.acknowledgeCommand(token, onCommand.command.id, {
    status: 'EXECUTED', code: 'OK', message: 'Auto Trade armed'
  });
  state = await service.state(userId);
  assert.equal(state.control.effectiveState, 'ON');
  assert.equal(state.control.canEnter, true);

  await service.heartbeat(token, {
    accountMask: '****1234', serverMask: '****Demo', brokerMask: '****Stellar',
    tradeMode: 'DEMO', terminalTradeAllowed: true, accountTradeAllowed: true,
    expertTradeAllowed: true,
    positions: [{
      ticket: '900001', symbol: 'XAUUSD', side: 'BUY', volume: 0.03,
      layers: 3, entry: 2500, currentPrice: 2505, initialSl: 2495,
      activeSl: 2500, tp1: 2505, tp2: 2510, tp3: 2515,
      profitUsd: 15, exitStage: 'TP1_HIT', slLock: 'BREAK_EVEN'
    }]
  });

  state = await service.stop(userId);
  assert.equal(state.control.desiredState, 'STOPPED');
  assert.equal(state.control.effectiveState, 'STOPPING');
  assert.equal(state.positions.length, 1);
  const stopCommand = await service.nextCommand(token);
  assert.equal(stopCommand.command.type, 'SYSTEM_STOP');
  assert.equal(stopCommand.command.payload.keepExitManagement, true);
  await service.acknowledgeCommand(token, stopCommand.command.id, { status: 'EXECUTED', code: 'OK' });
  state = await service.state(userId);
  assert.equal(state.control.effectiveState, 'STOPPED');
  assert.equal(state.positions.length, 1);
  assert.equal(state.positions[0].slLock, 'BREAK_EVEN');
});

test('high-risk READY signal is queued once because risk is warning-only', async () => {
  const { service, userId, token } = await setup();
  await service.saveSettings(userId, {
    capitalUsd: 100, lotPerLayer: 0.01, layers: 3,
    symbols: ['XAUUSD'], riskAcknowledged: true
  });
  await service.turnOn(userId, { confirmation: 'AKTIFKAN DEMO' });
  const onCommand = await service.nextCommand(token);
  await service.acknowledgeCommand(token, onCommand.command.id, { status: 'EXECUTED' });

  const market = {
    symbol: 'XAUUSD', receivedAt: 1_790_000_001_000,
    strategyNormal: {
      state: 'READY', side: 'BUY',
      plan: { entry: 2500, sl: 2490, tp1: 2510, tp2: 2520, tp3: 2530 }
    }
  };
  assert.deepEqual(await service.dispatchMarkets([market]), { queued: 1 });
  assert.deepEqual(await service.dispatchMarkets([market]), { queued: 0 });
  const setupCommand = await service.nextCommand(token);
  assert.equal(setupCommand.command.type, 'PLACE_SETUP');
  assert.equal(setupCommand.command.payload.risk.level, 'HIGH');
  assert.equal(setupCommand.command.payload.risk.blocksOrder, false);
});

test('emergency close requires step-up and exact phrase', async () => {
  const { service, userId } = await setup();
  await assert.rejects(
    () => service.emergencyCloseAll(userId, { confirmation: 'TUTUP SEMUA' }, false),
    error => error.code === 'STEP_UP_REQUIRED'
  );
  await assert.rejects(
    () => service.emergencyCloseAll(userId, { confirmation: 'close' }, true),
    error => error.code === 'CONFIRMATION_REQUIRED'
  );
  const state = await service.emergencyCloseAll(userId, { confirmation: 'TUTUP SEMUA' }, true);
  assert.equal(state.control.desiredState, 'STOPPED');
  assert.equal(state.control.effectiveState, 'EMERGENCY_CLOSING');
});

test('STOPPED users still receive StepLock management for open positions', async () => {
  const { service, token } = await setup();
  await service.heartbeat(token, {
    accountMask: '****1234', serverMask: '****Demo', brokerMask: '****Stellar',
    tradeMode: 'DEMO', terminalTradeAllowed: true, accountTradeAllowed: true,
    expertTradeAllowed: true,
    positions: [{
      ticket: '900002', symbol: 'XAUUSD', side: 'BUY', volume: 0.02,
      entry: 2500, currentPrice: 2510, initialSl: 2495, activeSl: 2500,
      profitUsd: 20, exitStage: 'TP2_HIT', slLock: 'TP1'
    }]
  });
  const result = await service.dispatchMarkets([{
    symbol: 'XAUUSD', receivedAt: 1_790_000_004_000,
    positionManagement: {
      action: 'HOLD', slMoveTriggered: true,
      slMoveAction: 'MOVE_SL_TP1', activeSl: 2505, slLockLabel: 'TP1'
    }
  }]);
  assert.deepEqual(result, { queued: 1 });
  const command = await service.nextCommand(token);
  assert.equal(command.command.type, 'MANAGE_POSITION');
  assert.equal(command.command.payload.actions[0].type, 'MOVE_SL_TP1');
});

test('pod heartbeat rejects raw broker credential fields', async () => {
  const { service, token } = await setup();
  await assert.rejects(
    () => service.heartbeat(token, {
      accountMask: '****1234', serverMask: '****Demo', tradeMode: 'DEMO',
      nested: { login: 1234, password: 'do-not-store' }
    }),
    error => error.code === 'INVALID_HEARTBEAT' && !!error.fields.credential
  );
});
