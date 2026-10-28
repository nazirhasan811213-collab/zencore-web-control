'use strict';
const test=require('node:test'),a=require('node:assert/strict'),L=require('../signal-desk/live'),F=require('../signal-desk/fusion');
const now=Date.now();
function packet(tf='2'){
 const size=Number(tf)*60000,end=Math.floor(now/size)*size;
 const candles=Array.from({length:90},(_,i)=>{const close=100+Math.sin(i*.6);return {time:end-(90-i)*size,timeframe:tf,open:close-.1,high:close+.3,low:close-.3,close};});
 return {pine:{symbol:'XAUUSD',timeframe:tf,signalObservedAt:now,receivedAt:now,close:100,confirmed:true,account:'never forward',password:'never forward',strategyNormal:{state:'READY',side:'BUY',solid:true,plan:{entry:100,sl:99,tp1:101,tp2:102,tp3:103},sop:{hema2:{fast:101,slow:100},secret:'never forward'}}},history:{symbol:'XAUUSD',timeframe:tf,candles}};
}
test('Real report uses original plans for four TF/horizon combinations and never fabricates missing fields',()=>{
 for(const tf of ['2','15'])for(const horizon of [30,60]){
  const x=L.model(packet(tf),now,horizon,F);a.equal(x.fresh,true);a.equal(x.ready,true);a.equal(x.plan.entry,100);a.equal(x.validUntil,now+horizon*60000);a.equal(x.candles.length,90);
  for(const level of [x.levels.support,x.levels.resistance])if(level!==null)a.ok(Math.abs(level-x.price)<=2.5*x.atr);
 }
 const p=packet();delete p.pine.strategyNormal.plan.sl;const x=L.model(p,now,30,F);a.equal(x.ready,false);a.equal(x.planValid,false);a.equal(x.plan.sl,null);
});
test('Real report freshness, future timestamps, open bars and invalid OHLC fail closed',()=>{
 a.equal(L.model(packet(),now+61000,30,F).fresh,false);a.equal(L.model(packet('15'),now+31000,30,F).fresh,false);
 const future=packet();future.pine.signalObservedAt=now+6000;a.equal(L.model(future,now,30,F).fresh,false);
 const open=packet();open.history.candles.push({time:now,open:100,high:101,low:99,close:100,timeframe:'2'});a.equal(L.model(open,now,30,F).candles.length,90);
 const invalid=packet();invalid.history.candles[0].high=1;a.throws(()=>L.project(invalid),/Candle/);
 const wrong=packet();wrong.history.timeframe='15';a.throws(()=>L.project(wrong),/TF/);
});
test('Cross-origin bridge projects market-only data and retains actual source timestamps',()=>{
 const x=L.project(packet());a.equal(x.pine.account,undefined);a.equal(x.pine.password,undefined);a.equal(x.pine.strategyNormal.sop.secret,undefined);a.equal(x.pine.signalObservedAt,now);a.equal(x.pine.receivedAt,now);a.equal(x.pine.strategyNormal.sop.hema2.fast,101);
});
