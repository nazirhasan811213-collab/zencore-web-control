const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryAutoTradeStore } = require('../auto-trade-store');
const { createAutoTradeService } = require('../auto-trade-service');

test('local EA only queues XAUUSD even when incoming feeds contain nine pairs', async () => {
  const symbols = ['XAUUSD','EURUSD','GBPUSD','USDJPY','USDCAD','USDCHF','EURJPY','GBPJPY','EURGBP'];
  const now = Date.now();
  const store = new MemoryAutoTradeStore();
  const reports = [];
  const service = createAutoTradeService({ store, now: () => now,
    commandSigningKey: 'test-signing-key-longer-than-thirty-two-bytes',
    allowDemoExecution: false, localEaExecutionUserIds: ['owner'],
    allowedDemoSymbols: ['XAUUSD'], onDispatchDiagnostic: report => reports.push(report) });
  store.podsByUser.set('owner', { id:'pod-owner', userId:'owner', ownershipMode:'TRADER_OWNED_EA_LOCAL',
    lastSeenAt:now, tradeMode:'DEMO', terminalTradeAllowed:true, accountTradeAllowed:true,
    expertTradeAllowed:true, demoExecutionUnlocked:true, connectorVersion:'1.3.0-ea-local', symbolSpecs:{} });
  await service.saveSettings('owner', { capitalUsd:1000, lotPerLayer:0.01, layers:3, symbols:['XAUUSD'], riskAcknowledged:true });
  await store.setControl('owner', { desiredState:'ON', effectiveState:'ON' });
  const {readyMarket}=require('./fixtures/current-market');
  const markets=symbols.map(symbol=>readyMarket({symbol,at:now}));
  await store.replacePositions('owner', [{symbol:'XAUUSD',side:'BUY',ticket:'1'}], now);
  assert.deepEqual(await service.dispatchMarkets(markets), {queued:0});
  assert.equal(reports[0].pairs.length, 1);
  assert.equal(reports[0].pairs.find(pair => pair.symbol==='XAUUSD').positionAllowsEntry, false);
  assert.equal((store.commands.get('pod-owner')||[]).length,0);
  await store.replacePositions('owner', [], now);
  assert.deepEqual(await service.dispatchMarkets(markets), {queued:1});
  const rows=store.commands.get('pod-owner');
  assert.deepEqual(rows.map(row=>row.payload.symbol),['XAUUSD']);
  assert.deepEqual(await service.dispatchMarkets(markets), {queued:0});
  assert.equal(reports.length,1, 'diagnostics are throttled');
});
