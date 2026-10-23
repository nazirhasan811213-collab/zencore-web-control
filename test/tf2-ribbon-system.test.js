'use strict';
const test=require('node:test'),a=require('node:assert/strict'),cp=require('node:child_process');
const S=require('../tf2-ribbon-scalping'),Hub=require('../tf2-ribbon-market-hub'),C=require('../analysis-execution-contract'),Core=require('../auto-trade-core'),Alerts=require('../analysis-alert-service'),T=require('../analysis-telegram');
let seq=0;
function fixture(side='BUY'){
 const now=Date.now()+ ++seq,sign=side==='BUY'?1:-1,row=Array(67).fill(null),t=now-180000;
 Object.assign(row,{0:'XAUUSD',1:t,6:4100,13:sign*2,14:sign,16:35,21:4,22:4100,23:4100-sign*3,24:4100-sign*3,25:4100+sign*4,26:4100+sign*8,27:4100+sign*12,28:true,29:side==='BUY',34:side,35:true,36:true,37:true,38:true,39:true,40:true,41:true,42:side==='BUY'?'BULLISH':'BEARISH',43:60,48:'HOLD',49:'HOLD',52:100,56:0,57:'INITIAL',58:'NONE',59:false});
 row[65]={version:'HEMA2_LIVE_V1',tf2:{fast:4100+sign,slow:4100,fastPreviousBar:4100,slowPreviousBar:4100-sign}};
 row[66]={entryRuleVersion:S.RULE,entryPolicyVersion:S.POLICY.entryPolicyVersion,planMode:"Fixed R:R",riskPlanVersion:S.RISK,atrPeriod:10,solidSide:side,solidHoldActive:true,solidClosedAt:null,solidTriggeredAt:t,setupAt:t,sourceEntry:4100-sign,solidEligible:true,completedAt:now,completionPrice:4100,riskAtrReference:4,riskStructure:4100-sign*2,riskTick:.01,entryEvent:true,entryAuthorizedAt:now,dashboardAi:{momentum:side==='BUY'?'Bullish 🟢':'Bearish 🔴',mtfScore:sign,dashboard:{mtfTimeframes:['3','5','10']}}};
 return {row,now,batch:{feedVersion:'TF2_REALTIME_V1',timeframe:'2',schemaVersion:'32.3-EXIT-STEPLOCK',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedChannel:'EXECUTION',confirmed:false,emittedAt:now,markets:[row]}};
}
function market(f){return Hub.ingest(f.batch,f.now)[0];}
test('BUY and SELL compact TF2 feed -> validated decision -> unchanged connector',()=>{for(const side of ['BUY','SELL']){
 const f=fixture(side),m=market(f);a.equal(m.strategyNormal.state,'READY');const d=C.createEntryDecision(m);a.equal(d.snapshot.side,side);a.equal(d.snapshot.executionTimeframe,'2');
 const settings={capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING',tradingSchedule:{enabled:false}};
 const cmd=Core.buildSetupCommand(m,settings,null,f.now);a.ok(cmd);a.equal(cmd.payload.exitPolicy,null);a.equal(cmd.payload.strategyMode,'TF2_SCALPING');
 const command={id:'00000000-0000-4000-8000-000000000000',type:'PLACE_SETUP',expiresAt:f.now+30000,payload:cmd.payload};
 const result=cp.spawnSync('python',['-c',"import sys,json;sys.path.insert(0,'ea-local-connector');from protocol import command_fields;print(json.dumps(command_fields(json.load(sys.stdin),{'account':'123456','server':'TEST','tradeMode':'DEMO'})))"],{input:JSON.stringify(command),encoding:'utf8'});a.equal(result.status,0,result.stderr);const fields=JSON.parse(result.stdout);a.equal(fields.side,side);a.equal(fields.slPolicy,'EXACT_ANALYSIS_V2');a.equal(fields.executionTimeframe,'2');a.equal(fields.exitLockVersion,'PINE_STEPLOCK_150_TP3_PLUS3_V1');
 }});
test('stale, wrong timeframe, old rule and replay batches fail closed',()=>{for(const change of [f=>f.batch.emittedAt-=61000,f=>f.batch.timeframe='3',f=>f.row[66].entryRuleVersion='OLD']){const f=fixture();change(f);a.equal(Hub.ingest(f.batch,f.now).length,0);}const f=fixture();a.equal(Hub.ingest(f.batch,f.now).length,1);a.equal(Hub.ingest(f.batch,f.now).length,0);});
test('opposite ribbon, excess SL and changed MTF block entry',()=>{for(const change of [f=>f.row[65].tf2.fast=4099,f=>f.row[23]=4094,f=>f.row[66].dashboardAi.dashboard.mtfTimeframes=['15','30','60'],f=>f.row[66].solidHoldActive=false]){const f=fixture();change(f);const m=market(f);a.equal(m.strategyNormal.state,'WAIT');a.equal(C.createEntryDecision(m),null);}});
test('Forecast ignored; execution event mandatory and Dashboard never orders',()=>{const f=fixture();f.row[43]=40;let m=market(f);a.equal(m.strategyNormal.sop.passed,4);a.ok(C.createEntryDecision(m));m={...m,feedChannel:'DASHBOARD'};a.equal(C.createEntryDecision(m),null);m={...m,feedChannel:'EXECUTION',entryEvent:false};a.equal(C.createEntryDecision(m),null);});
test('TP1 plus .50 uses existing absolute-price SL action, not EA entry override',()=>{const f=fixture();f.row[24]=4100.5;f.row[58]='MOVE_SL_ENTRY_PLUS_050';f.row[59]=true;const m=market(f),d=C.createManagementDecision(m);a.deepEqual(d.snapshot.actions[0],{type:'MOVE_SL_TP1',activeSl:4100.5,lockLabel:'INITIAL'});});
test('Telegram TF2 entry and close preserve timeframe without sending messages',async()=>{const f=fixture(),m=market(f);const service=new Alerts.AnalysisAlerts();await service.init();await service.record(m);const e=service.events.find(x=>x.kind==='ENTRY');a.ok(e);a.equal(T.entrySopAllowed(e),true);a.match(T.telegramMessage(e),/SOLID ENTRY TF2/);a.match(T.telegramMessage(e),/4,100\.00/);const close={...m,receivedAt:f.now+1,entryEvent:false,positionManagement:{action:'EXIT_ALL',reason:'SOP CLOSE ALL'}};await service.record(close);a.ok(service.events.some(x=>x.kind==='CLOSE'&&x.timeframe==='2'));clearInterval(service.cleanupTimer);});

test('ATR8 metadata rejected; chart partial becomes full close; management deduplicates',()=>{let f=fixture();f.row[66].atrPeriod=8;a.equal(market(f).strategyNormal.state,'WAIT');f=fixture();const m=market(f);m.positionManagement={action:'CLOSE_50_NOW',reason:'chart partial'};const d=C.createManagementDecision(m);a.equal(d.snapshot.actions[0].percent,100);a.equal(d.snapshot.actions[0].reason,'EXIT_ALL');a.equal(d.managementKey,C.createManagementDecision({...m,receivedAt:m.receivedAt+1}).managementKey);a.equal(d.snapshot.setupKey,m.setupKey);});
test('queued TF2 confirmation is recomputed from live values',()=>{const m=market(fixture());a.equal(Core.entryConfirmationsPass(m),true);m.strategyNormal.sop.hema2.fast=4099;a.equal(Core.entryConfirmationsPass(m),false);});
test('Pine release uses ATR10, live ribbon and full close on native partial',()=>{const s=require('node:fs').readFileSync(require.resolve('../ZenCore_TF2_Scalp.pine'),'utf8');a.match(s,/atr     = ta.atr\(10\)/);a.match(s,/or xc_partial\n/);a.doesNotMatch(s,/xc_half := true/);a.doesNotMatch(s,/draft_structure_ok|draft_structure_side|frozen_structure/);a.match(s,/alert\(zc24_payload, alert.freq_all\)/);});
test('live TF2 profile queues once and delivery checks TF2 rather than legacy TF2',async()=>{
 const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService,tokenHash}=require('../auto-trade-service');
 const f=fixture(),m=market(f),at=f.now,store=new MemoryAutoTradeStore(),lookups=[];
 const token='zcpod_'+'t'.repeat(48),hash=tokenHash(token);
 const pod={id:'pod',userId:'owner',tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:at,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.2.0-ea-local',symbolSpecs:{}};
 store.podsByUser.set('owner',pod);store.podsByToken.set(hash,pod);
 const svc=createAutoTradeService({store,now:()=>at,scalpingTimeframe:'2',localEaExecutionUserIds:['owner'],allowedDemoSymbols:Core.TRADE_SYMBOLS,commandSigningKey:'test-signing-key-longer-than-thirty-two-bytes',getLatestMarket:(sym,tf)=>{lookups.push(tf);return tf==='2'?m:null;}});
 await svc.saveSettings('owner',{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING',riskAcknowledged:true});await store.setControl('owner',{desiredState:'ON',effectiveState:'ON'});
 a.equal((await svc.dispatchMarkets([m])).queued,1);a.equal((await svc.dispatchMarkets([m])).queued,0);
 m.entryDeliveryVersion='FIXED_EVENT_RETRY_V1';
 const retry={...m,receivedAt:at+1,signalObservedAt:at+1};
 a.equal((await svc.dispatchMarkets([retry])).queued,0);
 const result=await svc.nextCommand(token);a.equal(result.command.payload.analysisSnapshot.executionTimeframe,'2');a.equal(lookups.at(-1),'2');
});

test('far swing structure does not block ATR10 entry; prices anchor to completion for both sides',()=>{
 for(const side of ['BUY','SELL']){
  const f=fixture(side);f.row[66].riskStructure=side==='BUY'?3900:4300;
  const m=market(f);a.equal(m.strategyNormal.state,'READY');a.ok(C.createEntryDecision(m));
  const sign=side==='BUY'?1:-1;
  a.equal(m.strategyNormal.plan.sl,4100-sign*3);
  a.equal(m.strategyNormal.plan.tp1,4100+sign*4);
 }
});
test('previous structure-plan version cannot authorize a new entry',()=>{
 const f=fixture();f.row[66].riskPlanVersion='TF2_ATR_STRUCTURE_V1';
 const m=market(f);a.equal(m.strategyNormal.state,'WAIT');a.equal(C.createEntryDecision(m),null);
});

test('newer dashboard cannot consume an unseen execution event; same-channel replay remains blocked',()=>{
 const f=fixture(),dash={...f.batch,feedChannel:'DASHBOARD',emittedAt:f.now+10};
 a.equal(Hub.ingest(dash,f.now+11).length,1);
 const exec=Hub.ingest(f.batch,f.now+12);
 a.equal(exec.length,1);a.ok(C.createEntryDecision(exec[0]));
 a.equal(Hub.ingest(f.batch,f.now+13).length,0);
});

test('reversed channel arrival delivers one TF2 command while dashboard plan remains independent',async()=>{
 const {createRealtimeDispatcher}=require('../realtime-dispatcher');
 const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService,tokenHash}=require('../auto-trade-service');
 const f=fixture(),m=market(f),at=f.now,store=new MemoryAutoTradeStore();
 const token='zcpod_'+'v'.repeat(48),hash=tokenHash(token);
 const pod={id:'pod-flow',userId:'flow',tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:at,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};
 store.podsByUser.set('flow',pod);store.podsByToken.set(hash,pod);
 let dispatcher;
 const svc=createAutoTradeService({store,now:()=>at+20,scalpingTimeframe:'2',localEaExecutionUserIds:['flow'],allowedDemoSymbols:Core.TRADE_SYMBOLS,commandSigningKey:'test-signing-key-longer-than-thirty-two-bytes',getLatestMarket:(sym,tf)=>dispatcher.getLatestMarket(sym,tf)});
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

test('independent dashboard cannot be used to deliver a queued TF2 execution',()=>{
 const check=require('../entry-delivery-check').checkEntryDelivery;
 for(const [change,reason] of [[m=>m.strategyNormal.side='SELL','SOP_CONFIRMATION_FAILED'],[m=>m.setupKey='other','SETUP_CHANGED']]){
  const f=fixture(),m=market(f),cmd=Core.buildSetupCommand(m,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD']},null,f.now);
  const dashboard=JSON.parse(JSON.stringify(m));dashboard.feedChannel='DASHBOARD';change(dashboard);
  a.equal(check(cmd,dashboard,f.now).reason,'EXECUTION_FEED_REQUIRED');
 }
});
test('Unified Pine uses one execution stream with heartbeat budget and explicit Telegram status',()=>{
 const text=require('node:fs').readFileSync(require.resolve('../ZenCore_TF2_Scalp.pine'),'utf8');
 a.match(text,/input.string\("Unified", "Feed channel"/);
 a.match(text,/zc24_channel == "Dashboard" \? "DASHBOARD" : "EXECUTION"/);
 a.match(text,/zc24_count < 6/);a.match(text,/zc24_count < 12/);
 a.match(require('node:fs').readFileSync(require.resolve('../analysis-telegram'),'utf8'),/belum pengesahan order MT5/);
});

test('newer dashboard does not suppress a matching execution close event',async()=>{
 const {createRealtimeDispatcher}=require('../realtime-dispatcher'),seen=[];
 const f=fixture(),m=market(f),exit={...m,entryEvent:false,positionManagement:{action:'EXIT_ALL',reason:'SOP CLOSE ALL'}};
 const dashboard={...m,feedChannel:'DASHBOARD',entryEvent:false,signalObservedAt:f.now+10};
 const dispatcher=createRealtimeDispatcher({dispatch:async batch=>seen.push(...batch),fetchMarkets:async()=>[]});
 await dispatcher.onMarket(dashboard);await dispatcher.onMarket(exit);
 a.equal(seen.at(-1),exit);
});

test('TF2 accepts 3/4 for BUY and SELL, rejects 2/4 and keeps mandatory HEMA',()=>{
 for(const side of ['BUY','SELL']){
  const f=fixture(side),sign=side==='BUY'?1:-1;
  f.row[43]=side==='BUY'?40:40;f.row[42]=side==='BUY'?'BULLISH':'BEARISH';

  let m=market(f);a.equal(m.strategyNormal.sop.passed,4);a.equal(m.strategyNormal.sop.requiredPassed,3);a.ok(C.createEntryDecision(m));
  const bad=fixture(side);bad.row[43]=40;bad.row[42]=side==='BUY'?'BULLISH':'BEARISH';bad.row[66].dashboardAi.mtfScore=-sign;bad.row[66].sourceEntry=4100+sign;
  m=market(bad);a.equal(m.strategyNormal.sop.passed,2);a.equal(C.createEntryDecision(m),null);
 }
});
test('chart renders SOP completion plan and suppresses native trade levels on TF2',()=>{
 const text=require('node:fs').readFileSync(require.resolve('../ZenCore_TF2_Scalp.pine'),'utf8');
 a.match(text,/zc80_passed >= 3/);a.doesNotMatch(text,/zc80_passed >= 5|Minimum 5\/6/);
 a.match(text,/transition_line := timeframe.period == "2" \? na : line.new/);
 a.match(text,/entry_label := timeframe.period == "2" \? na : label.new/);
 a.match(text,/array.from\(zc_seq_entry, draft_sl, zc_seq_tp1, zc_seq_tp2, zc_seq_tp3\)/);
 a.match(text,/"ENTRY SOP " \+ zc_seq_side, "SL SOP", "TP1 SOP", "TP2 SOP", "TP3 SOP"/);
 a.match(text,/if timeframe.period != "2"/);
});

test('native Pine holds unqualified SOLID through opposite ribbon, ends qualified SOLID on reversal',()=>{
 const text=require('node:fs').readFileSync(require.resolve('../ZenCore_TF2_Scalp.pine'),'utf8');
 const expr=text.match(/^bool zc_held_colour_end = (.+)$/m)[1].replaceAll(' and ',' && ').replace('not na(zc_seq_completed)','(zc_seq_completed !== null)');
 const evaluate=new Function('zc_hold_active','zc_seq_completed','zc_seq_side','zc_solid_end_buy','zc_solid_end_sell','return '+expr);
 for(const side of ['BUY','SELL']){
  a.equal(evaluate(true,null,side,true,true),false);
  a.equal(evaluate(true,100,side,true,true),true);
  a.equal(evaluate(true,100,side,false,false),false);
 }
 a.doesNotMatch(text,/zc_pending_colour_end/);
 a.match(text,/zc_hold_qualify = draft_ribbon and zc_movement_pass and draft_plan_ok/);
});
test('source benchmark precedes qualification; fibo zone and trade plan follow frozen SOP entry',()=>{
 const text=require('node:fs').readFileSync(require.resolve('../ZenCore_TF2_Scalp.pine'),'utf8');
 const reference=text.indexOf('float solidReference ='),plan=text.indexOf('if zc24_chart_ok and not na(zc_seq_completed)',reference);
 a.ok(reference>0&&plan>reference);
 a.match(text,/line.new\(solidStart,solidReference/);
 a.match(text,/f_priceFromRatio\(draft_sl,zc_seq_entry,0.786\)/);
 a.match(text,/f_priceFromRatio\(draft_sl,zc_seq_entry,0.236\)/);
 a.match(text,/if not na\(zc_seq_completed\) and bar_index == zc_plan_bar/);
 a.match(text,/array.size\(sopEntryHistory\) > 80/);
 a.match(text,/timeframe.period == "2" and nativeTpLabel \? na/);
});

// Requested policy: slope counts as one confirmation, never an extra mandatory gate.
test('flat HEMA40 accepts exactly 4/5 with matching ribbon, rejects 3/5 for BUY and SELL',()=>{
 for(const side of ['BUY','SELL']){
  const f=fixture(side);f.row[65].tf2.slowPreviousBar=f.row[65].tf2.slow;f.row[43]=40;
  let m=market(f);a.equal(m.strategyNormal.sop.passed,4);a.equal(m.strategyNormal.state,'READY');a.ok(C.createEntryDecision(m));
  const g=fixture(side);g.row[65].tf2.slowPreviousBar=g.row[65].tf2.slow;g.row[43]=40;g.row[13]=side==='BUY'?-2:2;
  m=market(g);a.equal(m.strategyNormal.sop.passed,3);a.equal(C.createEntryDecision(m),null);
 }
});
test('fresh authorized TF2 event is not blocked solely by TP1 or SL range',()=>{
 const check=require('../entry-delivery-check').checkEntryDelivery;
 for(const side of ['BUY','SELL'])for(const key of ['tp1','sl']){
  const f=fixture(side),m=market(f);m.price=m.strategyNormal.plan[key];
  const cmd=Core.buildSetupCommand(m,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD']},null,f.now);
  a.ok(cmd);a.equal(check(cmd,m,f.now).ok,true);
 }
});
test('Pine qualification keeps Movement and ribbon mandatory with five confirmations',()=>{
 const s=require('node:fs').readFileSync(require.resolve('../ZenCore_TF2_Scalp.pine'),'utf8');
 const gates=s.split('\n').filter(l=>l.startsWith('bool zc_hold_qualify =')||l.startsWith('bool zc24_ready =')||l.startsWith('zc24_ready :='));
 a.equal(gates.length,3);for(const g of gates){a.match(g,/draft_ribbon/);a.match(g,/zc80_passed >= 3/);a.doesNotMatch(g,/zc80_hema40/);}
 a.match(s,/bool zc_movement_pass =/);a.doesNotMatch(s,/bool zc_seq_shape =/);
});


test('fixed-event retry keeps original authorization, deadline and setup identity',()=>{
 const f=fixture();f.now+=100;f.batch.emittedAt=f.now;const auth=f.now-20000;
 Object.assign(f.row[66],{entryDeliveryVersion:'FIXED_EVENT_RETRY_V1',completedAt:auth,entryAuthorizedAt:auth});
 const m=market(f),d=C.createEntryDecision(m);a.ok(d);a.equal(d.snapshot.entryAuthorizedAt,auth);
 const cmd=Core.buildSetupCommand(m,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'BOTH'},null,f.now);
 a.ok(cmd);a.equal(cmd.notAfterMs,auth+60000);
 const retry={...m,receivedAt:f.now+1,signalObservedAt:f.now+1};
 a.equal(C.createEntryDecision(retry).signalKey,d.signalKey);
 const check=require('../entry-delivery-check').checkEntryDelivery;
 a.equal(check({payload:cmd.payload},m,auth+60001).reason,'ENTRY_EVENT_EXPIRED');
 a.equal(C.createEntryDecision({...m,entryAuthorizedAt:auth+1}),null);
 a.equal(C.createEntryDecision({...m,feedChannel:'DASHBOARD'}),null);
 a.equal(C.createEntryDecision({...m,entryEvent:false}),null);
 const stale=fixture();stale.now+=200;stale.batch.emittedAt=stale.now;Object.assign(stale.row[66],{entryDeliveryVersion:'FIXED_EVENT_RETRY_V1',completedAt:stale.now-61000,entryAuthorizedAt:stale.now-61000});
 a.equal(C.createEntryDecision(market(stale)),null);
});


test('TF2 event lifetime accepts 45s and exactly 60s; rejects after 60s without timer renewal',()=>{
 for(const age of [45000,60000,60001]){
  const f=fixture();f.now+=500;const origin=f.now-age;f.batch.emittedAt=origin;
  Object.assign(f.row[66],{entryDeliveryVersion:'FIXED_EVENT_RETRY_V1',completedAt:origin,entryAuthorizedAt:origin});
  delete require.cache[require.resolve('../tf2-ribbon-market-hub')];const hub=require('../tf2-ribbon-market-hub');
  const m=hub.ingest(f.batch,f.now)[0];
  if(age>60000){a.equal(m,undefined);continue;}
  a.ok(m);a.ok(S.entryDecision(m,f.now));
  if(age===45000){
   const cmd=Core.buildSetupCommand(m,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'BOTH'},null,f.now);
   a.ok(cmd);a.equal(cmd.notAfterMs,origin+60000);
   a.equal(require('../entry-delivery-check').checkEntryDelivery({payload:cmd.payload},m,f.now).ok,true);
   a.equal(require('../entry-delivery-check').checkEntryDelivery({payload:cmd.payload},m,origin+60001).reason,'ENTRY_EVENT_EXPIRED');
  }
 }
});


test('signed TF2 order survives an 11s poll without extending the original event deadline',async()=>{
 const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService,tokenHash}=require('../auto-trade-service');
 for(const side of ['BUY','SELL'])for(const age of [0,48000]){
  const f=fixture(side);f.now+=100;const auth=f.now-age;f.batch.emittedAt=f.now;
  Object.assign(f.row[66],{entryDeliveryVersion:'FIXED_EVENT_RETRY_V1',completedAt:auth,entryAuthorizedAt:auth});
  delete require.cache[require.resolve('../tf2-ribbon-market-hub')];
  const m=require('../tf2-ribbon-market-hub').ingest(f.batch,f.now)[0];a.ok(m);let at=f.now;const store=new MemoryAutoTradeStore(),token='zcpod_'+'q'.repeat(48),hash=tokenHash(token);
  const pod={id:'expiry-pod',userId:'expiry-owner',tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:at,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};
  store.podsByUser.set(pod.userId,pod);store.podsByToken.set(hash,pod);
  const svc=createAutoTradeService({store,now:()=>at,scalpingTimeframe:'2',localEaExecutionUserIds:[pod.userId],allowedDemoSymbols:Core.TRADE_SYMBOLS,commandSigningKey:'expiry-regression-signing-key-longer-than-32',getLatestMarket:()=>m});
  await svc.saveSettings(pod.userId,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING',riskAcknowledged:true,tradingSchedule:{enabled:false,skipUsNews:false}});
  await store.setControl(pod.userId,{desiredState:'ON',effectiveState:'ON'});
  a.equal((await svc.dispatchMarkets([m])).queued,1);
  at+=11000;const result=await svc.nextCommand(token);a.ok(result.command);
  a.equal(result.command.expiresAt,auth+60000);
  a.equal(JSON.parse(Buffer.from(result.command.signedEnvelope,'base64url')).expiresAt,auth+60000);
  if(age===0){
   // Existing Connector conservatively adds the full fetch RTT to serverTime.
   const verified=cp.spawnSync('python',['-c',"import sys,json;sys.path.insert(0,'ea-local-connector');from protocol import command_server_time;x=json.load(sys.stdin);assert x['command']['expiresAt']>command_server_time(x,11000)"],{input:JSON.stringify(result),encoding:'utf8'});
   a.equal(verified.status,0,verified.stderr);
  }
  a.equal((await svc.dispatchMarkets([m])).queued,0);
  at=auth+60001;a.equal((await svc.nextCommand(token)).command,null);
 }
});


test('current Telegram layout puts action and own plan before bounded analysis, without claiming an MT5 fill',async()=>{
 for(const side of ['BUY','SELL']){
  const f=fixture(side);delete require.cache[require.resolve('../tf2-ribbon-market-hub')];
  const m=require('../tf2-ribbon-market-hub').ingest(f.batch,f.now)[0],alerts=new Alerts.AnalysisAlerts();a.ok(m);await alerts.init();
  try{
   await alerts.record(m);const event=alerts.events.find(x=>x.kind==='ENTRY');a.ok(event);
   event.telegramSop.advisor={trend:side==='BUY'?'Uptrend':'Downtrend',momentum:side==='BUY'?'Bullish':'Bearish',mtfSummary:'Ringkasan '.repeat(200),advice:'SETUP KURANG PADU.',proTip:'JAGA MODAL - JANGAN TRADE'};
   const text=T.telegramMessage(event);a.ok(text.length<4096);a.ok(text.startsWith('━━━━━━━━━━━━━━━━━━\n'+(side==='BUY'?'🟢':'🔴')));
   a.ok(text.indexOf('📌 APA NAK BUAT')<text.indexOf('🎯 PELAN ENTRY'));a.ok(text.indexOf('🎯 PELAN ENTRY')<text.indexOf('📊 ANALYSIS SEMASA'));
   a.match(text,/Jangan tambah entry atau re-entry/);a.match(text,/belum pengesahan order MT5/);
   a.equal((text.match(/Entry:/g)||[]).length,1);a.equal((text.match(/SL:/g)||[]).length,1);a.equal((text.match(/Forecast 10 candle:/g)||[]).length,1);
   a.equal((text.match(/SETUP HIGH RISK JAGA SAIZ LAYER DAN LOT/g)||[]).length,1);
   a.doesNotMatch(text,/ORDER DIBUKA|ORDER EXECUTED|STATUS: SETUP ANALYSIS|undefined|NaN/);
   a.match(text,/Rujukan: ZC-/);a.match(text,/MYT/);
  }finally{clearInterval(alerts.cleanupTimer);}
 }
});

test('normal entry and re-entry both wait until every own scalping position closes',()=>{
 const f=fixture();delete require.cache[require.resolve('../tf2-ribbon-market-hub')];const m=require('../tf2-ribbon-market-hub').ingest(f.batch,f.now)[0];
 for(const entryType of ['SOLID_ENTRY','REENTRY']){
  m.strategyNormal.entryType=entryType;
  for(const side of ['BUY','SELL']){
   const position={symbol:'XAUUSD',side,strategyMode:'TF2_SCALPING',origin:'ZENCORE'};
   a.equal(Core.permitsPositionEntry(m,[position]),false);
   a.equal(Core.permitsPositionEntry(m,[position,{...position,ticket:'second'}]),false);
  }
  a.equal(Core.permitsPositionEntry(m,[]),true);
  a.equal(Core.permitsPositionEntry(m,[{symbol:'XAUUSD',side:'BUY',strategyMode:'TF15_INTRA',origin:'ZENCORE'}]),true);
 }
});


test('TF2 requires MTF 3/5/10 and rejects the old 5/10/15 feed',()=>{
 a.deepEqual(S.POLICY.mtf,['3','5','10']);
 const f=fixture();f.row[66].dashboardAi.dashboard.mtfTimeframes=['5','10','15'];
 delete require.cache[require.resolve('../tf2-ribbon-market-hub')];
 const m=require('../tf2-ribbon-market-hub').ingest(f.batch,f.now)[0];
 a.equal(m.strategyNormal.state,'WAIT');a.equal(C.createEntryDecision(m),null);
 const pine=require('node:fs').readFileSync(require.resolve('../ZenCore_TF2_Scalp.pine'),'utf8');
 a.match(pine,/tf_1 := "3"\n    tf_2 := "5"\n    tf_3 := "10"/);
});


test('live 207ms Dashboard setup mismatch cannot revoke a queued TF2 execution',async()=>{
 const {createRealtimeDispatcher}=require('../realtime-dispatcher');
 const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService,tokenHash}=require('../auto-trade-service');
 for(const dashboardFirst of [true,false]){
  const f=fixture(),at=f.now,store=new MemoryAutoTradeStore();
  delete require.cache[require.resolve('../tf2-ribbon-market-hub')];const hub=require('../tf2-ribbon-market-hub');
  const m=hub.ingest(f.batch,at)[0];
  const token='zcpod_'+'r'.repeat(48),hash=tokenHash(token);
  const pod={id:'pod-authority',userId:'authority',tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:at,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};
  store.podsByUser.set(pod.userId,pod);store.podsByToken.set(hash,pod);
  let clock=at,dispatcher;
  const svc=createAutoTradeService({store,now:()=>clock,scalpingTimeframe:'2',localEaExecutionUserIds:[pod.userId],allowedDemoSymbols:Core.TRADE_SYMBOLS,commandSigningKey:'regression-authority-key-longer-than-thirty-two-bytes',getLatestMarket:(sym,tf)=>dispatcher.getLatestMarket(sym,tf)});
  dispatcher=createRealtimeDispatcher({dispatch:(batch,current)=>svc.dispatchMarkets(batch,current),fetchMarkets:async()=>hub.markets()});
  await svc.saveSettings(pod.userId,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING',riskAcknowledged:true});await store.setControl(pod.userId,{desiredState:'ON',effectiveState:'ON'});
  const dashboard=JSON.parse(JSON.stringify(m));dashboard.feedChannel='DASHBOARD';dashboard.entryEvent=true;dashboard.setupKey='TF2|XAUUSD|BUY|'+(at+207);dashboard.signalObservedAt=at+207;dashboard.receivedAt=at+208;dashboard.strategyNormal.sop.qualifiedAt=at+207;
  for(const k of ['entry','sl','tp1','tp2','tp3'])dashboard.strategyNormal.plan[k]+=.01;
  const legacy=JSON.parse(JSON.stringify(m));legacy.timeframe='3';legacy.strategyNormal.tf='3m';legacy.strategyNormal.entrySopVersion='NORMAL_20261001_TF3_RIBBON_V1';legacy.setupKey='TF3|XAUUSD|BUY|'+at;
  await dispatcher.onMarket(legacy);a.equal((await svc.nextCommand(token)).command,null);
  if(dashboardFirst)await dispatcher.onMarket(dashboard);
  await dispatcher.onMarket(m);
  if(!dashboardFirst)await dispatcher.onMarket(dashboard);
  a.equal(dispatcher.getLatestMarket('XAUUSD','2'),m);
  clock=at+1000;
  const result=await svc.nextCommand(token);
  a.equal(result.command.type,'PLACE_SETUP');a.equal(result.command.payload.analysisSnapshot.setupKey,m.setupKey);a.equal(result.command.payload.entry,m.strategyNormal.plan.entry);
  await svc.acknowledgeCommand(token,result.command.id,{status:'EXECUTED',code:'SETUP_OPENED'});
  await dispatcher.onMarket(dashboard);await dispatcher.tick();
  a.equal((await svc.nextCommand(token)).command,null);
 }
});

test('TF2 Dashboard cannot replace an in-flight event; fresh EXECUTION changes still revoke it',async()=>{
 const {createRealtimeDispatcher}=require('../realtime-dispatcher');
 for(const executionChanges of [false,true]){
  const f=fixture();delete require.cache[require.resolve('../tf2-ribbon-market-hub')];const m=require('../tf2-ribbon-market-hub').ingest(f.batch,f.now)[0];
  let release,allowed;const gate=new Promise(r=>release=r);
  const d=createRealtimeDispatcher({dispatch:async(batch,current)=>{if(allowed===undefined){await gate;allowed=current(batch[0]);}},fetchMarkets:async()=>[]});
  const active=d.onMarket(m);
  const next={...m,feedChannel:executionChanges?'EXECUTION':'DASHBOARD',signalObservedAt:f.now+207,receivedAt:f.now+208,setupKey:'different'};
  d.onMarket(next);release();await active;
  a.equal(allowed,!executionChanges);
 }
});

test('TF2 fallback cache preserves execution identity when newer Dashboard arrives',()=>{
 const f=fixture();delete require.cache[require.resolve('../tf2-ribbon-market-hub')];const hub=require('../tf2-ribbon-market-hub');
 const execution=hub.ingest(f.batch,f.now)[0];
 const dashboard=JSON.parse(JSON.stringify(f.batch));dashboard.feedChannel='DASHBOARD';dashboard.emittedAt=f.now+207;dashboard.markets[0][66].setupAt=f.now+207;
 a.equal(hub.ingest(dashboard,f.now+208).length,1);
 a.equal(hub.markets()[0],execution);
 const command=Core.buildSetupCommand(execution,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD']},null,f.now);
 a.equal(require('../entry-delivery-check').checkEntryDelivery(command,execution,f.now+60001).ok,false);
});


test('ATR10 SL cap covers both sides, modes and volatility without widening or accepting the old policy',()=>{
 for(const side of ['BUY','SELL'])for(const mode of ['Fixed R:R','Fibonacci'])for(const atr of [.5,2.2,3,3.5,8]){
  const sign=side==='BUY'?1:-1,entry=4100,sl=entry-sign*Math.min(atr,3);
  const targets=mode==='Fibonacci'?[1.618,2.618,4.236].map(r=>sl+(entry-sl)*r):[1,2,3].map(r=>entry+sign*atr*r);
  const plan={entry,sl,tp1:targets[0],tp2:targets[1],tp3:targets[2]},s={riskAtrReference:atr,planMode:mode};
  a.equal(S.planPass(side,plan,s),true);
  a.equal(S.planPass(side,{...plan,sl:entry-sign*3.01},s),false);
  if(atr!==3)a.equal(S.planPass(side,{...plan,sl:entry-sign*Math.max(atr,3)},s),false);
 }
 for(const alter of [f=>f.row[66].atrPeriod=14,f=>f.row[66].riskPlanVersion='TF2_PINE_MIN3_PLAN_V4']){
  const f=fixture();alter(f);const m=market(f);a.ok(!m||m.strategyNormal.state==='WAIT');if(m)a.equal(C.createEntryDecision(m),null);
 }
});


test('TF2 analysis snapshot follows latest source across channels while execution cache stays unchanged',()=>{
 const f=fixture();delete require.cache[require.resolve('../tf2-ribbon-market-hub')];const hub=require('../tf2-ribbon-market-hub');
 const execution=hub.ingest(f.batch,f.now)[0];
 const dash=JSON.parse(JSON.stringify(f.batch));dash.feedChannel='DASHBOARD';dash.emittedAt=f.now+30000;dash.markets[0][6]=4101;dash.markets[0][66].entryEvent=false;
 const dashboard=hub.ingest(dash,f.now+30001)[0];a.ok(dashboard);
 a.equal(hub.analysisMarkets(f.now+30002)[0],dashboard);a.equal(hub.markets()[0],execution);
 a.equal(C.createEntryDecision(dashboard),null);
 const view=require('../analysis-dual-model').dualAnalysis(hub.analysisMarkets(f.now+30002),'XAUUSD',f.now+30002).views[0];
 a.equal(view.market.price,4101);a.equal(view.status,'LIVE');
 // A delayed execution packet may be newer in arrival time, but older at source.
 const delayed=JSON.parse(JSON.stringify(f.batch));delayed.emittedAt=f.now+10000;
 hub.ingest(delayed,f.now+31000);a.equal(hub.analysisMarkets(f.now+31001)[0],dashboard);
 const next=JSON.parse(JSON.stringify(f.batch));next.emittedAt=f.now+40000;
 const fresh=hub.ingest(next,f.now+40001)[0];a.equal(hub.analysisMarkets(f.now+40002)[0],fresh);
 a.equal(hub.analysisMarkets(f.now+18000001+40001).length,0);
});
