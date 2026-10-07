const test=require('node:test');
const assert=require('node:assert/strict');
const {MemoryAutoTradeStore}=require('../auto-trade-store');
const {createAutoTradeService}=require('../auto-trade-service');
const Core=require('../auto-trade-core');
const user='11111111-1111-4111-8111-111111111111';
const hb={accountMask:'****1234',serverMask:'****Live',brokerMask:'****MT5',tradeMode:'REAL',
 terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,
 connectorVersion:'1.3.0-ea-local',positions:[],symbolSpecs:[]};
async function setup(unlocked=true){
 const store=new MemoryAutoTradeStore();
 const service=createAutoTradeService({store,commandSigningKey:'test-only-key-more-than-thirty-two-characters',allowDemoExecution:unlocked,now:()=>1791000000000});
 const linked=await service.connectLocalEa(user);
 return {store,service,linked};
}
test('REAL local EA reports REAL and requires REAL confirmation; mode persists on settings refresh',async()=>{
 const {service,linked}=await setup();
 await service.heartbeat(linked.podToken,hb);
 await service.saveSettings(user,{capitalUsd:100,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],riskAcknowledged:true,strategyMode:'BOTH'});
 await assert.rejects(service.turnOn(user,{confirmation:'AKTIFKAN DEMO'}),e=>e.code==='CONFIRMATION_REQUIRED');
 let state=await service.turnOn(user,{confirmation:'AKTIFKAN REAL'});
 assert.equal(state.mode,'REAL');assert.equal(state.connection.ready,true);assert.equal(state.safeguards.demoOnly,false);
 let cmd=(await service.nextCommand(linked.podToken)).command;
 assert.equal(cmd.payload.mode,'REAL');assert.equal(cmd.type,'SYSTEM_ON');
 await service.acknowledgeCommand(linked.podToken,cmd.id,{status:'EXECUTED',code:'ARMED'});
 await service.saveSettings(user,{capitalUsd:100,lotPerLayer:.02,layers:2,symbols:['XAUUSD'],riskAcknowledged:true,strategyMode:'BOTH'});
 cmd=(await service.nextCommand(linked.podToken)).command;assert.equal(cmd.payload.mode,'REAL');
});
test('REAL needs new local transport; changed account mode and unknown mode are rejected',async()=>{
 const {service,linked}=await setup();
 await assert.rejects(service.heartbeat(linked.podToken,{...hb,connectorVersion:'1.2.0-ea-local'}),e=>e.code==='REAL_EA_UPGRADE_REQUIRED');
 await service.heartbeat(linked.podToken,hb);
 await assert.rejects(service.heartbeat(linked.podToken,{...hb,tradeMode:'DEMO'}),e=>e.code==='ACCOUNT_MODE_CHANGED');
 await assert.rejects(service.heartbeat(linked.podToken,{...hb,tradeMode:'CONTEST'}),e=>e.code==='INVALID_HEARTBEAT');
});
test('REAL support never bypasses server execution rollout or legacy transport gate',async()=>{
 const {service,linked}=await setup(false);await service.heartbeat(linked.podToken,hb);
 assert.equal((await service.state(user)).connection.ready,false);
 await assert.rejects(service.turnOn(user,{confirmation:'AKTIFKAN REAL'}),e=>e.code==='EXECUTION_ROLLOUT_LOCKED');
 assert.equal(Core.podConnectionState({...hb,lastSeenAt:1791000000000},1791000000000).ready,false);
});
test('DEMO remains supported on new Connector with DEMO confirmation',async()=>{
 const {service,linked}=await setup();await service.heartbeat(linked.podToken,{...hb,tradeMode:'DEMO'});
 await service.saveSettings(user,{capitalUsd:100,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],riskAcknowledged:true});
 await service.turnOn(user,{confirmation:'AKTIFKAN DEMO'});
 assert.equal((await service.nextCommand(linked.podToken)).command.payload.mode,'DEMO');
});
