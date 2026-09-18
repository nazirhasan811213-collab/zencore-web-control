const test = require('node:test');
const assert = require('node:assert/strict');
const Contract = require('../analysis-execution-contract');
const Core = require('../auto-trade-core');

function readyMarket(overrides = {}) {
  return {
    symbol: 'EURUSD',
    receivedAt: 1_790_000_010_000,
    strategyNormal: {
      state: 'READY',
      side: 'BUY',
      plan: { entry: 1.1, sl: 1.099, tp1: 1.101, tp2: 1.102, tp3: 1.103 },
      ...overrides
    }
  };
}

test('Analysis contract mirrors authorized prices and ignores unrelated indicator fields', () => {
  const first = Contract.createEntryDecision(readyMarket({
    rsi: 5, score: 1, inventedExecutionHint: 'SELL'
  }));
  const second = Contract.createEntryDecision(readyMarket({
    rsi: 95, score: 999, inventedExecutionHint: 'BUY_MORE'
  }));
  assert.ok(first);
  assert.deepEqual(first, second);
  assert.equal(first.snapshot.decisionOwner, 'ZENCORE_ANALYSIS');
  assert.equal(first.snapshot.decision, 'ENTRY_AUTHORIZED');
  assert.equal(first.snapshot.entry, 1.1);
  assert.equal(first.snapshot.sl, 1.099);
  assert.equal(first.snapshot.tp3, 1.103);
  assert.equal(Object.isFrozen(first.snapshot), true);
  assert.equal('rsi' in first.snapshot, false);
  assert.equal('score' in first.snapshot, false);
});

test('execution contract never promotes WATCH or incomplete plans into an entry', () => {
  assert.equal(Contract.createEntryDecision(readyMarket({ state: 'WATCH' })), null);
  assert.equal(Contract.createEntryDecision(readyMarket({
    plan: { entry: 1.1, sl: 1.099, tp1: 1.101, tp2: 1.102 }
  })), null);
});

test('Core command carries the immutable Analysis snapshot without recalculating TP or SL', () => {
  const market = readyMarket();
  const command = Core.buildSetupCommand(market, {
    capitalUsd: 1000,
    lotPerLayer: 0.03,
    layers: 3,
    symbols: ['EURUSD']
  }, { tickSize: 0.00001, tickValue: 1 });
  assert.ok(command);
  assert.equal(command.payload.analysisContractVersion, Contract.CONTRACT_VERSION);
  assert.equal(command.payload.analysisSnapshot.entry, market.strategyNormal.plan.entry);
  assert.equal(command.payload.analysisSnapshot.sl, market.strategyNormal.plan.sl);
  assert.equal(command.payload.analysisSnapshot.tp1, market.strategyNormal.plan.tp1);
  assert.equal(command.payload.analysisSnapshot.tp2, market.strategyNormal.plan.tp2);
  assert.equal(command.payload.analysisSnapshot.tp3, market.strategyNormal.plan.tp3);
});

test('StepLock management is emitted only from explicit Analysis actions', () => {
  const decision = Contract.createManagementDecision({
    symbol: 'XAUUSD',
    receivedAt: 1_790_000_020_000,
    positionManagement: {
      action: 'EXIT_REMAINING',
      slMoveTriggered: true,
      slMoveAction: 'MOVE_SL_TP2',
      activeSl: 2510,
      slLockLabel: 'TP2',
      reason: 'Confirmed opposite yellow Bj Reversal'
    }
  });
  assert.deepEqual(decision.snapshot.actions, [
    { type: 'MOVE_SL_TP2', activeSl: 2510, lockLabel: 'TP2' },
    { type: 'CLOSE_PERCENT', percent: 100, reason: 'EXIT_REMAINING' }
  ]);
  assert.equal(decision.snapshot.decisionOwner, 'ZENCORE_ANALYSIS');
});
