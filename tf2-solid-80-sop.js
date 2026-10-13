'use strict';
const RULE='TF2_SOLID_80PCT_V1',VERSION='NORMAL_20261001_TF2_SOLID_80PCT_V12';
const POLICY=Object.freeze({feedRule:RULE,version:VERSION,trigger:'NATIVE_SOLID_FIRST',confirmationCount:6,minimumPassed:5,minimumPercent:80,checklistMinimum:3,forecastThreshold:45,hemaGapAtrMinimum:null,ribbonDirectionRequired:false,hema40SlopeAtrMinimum:.05,slopeLookbackBars:2,mtfBuy:[1,5],mtfSell:[-5,-1],waitCandles:0,reentry:false,targetAnchor:'SOP_COMPLETION_PRICE_V1'});
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
function confirmations(side,s={}){
 const sign=side==='BUY'?1:side==='SELL'?-1:0,h=s.hema2||{},a=num(s.atrReference),fast=num(h.fast),slow=num(h.slow),f2=num(h.fastTwoBarsAgo),s2=num(h.slowTwoBarsAgo),w1=num(h.waveTrend1),w2=num(h.waveTrend2),p=num(s.marketPower),m=num(s.mtfScore),e=num(s.sourceEntry),price=num(s.price),green=num(s.sopGreen);
 const dataReady=!!sign&&a>0&&[fast,slow,f2,s2,w1,w2,p,m,e,price,green].every(x=>x!==null)&&Number.isInteger(m)&&Number.isInteger(green)&&green>=0&&green<=5&&p>=0&&p<=100;
 const hema40=dataReady&&sign*(slow-s2)>=.05*a;
 const gates=[{key:'entry',label:'Harga melepasi entry asal',pass:dataReady&&sign*(price-e)>0},{key:'wt',label:'Momentum WT searah',pass:dataReady&&sign*(w1-w2)>0},{key:'slope',label:'HEMA20/40 condong ≥0.05 ATR / 2 candle',pass:hema40&&sign*(fast-f2)>=.05*a},{key:'sop',label:'Checklist minimum 3/5 hijau',pass:dataReady&&green>=3},{key:'forecast',label:'Forecast mengikut arah — had 45',pass:dataReady&&(sign===1?(s.forecast==='NEUTRAL'||s.forecast==='BULLISH')&&p>45:(s.forecast==='NEUTRAL'&&p<45||s.forecast==='BEARISH'&&p>45))},{key:'mtf',label:'MTF BUY +1…+5 / SELL −1…−5',pass:dataReady&&sign*m>=1&&sign*m<=5}];
 const passed=gates.filter(g=>g.pass).length;
 return {dataReady,hema40,passed,total:6,percent:passed/6*100,gates,pass:dataReady&&hema40&&passed>=5};
}
function evaluate(d={}){
 const meta=d.setupMeta||d.tf2SetupMeta||{},side=meta.solidSide,ai=meta.dashboardAi||{},r=d.hemaConfirmation?.tf2||{};
 const t=num(meta.solidTriggeredAt),complete=num(meta.completedAt),observed=num(d.signalObservedAt??d.receivedAt),now=Date.now();
 const solid=meta.solidEligible===true&&t!==null&&complete===t&&observed!==null&&observed>=t&&observed-t<=30000&&now-t>=-5000&&now-t<=30000;
 const flags=[1,2,3,4,5].map(i=>d['normal3Sop'+i]===true);
 const s={solid,sourceEntry:num(meta.sourceEntry),price:num(d.normal3Close??d.close),atrReference:num(d.normal3Atr??d.atr),mtfScore:num(ai.mtfScore),sopGreen:flags.filter(Boolean).length,forecast:String(d.normal3Forecast||'').toUpperCase(),marketPower:num(d.normal3MarketPower),hema2:{fast:num(r.fast),slow:num(r.slow),fastTwoBarsAgo:num(r.fastTwoBarsAgo),slowTwoBarsAgo:num(r.slowTwoBarsAgo),waveTrend1:num(d.waveTrend1),waveTrend2:num(d.waveTrend2)}};
 const c=confirmations(side,s),sign=side==='BUY'?1:side==='SELL'?-1:0;
 s.hema2.mode=s.hema2.fast===null||s.hema2.slow===null?'WAIT_DATA':s.hema2.fast>s.hema2.slow?'BUY':s.hema2.fast<s.hema2.slow?'SELL':'NEUTRAL';
 s.hema2.state=c.hema40?'HEMA40_'+side:'HEMA40_FLAT_OR_OPPOSITE';
 const e=num(d.normal3Entry??d.entry),sl=num(d.initialSl),t1=num(d.tp1),t2=num(d.tp2),t3=num(d.tp3),anchor=num(meta.completionPrice);
 const validPlan=!!sign&&complete===t&&t!==null&&e===anchor&&[e,sl,t1,t2,t3].every(x=>x!==null&&x>0)&&sign*(e-sl)>0&&sign*(t1-e)>0&&sign*(t2-t1)>0&&sign*(t3-t2)>0;
 const ready=solid&&c.pass&&validPlan;
 return {side:sign?side:'WAIT',solid,ready,plan:validPlan?{side,entry:e,sl,tp1:t1,tp2:t2,tp3:t3,entryAnchor:'SOP_COMPLETION_PRICE_V1',qualifiedAt:complete,tpMode:'Fixed R:R',condition:'SOLID 80% TF2',planType:'TF2 Fixed R:R'}:null,sop:{...s,...c,scorePercent:c.percent,requiredPassed:5,advisor:ai,triggerAt:t,qualifiedAt:complete,eaEntryCompatible:true}};
}
function strategy(d={}){const x=evaluate(d),paused=/^(1|true|yes|on)$/i.test(process.env.ZENCORE_ENTRY_SIGNALS_PAUSED||'');return {mode:'NORMAL',entrySopVersion:VERSION,tf:'2m',side:x.side,state:paused?'PAUSED':x.ready?'READY':'WAIT',solid:x.solid,entryType:'SOLID_ENTRY',triggerPolicy:'SOLID_EVENT_80PCT_NO_WAIT',score:Math.round(x.sop.percent),plan:x.plan,sop:x.sop,reason:paused?'AUTO ENTRY PAUSED':x.ready?'SOLID '+x.side+' — '+x.sop.passed+'/6 lulus; zon bermula pada harga pengesahan':!x.solid?'Tunggu SOLID baharu — tiada latch / window candle':!x.sop.hema40?'Batal entry — HEMA40 mendatar, kurang condong atau arah salah':'SOP '+x.sop.passed+'/6; perlu minimum 5/6'};}
module.exports={RULE,VERSION,POLICY,evaluate,strategy,confirmations};
