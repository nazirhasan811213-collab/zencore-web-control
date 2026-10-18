'use strict';
const Lifecycle=require('./setup-lifecycle');
const POLICY='PINE_3TRIGGERS_3OF4_CHOP50_V3',MODES=['TF2_SCALPING','TF15_INTRA'];
function createEntryCycleReset(store){
 const cache=new Map();
 const key=(user,pod,mode)=>[user,pod,mode].join('|');
 const own=(positions,mode)=>positions.some(p=>p.symbol==='XAUUSD'&&p.origin!=='MANUAL'&&(p.strategyMode||'TF2_SCALPING')===mode);
 async function observe(user,pod,before,after,at){
  for(const mode of MODES)if(own(before,mode)&&!own(after,mode)){
   const reset={podId:pod,mode,closedAt:at};
   await store.appendAudit(user,'STRATEGY_CYCLE_RESET',reset);cache.set(key(user,pod,mode),reset);
  }
 }
 async function check(user,pod,market){
  if(![POLICY,'PINE_3TRIGGERS_4OF5_V2'].includes(market?.strategyNormal?.sop?.entryPolicyVersion))return {allowed:true,reason:null};
  const mode=String(market.timeframe)==='15'?'TF15_INTRA':'TF2_SCALPING',k=key(user,pod,mode);
  if(!cache.has(k))cache.set(k,typeof store.lastStrategyCycleReset==='function'?await store.lastStrategyCycleReset(user,pod,mode):null);
  const reset=cache.get(k);
  const s=market.strategyNormal.sop;
  if(s.lifecycleVersion===Lifecycle.VERSION&&typeof store.latestExecutedSetupForMode==='function'){
    const last=await store.latestExecutedSetupForMode(user,pod,mode);
    if(last&&(!reset||!Number.isFinite(last.acknowledgedAt)||last.acknowledgedAt>=reset.closedAt))return {allowed:false,reason:'WAIT_MT5_CLOSE_CONFIRMATION'};
  }
  if(!reset)return {allowed:true,reason:null};
  if(s.lifecycleVersion===Lifecycle.VERSION){
   const proof=Lifecycle.reentry(market.strategyNormal.side,s,reset.closedAt,market.signalObservedAt);
   return {allowed:!!proof,reason:proof?null:'WAIT_PULLBACK_MOMENTUM_AFTER_CLOSE',closedAt:reset.closedAt,proof};
  }
  const allowed=Number.isFinite(s.triggerAt)&&s.triggerAt>reset.closedAt;
  return {allowed,reason:allowed?null:'WAIT_NEW_SOLID_AFTER_CLOSE',closedAt:reset.closedAt};
 }
 async function allows(...args){return (await check(...args)).allowed;}

 return {observe,allows,check};
}
module.exports={createEntryCycleReset};
