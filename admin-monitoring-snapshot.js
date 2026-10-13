(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZenCoreMonitorSnapshot=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function receive(raw,at){
  if(!raw?.ok||!Number.isFinite(raw.observedAt)||!Number.isFinite(raw.servedAt)||!Array.isArray(raw.components)||!Array.isArray(raw.accounts)||!Array.isArray(raw.alerts)||!Array.isArray(raw.workers)||!raw.summary)throw new Error('INVALID_MONITOR');
  const age=raw.servedAt-raw.observedAt;
  if(age< -5000||age>75000)throw new Error('STALE_MONITOR');
  return {data:raw,receivedAt:at,initialAge:Math.max(0,age)};
 }
 function stale(snapshot,at){return !snapshot||snapshot.initialAge+Math.max(0,at-snapshot.receivedAt)>75000;}
 return {receive,stale};
});
