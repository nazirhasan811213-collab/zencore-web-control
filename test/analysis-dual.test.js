const test=require('node:test');
const assert=require('node:assert/strict');
const {dualAnalysis}=require('../analysis-dual-model');
const {AnalysisAlerts}=require('../analysis-alert-service');
const make=(tf,at,side='BUY')=>({symbol:'XAUUSD',timeframe:String(tf),receivedAt:at,strategyNormal:{tf:tf+'m',side,plan:{entry:tf}}});
test('late webhook delivery cannot make an old Pine observation appear live',()=>{
 const data=dualAnalysis([{...make(2,100000),signalObservedAt:60000},{...make(15,100000),signalObservedAt:98000}],'XAUUSD',100000);
 assert.equal(data.views[0].status,'STALE');assert.equal(data.views[0].sourceAgeMs,40000);
 assert.equal(data.views[0].transportLagMs,40000);assert.equal(data.views[1].status,'LIVE');
 assert.equal(data.views[1].transportLagMs,2000);
});
test('Pine clock in the future is marked invalid and not presented as a fresh signal',()=>{
 const view=dualAnalysis([{...make(2,100000),signalObservedAt:106000}],'XAUUSD',100000).views[0];
 assert.equal(view.status,'INVALID_TIME');assert.equal(view.transportLagMs,null);
});
test('dual analysis isolates timeframe, pair and plan with independently aged feeds',()=>{
 const now=100000;
 const data=dualAnalysis([make(2,now),make(15,now-31000,'SELL'),make(3,now+1),{...make(15,now),symbol:'GBPUSD'}],'XAUUSD',now);
 assert.equal(data.views[0].status,'LIVE');assert.equal(data.views[0].market.strategyNormal.plan.entry,2);
 assert.equal(data.views[1].status,'STALE');assert.equal(data.views[1].market.strategyNormal.side,'SELL');
 assert.equal(data.views[1].confirmationTimeframe,30);
});
test('missing TF15 is waiting and never borrowed from TF2; mismatched strategy is excluded',()=>{
 const data=dualAnalysis([make(2,100),{...make(15,100),strategyNormal:{tf:'2m'}}],'XAUUSD',100);
 assert.equal(data.views[1].market,null);assert.equal(data.views[1].status,'WAITING');
 assert.equal(dualAnalysis([make(15,100)],'XAUUSD',100).views[0].status,'WAITING');
 assert.throws(()=>dualAnalysis([],'EURUSD'),/INVALID_SYMBOL/);
});
test('future timestamps are rejected and newest valid timeframe observation selected',()=>{
 assert.equal(dualAnalysis([make(2,100),make(2,200)],'XAUUSD',200).views[0].market.receivedAt,200);
 assert.equal(dualAnalysis([make(15,10000)],'XAUUSD',100).views[1].status,'INVALID_TIME');
});
test('active plans are retrieved independently for TF2 and TF15',async()=>{
 const service=new AnalysisAlerts();
 service.states.set('XAUUSD|2',{activePlan:{side:'BUY',plan:{entry:2}}});
 service.states.set('XAUUSD|15',{activePlan:{side:'SELL',plan:{entry:15}}});
 assert.equal((await service.activePlan('XAUUSD')).plan.entry,2);
 assert.equal((await service.activePlan('XAUUSD',15)).side,'SELL');
 await assert.rejects(service.activePlan('XAUUSD',10));
});
