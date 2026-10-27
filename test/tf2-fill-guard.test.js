'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const S=require('../tf2-ribbon-scalping'),Hub=require('../tf2-ribbon-market-hub'),C=require('../analysis-execution-contract'),Core=require('../auto-trade-core');let seq=0;
function fixture(side='BUY'){
 const now=Date.now()+ ++seq,sign=side==='BUY'?1:-1,row=Array(67).fill(null),t=now-180000;
 Object.assign(row,{0:'XAUUSD',1:t,6:4100,13:sign*2,14:sign,16:35,21:4,22:4100,23:4100-sign*3,24:4100-sign*3,25:4100+sign*4,26:4100+sign*8,27:4100+sign*12,28:true,29:side==='BUY',34:side,35:true,36:true,37:true,38:true,39:true,40:true,41:true,42:side==='BUY'?'BULLISH':'BEARISH',43:60,48:'HOLD',49:'HOLD',52:100,56:0,57:'INITIAL',58:'NONE',59:false});
 row[65]={version:'HEMA2_LIVE_V1',tf2:{fast:4100+sign,slow:4100,fastPreviousBar:4100,slowPreviousBar:4100-sign}};
 row[66]={entryRuleVersion:S.RULE,exitLockVersion:S.POLICY.exitLockVersion,entryPolicyVersion:S.POLICY.entryPolicyVersion,planMode:"Fixed R:R",riskPlanVersion:S.RISK,atrPeriod:10,solidSide:side,solidHoldActive:true,solidClosedAt:null,solidTriggeredAt:t,setupAt:t,sourceEntry:4100-sign,solidEligible:true,completedAt:now,completionPrice:4100,riskAtrReference:4,riskStructure:4100-sign*2,riskTick:.01,entryEvent:true,entryAuthorizedAt:now,dashboardAi:{momentum:side==='BUY'?'Bullish 🟢':'Bearish 🔴',mtfScore:sign,dashboard:{mtfTimeframes:['3','5','10']}}};
 return {row,now,batch:{feedVersion:'TF2_REALTIME_V1',timeframe:'2',schemaVersion:'32.3-EXIT-STEPLOCK',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedChannel:'EXECUTION',confirmed:false,emittedAt:now,markets:[row]}};
}


const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService}=require('../auto-trade-service');
for(const side of ['BUY','SELL'])test('capped TF2 supports old and guarded EAs while refusing delivery once TP1 has passed: '+side,async()=>{
 const f=fixture(side),sign=side==='BUY'?1:-1;
 Object.assign(f.row,{21:2,23:4100-sign*2,24:4100-sign*2,25:4100+sign*1.5,26:4100+sign*2.3,27:4100+sign*3.5});
 Object.assign(f.row[66],{entryPolicyVersion:S.SOLID_POLICY,riskPlanVersion:S.RISK8_CAPS,atrPeriod:8,riskAtrReference:2});
 const m=Hub.ingest(f.batch,f.now)[0];a.ok(C.createEntryDecision(m,f.now));
 let clock=f.now;const store=new MemoryAutoTradeStore(),user='11111111-1111-4111-8111-111111111111';
 const service=createAutoTradeService({store,now:()=>clock,scalpingTimeframe:'2',allowDemoExecution:true,localEaExecutionUserIds:[user],commandSigningKey:'fill-guard-test-signing-key-longer-than-32-bytes',getLatestMarket:()=>m});
 const linked=await service.connectLocalEa(user);
 const hb={accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',tradeMode:'DEMO',terminalConnected:true,terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.3.0-ea-local',positions:[],symbolSpecs:[]};
 await service.heartbeat(linked.podToken,{...hb,eaVersion:'2.12'});
 await service.saveSettings(user,{capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING',riskAcknowledged:true});
 await store.setControl(user,{desiredState:'ON',effectiveState:'ON'});
 a.equal((await service.dispatchMarkets([m])).queued,1,'old EA may receive a valid capped trade');
 a.equal((await service.dispatchMarkets([m])).queued,0,'same event is still deduplicated');
 await service.heartbeat(linked.podToken,{...hb,eaVersion:'2.13'});
 a.equal((await service.dispatchMarkets([m])).queued,0,'upgrading does not duplicate the queued setup');
 const command=(await service.nextCommand(linked.podToken)).command;a.equal(command.type,'PLACE_SETUP');
 const check=require('../entry-delivery-check').checkEntryDelivery;
 a.equal(check(command,{...m,price:4100+sign*1.5},clock).reason,'TF2_ENTRY_PAST_TP1');
 a.equal(check(command,{...m,price:4100+sign*1.49},clock).ok,true);
 // An older EA heartbeat still permits delivery retry within the fixed deadline.
 await service.heartbeat(linked.podToken,{...hb,eaVersion:'2.12'});
 a.equal((await service.nextCommand(linked.podToken)).command.id,command.id);
});
