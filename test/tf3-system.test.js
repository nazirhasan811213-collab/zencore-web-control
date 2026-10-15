'use strict';
const test=require('node:test'),a=require('node:assert/strict'),cp=require('node:child_process');
const S=require('../tf3-scalping'),Hub=require('../tf3-market-hub'),C=require('../analysis-execution-contract'),Core=require('../auto-trade-core'),Alerts=require('../analysis-alert-service'),T=require('../analysis-telegram');
let seq=0;
function fixture(side='BUY'){
 const now=Date.now()+ ++seq,sign=side==='BUY'?1:-1,row=Array(67).fill(null),t=now-180000;
 Object.assign(row,{0:'XAUUSD',1:t,6:4100,13:sign*2,14:sign,21:4,22:4100,23:4100-sign*2.6,24:4100-sign*2.6,25:4100+sign*2,26:4100+sign*4,27:4100+sign*6,28:true,29:side==='BUY',34:side,35:true,36:true,37:true,38:true,39:true,40:true,41:true,42:side==='BUY'?'BULLISH':'BEARISH',43:60,48:'HOLD',49:'HOLD',52:100,56:0,57:'INITIAL',58:'NONE',59:false});
 row[65]={version:'HEMA3_LIVE_V1',tf3:{fast:4100+sign,slow:4100,fastPreviousBar:4100,slowPreviousBar:4100-sign}};
 row[66]={entryRuleVersion:S.RULE,riskPlanVersion:S.RISK,atrPeriod:14,solidSide:side,solidHoldActive:true,solidClosedAt:null,solidTriggeredAt:t,setupAt:t,sourceEntry:4100-sign,solidEligible:true,completedAt:now,completionPrice:4100,riskAtrReference:4,riskStructure:4100-sign*2,riskTick:.01,entryEvent:true,entryAuthorizedAt:now,dashboardAi:{mtfScore:sign,dashboard:{mtfTimeframes:['5','10','15']}}};
 return {row,now,batch:{feedVersion:'TF3_REALTIME_V1',timeframe:'3',schemaVersion:'32.3-EXIT-STEPLOCK',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedChannel:'EXECUTION',confirmed:false,emittedAt:now,markets:[row]}};
}
function market(f){return Hub.ingest(f.batch,f.now)[0];}
test('BUY and SELL compact TF3 feed -> validated decision -> unchanged connector',()=>{for(const side of ['BUY','SELL']){
 const f=fixture(side),m=market(f);a.equal(m.strategyNormal.state,'READY');const d=C.createEntryDecision(m);a.equal(d.snapshot.side,side);a.equal(d.snapshot.executionTimeframe,'3');
 const settings={capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING',tradingSchedule:{enabled:false}};
 const cmd=Core.buildSetupCommand(m,settings,null,f.now);a.ok(cmd);a.equal(cmd.payload.exitPolicy,null);a.equal(cmd.payload.strategyMode,'TF2_SCALPING');
 const command={id:'00000000-0000-4000-8000-000000000000',type:'PLACE_SETUP',expiresAt:f.now+30000,payload:cmd.payload};
 const result=cp.spawnSync('python',['-c',"import sys,json;sys.path.insert(0,'ea-local-connector');from protocol import command_fields;print(json.dumps(command_fields(json.load(sys.stdin),{'account':'123456','server':'TEST','tradeMode':'DEMO'})))"],{input:JSON.stringify(command),encoding:'utf8'});a.equal(result.status,0,result.stderr);const fields=JSON.parse(result.stdout);a.equal(fields.side,side);a.equal(fields.slPolicy,'EXACT_ANALYSIS_V2');
 }});
test('stale, wrong timeframe, old rule and replay batches fail closed',()=>{for(const change of [f=>f.batch.emittedAt-=31000,f=>f.batch.timeframe='2',f=>f.row[66].entryRuleVersion='OLD']){const f=fixture();change(f);a.equal(Hub.ingest(f.batch,f.now).length,0);}const f=fixture();a.equal(Hub.ingest(f.batch,f.now).length,1);a.equal(Hub.ingest(f.batch,f.now).length,0);});
test('opposite ribbon, insufficient slope, excess SL and changed MTF block entry',()=>{for(const change of [f=>f.row[65].tf3.fast=4099,f=>f.row[65].tf3.slowPreviousBar=4100,f=>f.row[23]=4096,f=>f.row[66].dashboardAi.dashboard.mtfTimeframes=['15','30','60'],f=>f.row[66].solidHoldActive=false]){const f=fixture();change(f);const m=market(f);a.equal(m.strategyNormal.state,'WAIT');a.equal(C.createEntryDecision(m),null);}});
test('5/6 accepted; execution event mandatory and Dashboard never orders',()=>{const f=fixture();f.row[43]=40;let m=market(f);a.equal(m.strategyNormal.sop.passed,5);a.ok(C.createEntryDecision(m));m={...m,feedChannel:'DASHBOARD'};a.equal(C.createEntryDecision(m),null);m={...m,feedChannel:'EXECUTION',entryEvent:false};a.equal(C.createEntryDecision(m),null);});
test('TP1 plus .50 uses existing absolute-price SL action, not EA entry override',()=>{const f=fixture();f.row[24]=4100.5;f.row[58]='MOVE_SL_ENTRY_PLUS_050';f.row[59]=true;const m=market(f),d=C.createManagementDecision(m);a.deepEqual(d.snapshot.actions[0],{type:'MOVE_SL_TP1',activeSl:4100.5,lockLabel:'INITIAL'});});
test('Telegram TF3 entry and close preserve timeframe without sending messages',async()=>{const f=fixture(),m=market(f);const service=new Alerts.AnalysisAlerts();await service.init();await service.record(m);const e=service.events.find(x=>x.kind==='ENTRY');a.ok(e);a.equal(T.entrySopAllowed(e),true);a.match(T.telegramMessage(e),/SOLID ENTRY TF3/);a.match(T.telegramMessage(e),/4,100\.00/);const close={...m,receivedAt:f.now+1,entryEvent:false,positionManagement:{action:'EXIT_ALL',reason:'SOP CLOSE ALL'}};await service.record(close);a.ok(service.events.some(x=>x.kind==='CLOSE'&&x.timeframe==='3'));clearInterval(service.cleanupTimer);});

test('ATR8 metadata rejected; chart partial becomes full close; management deduplicates',()=>{let f=fixture();f.row[66].atrPeriod=8;a.equal(market(f).strategyNormal.state,'WAIT');f=fixture();const m=market(f);m.positionManagement={action:'CLOSE_50_NOW',reason:'chart partial'};const d=C.createManagementDecision(m);a.equal(d.snapshot.actions[0].percent,100);a.equal(d.snapshot.actions[0].reason,'EXIT_ALL');a.equal(d.managementKey,C.createManagementDecision({...m,receivedAt:m.receivedAt+1}).managementKey);a.equal(d.snapshot.setupKey,m.setupKey);});
test('queued TF3 confirmation is recomputed from live values',()=>{const m=market(fixture());a.equal(Core.entryConfirmationsPass(m),true);m.strategyNormal.sop.hema3.fast=4099;a.equal(Core.entryConfirmationsPass(m),false);});
test('Pine release uses ATR14, live ribbon and full close on native partial',()=>{const s=require('node:fs').readFileSync(require.resolve('../ZenCore_TF3_Scalp.pine'),'utf8');a.match(s,/atr     = ta.atr\(14\)/);a.match(s,/or xc_partial\n/);a.doesNotMatch(s,/xc_half := true/);a.doesNotMatch(s,/draft_structure_ok|draft_structure_side|frozen_structure/);a.match(s,/alert\(zc24_payload, alert.freq_all\)/);});
test('live TF3 profile queues once and delivery checks TF3 rather than legacy TF2',async()=>{
 const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService,tokenHash}=require('../auto-trade-service');
 const f=fixture(),m=market(f),at=f.now,store=new MemoryAutoTradeStore(),lookups=[];
 const token='zcpod_'+'t'.repeat(48),hash=tokenHash(token);
 const pod={id:'pod',userId:'owner',tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:at,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.2.0-ea-local',symbolSpecs:{}};
 store.podsByUser.set('owner',pod);store.podsByToken.set(hash,pod);
 const svc=createAutoTradeService({store,now:()=>at,scalpingTimeframe:'3',localEaExecutionUserIds:['owner'],allowedDemoSymbols:Core.TRADE_SYMBOLS,commandSigningKey:'test-signing-key-longer-than-thirty-two-bytes',getLatestMarket:(sym,tf)=>{lookups.push(tf);return tf==='3'?m:null;}});
 await svc.saveSettings('owner',{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING',riskAcknowledged:true});await store.setControl('owner',{desiredState:'ON',effectiveState:'ON'});
 a.equal((await svc.dispatchMarkets([m])).queued,1);a.equal((await svc.dispatchMarkets([m])).queued,0);
 const result=await svc.nextCommand(token);a.equal(result.command.payload.analysisSnapshot.executionTimeframe,'3');a.equal(lookups.at(-1),'3');
});

test('far swing structure does not block ATR14 entry; prices anchor to completion for both sides',()=>{
 for(const side of ['BUY','SELL']){
  const f=fixture(side);f.row[66].riskStructure=side==='BUY'?3900:4300;
  const m=market(f);a.equal(m.strategyNormal.state,'READY');a.ok(C.createEntryDecision(m));
  const sign=side==='BUY'?1:-1;
  a.equal(m.strategyNormal.plan.sl,4100-sign*2.6);
  a.equal(m.strategyNormal.plan.tp1,4100+sign*2);
 }
});
test('previous structure-plan version cannot authorize a new entry',()=>{
 const f=fixture();f.row[66].riskPlanVersion='TF3_ATR_STRUCTURE_V1';
 const m=market(f);a.equal(m.strategyNormal.state,'WAIT');a.equal(C.createEntryDecision(m),null);
});

test('newer dashboard cannot consume an unseen execution event; same-channel replay remains blocked',()=>{
 const f=fixture(),dash={...f.batch,feedChannel:'DASHBOARD',emittedAt:f.now+10};
 a.equal(Hub.ingest(dash,f.now+11).length,1);
 const exec=Hub.ingest(f.batch,f.now+12);
 a.equal(exec.length,1);a.ok(C.createEntryDecision(exec[0]));
 a.equal(Hub.ingest(f.batch,f.now+13).length,0);
});

test('reversed channel arrival delivers one TF3 command while dashboard plan remains independent',async()=>{
 const {createRealtimeDispatcher}=require('../realtime-dispatcher');
 const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService,tokenHash}=require('../auto-trade-service');
 const f=fixture(),m=market(f),at=f.now,store=new MemoryAutoTradeStore();
 const token='zcpod_'+'v'.repeat(48),hash=tokenHash(token);
 const pod={id:'pod-flow',userId:'flow',tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:at,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};
 store.podsByUser.set('flow',pod);store.podsByToken.set(hash,pod);
 let dispatcher;
 const svc=createAutoTradeService({store,now:()=>at+20,scalpingTimeframe:'3',localEaExecutionUserIds:['flow'],allowedDemoSymbols:Core.TRADE_SYMBOLS,commandSigningKey:'test-signing-key-longer-than-thirty-two-bytes',getLatestMarket:(sym,tf)=>dispatcher.getLatestMarket(sym,tf)});
 dispatcher=createRealtimeDispatcher({dispatch:(batch,current)=>svc.dispatchMarkets(batch,current),fetchMarkets:async()=>[]});
 await svc.saveSettings('flow',{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING',riskAcknowledged:true});await store.setControl('flow',{desiredState:'ON',effectiveState:'ON'});
 const dashboard=JSON.parse(JSON.stringify(m));dashboard.feedChannel='DASHBOARD';dashboard.entryEvent=false;dashboard.signalObservedAt=at+10;dashboard.receivedAt=at+11;
 for(const k of ['entry','sl','tp1','tp2','tp3'])dashboard.strategyNormal.plan[k]+=.01;
 await dispatcher.onMarket(dashboard);await dispatcher.onMarket(m);
 const result=await svc.nextCommand(token);
 a.equal(result.command.type,'PLACE_SETUP');a.equal(result.command.payload.entry,m.strategyNormal.plan.entry);
 await svc.acknowledgeCommand(token,result.command.id,{status:'EXECUTED',code:'SETUP_OPENED'});
 a.equal((await store.listAudit('flow',30)).some(e=>e.type==='COMMAND_ACKNOWLEDGED'),true);
 a.equal((await svc.nextCommand(token)).command,null);
});

test('independent dashboard cannot override side, source setup or price range checks',()=>{
 const check=require('../entry-delivery-check').checkEntryDelivery;
 for(const [change,reason] of [[m=>m.strategyNormal.side='SELL','SOP_CONFIRMATION_FAILED'],[m=>m.setupKey='other','SETUP_CHANGED'],[m=>m.price=m.strategyNormal.plan.tp1,'PRICE_OUTSIDE_ENTRY_RANGE']]){
  const f=fixture(),m=market(f),cmd=Core.buildSetupCommand(m,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD']},null,f.now);
  const dashboard=JSON.parse(JSON.stringify(m));dashboard.feedChannel='DASHBOARD';change(dashboard);
  a.equal(check(cmd,dashboard,f.now).reason,reason);
 }
});
test('Unified Pine uses one execution stream with heartbeat budget and explicit Telegram status',()=>{
 const text=require('node:fs').readFileSync(require.resolve('../ZenCore_TF3_Scalp.pine'),'utf8');
 a.match(text,/input.string\("Unified", "Feed channel"/);
 a.match(text,/zc24_channel == "Dashboard" \? "DASHBOARD" : "EXECUTION"/);
 a.match(text,/zc24_count < 6/);a.match(text,/zc24_count < 12/);
 a.match(require('node:fs').readFileSync(require.resolve('../analysis-telegram'),'utf8'),/BELUM SAH ORDER MT5/);
});
