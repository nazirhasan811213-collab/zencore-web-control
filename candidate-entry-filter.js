'use strict';
// Research only. No runtime imports or live activation. TF15 has no validated replacement.
const POLICY='TF2_DIRECTION65_SLOPE_EARLY035_RESEARCH_V1';
const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
function evaluate(input={}){
 const side=String(input.side||'').toUpperCase(),sign=side==='BUY'?1:side==='SELL'?-1:0;
 const r=input.hemaOwn||{},values=[input.price,input.entry,input.atr,input.power,r.fast,r.slow,r.previousFast,r.previousSlow].map(number);
 if(String(input.timeframe)!=='2'||!sign||values.some(v=>v===null)||values[2]<=0)return {policy:POLICY,pass:false,reason:'WAIT_DATA'};
 const [price,entry,atr,power,fast,slow,pf,ps]=values;
 const forecast=String(input.forecast||'').toUpperCase();
 const directional=forecast===(sign===1?'BULLISH':'BEARISH')&&power>=65&&power<=100;
 const slope=sign*(fast-slow)>0&&sign*(fast-pf)>0&&sign*(slow-ps)>0;
 const distance=sign*(price-entry)/atr,early=distance>0&&distance<=.35;
 return {policy:POLICY,pass:directional&&slope&&early,directional,slope,early,distanceAtr:distance,
  reason:!directional?'WAIT_DIRECTIONAL65':!slope?'WAIT_HEMA_SLOPE':!early?'WAIT_EARLY_ENTRY':'RESEARCH_FILTER_PASS'};
}
module.exports={POLICY,evaluate};
