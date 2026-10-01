const test=require('node:test');const assert=require('node:assert/strict');
const {MemoryAutoTradeStore}=require('../auto-trade-store');
const {createAutoTradeService}=require('../auto-trade-service');
test('scoped EA gate enables only nominated local DEMO user while global execution remains locked',async()=>{
 const store=new MemoryAutoTradeStore();const now=1790000000000;
 const service=createAutoTradeService({store,commandSigningKey:'test-signing-key-longer-than-thirty-two-bytes',allowDemoExecution:false,localEaExecutionUserIds:['owner'],now:()=>now});
 for(const id of ['owner','other','hosted']){
  store.podsByUser.set(id,{id:'pod-'+id,userId:id,ownershipMode:id==='hosted'?'INTERNAL_DEMO':'TRADER_OWNED_EA_LOCAL',lastSeenAt:now,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.0.0-ea-local'});
 }
 assert.equal((await service.state('owner')).control.executionRolloutUnlocked,true);
 assert.equal((await service.state('owner')).connection.ready,true);
 for(const id of ['other','hosted']){
  const state=await service.state(id);assert.equal(state.control.executionRolloutUnlocked,false);assert.equal(state.connection.ready,false);
  await assert.rejects(service.turnOn(id,{confirmation:'AKTIFKAN DEMO'}),{code:'EXECUTION_ROLLOUT_LOCKED'});
 }
 // Nominated user still requires settings, a DEMO account, correct version and Algo permissions.
 await assert.rejects(service.turnOn('owner',{confirmation:'AKTIFKAN DEMO'}),{code:'SETTINGS_REQUIRED'});
 const pod=store.podsByUser.get('owner');pod.tradeMode='REAL';assert.equal((await service.state('owner')).connection.ready,false);
 pod.tradeMode='DEMO';pod.expertTradeAllowed=false;assert.equal((await service.state('owner')).connection.ready,false);
 pod.expertTradeAllowed=true;pod.connectorVersion='outdated';assert.equal((await service.state('owner')).connection.ready,false);
});
