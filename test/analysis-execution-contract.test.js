const test = require('node:test');
const assert = require('node:assert/strict');
const Contract = require('../analysis-execution-contract');
const Core = require('../auto-trade-core');

function readyMarket(overrides = {}) {
  return {
    symbol: 'GBPUSD',timeframe:'2',
    receivedAt: 1_790_000_010_000,
    strategyNormal: {
      state: 'READY',
      side: 'BUY',
      sop:{sopGreen:4,forecast:'BULLISH',marketPower:70,gates:[{pass:true},{pass:true}]},
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

test('entry requires C+ or higher while position close stays available', () => {
  const base=readyMarket();
  const low={...base,strategyNormal:{...base.strategyNormal,sop:{...base.strategyNormal.sop,sopGreen:0,forecast:'WAIT',marketPower:0}}};
  assert.equal(Contract.entryQuality(low).grade,'C');
  assert.equal(Contract.createEntryDecision(low),null);
  const cPlus={...base,strategyNormal:{...base.strategyNormal,sop:{...base.strategyNormal.sop,forecast:'WAIT',marketPower:0}}};
  assert.equal(Contract.entryQuality(cPlus).grade,'C+');
  assert.ok(Contract.createEntryDecision(cPlus));
  assert.ok(Contract.createEntryDecision(base));
  assert.ok(Contract.createManagementDecision({...low,positionManagement:{action:'EXIT_ALL'}}));
});

test('active position permits only explicit same-side Normal or High re-entry',()=>{
  const open=[{symbol:'XAUUSD',side:'SELL'}];
  const base={symbol:'XAUUSD',strategyNormal:{side:'SELL',entryType:'HIGH_REENTRY'}};
  assert.equal(Core.permitsPositionEntry(base,open),true);
  assert.equal(Core.permitsPositionEntry({...base,strategyNormal:{...base.strategyNormal,entryType:'NORMAL_REENTRY'}},open),true);
  assert.equal(Core.permitsPositionEntry({...base,strategyNormal:{...base.strategyNormal,entryType:'SOLID_ENTRY'}},open),false);
  assert.equal(Core.permitsPositionEntry({...base,strategyNormal:{...base.strategyNormal,side:'BUY'}},open),false);
  assert.equal(Core.permitsPositionEntry(base,[...open,{symbol:'XAUUSD',side:'BUY'}]),false);
});

test('Core command carries the immutable Analysis snapshot without recalculating TP or SL', () => {
  const market = readyMarket();
  const command = Core.buildSetupCommand(market, {
    capitalUsd: 1000,
    lotPerLayer: 0.03,
    layers: 3,
    symbols: ['GBPUSD']
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
