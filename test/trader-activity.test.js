const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryAutoTradeStore}=require('../auto-trade-store');
const {activityView}=require('../trader-activity');
test('activity counts successful entries across local and hosted, excluding failed and other users',async()=>{
 const s=new MemoryAutoTradeStore(),now=Date.now();
 s.commands.set('pod',[{userId:'a',type:'PLACE_SETUP',status:'EXECUTED',createdAt:now-10000,acknowledgedAt:now-9000},{userId:'a',type:'PLACE_SETUP',status:'FAILED',createdAt:now},{userId:'b',type:'PLACE_SETUP',status:'EXECUTED',createdAt:now},{userId:'a',type:'SYSTEM_ON',status:'EXECUTED',createdAt:now}]);
 s.hostedCommands.set('host',[{userId:'a',type:'PLACE_SETUP',status:'EXECUTED',createdAt:now-10*86400000}]);
 const a=await s.traderActivitySummary('a',now);assert.equal(a.executedSetups7d,1);assert.equal(a.executedSetups30d,2);assert.equal(a.lastTradeAt,now-9000);
 assert.equal(activityView(a,[],now).status,'ACTIVE_7D');assert.equal(activityView(await s.traderActivitySummary('missing',now),[],now).status,'NO_RECORDED_TRADE');
});
test('open reported positions count as active even without executed ACK; stale historical trades are inactive',()=>{
 const now=Date.now();assert.equal(activityView({lastTradeAt:now-8*86400000},[],now).status,'INACTIVE_7D');
 const a=activityView(null,[{openedAt:now-10000}],now);assert.equal(a.status,'POSITION_OPEN');assert.equal(a.lastTradeAt,now-10000);assert.equal(a.openPositions,1);
});
