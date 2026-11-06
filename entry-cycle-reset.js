'use strict';
const Lifecycle=require('./setup-lifecycle');
const POLICY='PINE_3TRIGGERS_3OF4_CHOP50_V3',MODES=['TF2_SCALPING','TF15_INTRA'];
function createEntryCycleReset(store){
 const cache=new Map(), recoveryNeeded=new Set(), flatEvidence=new Map();
 const key=(user,pod,mode)=>[user,pod,mode].join('|');
 const own=(positions,mode)=>positions.some(p=>p.symbol==='XAUUSD'&&p.origin!=='MANUAL'&&(p.strategyMode||'TF2_SCALPING')===mode);
 // Called only for accepted, connected, complete MT5 snapshots. A fast trade
 // can open and close between heartbeats (or while the Connector is offline).
 // Recover that missing transition from two fresh flat observations, never
 // from an empty cached position list or a chart/Telegram signal.
 async function observe(user,pod,before,after,at){
  for(const mode of MODES){
   const k=key(user,pod,mode);
   if(own(after,mode)){flatEvidence.delete(k);continue;}
   if(own(before,mode)){
    const reset={podId:pod,mode,closedAt:at,source:'POSITION_TRANSITION'};
    await store.appendAudit(user,'STRATEGY_CYCLE_RESET',reset);cache.set(k,reset);
    recoveryNeeded.delete(k);flatEvidence.delete(k);continue;
   }
   if(!recoveryNeeded.has(k)||typeof store.latestExecutedSetupForMode!=='function')continue;
   const prior=flatEvidence.get(k);
   if(prior&&at-prior.checkedAt<5000)continue;
   const last=await store.latestExecutedSetupForMode(user,pod,mode),ack=last?.acknowledgedAt;
   const candidate={checkedAt:at,firstEmptyAt:at,commandId:last?.id,ack};
   flatEvidence.set(k,candidate);
   if(!Number.isFinite(ack)||ack<=0||ack>=at)continue;
   const reset=cache.get(k);
   if(reset&&reset.closedAt>ack){recoveryNeeded.delete(k);flatEvidence.delete(k);continue;}
   if(!prior||prior.commandId!==last.id||prior.ack!==ack||at-prior.firstEmptyAt<5000)continue;
   candidate.firstEmptyAt=prior.firstEmptyAt;
   if(at-ack<10000)continue;
   const recovered={podId:pod,mode,closedAt:at,source:'CONFIRMED_FLAT_SNAPSHOTS',
    lastExecutedCommandId:last.id,firstEmptyAt:prior.firstEmptyAt,confirmedEmptyAt:at};
   await store.appendAudit(user,'STRATEGY_CYCLE_RESET',recovered);cache.set(k,recovered);
   recoveryNeeded.delete(k);flatEvidence.delete(k);
  }
 }
 async function check(user,pod,market){
  if(![POLICY,'PINE_3TRIGGERS_4OF5_V2','PINE_3TRIGGERS_3OF4_FORECAST45_V4','PINE_SOLID_3OF4_FORECAST45_V5','PINE_SOLID_PRICE_WT_HEMA_V6'].includes(market?.strategyNormal?.sop?.entryPolicyVersion))return {allowed:true,reason:null};
  const mode=String(market.timeframe)==='15'?'TF15_INTRA':'TF2_SCALPING',k=key(user,pod,mode);
  if(!cache.has(k))cache.set(k,typeof store.lastStrategyCycleReset==='function'?await store.lastStrategyCycleReset(user,pod,mode):null);
  const reset=cache.get(k);
  const s=market.strategyNormal.sop;
  if(typeof store.latestExecutedSetupForMode==='function'){
    const last=await store.latestExecutedSetupForMode(user,pod,mode);
    if(last&&(!reset||!Number.isFinite(last.acknowledgedAt)||last.acknowledgedAt>=reset.closedAt)){
      recoveryNeeded.add(k);return {allowed:false,reason:'WAIT_MT5_CLOSE_CONFIRMATION'};
    }
  }
  if(!reset)return {allowed:true,reason:null};
  if(Lifecycle.supported(s.lifecycleVersion)){
   // Pine INITIAL is a genuinely new native SOLID, not a continuation of the
   // last closed setup. Require both its source candle and live trigger after
   // the confirmed close; a held INITIAL cannot reuse this after its own exit.
   const freshNative=s.cycleKind==='INITIAL'&&s.reentryContext?.parentQualifiedAt==null&&
    Number.isFinite(s.sourceSetupAt)&&s.sourceSetupAt>reset.closedAt&&
    Number.isFinite(s.triggerAt)&&s.triggerAt>=s.sourceSetupAt&&s.triggerAt>reset.closedAt;
   // Pine can form FOLLOWUP candidates before this account has traded a new
   // native source. A source born after the last confirmed broker close is
   // still a normal entry for this account, even when Pine has advanced its
   // virtual cycle. After a real trade closes, reset.closedAt advances past
   // that source, so the ordinary post-close re-entry proof remains required.
   const parent=s.reentryContext?.parentQualifiedAt;
   const untradedTf2Source=String(market.timeframe)==='2'&&s.cycleKind==='FOLLOWUP'&&
    Number.isFinite(s.sourceSetupAt)&&s.sourceSetupAt>reset.closedAt&&
    Number.isFinite(s.triggerAt)&&s.triggerAt>=s.sourceSetupAt&&s.triggerAt>reset.closedAt&&
    Number.isFinite(parent)&&parent>=s.triggerAt&&Number.isFinite(s.qualifiedAt)&&s.qualifiedAt>parent;
   if(freshNative||untradedTf2Source)return {allowed:true,reason:null,closedAt:reset.closedAt,cycleKind:s.cycleKind,entryKind:'NORMAL_ENTRY'};
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
