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

test('public local EA rollout supports REAL and DEMO clients without unlocking hosted workers or auto-arming',async()=>{
 const store=new MemoryAutoTradeStore(),now=1790000000000;
 const service=createAutoTradeService({store,now:()=>now,commandSigningKey:'test-signing-key-longer-than-thirty-two-bytes',
  allowDemoExecution:false,allowLocalEaExecution:true});
 for(const mode of ['REAL','DEMO']){
  const id='client-'+mode;
  store.podsByUser.set(id,{id:'pod-'+id,userId:id,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:now,tradeMode:mode,
   terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local'});
  let state=await service.state(id);
  assert.equal(state.connection.ready,true);assert.equal(state.control.effectiveState,'STOPPED');
  await service.saveSettings(id,{capitalUsd:100,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],riskAcknowledged:true});
  await assert.rejects(service.turnOn(id,{confirmation:'WRONG'}),{code:'CONFIRMATION_REQUIRED'});
  state=await service.turnOn(id,{confirmation:'AKTIFKAN '+mode});
  assert.equal(state.control.desiredState,'ON');assert.notEqual(state.control.effectiveState,'ON');
 }
 store.podsByUser.set('hosted',{id:'hosted-pod',userId:'hosted',ownershipMode:'INTERNAL_DEMO',lastSeenAt:now,tradeMode:'DEMO',
  terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'2.2.5-gcp-multiuser-multipair'});
 assert.equal((await service.state('hosted')).connection.ready,false);
 await assert.rejects(service.turnOn('hosted',{confirmation:'AKTIFKAN DEMO'}),{code:'EXECUTION_ROLLOUT_LOCKED'});
});

test('supported REAL transport reports rollout lock correctly, not a misleading installer upgrade',async()=>{
 const store=new MemoryAutoTradeStore(),now=1790000000000;
 const service=createAutoTradeService({store,now:()=>now,commandSigningKey:'test-signing-key-longer-than-thirty-two-bytes',allowDemoExecution:false});
 const pod={id:'pod',userId:'client',ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:now,tradeMode:'REAL',
  terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local'};
 store.podsByUser.set('client',pod);
 assert.equal((await service.state('client')).connection.state,'CONNECTED_LOCKED');
 const enabled=createAutoTradeService({store,now:()=>now,commandSigningKey:'test-signing-key-longer-than-thirty-two-bytes',allowLocalEaExecution:true});
 for(const permission of ['terminalTradeAllowed','accountTradeAllowed','expertTradeAllowed']){
  pod[permission]=false;assert.equal((await enabled.state('client')).connection.ready,false);pod[permission]=true;
 }
 pod.connectorVersion='1.2.0-ea-local';assert.equal((await enabled.state('client')).connection.state,'BLOCKED_REAL');
});


test('demo-only rollout is limited to nominated user and masked DEMO account, never REAL or another client',async()=>{
 const store=new MemoryAutoTradeStore(),now=Date.now();
 const service=createAutoTradeService({store,now:()=>now,commandSigningKey:'test-signing-key-longer-than-thirty-two-bytes',localEaDemoExecutionUserIds:['owner'],localEaDemoAccountMask:'****6110'});
 const base={id:'pod',userId:'owner',ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:now,tradeMode:'DEMO',accountMask:'****6110',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local'};
 store.podsByUser.set('owner',base);
 assert.equal((await service.state('owner')).control.executionRolloutUnlocked,true);
 for(const [field,value] of [['tradeMode','REAL'],['tradeMode',null],['accountMask','****7777'],['ownershipMode','INTERNAL_DEMO']]){
  const original=base[field];base[field]=value;assert.equal((await service.state('owner')).control.executionRolloutUnlocked,false);await assert.rejects(service.turnOn('owner',{confirmation:'AKTIFKAN DEMO'}),{code:'EXECUTION_ROLLOUT_LOCKED'});base[field]=original;
 }
 store.podsByUser.set('other',{...base,id:'other-pod',userId:'other'});assert.equal((await service.state('other')).control.executionRolloutUnlocked,false);
 await service.saveSettings('owner',{capitalUsd:100,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],riskAcknowledged:true});
 const state=await service.turnOn('owner',{confirmation:'AKTIFKAN DEMO'});assert.equal(state.control.desiredState,'ON');assert.equal(state.control.effectiveState,'ARMING');
});

test('queued DEMO ON is revoked when account leaves its scoped mask before delivery',async()=>{
 const store=new MemoryAutoTradeStore(),now=Date.now(),service=createAutoTradeService({store,now:()=>now,commandSigningKey:'test-signing-key-longer-than-thirty-two-bytes',localEaDemoExecutionUserIds:['owner'],localEaDemoAccountMask:'****6110'});
 const paired=await service.connectLocalEa('owner');const pod=store.podsByUser.get('owner');Object.assign(pod,{lastSeenAt:now,tradeMode:'DEMO',accountMask:'****6110',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local'});
 await service.saveSettings('owner',{capitalUsd:100,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],riskAcknowledged:true});await service.turnOn('owner',{confirmation:'AKTIFKAN DEMO'});pod.accountMask='****7777';
 assert.equal((await service.nextCommand(paired.podToken)).command,null);
});
