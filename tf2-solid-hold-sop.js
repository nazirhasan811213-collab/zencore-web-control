'use strict';
const B=require('./tf2-solid-80-sop'),R=require('./tf2-scalp-range'),C=require('./analysis-execution-contract');
const {chartSolidSignal}=require('./chart-solid-signal');
const RULE='TF2_SOLID_HOLD_SCALP_CAP_V4',VERSION='NORMAL_20261001_TF2_SOLID_HOLD_V15';
const POLICY={...B.POLICY,feedRule:RULE,version:VERSION,minimumPassed:6,minimumPercent:100,trigger:'NATIVE_SOLID_LATCH',cancel:'SOP_CLOSE_ALL',expiryMs:null,deliveryFreshnessMs:30000,riskRange:R.POLICY};
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
function strategy(d={}){
 const m=d.setupMeta||d.tf2SetupMeta||{},side=m.solidSide,chartSignal=chartSolidSignal(d),h=d.hemaConfirmation?.tf2||{};
 const t=num(m.solidTriggeredAt),complete=num(m.completedAt),observed=num(d.signalObservedAt),received=num(d.receivedAt),now=Date.now();
 const fresh=observed>0&&received>0&&[observed,received].every(v=>now-v>=-5000&&now-v<=30000);
 const solid=m.entryRuleVersion===RULE&&m.solidHoldActive===true&&m.solidClosedAt==null&&chartSignal.present&&fresh;
 const s={solid,solidHoldActive:solid,solidClosedAt:m.solidClosedAt??null,signalObservedAt:observed,triggerAt:t,qualifiedAt:complete,sourceEntry:num(m.sourceEntry),price:num(d.normal3Close??d.close),atrReference:num(d.normal3Atr??d.atr),riskAtrReference:num(m.riskAtrReference),mtfScore:num(m.dashboardAi?.mtfScore),sopGreen:[1,2,3,4,5].filter(i=>d['normal3Sop'+i]===true).length,forecast:String(d.normal3Forecast||'').toUpperCase(),marketPower:num(d.normal3MarketPower),hema2:{fast:num(h.fast),slow:num(h.slow),fastPreviousBar:num(h.fastPreviousBar),slowPreviousBar:num(h.slowPreviousBar),waveTrend1:num(d.waveTrend1),waveTrend2:num(d.waveTrend2)},advisor:m.dashboardAi||{},chartSignal};
 const c=B.confirmations(side,s);s.hema2.mode=s.hema2.fast>s.hema2.slow?'BUY':s.hema2.fast<s.hema2.slow?'SELL':'NEUTRAL';
 const plan={side,entry:num(d.normal3Entry??d.entry),sl:num(d.initialSl),tp1:num(d.tp1),tp2:num(d.tp2),tp3:num(d.tp3),entryAnchor:'SOP_COMPLETION_PRICE_V1',qualifiedAt:complete,riskPlanVersion:R.VERSION,planType:'TF2 SCALPING SOLID HOLD'};
 const valid=m.solidEligible===true&&complete>=t&&complete<=observed&&complete>0&&plan.entry===num(m.completionPrice)&&m.riskPlanVersion===R.VERSION&&C.tf2ScalpPlanPass(side,plan,s.riskAtrReference);
 const ready=solid&&c.dataReady&&c.passed===6&&valid,paused=/^(1|true|yes|on)$/i.test(process.env.ZENCORE_ENTRY_SIGNALS_PAUSED||'');
 return {mode:'NORMAL',entrySopVersion:VERSION,tf:'2m',side:['BUY','SELL'].includes(side)?side:'WAIT',state:paused?'PAUSED':ready?'READY':'WAIT',solid,entryType:'SOLID_ENTRY',triggerPolicy:'SOLID_HELD_UNTIL_CLOSE_ALL',score:Math.round(c.percent),plan:valid?plan:null,sop:{...s,...c,pass:ready,solid,solidHoldActive:solid,requiredPassed:6,scorePercent:c.percent,riskPlanVersion:m.riskPlanVersion,riskRange:R.POLICY,eaEntryCompatible:true},reason:paused?'AUTO ENTRY PAUSED':!solid?'Tunggu SOLID baharu atau data semasa':ready?'SOLID '+side+' — semua 6/6 SOP lengkap; entry sekali sahaja':'SOLID '+side+' dipegang — SOP '+c.passed+'/6, tunggu lengkap'};
}
module.exports={RULE,VERSION,POLICY,strategy};
