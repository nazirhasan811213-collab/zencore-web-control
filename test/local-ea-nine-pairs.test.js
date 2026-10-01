const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryAutoTradeStore } = require('../auto-trade-store');
const { createAutoTradeService } = require('../auto-trade-service');

test('local EA queues all nine eligible pairs and existing positions only block their own pair', async () => {
  const symbols = ['XAUUSD','EURUSD','GBPUSD','USDJPY','USDCAD','USDCHF','EURJPY','GBPJPY','EURGBP'];
  const now = Date.now();
  const store = new MemoryAutoTradeStore();
  const reports = [];
  const service = createAutoTradeService({ store, now: () => now,
    commandSigningKey: 'test-signing-key-longer-than-thirty-two-bytes',
    allowDemoExecution: false, localEaExecutionUserIds: ['owner'],
    allowedDemoSymbols: symbols, onDispatchDiagnostic: report => reports.push(report) });
  store.podsByUser.set('owner', { id:'pod-owner', userId:'owner', ownershipMode:'TRADER_OWNED_EA_LOCAL',
    lastSeenAt:now, tradeMode:'DEMO', terminalTradeAllowed:true, accountTradeAllowed:true,
    expertTradeAllowed:true, demoExecutionUnlocked:true, connectorVersion:'1.0.0-ea-local', symbolSpecs:{} });
  await service.saveSettings('owner', { capitalUsd:1000, lotPerLayer:0.01, layers:3, symbols, riskAcknowledged:true });
  await store.setControl('owner', { desiredState:'ON', effectiveState:'ON' });
  const markets = symbols.map(symbol => ({ symbol, receivedAt:now, freshness:'LIVE',
    strategyNormal:{ state:'READY', side:'BUY', sop:{ sopGreen:5, forecast:'BULLISH', marketPower:70,
      gates:[{pass:true},{pass:true}] }, plan:{entry:100, sl:99, tp1:101, tp2:102, tp3:103} } }));
  // One existing XAUUSD position must not prevent the eight other pairs.
  await store.replacePositions('owner', [{symbol:'XAUUSD',side:'BUY',ticket:'1'}], now);
  assert.deepEqual(await service.dispatchMarkets(markets), {queued:8});
  assert.equal(reports[0].pairs.length, 9);
  assert.equal(reports[0].pairs.find(pair => pair.symbol==='XAUUSD').positionAllowsEntry, false);
  const rows = store.commands.get('pod-owner');
  assert.deepEqual(rows.map(row=>row.payload.symbol), symbols.slice(1));
  await store.replacePositions('owner', [], now);
  assert.deepEqual(await service.dispatchMarkets(markets), {queued:1});
  assert.equal(rows.length,9);
  assert.deepEqual(await service.dispatchMarkets(markets), {queued:0});
  assert.equal(reports.length,1, 'diagnostics are throttled');
});
