'use strict';
const POLICY='PINE_3TRIGGERS_4OF5_V2',MODES=['TF2_SCALPING','TF15_INTRA'];
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
 async function allows(user,pod,market){
  if(market?.strategyNormal?.sop?.entryPolicyVersion!==POLICY)return true;
  const mode=String(market.timeframe)==='15'?'TF15_INTRA':'TF2_SCALPING',k=key(user,pod,mode);
  if(!cache.has(k))cache.set(k,typeof store.lastStrategyCycleReset==='function'?await store.lastStrategyCycleReset(user,pod,mode):null);
  const reset=cache.get(k);return !reset||(Number.isFinite(market.strategyNormal.sop.triggerAt)&&market.strategyNormal.sop.triggerAt>reset.closedAt);
 }
 return {observe,allows};
}
module.exports={createEntryCycleReset};
