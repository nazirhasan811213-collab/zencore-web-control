'use strict';
// Private runtime diagnostics: expose execution facts, never account identity or credentials.
const TYPES=new Set(['ENTRY_BLOCKED','SETUP_QUEUED','ENTRY_DELIVERED','ENTRY_REVOKED','COMMAND_ACKNOWLEDGED','MT5_POSITION_OBSERVED','STRATEGY_CYCLE_RESET']);
const FIELDS=['commandId','commandType','timeframe','reason','status','code','lifecycleState','layers','closedAt','source','sopCompletedAt','entryAuthorizedAt','commandQueuedAt','commandDeliveredAt','mt5AcknowledgedAt','queueToDeliveryMs','queueToAckMs'];
function entryFlowEvidence(events){
 return (Array.isArray(events)?events:[]).filter(e=>TYPES.has(e?.type)).slice(0,20).map(e=>{
  const out={type:e.type,at:e.createdAt};
  for(const key of FIELDS){const value=e.detail?.[key];if(typeof value==='number'&&Number.isFinite(value)||typeof value==='string')out[key]=typeof value==='string'?value.slice(0,120):value;}
  return out;
 });
}
module.exports={entryFlowEvidence};
