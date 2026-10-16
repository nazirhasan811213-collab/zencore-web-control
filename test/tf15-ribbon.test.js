'use strict';
const test=require('node:test'),a=require('node:assert/strict');
const S=require('../tf15-intraday'),Hub=require('../tf15-market-hub'),C=require('../analysis-execution-contract'),Core=require('../auto-trade-core'),Alerts=require('../analysis-alert-service'),T=require('../analysis-telegram');
let seq=0;
function fixture(side='BUY'){
 const now=Date.now()+ ++seq,sign=side==='BUY'?1:-1,row=Array(67).fill(null),t=now-900000;
 Object.assign(row,{0:'XAUUSD',1:t,6:4100,13:sign*2,14:sign,21:4,22:4100,23:4100-sign*4,24:4100-sign*4,25:4100+sign*4,26:4100+sign*8,27:4100+sign*12,28:true,29:side==='BUY',34:side,35:true,36:true,37:true,38:true,39:true,40:true,41:true,42:side==='BUY'?'BULLISH':'BEARISH',43:60,48:'HOLD',49:'HOLD',52:100,56:0,57:'INITIAL',58:'NONE',59:false});
 row[65]={version:'HEMA15_LIVE_V1',tf15:{fast:4100+sign,slow:4100,fastPreviousBar:4100,slowPreviousBar:4100-sign}};
 row[66]={entryRuleVersion:S.RULE,entryPolicyVersion:S.POLICY.entryPolicyVersion,planMode:"Fixed R:R",riskPlanVersion:S.RISK,atrPeriod:14,solidSide:side,solidHoldActive:true,solidClosedAt:null,solidTriggeredAt:t,setupAt:t,sourceEntry:4100-sign,solidEligible:true,completedAt:now,completionPrice:4100,riskAtrReference:4,riskStructure:4100-sign*2,riskTick:.01,entryEvent:true,entryAuthorizedAt:now,dashboardAi:{momentum:side==='BUY'?'Bullish 🟢':'Bearish 🔴',mtfScore:sign,dashboard:{mtfTimeframes:['15','30','45']}}};
 return {row,now,batch:{feedVersion:'TF15_REALTIME_V1',timeframe:'15',schemaVersion:'32.3-EXIT-STEPLOCK',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedChannel:'EXECUTION',confirmed:false,emittedAt:now,markets:[row]}};
}
function market(f){return Hub.ingest(f.batch,f.now)[0];}

