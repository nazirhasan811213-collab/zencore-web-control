(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZenCoreTf3=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const RULE='TF3_SOLID_RIBBON_V1',VERSION='NORMAL_20261001_TF3_RIBBON_V1',RISK='TF3_PINE_MIN3_PLAN_V4';
const POLICY={feedRule:RULE,version:VERSION,entryPolicyVersion:'PINE_3TRIGGERS_3OF4_CHOP50_V3',timeframe:'3',atrPeriod:14,chartPartialAction:'CLOSE_ALL',mtf:['5', '10', '15'],mandatoryTriggers:['NATIVE_SOLID','DASHBOARD_MOVEMENT','HEMA_TREND'],minimumPassed:3,minimumTotal:4,eventMaxAgeMs:60000,checklistHemaTimeframe:'3',checklistMinimum:4,forecastRequired:false,chopIndexExclusiveMaximum:50,slopeFilter:false,entryPriceRangeRequired:false,planSource:'UPLOADED_PINE_NATIVE_PLAN',slAtr:1,slMinimumPrice:3,tpModes:['Fixed R:R','Fibonacci'],fixedRr:[1,2,3],fibonacciRatios:[1.618,2.618,4.236],tp1Cap:null,tp1Lock:1.5,tp3Extension:3,exitLockVersion:'PINE_STEPLOCK_150_TP3_PLUS3_V1',transportMode:'TF2_SCALPING'};
const Lifecycle=typeof module==='object'&&module.exports?require('./setup-lifecycle'):rootLifecycle();
function rootLifecycle(){return globalThis.ZenCoreSetupLifecycle;}
const finite=x=>typeof x==='number'&&Number.isFinite(x),fresh=(x,now,maxAge=30000)=>finite(x)&&x>0&&now-x>=-5000&&now-x<=maxAge;
function confirmations(side,s={}){
 const sign=side==='BUY'?1:side==='SELL'?-1:0,h=s.hema3||{},a=s.atrReference,m=s.mtfScore,g=s.sopGreen;
 const dataReady=!!sign&&a>0&&[a,h.fast,h.slow,h.waveTrend1,h.waveTrend2,m,g,s.price,s.sourceEntry].every(finite)&&Number.isInteger(g)&&g>=0&&g<=5&&[1,3,-1,-3].includes(m);
 // Movement is the exact native mom_state expression: WT1 > WT2 ? Bullish : Bearish.
 const expectedMovement=h.waveTrend1>h.waveTrend2?'Bullish':'Bearish';
 const movement=dataReady&&String(s.advisor?.momentum||'').startsWith(expectedMovement)&&(sign===1?expectedMovement==='Bullish':expectedMovement==='Bearish');
 const ribbon=dataReady&&sign*(h.fast-h.slow)>0;
 const values={entry:dataReady&&sign*(s.price-s.sourceEntry)>0,wt:dataReady&&sign*(h.waveTrend1-h.waveTrend2)>0,sop:dataReady&&g>=4,mtf:dataReady&&sign*m>0};
 const names={entry:'Harga lepas entry SOLID',wt:'WT1/WT2',sop:'Checklist Pine 4/5',mtf:'MTF 5/10/15'};
 const gates=Object.entries(values).map(([key,pass])=>({key,label:names[key],pass})),passed=gates.filter(g=>g.pass).length;
 const chopPass=finite(s.chopIndex)&&s.chopIndex>=0&&s.chopIndex<50;
 return {dataReady,movement,ribbon,chopPass,gates,passed,total:4,scorePercent:passed/4*100,pass:dataReady&&movement&&ribbon&&passed>=3&&chopPass};
}
function planPass(side,p={},s={}){
 const sign=side==='BUY'?1:side==='SELL'?-1:0,a=s.riskAtrReference;
 if(!sign||![a,p.entry,p.sl,p.tp1,p.tp2,p.tp3].every(x=>finite(x)&&x>0)||!['Fixed R:R','Fibonacci'].includes(s.planMode))return false;
 const sl=p.entry-sign*Math.max(a,3);
 const targets=s.planMode==='Fibonacci'?[1.618,2.618,4.236].map(r=>sl+(p.entry-sl)*r):[1,2,3].map(r=>p.entry+sign*a*r);
 return Math.abs(p.sl-sl)<=1e-6&&['tp1','tp2','tp3'].every((k,i)=>Math.abs(p[k]-targets[i])<=1e-6);
}
function strategy(d={},now=Date.now()){
 const m=d.setupMeta||{},side=m.solidSide,h=d.hemaConfirmation?.tf3||{},ai=m.dashboardAi||{};
 const solid=m.entryRuleVersion===RULE&&m.solidHoldActive===true&&m.solidClosedAt==null&&finite(m.solidTriggeredAt)&&m.solidTriggeredAt>0&&m.solidTriggeredAt<=d.signalObservedAt&&fresh(d.signalObservedAt,now,d.feedChannel==='EXECUTION'&&d.entryEvent===true?60000:30000)&&fresh(d.receivedAt,now);
 const s={lifecycleVersion:m.lifecycleVersion,cycleKind:m.cycleKind,sourceSetupAt:m.sourceSetupAt,reentryContext:m.reentryContext,entryPolicyVersion:m.entryPolicyVersion,planMode:m.planMode,solid,solidHoldActive:solid,solidClosedAt:m.solidClosedAt??null,triggerAt:m.solidTriggeredAt,qualifiedAt:m.completedAt,signalObservedAt:d.signalObservedAt,sourceEntry:m.sourceEntry,price:d.normal3Close,atrReference:d.normal3Atr,riskAtrReference:m.riskAtrReference,riskTick:m.riskTick,riskStructure:m.riskStructure,riskPlanVersion:m.riskPlanVersion,chopIndex:d.chopIndex,mtfScore:ai.mtfScore,sopGreen:[1,2,3,4,5].filter(i=>d['normal3Sop'+i]===true).length,forecast:String(d.normal3Forecast||'').toUpperCase(),marketPower:d.normal3MarketPower,hema3:{...h,waveTrend1:d.waveTrend1,waveTrend2:d.waveTrend2,mode:h.fast>h.slow?'BUY':h.fast<h.slow?'SELL':'NEUTRAL'},advisor:ai,eaEntryCompatible:true};
 const c=confirmations(side,s),p={side,entry:d.normal3Entry,sl:d.initialSl,tp1:d.tp1,tp2:d.tp2,tp3:d.tp3,entryAnchor:'SOP_COMPLETION_PRICE_V1'};
 const valid=m.entryPolicyVersion===POLICY.entryPolicyVersion&&m.atrPeriod===14&&m.riskPlanVersion===RISK&&m.solidEligible===true&&finite(m.completedAt)&&m.completedAt>=m.solidTriggeredAt&&m.completedAt<=d.signalObservedAt&&m.completionPrice===p.entry&&planPass(side,p,s)&&JSON.stringify(ai.dashboard?.mtfTimeframes)===JSON.stringify(POLICY.mtf);
 const followup=m.lifecycleVersion===Lifecycle.VERSION&&m.cycleKind==='FOLLOWUP';
 const reentryPass=!followup||!!Lifecycle.reentry(side,s,m.reentryContext?.parentQualifiedAt,d.signalObservedAt);
 const expired=finite(m.completedAt)&&now-m.completedAt>60000;
 const ready=solid&&c.pass&&valid&&reentryPass&&!expired;
 const lifecycleState=Lifecycle.describe({solid,confirmations:c.pass&&valid&&reentryPass,completedAt:m.completedAt,observedAt:d.signalObservedAt,now,event:d.entryEvent===true,cycleKind:m.cycleKind});
 return {mode:'NORMAL',entrySopVersion:VERSION,tf:'3m',side,lifecycleState,state:ready?'READY':'WAIT',solid,entryType:followup?'REENTRY':'SOLID_ENTRY',plan:valid?p:null,sop:{...s,...c,requiredPassed:3},reason:expired?'Event luput — tunggu pullback dan momentum untuk setup baharu':!reentryPass?'Re-entry tunggu pullback dan momentum kuat':ready?'SOLID '+side+' TF3 — SOP '+c.passed+'/4 lengkap':!solid?'Tunggu SOLID TF3 aktif dan data segar':!c.movement?'Movement dashboard tidak searah SOLID':!c.ribbon?'HEMA Trend tidak searah SOLID':!c.chopPass?'Entry ditolak — Chop Index mesti bawah 50':!valid?'Tunggu pelan ATR14 daripada harga entry yang sah':'Tunggu SOP '+c.passed+'/4'};
}
function entryDecision(m={},now=Date.now()){
 if(typeof process!=='undefined'&&/^(1|true|yes|on)$/i.test(process.env.ZENCORE_ENTRY_SIGNALS_PAUSED||''))return null;
 const n=m.strategyNormal||{},s=n.sop||{},p=n.plan||{},c=confirmations(n.side,s),a=m.entryAuthorizedAt;
 if(s.lifecycleVersion===Lifecycle.VERSION&&s.cycleKind==='FOLLOWUP'&&!Lifecycle.reentry(n.side,s,s.reentryContext?.parentQualifiedAt,m.signalObservedAt))return null;
 const authorizationMatches=m.entryDeliveryVersion==='FIXED_EVENT_RETRY_V1'?a===s.qualifiedAt&&a<=m.signalObservedAt:a===m.signalObservedAt;
 if(m.symbol!=='XAUUSD'||String(m.timeframe)!=='3'||n.tf!=='3m'||n.entrySopVersion!==VERSION||n.state!=='READY'||!n.solid||!s.solidHoldActive||s.solidClosedAt!=null||!c.pass||!planPass(n.side,p,s)||s.entryPolicyVersion!==POLICY.entryPolicyVersion||s.riskPlanVersion!==RISK||m.feedChannel!=='EXECUTION'||m.feedUpdateVersion!=='SPLIT_CHANNEL_BOOTSTRAP_V2'||m.entryEvent!==true||!authorizationMatches||!fresh(a,now,60000)||!fresh(m.receivedAt,now)||!finite(s.triggerAt)||!finite(s.qualifiedAt)||s.qualifiedAt<s.triggerAt||s.qualifiedAt>a||a-s.qualifiedAt>60000||!finite(m.price))return null;
 const snapshot={contractVersion:'ZENCORE_ANALYSIS_EXECUTION_V1',decision:'ENTRY_AUTHORIZED',decisionOwner:'ZENCORE_ANALYSIS',strategy:'NORMAL_3M_SOP_V32',schemaVersion:'32.3-EXIT-STEPLOCK',symbol:m.symbol,side:n.side,executionTimeframe:'3',entry:p.entry,sl:p.sl,tp1:p.tp1,tp2:p.tp2,tp3:p.tp3,setupKey:m.setupKey,signalObservedAt:m.signalObservedAt,sourceReceivedAt:m.receivedAt,lifecycleVersion:s.lifecycleVersion||null,cycleKind:s.cycleKind||'INITIAL',sourceSetupAt:s.sourceSetupAt||null,triggerAt:s.triggerAt,qualifiedAt:s.qualifiedAt,entryAuthorizedAt:a,entryDeliveryVersion:m.entryDeliveryVersion||null,analysisSopVersion:VERSION,entryPolicyVersion:POLICY.entryPolicyVersion,planMode:s.planMode,exitLockVersion:POLICY.exitLockVersion,confirmationEvidence:{signalObservedAt:m.signalObservedAt,triggerAt:s.triggerAt,qualifiedAt:s.qualifiedAt,sopGreen:s.sopGreen,chopIndex:s.chopIndex,chopIndexExclusiveMaximum:50,forecast:s.forecast,marketPower:s.marketPower,hemaOwn:s.hema3.mode,mtfScore:s.mtfScore,atrPeriod:14,riskAtrReference:s.riskAtrReference,riskStructure:s.riskStructure,riskTick:s.riskTick,gates:c.gates.map(g=>({key:g.key,passed:g.pass}))}};
 return {signalKey:['ZENCORE_ANALYSIS_EXECUTION_V1','3',m.symbol,n.side,p.entry,m.setupKey].join('|'),snapshot};
}
return {RULE,VERSION,RISK,POLICY,confirmations,planPass,strategy,entryDecision};
});
