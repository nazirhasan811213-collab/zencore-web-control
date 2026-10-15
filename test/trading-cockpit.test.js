const test=require('node:test'),assert=require('node:assert/strict');
const {cockpit}=require('../trading-cockpit-model');
const make=(tf=15,at=100000)=>({symbol:'XAUUSD',timeframe:String(tf),receivedAt:at,signalObservedAt:at,price:2001,strategyNormal:{tf:tf+'m',solid:true,entrySopVersion:tf===2?'NORMAL_20261001_TF2_V2':'NORMAL_20261001_TF15_V2',state:'READY',side:'BUY',sop:{['hema'+tf]:{mode:'BUY'},['hema'+(tf===2?3:30)]:{mode:'BUY'},sopGreen:4,forecast:'BULLISH',marketPower:70,gates:Array.from({length:7},()=>({pass:true}))},plan:{entry:2000,sl:1990,tp1:2010,tp2:2020,tp3:2030}}});
test('cockpit exposes only TF3/TF15 and never substitutes legacy TF2',()=>{const data=cockpit([make(2),make(15)],100000);assert.deepEqual(data.pairs.map(p=>p.symbol),['XAUUSD']);assert.deepEqual(data.pairs[0].views.map(v=>v.timeframe),[3,15]);assert.equal(data.liveFeeds,1);assert.equal(data.readySetups,1);assert.equal(data.pairs[0].views[0].displayState,'WAITING');});
test('expired entry observation is never advertised as ready even when receiving fresh frames',()=>{const m=make();m.signalObservedAt=60000;const data=cockpit([m],100000);assert.equal(data.readySetups,0);assert.equal(data.pairs[0].views[1].displayState,'WAITING');assert.equal(data.pairs[0].views[1].status,'STALE');});
test('stale feeds, TP1 crossed and incomplete gates cannot be promoted',()=>{assert.equal(cockpit([make()],140000).readySetups,0);const tp=make();tp.price=2011;assert.equal(cockpit([tp],100000).readySetups,0);const failed=make();failed.strategyNormal.sop.gates[2].pass=false;assert.equal(cockpit([failed],100000).readySetups,0);});
test('unknown SOP and legacy TF3 never appear as active entry',()=>{const unknown=make();unknown.strategyNormal.entrySopVersion='OLD';assert.equal(cockpit([unknown,make(3)],100000).readySetups,0);assert.equal(cockpit([make(3)],100000).readySetups,0);});
test('both new ATR40 SOP versions are displayed ready only with a passing pullback guard',()=>{
 for(const tf of [15]){
  const m=make(tf);m.strategyNormal.entrySopVersion=`NORMAL_20261001_TF${tf}_SEQ_ATR40_V4`;
  m.strategyNormal.sop.gates[0].key='pullback';m.strategyNormal.sop.pullback={pass:true};
  assert.equal(cockpit([m],100000).readySetups,1);
  m.strategyNormal.sop.pullback.pass=false;assert.equal(cockpit([m],100000).readySetups,0);
 }
});
