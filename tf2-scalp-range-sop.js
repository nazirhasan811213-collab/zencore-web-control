'use strict';
const B=require('./tf2-solid-80-sop'),R=require('./tf2-scalp-range'),C=require('./analysis-execution-contract');
const {chartSolidSignal}=require('./chart-solid-signal');
const RULE='TF2_SOLID_80PCT_SCALP_CAP_V3',VERSION='NORMAL_20261001_TF2_SOLID80_SCALP_CAP_V14';
const POLICY={...B.POLICY,feedRule:RULE,version:VERSION,riskRange:R.POLICY};
function strategy(d={}){
 const meta=d.setupMeta||d.tf2SetupMeta||{};
 const x=B.strategy({...d,setupMeta:{...meta,entryRuleVersion:meta.entryRuleVersion===RULE?B.RULE:'UNSUPPORTED'}});
 const chartSignal=chartSolidSignal(d);
 const nativeSolid=chartSignal.present?chartSignal.current:x.solid;
 const valid=meta.riskPlanVersion===R.VERSION&&C.tf2ScalpPlanPass(x.side,x.plan,x.sop.atrReference);
 return {...x,solid:nativeSolid,entrySopVersion:VERSION,state:x.state==='PAUSED'?'PAUSED':valid?x.state:'WAIT',plan:valid?{...x.plan,riskPlanVersion:R.VERSION,planType:'TF2 SCALPING TP1 CAP'}:null,sop:{...x.sop,solid:nativeSolid,entrySignalQualified:x.solid,riskPlanVersion:meta.riskPlanVersion,riskRange:R.POLICY,chartSignal},reason:x.state==='PAUSED'?x.reason:chartSignal.current&&!meta.solidEligible?'SOLID '+chartSignal.side+' pada chart diterima; SOP tidak layak ketika SOLID muncul'+(chartSignal.atTrigger?' ('+chartSignal.atTrigger.passed+'/6; HEMA40 '+(chartSignal.atTrigger.hema40?'lulus':'belum lulus')+')':'')+'. Tunggu SOLID baharu.':!x.solid?x.reason:valid?x.reason:'TP/SL TF2 belum sepadan dengan ATR dan had scalping'};
}
module.exports={RULE,VERSION,POLICY,strategy};

