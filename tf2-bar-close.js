(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZenCoreTf2BarClose=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VERSION='TF2_BAR_CLOSE_V1';
function applies(m){return (m?.setupMeta?.decisionTimingVersion||m?.strategyNormal?.sop?.decisionTimingVersion)===VERSION;}
function confirmed(m){
 const meta=m?.setupMeta||m?.strategyNormal?.sop||{},at=meta.decisionBarCloseAt,time=m?.sourceBarTime??m?.time,observed=m?.signalObservedAt;
 return m?.confirmed===true&&[at,time,observed].every(Number.isFinite)&&at>0&&Math.abs(at-(time+120000))<=1&&observed>=at-1000&&observed-at<=60000;
}
function allowRow(row,batch){return confirmed({setupMeta:row?.[66],sourceBarTime:row?.[1],signalObservedAt:batch?.emittedAt,confirmed:batch?.confirmed});}
return {VERSION,applies,confirmed,allowRow};
});
