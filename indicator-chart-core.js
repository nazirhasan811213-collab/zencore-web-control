(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZenCoreIndicatorData=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const MAX_AGE=5*60*60*1000,MAX_BARS=300,finite=Number.isFinite;
function point(m){
 const tf=String(m?.timeframe),time=m?.sourceBarTime??m?.time;
 if(m?.symbol!=='XAUUSD'||!['2','15'].includes(tf)||!finite(time)||time<=0||
   ![m.open,m.high,m.low,m.close].every(v=>finite(v)&&v>0)||m.high<Math.max(m.open,m.close)||m.low>Math.min(m.open,m.close)||m.low>m.high)return null;
 const s=m.strategyNormal?.sop||{},h=s['hema'+tf]||{},signal=s.chartSignal;
 const solidAt=signal?.present?signal.triggeredAt:s.triggerAt;
 const side=signal?.present?signal.side:m.strategyNormal?.solid?m.strategyNormal.side:null;
 const marker=['BUY','SELL'].includes(side)&&finite(solidAt)&&solidAt>=time&&solidAt<time+Number(tf)*60000;
 return {time,timeframe:tf,open:m.open,high:m.high,low:m.low,close:m.close,
   hema20:finite(m.hema20)?m.hema20:finite(h.fast)?h.fast:null,
   hema40:finite(m.hema40)?m.hema40:finite(h.slow)?h.slow:null,
   basis:finite(m.basis)?m.basis:null,confirmed:m.confirmed===true,
   atr:finite(m.atr)?m.atr:null,waveTrend1:finite(m.waveTrend1)?m.waveTrend1:null,waveTrend2:finite(m.waveTrend2)?m.waveTrend2:null,chopIndex:finite(m.chopIndex)?m.chopIndex:null,observedAt:finite(m.signalObservedAt)?m.signalObservedAt:0,
   solid:marker?side:null,solidAt:marker?solidAt:null};
}
function merge(points,next,tf,now=Date.now()){
 const map=new Map();
 for(const p of [...(Array.isArray(points)?points:[]),...(Array.isArray(next)?next:next?[next]:[])]){
  if(!p||String(p.timeframe)!==String(tf)||!finite(p.time)||p.time<now-MAX_AGE||p.time>now+5000||
   ![p.open,p.high,p.low,p.close].every(v=>finite(v)&&v>0)||p.high<Math.max(p.open,p.close)||p.low>Math.min(p.open,p.close)||p.low>p.high)continue;
  const old=map.get(p.time);if(!old||(p.confirmed===true&&old.confirmed!==true)||((p.confirmed===true)===(old.confirmed===true)&&p.observedAt>=old.observedAt))map.set(p.time,{...p,
    solid:p.solid||old?.solid||null,solidAt:p.solidAt||old?.solidAt||null});
 }
 return [...map.values()].sort((a,b)=>a.time-b.time).slice(-MAX_BARS);
}
return {MAX_AGE,MAX_BARS,point,merge};
});
