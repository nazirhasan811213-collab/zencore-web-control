'use strict';
const crypto=require('crypto');
// Event IDs and arrival times change on reconnect; setup identity does not.
function notificationKey(e,previous=null){
 const s=e.telegramSop||{},source=Number.isFinite(s.sourceSetupAt)&&s.sourceSetupAt>0?s.sourceSetupAt:s.triggerAt;
 // New TF2 cycles have a fixed qualification identity: retries share a key,
 // while a fresh post-close pullback can notify again in the same SOLID.
 if(e.kind==='ENTRY'&&String(e.timeframe)==='2'&&s.cycleKind==='FOLLOWUP'&&s.reentryPolicyVersion==='TF2_BROKER_CLOSE_CYCLES_V1'&&Number.isFinite(s.qualifiedAt)&&s.qualifiedAt>0)
  return crypto.createHash('sha256').update(JSON.stringify(['ZENCORE_REENTRY_CYCLE_V1',e.symbol,'2',e.side||null,source,e.brokerCycle||s.qualifiedAt])).digest('hex');
 // Follow-up setupAt/price can change; the parent native SOLID remains the identity.
 if(e.kind==='ENTRY'&&s.cycleKind==='FOLLOWUP'&&Number.isFinite(source)&&source>0)
  return crypto.createHash('sha256').update(JSON.stringify(['ZENCORE_REENTRY_SOLID_V1',e.symbol,String(e.timeframe||'2'),e.side||null,source])).digest('hex');
 const position=previous?.telegramPosition,plan=e.telegramPlan||previous?.activePlan?.plan;
 const setup=e.setupKey||(e.kind==='CLOSE'?(position?.setupKey||previous?.activePlan?.setupKey):null);
 const reentry=!setup&&e.kind==='ENTRY'&&/^(NORMAL|HIGH)_REENTRY$/.test(e.entryType)?[e.entryType,e.sourceBarTime||null]:null;
 const fallback=e.kind==='ENTRY'
  ? [e.side,plan?.entry??e.anchor??e.message?.match(/Entry:\s*([^|\n]+)/)?.[1]??'UNKNOWN']
  : [position?.anchor||previous?.activePlan?.side||'UNKNOWN'];
 const parts=['ZENCORE_NOTIFICATION_V2',e.symbol,String(e.timeframe||'2'),e.kind,e.side||null,setup||fallback,reentry,e.kind==='CLOSE'?Number(e.percent)||100:null];
 if(e.kind==='TP_HIT')parts.push(e.targetNumber);
 if(e.kind==='PULLBACK'){parts.push(e.pullbackStage);if(e.reversalEvidence?.version)parts.push(e.reversalEvidence.version);}
 const identity=JSON.stringify(parts);
 return crypto.createHash('sha256').update(identity).digest('hex');
}
module.exports={notificationKey};
