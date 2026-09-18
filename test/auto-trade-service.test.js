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
    allowDemoExecution: true,
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
    demoExecutionUnlocked: true,
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

test('trader-owned Azure pairing is one-time and never exposes machine credentials in state', async () => {
  let currentTime = 1_790_000_000_000;
  const store = new MemoryAutoTradeStore();
  const service = createAutoTradeService({
    store,
    commandSigningKey: SIGNING_KEY,
    now: () => currentTime,
    pairingTtlMs: 5 * 60 * 1000
  });
  const userId = '22222222-2222-4222-8222-222222222222';

  await assert.rejects(
    () => service.createPairingSession(userId, {
      confirmation: 'PAIR SECURE POD', nested: { password: 'must-never-enter-pairing' }
    }),
    error => error.code === 'CREDENTIAL_REJECTED'
  );
  const created = await service.createPairingSession(userId, {
    confirmation: 'PAIR SECURE POD', ownershipMode: 'TRADER_OWNED_AZURE'
  });
  assert.match(created.pairing.code, /^zcpair_/);
  let state = await service.state(userId);
  assert.equal(state.pairing.ownershipMode, 'TRADER_OWNED_AZURE');
  assert.equal(JSON.stringify(state).includes(created.pairing.code), false);

  const paired = await service.pairTraderOwnedPod({
    pairingCode: created.pairing.code,
    ownershipMode: 'TRADER_OWNED_AZURE'
  });
  assert.match(paired.podToken, /^zcpod_/);
  assert.ok(paired.commandSigningKey.length >= 32);
  await assert.rejects(
    () => service.pairTraderOwnedPod({
      pairingCode: created.pairing.code,
      ownershipMode: 'TRADER_OWNED_AZURE'
    }),
    error => error.code === 'INVALID_PAIRING_CODE'
  );

  state = await service.state(userId);
  assert.equal(state.pod.ownershipMode, 'TRADER_OWNED_AZURE');
  const publicState = JSON.stringify(state);
  assert.equal(publicState.includes(paired.podToken), false);
  assert.equal(publicState.includes(paired.commandSigningKey), false);

  await service.heartbeat(paired.podToken, {
    accountMask: '****1234', serverMask: '****Demo', brokerMask: '****Stellar',
    tradeMode: 'DEMO', terminalTradeAllowed: true, accountTradeAllowed: true,
    expertTradeAllowed: true, demoExecutionUnlocked: true, positions: [{
      ticket: '900003', symbol: 'XAUUSD', side: 'BUY', volume: 0.03,
      entry: 2500, currentPrice: 2501, activeSl: 2495
    }]
  });
  await assert.rejects(
    () => service.createPairingSession(userId, { confirmation: 'PAIR SECURE POD' }),
    error => error.code === 'OPEN_POSITIONS'
  );
});

test('trader-owned Windows PC pairs without exposing broker credentials and stays execution locked', async () => {
  const store = new MemoryAutoTradeStore();
  const service = createAutoTradeService({ store, commandSigningKey: SIGNING_KEY });
  const userId = '55555555-5555-4555-8555-555555555555';
  const created = await service.createPairingSession(userId, {
    confirmation: 'PAIR SECURE POD',
    ownershipMode: 'TRADER_OWNED_WINDOWS_PC'
  });
  assert.equal(created.pairing.ownershipMode, 'TRADER_OWNED_WINDOWS_PC');
  const paired = await service.pairTraderOwnedPod({
    pairingCode: created.pairing.code,
    ownershipMode: 'TRADER_OWNED_WINDOWS_PC'
  });
  await service.heartbeat(paired.podToken, {
    accountMask: '****1234', serverMask: '****Demo', brokerMask: '****Stellar',
    tradeMode: 'DEMO', terminalTradeAllowed: true, accountTradeAllowed: true,
    expertTradeAllowed: true, demoExecutionUnlocked: false, positions: []
  });
  const state = await service.state(userId);
  assert.equal(state.pod.ownershipMode, 'TRADER_OWNED_WINDOWS_PC');
  assert.equal(state.pod.demoExecutionUnlocked, false);
  assert.equal(state.connection.state, 'CONNECTED_LOCKED');
  assert.equal(state.control.canTurnOn, false);
  assert.equal(JSON.stringify(state).includes(paired.podToken), false);
});

test('server-side rollout gate blocks ON and setup dispatch independently of the worker', async () => {
  const store = new MemoryAutoTradeStore();
  const service = createAutoTradeService({ store, commandSigningKey: SIGNING_KEY });
  const userId = '77777777-7777-4777-8777-777777777777';
  const provisioned = await service.provisionDemoPod(userId, 'Locked rollout pod');
  await service.heartbeat(provisioned.token, {
    accountMask: '****1234', serverMask: '****Demo', brokerMask: '****Stellar',
    tradeMode: 'DEMO', terminalTradeAllowed: true, accountTradeAllowed: true,
    expertTradeAllowed: true, demoExecutionUnlocked: true, positions: []
  });
  await service.saveSettings(userId, {
    capitalUsd: 100, lotPerLayer: 0.01, layers: 3,
    symbols: ['XAUUSD'], riskAcknowledged: true
  });
  await assert.rejects(
    () => service.turnOn(userId, { confirmation: 'AKTIFKAN DEMO' }),
    error => error.code === 'EXECUTION_ROLLOUT_LOCKED'
  );
  const state = await service.state(userId);
  assert.equal(state.control.executionRolloutUnlocked, false);
  assert.equal(state.control.canTurnOn, false);
  assert.deepEqual(await service.dispatchMarkets([{
    symbol: 'XAUUSD', receivedAt: 1_790_000_008_000,
    strategyNormal: {
      state: 'READY', side: 'BUY',
      plan: { entry: 2500, sl: 2495, tp1: 2505, tp2: 2510, tp3: 2515 }
    }
  }]), { queued: 0 });
});

test('pairing code cannot cross from the selected Windows host profile to another host type', async () => {
  const store = new MemoryAutoTradeStore();
  const service = createAutoTradeService({ store, commandSigningKey: SIGNING_KEY });
  const created = await service.createPairingSession(
    '66666666-6666-4666-8666-666666666666',
    { confirmation: 'PAIR SECURE POD', ownershipMode: 'TRADER_OWNED_WINDOWS_PC' }
  );
  await assert.rejects(
    () => service.pairTraderOwnedPod({
      pairingCode: created.pairing.code,
      ownershipMode: 'TRADER_OWNED_AZURE'
    }),
    error => error.code === 'PAIRING_HOST_MISMATCH'
  );
});

test('each Secure Pod receives an isolated command signing key', async () => {
  const store = new MemoryAutoTradeStore();
  const service = createAutoTradeService({ store, commandSigningKey: SIGNING_KEY });
  const first = await service.provisionDemoPod('33333333-3333-4333-8333-333333333333', 'First');
  const second = await service.provisionDemoPod('44444444-4444-4444-8444-444444444444', 'Second');
  assert.notEqual(first.commandSigningKey, second.commandSigningKey);
  assert.equal(first.commandSigningKey, service.commandSigningKeyForPod(first.pod.id));
  assert.equal(second.commandSigningKey, service.commandSigningKeyForPod(second.pod.id));
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
    expertTradeAllowed: true, demoExecutionUnlocked: true,
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
    expertTradeAllowed: true, demoExecutionUnlocked: true,
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
