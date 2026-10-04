const test=require('node:test'),assert=require('node:assert/strict'),P=require('../strategies/three-candle-exit');
const base={setupKey:'A',side:'BUY',openedAt:0,plan:{entry:100,sl:90,tp1:110}};
function bars(tf,n,extra={}){return Array.from({length:n},(_,i)=>({confirmed:true,timeframeMinutes:tf,openAt:i*tf*60000,closeAt:(i+1)*tf*60000,high:105,low:95,...extra}));}
test('SL distance reduced 20% symmetrically without moving TP or mutating input',()=>{
 assert.equal(P.tightenPlan(base.plan,'BUY').sl,92);assert.equal(base.plan.sl,90);
 assert.equal(P.tightenPlan({entry:100,sl:110,tp1:90},'SELL').sl,108);
 assert.equal(P.tightenPlan(base.plan,'BUY').tp1,110);
 assert.throws(()=>P.tightenPlan(base.plan,'SELL'));
});
for(const tf of [2,10])test(`TF${tf}: close all only after third complete candle, repeated bars do not count`,()=>{
 const run=(s,b,n)=>P.evaluate({state:s,timeframeMinutes:tf,bars:b,now:n*tf*60000,quote:{bid:100,ask:101}});
 let r=run(base,bars(tf,2),2);assert.equal(r.intent,null);
 r=run(r.state,bars(tf,2),2);assert.equal(r.state.completedBarCloses.length,2);assert.equal(r.intent,null);
 r=run(r.state,bars(tf,3),3);assert.equal(r.intent.value,100);assert.equal(r.intent.reason,'TP1_NOT_REACHED_AFTER_3_CANDLES');
});
test('intrabar TP1 touch survives pullback and suppresses timeout',()=>{
 let r=P.evaluate({state:base,timeframeMinutes:2,bars:bars(2,1,{high:110}),now:120000});
 r=P.evaluate({state:r.state,timeframeMinutes:2,bars:bars(2,3),now:360000,quote:{bid:99,ask:100}});
 assert.equal(r.state.tp1Touched,true);assert.equal(r.intent,null);
});
test('SELL uses ASK low and TP1 touch at exact boundary wins over timeout',()=>{
 const s={...base,side:'SELL',plan:{entry:100,sl:110,tp1:90}};
 const r=P.evaluate({state:s,timeframeMinutes:10,bars:bars(10,3,{low:90}),now:1800000});
 assert.equal(r.intent,null);assert.equal(r.state.tp1Touched,true);
});
test('exclude partial-entry, wrong TF, unconfirmed and future bars; isolate setups',()=>{
 const r=P.evaluate({state:{...base,openedAt:60000},timeframeMinutes:2,bars:[...bars(2,3),...bars(10,3),...bars(2,4,{confirmed:false})],now:360000});
 assert.equal(r.state.completedBarCloses.length,2);assert.equal(r.intent,null);
 assert.equal(base.completedBarCloses,undefined);
});
