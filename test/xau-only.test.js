const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../auto-trade-core');
const Contract=require('../analysis-execution-contract');
const {MemoryAutoTradeStore,PostgresAutoTradeStore}=require('../auto-trade-store');
const {SYMBOLS,dualAnalysis}=require('../analysis-dual-model');
test('only XAUUSD is selectable; legacy selections normalize without altering gold settings',()=>{
 assert.deepEqual(Core.TRADE_SYMBOLS,['XAUUSD']);assert.deepEqual(SYMBOLS,['XAUUSD']);
 const v=Core.validateSettings({capitalUsd:100,lotPerLayer:.01,layers:5,strategyMode:'BOTH',symbols:['XAUUSD','GBPUSD','GBPJPY']});
 assert.equal(v.ok,true);assert.deepEqual(v.value.symbols,['XAUUSD']);assert.equal(v.value.layers,5);assert.equal(v.value.lotPerLayer,.01);
 assert.throws(()=>dualAnalysis([],'GBPJPY'),/INVALID_SYMBOL/);
});
test('removed currencies cannot authorize entry, but existing position exit remains available',()=>{
 for(const symbol of ['GBPUSD','GBPJPY']){
 const market={symbol,timeframe:'2',receivedAt:Date.now(),strategyNormal:{state:'READY',side:'BUY',plan:{entry:100,sl:99,tp1:101,tp2:102,tp3:103}},positionManagement:{action:'EXIT_ALL',reason:'EXIT_ALL'}};
 assert.equal(Contract.createEntryDecision(market),null);assert.ok(Contract.createManagementDecision(market));
 }
});
test('old queued currency entries are never delivered; exits and XAUUSD entries still deliver',async()=>{
 const store=new MemoryAutoTradeStore(),at=Date.now();
 for(const [id,type,symbol] of [['fx','PLACE_SETUP','GBPUSD'],['exit','MANAGE_POSITION','GBPUSD'],['gold','PLACE_SETUP','XAUUSD']])await store.createCommand({id,userId:'owner',podId:'pod',type,payload:{symbol},createdAt:at,expiresAt:at+15000});
 let c=await store.nextCommandForPod('pod',at);assert.equal(c.id,'exit');await store.ackCommand('pod',c.id,'EXECUTED',{});
 c=await store.nextCommandForPod('pod',at);assert.equal(c.id,'gold');await store.ackCommand('pod',c.id,'EXECUTED',{});
 assert.equal(await store.nextCommandForPod('pod',at),null);
});
test('Postgres pod and hosted queues guard removed symbols at delivery',async()=>{
 const statements=[];const client={query:async(sql)=>{statements.push(sql);return {rows:[]}},release(){}};
 const store=Object.create(PostgresAutoTradeStore.prototype);store.pool={connect:async()=>client};
 await store.nextCommandForPod('pod',Date.now());await store.nextHostedCommand('account',Date.now());
 const queries=statements.filter(sql=>sql.includes('SELECT * FROM'));
 assert.equal(queries.length,2);for(const sql of queries)assert.match(sql,/command_type <> 'PLACE_SETUP' OR payload->>'symbol' = 'XAUUSD'/);
});
