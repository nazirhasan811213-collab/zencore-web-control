'use strict';
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
// Chart observation only. Never authorizes an order or extends the entry window.
function chartSolidSignal(d={},now=Date.now()){
 const meta=d.setupMeta||d.tf2SetupMeta||{},t=num(meta.solidTriggeredAt),observed=num(d.signalObservedAt??d.receivedAt),setup=num(meta.setupAt),entry=num(meta.sourceEntry),side=meta.solidSide;
 const present=meta.entryRuleVersion==='TF2_SOLID_80PCT_SCALP_CAP_V3'&&['BUY','SELL'].includes(side)&&t>0&&setup>0&&entry>0&&observed>0&&t<=observed+5000&&t<=now+5000;
 const current=present&&observed>=t&&observed-t<=30000&&now-t>=-5000&&now-t<=30000&&now-observed>=-5000&&now-observed<=30000;
 const at=meta.solidAtTrigger,passed=num(at?.passed);
 return {source:'PINE_NATIVE_SOLID_LABEL',present,current,side:present?side:'WAIT',triggeredAt:present?t:null,setupAt:present?setup:null,sourceEntry:present?entry:null,sourceQualified:present&&meta.solidEligible===true,atTrigger:present&&Number.isInteger(passed)&&passed>=0&&passed<=6&&typeof at?.hema40==='boolean'?{passed,total:6,hema40:at.hema40}:null};
}
module.exports={chartSolidSignal};
