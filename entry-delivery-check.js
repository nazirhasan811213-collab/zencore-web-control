'use strict';
const Core=require('./auto-trade-core');
// Use the same numeric tolerance as the analysis plan validator. JSON round-trips
// can change the final binary decimal without changing an executable price.
const samePrice=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-6;
function checkEntryDelivery(command,market,at=Date.now()){
 const p=command.payload||{},snap=p.analysisSnapshot||{},n=market?.strategyNormal;
 const observed=Number(market?.signalObservedAt)||market?.receivedAt;
 const detail={timeframe:snap.executionTimeframe||null,side:p.side||null,setupKey:snap.setupKey||null,
  currentSide:n?.side||null,currentSetupKey:market?.setupKey||null,observedAt:observed||null};
 const fail=(reason,extra={})=>({ok:false,reason,...detail,...extra});
 if(snap.entryDeliveryVersion==='FIXED_EVENT_RETRY_V1'&&(!Number.isFinite(snap.entryAuthorizedAt)||at-snap.entryAuthorizedAt>60000||snap.entryAuthorizedAt>at+5000))return fail('ENTRY_EVENT_EXPIRED');
 if(!market)return fail('MARKET_MISSING');
 if(snap.decisionTimingVersion==='TF2_BAR_CLOSE_V1'&&!require('./tf2-bar-close').confirmed(market))return fail('TF2_CANDLE_NOT_CLOSED');
 if(snap.analysisSopVersion==='NORMAL_20261001_TF2_RIBBON_V1'&&market.feedChannel!=='EXECUTION')return fail('EXECUTION_FEED_REQUIRED');
 if(!Number.isFinite(observed)||at-observed>(['2','3','15'].includes(String(market?.timeframe))&&market?.feedChannel==='EXECUTION'&&market?.entryEvent===true?60000:require('./entry-data-age').maximumAge(market))||observed>at+5000)return fail('MARKET_STALE');
 if(!Core.entryConfirmationsPass(market))return fail('SOP_CONFIRMATION_FAILED',{
  failedGates:(n?.sop?.gates||[]).filter(g=>g.pass===false||g.passed===false).map(g=>g.key).slice(0,10)});
 if(n.side!==p.side)return fail('SIDE_CHANGED');
 if(snap.setupKey&&market.setupKey!==snap.setupKey)return fail('SETUP_CHANGED');
 if(snap.lifecycleVersion==='PULLBACK_REQUALIFY_V1'&&snap.cycleKind==='FOLLOWUP'&&!require('./setup-lifecycle').reentry(n.side,n.sop,n.sop?.reentryContext?.parentQualifiedAt,observed))return fail('REENTRY_MOMENTUM_CHANGED');
 const keys=['entry','sl','tp1','tp2','tp3'];
 const live=snap.entryAnchor==='LIVE_SIGNAL_PRICE_V1';
 const current=live?n.plan?.sourceChartPlan:n.plan;
 const expected=live?snap.sourceChartPlan:p;
 // Dashboard is a separate Pine instance; its completion tick can differ.
 // Its current SOP/side/setup are checked above; the signed execution plan stays fixed.
 const independentDashboard=['2','3','15'].includes(String(market.timeframe))&&market.feedChannel==='DASHBOARD'&&snap.analysisSopVersion===`NORMAL_20261001_TF${market.timeframe}_RIBBON_V1`;
 const changed=independentDashboard?[]:keys.filter(k=>!samePrice(current?.[k],expected?.[k]));
 if(changed.length)return fail('PLAN_CHANGED',{changedFields:changed});
 if(live&&!(p.side==='BUY'?market.price>expected.entry&&market.price<expected.tp1:market.price<expected.entry&&market.price>expected.tp1))return fail('PRICE_OUTSIDE_ENTRY_RANGE');
 if(['TF2_PINE_ATR8_SL2_TP150_230_350_CAPS_V1','TF2_PINE_ATR8_SL3_TP150_250_350_CAPS_V2'].includes(snap.confirmationEvidence?.riskPlanVersion)&&Number.isFinite(market.price)&&!(p.side==='BUY'?market.price<p.tp1:market.price>p.tp1))return fail('TF2_ENTRY_PAST_TP1');
 return {ok:true,reason:null,...detail};
}
module.exports={checkEntryDelivery};
