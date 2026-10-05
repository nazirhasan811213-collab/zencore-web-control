const test=require('node:test');
const assert=require('node:assert/strict');
const Contract=require('../analysis-execution-contract');
function market(side,price){
 return {symbol:'XAUUSD',timeframe:'2',price,receivedAt:Date.now(),strategyNormal:{state:'READY',side,
  sop:{sopGreen:5,marketPower:70,forecast:side==='BUY'?'BULLISH':'BEARISH',gates:[{pass:true},{pass:true}]},
  plan:side==='BUY'?{entry:100,sl:99,tp1:101,tp2:102,tp3:103}:{entry:100,sl:101,tp1:99,tp2:98,tp3:97}}};
}
test('late BUY and SELL are refused at TP1, beyond TP1, and at SL',()=>{
 for(const price of [101,102,99])assert.equal(Contract.createEntryDecision(market('BUY',price)),null);
 for(const price of [99,98,101])assert.equal(Contract.createEntryDecision(market('SELL',price)),null);
 for(const side of ['BUY','SELL']){
  const decision=Contract.createEntryDecision(market(side,100));
  assert.ok(decision);assert.equal(decision.snapshot.executionTimeframe,'2');
  assert.equal(decision.snapshot.entry,100);
 }
});
test('dispatcher refuses old feed and signs entry with a 15 second lifetime',async()=>{
 const {MemoryAutoTradeStore}=require('../auto-trade-store');
 const {createAutoTradeService}=require('../auto-trade-service');
 const now=Date.now(),store=new MemoryAutoTradeStore();
 const service=createAutoTradeService({store,now:()=>now,commandSigningKey:'test-signing-key-longer-than-thirty-two-bytes',
  localEaExecutionUserIds:['u'],allowedDemoSymbols:['XAUUSD']});
 store.podsByUser.set('u',{id:'p',userId:'u',ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:now,
  tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,
  demoExecutionUnlocked:true,connectorVersion:'1.2.0-ea-local'});
 await service.saveSettings('u',{capitalUsd:100,lotPerLayer:.01,layers:3,symbols:['XAUUSD'],riskAcknowledged:true});
 await store.setControl('u',{desiredState:'ON',effectiveState:'ON'});
 const signal=market('BUY',100);signal.receivedAt=now-31000;
 assert.deepEqual(await service.dispatchMarkets([signal]),{queued:0});
 signal.receivedAt=now;
 assert.deepEqual(await service.dispatchMarkets([signal]),{queued:1});
 assert.equal(store.commands.get('p')[0].expiresAt,now+15000);
});
