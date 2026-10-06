'use strict';
const {createCoalescingDispatcher}=require('./coalescing-dispatcher');
const {createEntryDecision}=require('./analysis-execution-contract');
// A webhook event already contains the analyzed market: no local HTTP reread.
// Only matching current dashboard confirmations may preserve a queued trigger.
function createRealtimeDispatcher({dispatch,fetchMarkets,onError=()=>{}}){
 const pending=new Map(),latest=new Map();
 const key=m=>String(m?.symbol||'')+'|'+String(m?.timeframe||'');
 const tick=createCoalescingDispatcher(async()=>{
  let markets;
  if(pending.size){markets=[...pending.values()];pending.clear();}
  else {
   markets=await fetchMarkets();
   // Events received during a fallback fetch take priority over that fetched copy.
   if(pending.size){markets=[...pending.values()];pending.clear();}
  }
  if(markets)for(const m of markets){const k=key(m),old=latest.get(k);if(!old||Number(m.signalObservedAt||m.receivedAt)>=Number(old.signalObservedAt||old.receivedAt))latest.set(k,m);}
  await dispatch(markets,m=>latest.get(key(m))===m || sameConfirmation(m,latest.get(key(m))));
 },onError);
 function sameConfirmation(entry,current){return current?.feedChannel==='DASHBOARD'&&current.strategyNormal?.state==='READY'&&
  current.strategyNormal?.side===entry.strategyNormal?.side&&current.setupKey===entry.setupKey;}
 function onMarket(m){
  if(!m||!['XAUUSD','EURUSD','GBPUSD','USDJPY','USDCAD','USDCHF','EURJPY','GBPJPY','EURGBP'].includes(m.symbol)||!['2','15'].includes(String(m.timeframe)))return;
  const k=key(m),previous=pending.get(k),old=latest.get(k);
  if(old&&Number(m.signalObservedAt||m.receivedAt)<Number(old.signalObservedAt||old.receivedAt))return;
  latest.set(k,m);
  // Keep a fresh execution event through matching dashboard confirmations only.
  // Changed direction, setup or failed confirmations revoke every pending entry.
  if(!previous||!createEntryDecision(previous)||!sameConfirmation(previous,m))pending.set(k,m);
  // Start immediately; coalescer serializes order creation and reruns pending work.
  return tick();
 }
 return {tick,onMarket,getLatestMarket:(symbol,tf)=>latest.get(String(symbol)+'|'+String(tf))};
}
module.exports={createRealtimeDispatcher};
