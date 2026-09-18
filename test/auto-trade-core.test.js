const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../auto-trade-core');

test('settings support 11 markets and calculate total layered lot', () => {
  const result = Core.validateSettings({
    capitalUsd: 100,
    lotPerLayer: 0.01,
    layers: 3,
    symbols: Core.SUPPORTED_MARKETS
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.totalLot, 0.03);
  assert.deepEqual(result.value.symbols, Core.SUPPORTED_MARKETS);
});

test('high risk produces a warning and never blocks the order', () => {
  const risk = Core.calculateRisk({
    capitalUsd: 100,
    lotPerLayer: 0.01,
    layers: 3,
    symbols: ['XAUUSD'],
    entry: 2500,
    sl: 2490,
    tickSize: 0.01,
    tickValue: 1
  });
  assert.equal(risk.available, true);
  assert.equal(risk.level, 'HIGH');
  assert.equal(risk.blocksOrder, false);
  assert.ok(risk.riskPercent > 2);
});

test('credential-bearing payloads are rejected recursively', () => {
  const result = Core.normaliseHeartbeat({
    accountMask: '****1234',
    serverMask: '****Demo',
    brokerMask: '****Stellar',
    tradeMode: 'DEMO',
    nested: { password: 'must-not-enter-control-plane' }
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.credential);
});

test('heartbeat only retains masked identity and sanitised positions', () => {
  const result = Core.normaliseHeartbeat({
    accountMask: '****1234',
    serverMask: '****Demo',
    brokerMask: '****Stellar',
    tradeMode: 'DEMO',
    terminalTradeAllowed: true,
    accountTradeAllowed: true,
    expertTradeAllowed: true,
    connectorVersion: '1.0.0',
    positions: [{
      ticket: '123456', symbol: 'XAUUSD', side: 'BUY', volume: 0.03,
      layers: 3, entry: 2500, currentPrice: 2504, initialSl: 2495,
      activeSl: 2500, tp1: 2505, tp2: 2510, tp3: 2515,
      profitUsd: 12.34, exitStage: 'TP1_HIT', slLock: 'BREAK_EVEN'
    }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.accountMask, '****1234');
  assert.equal(result.value.positions.length, 1);
  assert.equal(result.value.positions[0].ticket, '123456');
  assert.equal(JSON.stringify(result.value).includes('must-not-enter'), false);
});

test('ready Normal 3M signal becomes a StepLock command without changing SOP', () => {
  const command = Core.buildSetupCommand({
    symbol: 'XAUUSD',
    receivedAt: 1_790_000_000_000,
    strategyNormal: {
      state: 'READY',
      side: 'BUY',
      plan: { entry: 2500, sl: 2495, tp1: 2505, tp2: 2510, tp3: 2515 }
    }
  }, {
    capitalUsd: 100,
    lotPerLayer: 0.01,
    layers: 3,
    symbols: ['XAUUSD']
  }, { tickSize: 0.01, tickValue: 1 });
  assert.ok(command);
  assert.equal(command.payload.strategy, 'NORMAL_3M_SOP_V32');
  assert.equal(command.payload.schemaVersion, '32.3-EXIT-STEPLOCK');
  assert.equal(command.payload.totalLot, 0.03);
  assert.equal(command.payload.risk.blocksOrder, false);
});

test('STOP connection states fail closed until a demo pod is ready', () => {
  assert.equal(Core.podConnectionState(null).state, 'UNPROVISIONED');
  const ready = Core.podConnectionState({
    lastSeenAt: Date.now(),
    tradeMode: 'DEMO',
    terminalTradeAllowed: true,
    accountTradeAllowed: true,
    expertTradeAllowed: true
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.state, 'READY');
});

test('EXIT 32.3 events become explicit local management actions', () => {
  const command = Core.buildManagementCommand({
    symbol: 'XAUUSD',
    receivedAt: 1_790_000_002_000,
    positionManagement: {
      action: 'CLOSE_50_NOW',
      slMoveTriggered: true,
      slMoveAction: 'MOVE_SL_ENTRY',
      activeSl: 2500,
      slLockLabel: 'BREAK_EVEN',
      reason: 'Close Separuh signal'
    }
  });
  assert.ok(command);
  assert.deepEqual(command.payload.actions, [
    { type: 'MOVE_SL_ENTRY', activeSl: 2500, lockLabel: 'BREAK_EVEN' },
    { type: 'CLOSE_PERCENT', percent: 50, reason: 'CLOSE_SEPARUH' }
  ]);
});
