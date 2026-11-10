'use strict';
// Projection only: diagnostic components remain available, active alerts are red flow faults.
function criticalAlerts({components=[],accounts=[],paused=false,observedAt=Date.now()}={}){
 const out=[],add=(id,component,message,userId,timeframe)=>out.push({id,severity:'error',component,message,code:id.split(':')[0],observedAt,...(userId?{userId}:{}),...(timeframe?{timeframe}:{})});
 for(const c of components){
  if(c.id==='database'&&c.status==='ERROR')add('DATA_STORE_FAILED',c.label,c.detail);
  if(paused)continue;
  if(/^feed(2|15)$/.test(c.id)&&c.status!=='OK')add('PINE_DATA_UNAVAILABLE:'+c.id,c.label,c.detail,null,Number(c.id.slice(4)));
  if(c.id==='trading'&&['ERROR','UNKNOWN'].includes(c.status))add('EXECUTION_DISPATCH_FAILED',c.label,c.detail);
  if(c.id==='orders'&&['ERROR','WARNING','UNKNOWN'].includes(c.status))add('EXECUTION_QUEUE_FAILED',c.label,c.detail);
 }
 for(const r of accounts){
  if(paused||r.transport==='NOT_LINKED'||!['ON','RUNNING','STARTING'].includes(r.control?.desiredState))continue;
  if(!r.ready)add('MT5_CONNECTION_FAILED:'+r.userId,'Client → MT5',r.state+'. Semak Connector, EA dan lease.',r.userId);
 }
 return [...new Map(out.map(a=>[a.id,a])).values()];
}
module.exports={criticalAlerts};
