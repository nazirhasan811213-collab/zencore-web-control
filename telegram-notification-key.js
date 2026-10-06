'use strict';
const crypto=require('crypto');
// Event IDs and arrival times change on reconnect; setup identity does not.
function notificationKey(e,previous=null){
 const position=previous?.telegramPosition,plan=e.telegramPlan||previous?.activePlan?.plan;
 const setup=e.setupKey||(e.kind==='CLOSE'?(position?.setupKey||previous?.activePlan?.setupKey):null);
 const reentry=e.kind==='ENTRY'&&/^(NORMAL|HIGH)_REENTRY$/.test(e.entryType)?[e.entryType,e.sourceBarTime||null]:null;
 const fallback=e.kind==='ENTRY'
  ? [e.side,plan?.entry??e.anchor??e.message?.match(/Entry:\s*([^|\n]+)/)?.[1]??'UNKNOWN']
  : [position?.anchor||previous?.activePlan?.side||'UNKNOWN'];
 const identity=JSON.stringify(['ZENCORE_NOTIFICATION_V2',e.symbol,String(e.timeframe||'2'),e.kind,e.side||null,setup||fallback,reentry,e.kind==='CLOSE'?Number(e.percent)||100:null]);
 return crypto.createHash('sha256').update(identity).digest('hex');
}
module.exports={notificationKey};
