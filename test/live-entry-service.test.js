'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryAutoTradeStore}=require('../auto-trade-store');const {createAutoTradeService}=require('../auto-trade-service');
const {readyMarket}=require('./fixtures/current-market');const {levelsAtFill}=require('../live-entry-levels');
const user='11111111-1111-4111-8111-111111111111',clock=1791000000000;
const hb={accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.3.0-ea-local',positions:[],symbolSpecs:[]};
async function setup(){
 const source={side:'BUY',entry:100,sl:99,tp1:101,tp2:102,tp3:103};
 let latest=readyMarket({at:clock,plan:source});latest.setupKey='one';latest.entryEvent=true;
 latest.strategyNormal.entrySopVersion='NORMAL_20261001_TF2_TP1_HEMAGAP_V5';latest.strategyNormal.sop.atrReference=1;for(const key of ['hema2','hema3'])Object.assign(latest.strategyNormal.sop[key],{fast:102,slow:101});
 const anchor=()=>latest.strategyNormal.plan={...levelsAtFill(source,latest.price),entryAnchor:'LIVE_SIGNAL_PRICE_V1',sourceChartPlan:source};anchor();
 const store=new MemoryAutoTradeStore(),service=createAutoTradeService({store,commandSigningKey:'test-signing-key-more-than-32-characters',allowDemoExecution:true,allowedDemoSymbols:['XAUUSD'],now:()=>clock,getLatestMarket:()=>latest});
 const c=await service.connectLocalEa(user);await service.heartbeat(c.podToken,hb);
 await service.saveSettings(user,{capitalUsd:100,lotPerLayer:.01,layers:3,symbols:['XAUUSD'],riskAcknowledged:true});await service.turnOn(user,{confirmation:'AKTIFKAN DEMO'});
 const arm=(await service.nextCommand(c.podToken)).command;await service.acknowledgeCommand(c.podToken,arm.id,{status:'EXECUTED'});
 return {store,service,c,get latest(){return latest;},anchor};
}
test('rebased command survives a fresh in-zone quote and retains fixed issued targets',async()=>{
 const f=await setup();assert.equal((await f.service.dispatchMarkets([f.latest])).queued,1);
 f.latest.price=100.2;f.anchor();
 const cmd=(await f.service.nextCommand(f.c.podToken)).command;assert.equal(cmd.type,'PLACE_SETUP');assert.equal(cmd.payload.entry,100.01);assert.equal(cmd.payload.tp1,101.01);
 assert.equal((await f.store.latestSetupForMode(user,'XAUUSD','TF2_SCALPING')).id,cmd.id);
});
test('price outside original TP1 zone cancels queued live-anchor order',async()=>{
 const f=await setup();await f.service.dispatchMarkets([f.latest]);f.latest.price=101.1;f.anchor();
 assert.equal((await f.service.nextCommand(f.c.podToken)).command,null);
});
test('rebased positions ignore old chart close and use reported TP1 for StepLock',async()=>{
 const f=await setup();await f.service.dispatchMarkets([f.latest]);const cmd=(await f.service.nextCommand(f.c.podToken)).command,p=cmd.payload;
 await f.service.acknowledgeCommand(f.c.podToken,cmd.id,{status:'EXECUTED'});
 const pos={ticket:'1234',origin:'ZENCORE',symbol:'XAUUSD',side:'BUY',strategyMode:'TF2_SCALPING',volume:.03,entry:p.entry,currentPrice:p.entry,activeSl:p.sl,openedAt:clock-60000,tp1:p.tp1,tp2:p.tp2,tp3:p.tp3};
 await f.service.heartbeat(f.c.podToken,{...hb,positions:[pos]});
 f.latest.positionManagement={action:'EXIT_SL',slMoveTriggered:true,slMoveAction:'MOVE_SL_TP1',activeSl:101};
 assert.equal((await f.service.dispatchMarkets([f.latest])).queued,0);
 pos.currentPrice=p.tp1+.01;await f.service.heartbeat(f.c.podToken,{...hb,positions:[pos]});
 assert.equal((await f.service.dispatchMarkets([f.latest])).queued,1);
 const managed=(await f.service.nextCommand(f.c.podToken)).command;assert.equal(managed.type,'MANAGE_POSITION');assert.equal(managed.payload.analysisSnapshot.entryCommandId,cmd.id);
 assert.equal(managed.payload.actions.find(x=>x.type==='MOVE_SL_ENTRY').activeSl,p.entry);
});
test('execution contract rejects altered target distances and rebasing outside original zone',async()=>{
 const C=require('../analysis-execution-contract'),f=await setup();assert.ok(C.createEntryDecision(f.latest));
 const forged=structuredClone(f.latest);forged.strategyNormal.plan.tp1+=.1;assert.equal(C.createEntryDecision(forged),null);
 f.latest.price=101.1;f.anchor();assert.equal(C.createEntryDecision(f.latest),null);
});
