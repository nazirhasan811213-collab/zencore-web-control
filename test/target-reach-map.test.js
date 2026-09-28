const test=require('node:test'),assert=require('node:assert/strict');
const {targetReachMap}=require('../target-reach-map');
const sop=(side='BUY')=>({state:'READY',side,plan:side==='BUY'?
  {entry:1234,sl:1230,tp1:1237,tp2:1242,tp3:1248}:
  {entry:1234,sl:1238,tp1:1231,tp2:1226,tp3:1220}});
test('gold target map uses USD per ounce and never invents pip or dollar account profit',()=>{
 const r=targetReachMap({symbol:'XAUUSD',sop:sop(),external:{status:'AVAILABLE',currentPrice:1234,atr3m:4},scenario:{status:'NEAR_ENTRY'}});
 assert.equal(r.targets[0].distance,3);assert.equal(r.unit,'USD/oz');assert.equal(r.targets[0].rr,.75);
 assert.equal(r.targets[0].reach,'DALAM JULAT 15M');assert.equal(r.targets[1].reach,'DI LUAR JULAT 15M');
 assert.equal(r.targets[0].historical,null);
});
test('historical rates require thirty pair-and-side resolved samples and are not setup probabilities',()=>{
 const input={symbol:'XAUUSD',sop:sop('SELL'),external:{status:'AVAILABLE',currentPrice:1234,atr3m:4},scenario:{status:'NEAR_ENTRY'}};
 assert.equal(targetReachMap({...input,stats:{sample:29,hitTp1:20}}).targets[0].historical,null);
 const r=targetReachMap({...input,stats:{sample:40,hitTp1:30,hitTp2:12,hitTp3:2}});
 assert.deepEqual(r.targets.map(t=>t.historical.rate),[75,30,5]);
 assert.equal(r.targets[0].price,1231);assert.equal(r.targets[0].distance,3);
});
test('forex pip conversion and stale external data cannot label reachable targets',()=>{
 const r=targetReachMap({symbol:'EURUSD',sop:{state:'READY',side:'BUY',plan:{entry:1.1000,sl:1.0990,tp1:1.1030,tp2:1.1040,tp3:1.1050}},external:{status:'STALE',currentPrice:1.1010,atr3m:.002},scenario:{status:'WAIT_DATA'}});
 assert.equal(r.targets[0].distance,30);assert.equal(r.targets[0].remaining,null);
 assert.equal(r.targets[0].reach,'BELUM DAPAT DINILAI');assert.equal(r.status,'PLAN_ONLY');
 assert.equal(targetReachMap({symbol:'XAUUSD',sop:{...sop(),state:'WAIT'}}).status,'WAIT_SOP');
});
