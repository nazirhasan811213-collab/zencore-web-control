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
 if(!market)return fail('MARKET_MISSING');
 if(!Number.isFinite(observed)||at-observed>30000||observed>at+5000)return fail('MARKET_STALE');
 if(!Core.entryConfirmationsPass(market))return fail('SOP_CONFIRMATION_FAILED',{
  failedGates:(n?.sop?.gates||[]).filter(g=>g.pass===false||g.passed===false).map(g=>g.key).slice(0,10)});
 if(n.side!==p.side)return fail('SIDE_CHANGED');
 if(snap.setupKey&&market.setupKey!==snap.setupKey)return fail('SETUP_CHANGED');
 const keys=['entry','sl','tp1','tp2','tp3'];
 const live=snap.entryAnchor==='LIVE_SIGNAL_PRICE_V1';
 const current=live?n.plan?.sourceChartPlan:n.plan;
 const expected=live?snap.sourceChartPlan:p;
 const changed=keys.filter(k=>!samePrice(current?.[k],expected?.[k]));
 if(changed.length)return fail('PLAN_CHANGED',{changedFields:changed});
 if(live&&!(p.side==='BUY'?market.price>expected.entry&&market.price<expected.tp1:market.price<expected.entry&&market.price>expected.tp1))return fail('PRICE_OUTSIDE_ENTRY_RANGE');
 return {ok:true,reason:null,...detail};
}
module.exports={checkEntryDelivery};
