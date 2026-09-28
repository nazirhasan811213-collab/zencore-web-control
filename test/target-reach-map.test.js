const test=require('node:test'),assert=require('node:assert/strict');
const {targetReachMap}=require('../target-reach-map');
const sop=(side='BUY')=>({state:'READY',side,plan:side==='BUY'?
  {entry:1234,sl:1230,tp1:1237,tp2:1242,tp3:1248}:
  {entry:1234,sl:1238,tp1:1231,tp2:1226,tp3:1220},indicator:{
    close:1234,atr:4,ema9:1233,ema20:1232,ema50:1231,hema20:1233,hema40:1232,
    waveTrend1:20,waveTrend2:15,rsi:55,chop:35,relativeVolume:1.2,globalTrend:3,
    power:76,green:5,forecast:'BULLISH'}});
test('Pine inputs assess target distance without historical samples',()=>{
 const r=targetReachMap({symbol:'XAUUSD',sop:sop()});
 assert.equal(r.status,'AVAILABLE');assert.equal(r.unit,'USD/oz');assert.equal(r.targets[0].distance,3);
 assert.equal(r.targets[0].reach,'DISOKONG INDIKATOR');assert.equal(r.targets[1].reach,'DI LUAR JULAT INDIKATOR');
 assert.equal(r.indicator.support,9);assert.equal(r.targets[0].rr,.75);
 assert.equal(r.targets[0].historical,undefined);
});
test('opposite forecast and choppy candles block optimistic reach',()=>{
 const a=sop('SELL');a.indicator={...a.indicator,ema9:1235,ema20:1236,ema50:1237,hema20:1235,hema40:1236,
   waveTrend1:10,waveTrend2:15,rsi:45,globalTrend:-3};
 assert.equal(targetReachMap({symbol:'XAUUSD',sop:a}).targets[0].reach,'TERHALANG · KONFLIK INDIKATOR');
 a.indicator.forecast='BEARISH';a.indicator.chop=70;
 assert.equal(targetReachMap({symbol:'XAUUSD',sop:a}).targets[0].reach,'TERHALANG · KONFLIK INDIKATOR');
});
test('EMA barrier blocks a farther TP even when ATR permits it',()=>{
 const a=sop();a.indicator.ema20=1236;a.indicator.hema20=1236;
 assert.equal(targetReachMap({symbol:'XAUUSD',sop:a}).targets[0].reach,'TERHALANG · EMA/HEMA');
});
test('missing or invalid Pine input only yields plan distances',()=>{
 const a=sop();delete a.indicator.atr;
 const r=targetReachMap({symbol:'EURUSD',sop:{...a,plan:{entry:1.1,sl:1.099,tp1:1.103,tp2:1.104,tp3:1.105}}});
 assert.equal(r.status,'PLAN_ONLY');assert.equal(r.targets[0].distance,30);
 assert.equal(r.targets[0].remaining,null);
 assert.equal(r.targets[0].reach,'DATA INDIKATOR TIDAK LENGKAP');
 assert.equal(targetReachMap({symbol:'XAUUSD',sop:{...a,state:'WAIT'}}).status,'WAIT_SOP');
});
