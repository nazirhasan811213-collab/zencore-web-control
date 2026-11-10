'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService}=require('../auto-trade-service');
const {AccountHandover}=require('../account-handover');
const settings={capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],riskAcknowledged:true};
const hb={accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',accountFingerprint:'a'.repeat(64),positions:[]};
test('master stop is signed, disables entry and manual adoption, locks ON/settings and leaves other clients intact',async()=>{
 const store=new MemoryAutoTradeStore(),service=createAutoTradeService({store,commandSigningKey:'test-signing-key-more-than-32-characters',allowDemoExecution:true,allowedDemoSymbols:['XAUUSD']});
 const first=await service.connectLocalEa('one'),second=await service.connectLocalEa('two');
 for(const [id,token]of [['one',first.podToken],['two',second.podToken]]){await service.heartbeat(token,hb);await service.saveSettings(id,settings);await store.setControl(id,{desiredState:'ON',effectiveState:'ON'});}
 const stopped=await service.stop('one',{generation:3});a.equal(stopped.control.desiredState,'STOPPED');
 const command=(await service.nextCommand(first.podToken)).command;a.equal(command.type,'SYSTEM_STOP');a.equal(command.payload.masterResetVersion,'MASTER_RESET_V1');a.equal(command.payload.masterResetGeneration,3);
 a.equal(JSON.parse(Buffer.from(command.signedEnvelope,'base64url')).payload.masterResetVersion,'MASTER_RESET_V1');
 await a.rejects(service.turnOn('one',{}),{code:'MASTER_RESET_PENDING'});await a.rejects(service.saveSettings('one',settings),{code:'MASTER_RESET_PENDING'});
 a.equal((await store.getProfile('two')).desiredState,'ON');a.equal((await store.getProfile('one')).manualExit.enabled,false);
 await service.acknowledgeCommand(first.podToken,command.id,{status:'EXECUTED',code:'MASTER_RESET_READY'});
 await a.rejects(service.turnOn('one',{}),{code:'MASTER_RESET_PENDING'});
 a.equal((await store.masterResetCommand('two')),null);
});
test('master reset refuses positions without issuing a close instruction',async()=>{
 const store=new MemoryAutoTradeStore(),service=createAutoTradeService({store,commandSigningKey:'test-signing-key-more-than-32-characters',allowDemoExecution:true});
 const paired=await service.connectLocalEa('one');await service.heartbeat(paired.podToken,hb);
 await store.replacePositions('one',[{ticket:'123',symbol:'XAUUSD',side:'BUY',volume:.01,entry:100}],Date.now());
 await a.rejects(service.stop('one',{generation:0}),{code:'MASTER_RESET_POSITIONS_OPEN'});
 a.equal((store.commands.get(paired.podId)||[]).length,0);a.equal((await store.listPositions('one')).length,1);
});
test('only confirmed active admin can invoke master reset',async()=>{
 const h=new AccountHandover({pool:{query:()=>{throw Error('must not query')}}});
 for(const role of ['client','ib'])await a.rejects(h.masterReset({role,status:'active'},'id',{confirmation:'RESET'}),e=>e.status===403);
 await a.rejects(h.masterReset({role:'admin',status:'active'},'id',{}),e=>e.status===400);
});