test('TF15 uses own candles, ribbon, four confirmations and MTF 15/30/45',()=>{for(const side of ['BUY','SELL']){const f=fixture(side);f.row[65].tf15.slowPreviousBar=f.row[65].tf15.slow;f.row[43]=40;const m=market(f);a.equal(m.strategyNormal.sop.passed,4);a.equal(m.strategyNormal.state,'READY');const d=C.createEntryDecision(m);a.equal(d.snapshot.executionTimeframe,'15');a.equal(d.snapshot.side,side);a.deepEqual(S.POLICY.mtf,['15','30','45']);}});
test('TF15 rejects TF3 MTF, opposite ribbon, stale and Dashboard authorization',()=>{for(const change of [f=>f.row[66].dashboardAi.dashboard.mtfTimeframes=['5','10','15'],f=>f.row[65].tf15.fast=4099,f=>f.row[66].solidHoldActive=false]){const f=fixture();change(f);a.equal(C.createEntryDecision(market(f)),null);}const f=fixture();f.batch.feedChannel='DASHBOARD';a.equal(C.createEntryDecision(market(f)),null);const old=fixture();old.batch.emittedAt-=31000;a.equal(Hub.ingest(old.batch,old.now).length,0);});
test('TF15 current hub routes new rule separately from legacy; duplicates rejected',()=>{const f=fixture(),legacy=require('../strategy-market-hub');const out=legacy.ingest(f.batch,f.now);a.equal(out.length,1);a.equal(out[0].strategyNormal.entrySopVersion,S.VERSION);a.equal(legacy.ingest(f.batch,f.now).length,0);});
test('TF15 profile dispatches correct layers and signed unchanged-mode command',async()=>{const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService,tokenHash}=require('../auto-trade-service');const f=fixture(),m=market(f),store=new MemoryAutoTradeStore(),token='zcpod_'+'a'.repeat(48),hash=tokenHash(token);const pod={id:'tf15pod',userId:'tf15user',tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:f.now,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};store.podsByUser.set('tf15user',pod);store.podsByToken.set(hash,pod);const svc=createAutoTradeService({store,now:()=>f.now,scalpingTimeframe:'3',localEaExecutionUserIds:['tf15user'],allowedDemoSymbols:Core.TRADE_SYMBOLS,commandSigningKey:'a-test-signing-key-longer-than-thirty-two-bytes',getLatestMarket:(sym,tf)=>tf==='15'?m:null});await svc.saveSettings('tf15user',{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF15_INTRA',riskAcknowledged:true});await store.setControl('tf15user',{desiredState:'ON',effectiveState:'ON'});a.equal((await svc.dispatchMarkets([m])).queued,1);const result=await svc.nextCommand(token);a.equal(result.command.payload.strategyMode,'TF15_INTRA');a.equal(result.command.payload.analysisSnapshot.executionTimeframe,'15');a.equal(result.command.payload.layers,2);});
test('TF15 Telegram labels and current analysis, full close and step lock are isolated',async()=>{const f=fixture(),m=market(f),svc=new Alerts.AnalysisAlerts();await svc.init();await svc.record(m);const e=svc.events.find(x=>x.kind==='ENTRY');a.ok(e);a.equal(T.entrySopAllowed(e),true);a.match(T.telegramMessage(e),/SOLID ENTRY TF15/);a.match(T.telegramMessage(e),/15\/30\/45/);a.doesNotMatch(T.telegramMessage(e),/SOLID ENTRY TF3/);m.positionManagement={action:'CLOSE_50_NOW',reason:'native partial'};const d=C.createManagementDecision(m);a.equal(d.snapshot.executionTimeframe,'15');a.equal(d.snapshot.actions[0].percent,100);a.equal(d.snapshot.setupKey,m.setupKey);clearInterval(svc.cleanupTimer);});
test('TF15 independent Dashboard may confirm but cannot replace execution plan',()=>{const f=fixture(),m=market(f),cmd=Core.buildSetupCommand(m,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF15_INTRA'},null,f.now),dash=JSON.parse(JSON.stringify(m));a.ok(cmd);dash.feedChannel='DASHBOARD';for(const k of ['entry','sl','tp1','tp2','tp3'])dash.strategyNormal.plan[k]+=.01;a.equal(require('../entry-delivery-check').checkEntryDelivery(cmd,dash,f.now).ok,true);dash.strategyNormal.side='SELL';a.equal(require('../entry-delivery-check').checkEntryDelivery(cmd,dash,f.now).ok,false);});
test('TF15 Pine emits own timeframe, MTF and schema identity',()=>{const s=require('node:fs').readFileSync(require.resolve('../ZenCore_TF15_Intraday.pine'),'utf8');a.match(s,/timeframe.period == "15" and tradeMode == "Intraday"/);a.match(s,/tf_1 := "15"\n    tf_2 := "30"\n    tf_3 := "45"/);a.match(s,/HEMA15_LIVE_V1/);a.match(s,/TF15_SOLID_RIBBON_V1/);a.doesNotMatch(s,/TF3_SOLID_RIBBON_V1|TF3_REALTIME_V1/);});

test('mandatory Movement and HEMA veto entry even when four optional confirmations pass',()=>{
 for(const side of ['BUY','SELL']){
  const f=fixture(side),m=market(f),s=m.strategyNormal.sop,adapter=require('../tf15-intraday');
  a.equal(adapter.confirmations(side,s).pass,true);
  const wrong={...s,advisor:{...s.advisor,momentum:side==='BUY'?'Bearish 🔴':'Bullish 🟢'}};
  a.equal(adapter.confirmations(side,wrong).passed,5);a.equal(adapter.confirmations(side,wrong).pass,false);
  const h={...s.hema15,fast:s.hema15.slow+(side==='BUY'?-1:1)};
  a.equal(adapter.confirmations(side,{...s,hema15:h}).pass,false);
 }
});
test('Pine reference plan formulas match Fixed R:R and Fibonacci for both directions',()=>{
 const adapter=require('../tf15-intraday');
 for(const side of ['BUY','SELL'])for(const mode of ['Fixed R:R','Fibonacci']){
  const sign=side==='BUY'?1:-1,entry=4100,atr=4,sl=entry-sign*atr,targets=mode==='Fibonacci'?[1.618,2.618,4.236].map(r=>sl+(entry-sl)*r):[1,2,3].map(r=>entry+sign*atr*r);
  const p={entry,sl,tp1:targets[0],tp2:targets[1],tp3:targets[2]};a.equal(adapter.planPass(side,p,{riskAtrReference:atr,planMode:mode}),true);
  a.equal(adapter.planPass(side,{...p,tp1:p.tp1+.1},{riskAtrReference:atr,planMode:mode}),false);
 }
});
test('new lock actions preserve Pine absolute prices for entry +1.50 and TP3 extension',()=>{
 const m=market(fixture());for(const [action,target,type] of [['MOVE_SL_ENTRY_PLUS_150',4101.5,'MOVE_SL_TP1'],['MOVE_SL_TP3',m.strategyNormal.plan.tp3,'MOVE_SL_TP2']]){
  m.positionManagement={action:'HOLD',slMoveTriggered:true,slMoveAction:action,activeSl:target};
  const d=C.createManagementDecision(m);a.equal(d.snapshot.actions[0].type,type);a.equal(d.snapshot.actions[0].activeSl,target);
 }
});
test('Telegram contains one forecast, checklist, MTF and risk advice instead of duplicated coach content',async()=>{
 const m=market(fixture());Object.assign(m.strategyNormal.sop.advisor,{trend:'Uptrend',mtfSummary:'TF Sepakat NAIK',advice:'SETUP KURANG PADU.',proTip:'JAGA MODAL - JANGAN TRADE',aiCoach:'• [TREND]: Uptrend\n• [MOMENTUM]: Bullish\n• [HALANGAN]: Laluan CLEAR.\n• [WHALES]: Active\n• [NASIHAT]: SETUP KURANG PADU.'});
 const svc=new Alerts.AnalysisAlerts();await svc.init();await svc.record(m);const e=svc.events.find(e=>e.kind==='ENTRY'),text=T.telegramMessage(e);
 a.equal((text.match(/Forecast 10 candle:/g)||[]).length,1);a.equal((text.match(/Checklist Pine:/g)||[]).length,1);a.equal((text.match(/MTF 15\/30\/45:/g)||[]).length,1);
 a.equal((text.match(/SETUP HIGH RISK JAGA SAIZ LAYER DAN LOT/g)||[]).length,1);a.doesNotMatch(text,/SETUP KURANG PADU|JANGAN TRADE/);clearInterval(svc.cleanupTimer);
});

test('actual heartbeat close resets TF15; fresh new SOLID enters full layers immediately without five-minute cooldown',async()=>{
 const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService,tokenHash}=require('../auto-trade-service');
 const f=fixture(),firstMarket=market(f),store=new MemoryAutoTradeStore(),token='zcpod_'+'x'.repeat(48),hash=tokenHash(token);let at=f.now,current=firstMarket;
 const pod={id:'cycle-pod',userId:'cycle-user',tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:at,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};
 store.podsByUser.set(pod.userId,pod);store.podsByToken.set(hash,pod);
 const svc=createAutoTradeService({store,now:()=>at,scalpingTimeframe:'3',localEaExecutionUserIds:[pod.userId],allowedDemoSymbols:Core.TRADE_SYMBOLS,commandSigningKey:'a-test-signing-key-longer-than-thirty-two-bytes',getLatestMarket:()=>current});
 await svc.saveSettings(pod.userId,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF15_INTRA',riskAcknowledged:true});await store.setControl(pod.userId,{desiredState:'ON',effectiveState:'ON'});
 a.equal((await svc.dispatchMarkets([current])).queued,1);const first=await svc.nextCommand(token);a.ok(first.command);await svc.acknowledgeCommand(token,first.command.id,{status:'EXECUTED',code:'SETUP_OPENED'});
 const hb={accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',tradeMode:'DEMO',terminalConnected:true,terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',accountFingerprint:'a'.repeat(64),positions:[],symbolSpecs:[]};
 at+=10;await svc.heartbeat(token,{...hb,positions:[{ticket:'123456',symbol:'XAUUSD',side:'BUY',volume:.01,entry:4100,strategyMode:'TF15_INTRA',setupId:first.command.id.slice(0,20)}]});
 at+=10;await svc.heartbeat(token,hb);a.ok((await store.listAudit(pod.userId,100)).find(e=>e.type==='STRATEGY_CYCLE_RESET'));
 a.equal((await svc.dispatchMarkets([current])).queued,0);
 const next=fixture();next.now=at+20;next.batch.emittedAt=next.now;next.row[66].entryAuthorizedAt=next.now;next.row[66].completedAt=next.now;next.row[66].solidTriggeredAt=at+10;next.row[66].setupAt=at+10;current=market(next);at=next.now;
 a.equal((await svc.dispatchMarkets([current])).queued,1);const fresh=await svc.nextCommand(token);a.ok(fresh.command);a.equal(fresh.command.payload.layers,2);a.equal(fresh.command.payload.strategyMode,'TF15_INTRA');
});


test('fixed-event retry keeps original authorization, deadline and setup identity',()=>{
 const f=fixture();f.now+=100;f.batch.emittedAt=f.now;const auth=f.now-20000;
 Object.assign(f.row[66],{entryDeliveryVersion:'FIXED_EVENT_RETRY_V1',completedAt:auth,entryAuthorizedAt:auth});
 const m=market(f),d=C.createEntryDecision(m);a.ok(d);a.equal(d.snapshot.entryAuthorizedAt,auth);
 const cmd=Core.buildSetupCommand(m,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'BOTH'},null,f.now);
 a.ok(cmd);a.equal(cmd.notAfterMs,auth+30000);
 const retry={...m,receivedAt:f.now+1,signalObservedAt:f.now+1};
 a.equal(C.createEntryDecision(retry).signalKey,d.signalKey);
 const check=require('../entry-delivery-check').checkEntryDelivery;
 a.equal(check({payload:cmd.payload},m,auth+30001).reason,'ENTRY_EVENT_EXPIRED');
 a.equal(C.createEntryDecision({...m,entryAuthorizedAt:auth+1}),null);
 a.equal(C.createEntryDecision({...m,feedChannel:'DASHBOARD'}),null);
 a.equal(C.createEntryDecision({...m,entryEvent:false}),null);
 const stale=fixture();stale.now+=200;stale.batch.emittedAt=stale.now;Object.assign(stale.row[66],{entryDeliveryVersion:'FIXED_EVENT_RETRY_V1',completedAt:stale.now-31000,entryAuthorizedAt:stale.now-31000});
 a.equal(C.createEntryDecision(market(stale)),null);
});
