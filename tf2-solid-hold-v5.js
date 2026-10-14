'use strict';
const B=require('./tf2-solid-hold-sop');
const RULE='TF2_SOLID_HOLD_SCALP_CAP_V5',VERSION='NORMAL_20261001_TF2_SOLID_HOLD_V16';
const POLICY={...B.POLICY,feedRule:RULE,version:VERSION,minimumPassed:5,minimumPercent:80,exitPolicy:'CHART_PARTIAL_THEN_OPPOSITE_COLOUR_V1'};
function strategy(d={}){
 const meta=d.setupMeta||d.tf2SetupMeta||{},x=B.strategy({...d,setupMeta:{...meta,entryRuleVersion:meta.entryRuleVersion===RULE?B.RULE:'UNSUPPORTED'}});
 const ready=x.solid&&x.sop.dataReady&&x.sop.hema40&&x.sop.passed>=5&&!!x.plan;
 return {...x,entrySopVersion:VERSION,state:x.state==='PAUSED'?'PAUSED':ready?'READY':'WAIT',sop:{...x.sop,pass:ready,requiredPassed:5},reason:x.state==='PAUSED'?x.reason:!x.solid?x.reason:ready?'SOLID '+x.side+' — '+x.sop.passed+'/6 SOP lulus':'SOLID '+x.side+' dipegang — tunggu minimum 5/6; HEMA40 wajib searah'};
}
module.exports={RULE,VERSION,POLICY,strategy};
