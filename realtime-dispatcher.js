'use strict';
const {createCoalescingDispatcher}=require('./coalescing-dispatcher');
const {createEntryDecision}=require('./analysis-execution-contract');
// A webhook event already contains the analyzed market: no local HTTP reread.
// Preserve an authorized trigger if a later WAIT arrives while dispatch is busy.
function createRealtimeDispatcher({dispatch,fetchMarkets,onError=()=>{}}){
 const pending=new Map();
 const key=m=>String(m?.symbol||'')+'|'+String(m?.timeframe||'');
 const tick=createCoalescingDispatcher(async()=>{
  let markets;
  if(pending.size){markets=[...pending.values()];pending.clear();}
  else {
   markets=await fetchMarkets();
   // Events received during a fallback fetch take priority over that fetched copy.
   if(pending.size){markets=[...pending.values()];pending.clear();}
  }
  await dispatch(markets);
 },onError);
 function onMarket(m){
  if(!m||!['XAUUSD','EURUSD','GBPUSD','USDJPY','USDCAD','USDCHF','EURJPY','GBPJPY','EURGBP'].includes(m.symbol)||!['2','15'].includes(String(m.timeframe)))return;
  const k=key(m),previous=pending.get(k);
  const sequential=String(previous?.strategyNormal?.entrySopVersion||'').includes('_SEQ_')||
   String(m.strategyNormal?.entrySopVersion||'').includes('_SEQ_');
  // A held setup uses current confirmations: a later WAIT must revoke queued readiness.
  if(!previous||sequential||!createEntryDecision(previous)||createEntryDecision(m))pending.set(k,m);
  // Start immediately; coalescer serializes order creation and reruns pending work.
  return tick();
 }
 return {tick,onMarket};
}
module.exports={createRealtimeDispatcher};
