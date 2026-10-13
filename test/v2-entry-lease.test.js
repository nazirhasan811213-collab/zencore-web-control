'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService}=require('../auto-trade-service');
test('heartbeat lease never says ON when global pause or rollout lock blocks entry',async()=>{
 const old=process.env.ZENCORE_ENTRY_SIGNALS_PAUSED;
 try{for(const allowed of [false,true]){const store=new MemoryAutoTradeStore(),now=Date.now(),svc=createAutoTradeService({store,now:()=>now,allowLocalEaExecution:allowed,commandSigningKey:'offline-test-signing-key-longer-than-thirty-two-bytes'}),user='test-user';const p=await svc.connectLocalEa(user);await store.setControl(user,{desiredState:'ON',effectiveState:'ON'});const input={accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',tradeMode:'DEMO',connectorVersion:'1.4.0-ea-local',accountFingerprint:'a'.repeat(64),terminalBuild:'6204',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,positions:[],symbolSpecs:[]};
 process.env.ZENCORE_ENTRY_SIGNALS_PAUSED='true';const paused=await svc.heartbeat(p.podToken,input);assert.equal(paused.desiredState,'STOPPED');assert.equal(paused.entryBlockedReason,'GLOBAL_ENTRY_PAUSED');process.env.ZENCORE_ENTRY_SIGNALS_PAUSED='false';const normal=await svc.heartbeat(p.podToken,input);assert.equal(normal.desiredState,allowed?'ON':'STOPPED');assert.equal(normal.entryBlockedReason,allowed?null:'EXECUTION_ROLLOUT_LOCKED');}}
 finally{if(old===undefined)delete process.env.ZENCORE_ENTRY_SIGNALS_PAUSED;else process.env.ZENCORE_ENTRY_SIGNALS_PAUSED=old;}
});
