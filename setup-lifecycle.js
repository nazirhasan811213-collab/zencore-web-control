(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZenCoreSetupLifecycle=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VERSION='PULLBACK_REQUALIFY_V1',finite=Number.isFinite;
const POLICY={version:VERSION,pullbackAtrMinimum:.10,ribbonAtrMinimum:.10,historySeconds:120,eventMaxAgeMs:60000};
function pullback(side,path,after,through,atr){
 const sign=side==='BUY'?1:side==='SELL'?-1:0;
 if(!sign||!finite(after)||!finite(through)||!(atr>0)||!Array.isArray(path)||path.length>120)return null;
 let previous=-Infinity,peak=-Infinity,anchorAt=null;
 let found=null;
 for(const point of path){
  if(!Array.isArray(point)||point.length!==2||!point.every(finite)||point[0]<=previous||point[1]<=0)return null;
  previous=point[0];if(point[0]<=after||point[0]>through)continue;
  const value=sign*point[1];
  if(value>peak){peak=value;anchorAt=point[0];}
  const amount=peak-value;
  if(amount>=atr*.10)found={anchorAt,pullbackAt:point[0],amount,atrFraction:amount/atr};
 }
 return found;
}
function momentum(side,s={}){
 const sign=side==='BUY'?1:side==='SELL'?-1:0,h=s.hema3||s.hema15||{},r=s.reentryContext||{},atr=s.atrReference;
 const nums=[h.fast,h.slow,r.fastPrevious,r.slowPrevious,h.waveTrend1,h.waveTrend2,r.wtGapPrevious,r.previousHigh,r.previousLow,s.price,atr];
 return !!sign&&nums.every(finite)&&atr>0&&
  sign*(h.fast-h.slow)>=atr*.10&&sign*(h.fast-r.fastPrevious)>0&&sign*(h.slow-r.slowPrevious)>0&&
  Math.abs(h.fast-h.slow)>Math.abs(r.fastPrevious-r.slowPrevious)&&
  sign*(h.waveTrend1-h.waveTrend2)>0&&Math.abs(h.waveTrend1-h.waveTrend2)>r.wtGapPrevious&&r.wtGapPrevious>=0&&
  (sign===1?s.price>Math.max(h.fast,h.slow,r.previousHigh):s.price<Math.min(h.fast,h.slow,r.previousLow));
}
function reentry(side,s,after,observed){
 if(s?.lifecycleVersion!==VERSION||!finite(s.qualifiedAt)||s.qualifiedAt<=after||!momentum(side,s))return null;
 // The path is sampled by Pine after each second, plus the current tick. Only
 // points after the actual MT5 close (or prior qualification) may prove a dip.
 const path=s.reentryContext?.pricePath;
 if(!Array.isArray(path)||path.some(p=>!Array.isArray(p)||p[0]>observed))return null;
 const through=Math.min(s.qualifiedAt,observed),proof=pullback(side,s.reentryContext?.pricePath,after,through,s.atrReference);
 return proof&&proof.pullbackAt<=s.qualifiedAt?proof:null;
}
function describe({solid,confirmations,completedAt,observedAt,now,event,cycleKind}){
 if(!solid)return 'WAIT_SOLID';
 if(finite(completedAt)&&now-completedAt>60000)return 'EVENT_EXPIRED';
 if(!confirmations)return 'WAIT_SOP';
 if(!finite(completedAt))return 'WAIT_PLAN';
 if(!finite(observedAt)||now-observedAt>60000)return 'WAIT_DATA';
 return event?'ENTRY_EVENT_READY':cycleKind==='FOLLOWUP'?'REENTRY_CANDIDATE':'SOP_COMPLETE';
}
return {VERSION,POLICY,pullback,momentum,reentry,describe};
});
