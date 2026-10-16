(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZenCoreTf15=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const RULE='TF15_SOLID_RIBBON_V1',VERSION='NORMAL_20261001_TF15_RIBBON_V1',RISK='TF15_ATR_ENTRY_V2';
const POLICY={feedRule:RULE,version:VERSION,timeframe:'15',atrPeriod:14,chartPartialAction:'CLOSE_ALL',mtf:['15','30','45'],minimumPassed:4,minimumTotal:6,checklistMinimum:3,forecastThreshold:45,hema40SlopeAtr:.05,hema40SlopeRequired:false,entryPriceRangeRequired:false,slBaseAtr:.65,structureFilter:false,tpAtr:[.5,1,1.5],tp1Cap:3,tp1Lock:.5,adaptive:false,transportMode:'TF15_INTRA'};
const finite=x=>typeof x==='number'&&Number.isFinite(x),fresh=(x,now)=>finite(x)&&x>0&&now-x>=-5000&&now-x<=30000;
function confirmations(side,s={}){
 const sign=side==='BUY'?1:side==='SELL'?-1:0,h=s.hema15||{},a=s.atrReference,p=s.marketPower,m=s.mtfScore,g=s.sopGreen;
 const dataReady=!!sign&&a>0&&[a,h.fast,h.slow,h.fastPreviousBar,h.slowPreviousBar,h.waveTrend1,h.waveTrend2,p,m,g,s.price,s.sourceEntry].every(finite)&&Number.isInteger(g)&&g>=0&&g<=5&&[1,3,-1,-3].includes(m)&&p>=0&&p<=100;
 const ribbon=dataReady&&sign*(h.fast-h.slow)>0,hema40=dataReady&&sign*(h.slow-h.slowPreviousBar)>=.05*a;
 const values={entry:dataReady&&sign*(s.price-s.sourceEntry)>0,wt:dataReady&&sign*(h.waveTrend1-h.waveTrend2)>0,slope:hema40&&sign*(h.fast-h.fastPreviousBar)>=.05*a,sop:dataReady&&g>=3,forecast:dataReady&&(sign===1?(s.forecast==='NEUTRAL'||s.forecast==='BULLISH')&&p>45:(s.forecast==='NEUTRAL'&&p<45||s.forecast==='BEARISH'&&p>45)),mtf:dataReady&&sign*m>0};
 const names={entry:'Harga lepas entry',wt:'Momentum WT',slope:'Cerun HEMA20/40',sop:'Checklist 3/5',forecast:'Forecast 45%',mtf:'MTF 15/30/45'};
 const gates=Object.entries(values).map(([key,pass])=>({key,label:names[key],pass})),passed=gates.filter(g=>g.pass).length;
 return {dataReady,ribbon,hema40,gates,passed,total:6,scorePercent:passed/6*100,pass:dataReady&&ribbon&&passed>=4};
}
function planPass(side,p={},s={}){
 const sign=side==='BUY'?1:side==='SELL'?-1:0,a=s.riskAtrReference,t=s.riskTick;
 if(!sign||![a,t,p.entry,p.sl,p.tp1,p.tp2,p.tp3].every(x=>finite(x)&&x>0))return false;
 const raw=p.entry-sign*.65*a;
 const sl=(sign===1?Math.floor(raw/t+1e-9):Math.ceil(raw/t-1e-9))*t;
 return sign*(p.entry-p.sl)>0&&Math.abs(p.sl-sl)<1e-6&&['tp1','tp2','tp3'].every((k,i)=>Math.abs(p[k]-(p.entry+sign*[Math.min(.5*a,3),a,1.5*a][i]))<1e-6);
}
function strategy(d={},now=Date.now()){
 const m=d.setupMeta||{},side=m.solidSide,h=d.hemaConfirmation?.tf15||{},ai=m.dashboardAi||{};
 const solid=m.entryRuleVersion===RULE&&m.solidHoldActive===true&&m.solidClosedAt==null&&finite(m.solidTriggeredAt)&&m.solidTriggeredAt>0&&m.solidTriggeredAt<=d.signalObservedAt&&fresh(d.signalObservedAt,now)&&fresh(d.receivedAt,now);
 const s={solid,solidHoldActive:solid,solidClosedAt:m.solidClosedAt??null,triggerAt:m.solidTriggeredAt,qualifiedAt:m.completedAt,signalObservedAt:d.signalObservedAt,sourceEntry:m.sourceEntry,price:d.normal3Close,atrReference:d.normal3Atr,riskAtrReference:m.riskAtrReference,riskTick:m.riskTick,riskStructure:m.riskStructure,riskPlanVersion:m.riskPlanVersion,mtfScore:ai.mtfScore,sopGreen:[1,2,3,4,5].filter(i=>d['normal3Sop'+i]===true).length,forecast:String(d.normal3Forecast||'').toUpperCase(),marketPower:d.normal3MarketPower,hema15:{...h,waveTrend1:d.waveTrend1,waveTrend2:d.waveTrend2,mode:h.fast>h.slow?'BUY':h.fast<h.slow?'SELL':'NEUTRAL'},advisor:ai,eaEntryCompatible:true};
 const c=confirmations(side,s),p={side,entry:d.normal3Entry,sl:d.initialSl,tp1:d.tp1,tp2:d.tp2,tp3:d.tp3,entryAnchor:'SOP_COMPLETION_PRICE_V1'};
 const valid=m.atrPeriod===14&&m.riskPlanVersion===RISK&&m.solidEligible===true&&finite(m.completedAt)&&m.completedAt>=m.solidTriggeredAt&&m.completedAt<=d.signalObservedAt&&m.completionPrice===p.entry&&planPass(side,p,s)&&JSON.stringify(ai.dashboard?.mtfTimeframes)===JSON.stringify(POLICY.mtf);
 const ready=solid&&c.pass&&valid;
 return {mode:'NORMAL',entrySopVersion:VERSION,tf:'15m',side,state:ready?'READY':'WAIT',solid,entryType:'SOLID_ENTRY',plan:valid?p:null,sop:{...s,...c,requiredPassed:4},reason:ready?'SOLID '+side+' TF15 — SOP '+c.passed+'/6 lengkap':!solid?'Tunggu SOLID TF15 aktif dan data segar':!c.ribbon?'Ribbon bertentangan / mendatar':!valid?'Tunggu pelan ATR14 daripada harga entry yang sah':'Tunggu SOP '+c.passed+'/6'};
}
function entryDecision(m={},now=Date.now()){
 if(typeof process!=='undefined'&&/^(1|true|yes|on)$/i.test(process.env.ZENCORE_ENTRY_SIGNALS_PAUSED||''))return null;
 const n=m.strategyNormal||{},s=n.sop||{},p=n.plan||{},c=confirmations(n.side,s),a=m.entryAuthorizedAt;
 if(m.symbol!=='XAUUSD'||String(m.timeframe)!=='15'||n.tf!=='15m'||n.entrySopVersion!==VERSION||n.state!=='READY'||!n.solid||!s.solidHoldActive||s.solidClosedAt!=null||!c.pass||!planPass(n.side,p,s)||s.riskPlanVersion!==RISK||m.feedChannel!=='EXECUTION'||m.feedUpdateVersion!=='SPLIT_CHANNEL_BOOTSTRAP_V2'||m.entryEvent!==true||a!==m.signalObservedAt||!fresh(a,now)||!fresh(m.receivedAt,now)||!finite(s.triggerAt)||!finite(s.qualifiedAt)||s.qualifiedAt<s.triggerAt||s.qualifiedAt>a||a-s.qualifiedAt>30000||!finite(m.price))return null;
 const snapshot={contractVersion:'ZENCORE_ANALYSIS_EXECUTION_V1',decision:'ENTRY_AUTHORIZED',decisionOwner:'ZENCORE_ANALYSIS',strategy:'NORMAL_3M_SOP_V32',schemaVersion:'32.3-EXIT-STEPLOCK',symbol:m.symbol,side:n.side,executionTimeframe:'15',entry:p.entry,sl:p.sl,tp1:p.tp1,tp2:p.tp2,tp3:p.tp3,setupKey:m.setupKey,signalObservedAt:m.signalObservedAt,sourceReceivedAt:m.receivedAt,analysisSopVersion:VERSION,confirmationEvidence:{signalObservedAt:m.signalObservedAt,triggerAt:s.triggerAt,qualifiedAt:s.qualifiedAt,sopGreen:s.sopGreen,forecast:s.forecast,marketPower:s.marketPower,hemaOwn:s.hema15.mode,mtfScore:s.mtfScore,atrPeriod:14,riskAtrReference:s.riskAtrReference,riskStructure:s.riskStructure,riskTick:s.riskTick,gates:c.gates.map(g=>({key:g.key,passed:g.pass}))}};
 return {signalKey:['ZENCORE_ANALYSIS_EXECUTION_V1','15',m.symbol,n.side,p.entry,m.setupKey].join('|'),snapshot};
}
return {RULE,VERSION,RISK,POLICY,confirmations,planPass,strategy,entryDecision};
});
