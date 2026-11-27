'use strict';
const test=require('node:test'),a=require('node:assert/strict');
const D=require('../pine-direct-entry'),Core=require('../auto-trade-core');
function event(tf='1',side='BUY'){
 const sign=side==='BUY'?1:-1;
 return {hema20:4000+sign,hema40:4000,symbol:'XAUUSD',timeframe:tf,feedChannel:'EXECUTION',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',entryEvent:true,
 setupKey:`${tf}|test`,entryAuthorizedAt:1000,signalObservedAt:1000,receivedAt:1000,
 setupMeta:{entryPolicyVersion:'PINE_NATIVE_SOLID_ENTRY_V7',solidSide:side,completedAt:1000,cycleKind:'INITIAL'},
 normal3Entry:4000,initialSl:4000-sign*2,tp1:4000+sign*1.5,tp2:4000+sign*2.5,tp3:4000+sign*3.5};
}
for(const tf of ['1','15'])for(const side of ['BUY','SELL'])test(`Pine direct ${tf} ${side}: Pine retains signal qualification and ZenCore enforces the selected schedule`,()=>{
 const m=event(tf,side),s={capitalUsd:100,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:tf==='15'?'TF15_INTRA':'TF2_SCALPING',riskAcknowledgedAt:1,tradingSchedule:{enabled:true,skipNews:true}};
 const d=D.decision(m);a.ok(d);a.equal(d.snapshot.entry,m.normal3Entry);a.equal(d.snapshot.sl,m.initialSl);
 const openAt=Date.UTC(2026,10,11,0,30), endAt=Date.UTC(2026,10,11,3,30);
 const timed={...m,entryAuthorizedAt:openAt,signalObservedAt:openAt,receivedAt:openAt,
  setupMeta:{...m.setupMeta,completedAt:openAt}};
 a.equal(Core.buildSetupCommand(timed,s,null,openAt-1),null);
 a.equal(Core.buildSetupCommand(m,s,null,openAt),null,'previous-session signal cannot open on the next session');
 const c=Core.buildSetupCommand(timed,s,null,openAt);a.ok(c);a.equal(c.notAfterMs,endAt);
 a.equal(Core.buildSetupCommand(timed,s,null,endAt),null);
 a.equal(Core.buildSetupCommand(m,{...s,tradingSchedule:{enabled:false,skipNews:false}},null,endAt).notAfterMs,Infinity);
 a.equal(require('../entry-delivery-check').checkEntryDelivery({type:'PLACE_SETUP',payload:c.payload},null).ok,true);
 a.equal(D.decision({...m,feedChannel:'DASHBOARD'}),null);
 a.equal(D.decision({...m,entryEvent:false}),null);
 a.equal(D.decision({...m,initialSl:m.normal3Entry}),null);
 a.equal(D.decision({...m,tp2:m.tp1}),null);
 a.equal(D.decision({...m,entryAuthorizedAt:999}),null);
});

test('Retired Low Risk cannot build or save a new entry', () => {
 const m=event(),settings={capitalUsd:500,lotPerLayer:.01,layers:8,symbols:['XAUUSD']};
 const normal=Core.buildSetupCommand(m,settings);
 a.equal(normal.payload.analysisSnapshot.cashLayerPolicy,undefined);
 a.equal(normal.payload.layers,8);
 a.equal(Core.buildSetupCommand(m,{...settings,entryExitStrategy:'LOW_RISK'}),null);
 a.equal(Core.validateSettings({...settings,entryExitStrategy:'LOW_RISK'}).ok,false);
});

test('Pine Direct is gated at dispatch and when the Connector takes the queued command', async () => {
 const {MemoryAutoTradeStore}=require('../auto-trade-store');
 const {createAutoTradeService}=require('../auto-trade-service');
 const store=new MemoryAutoTradeStore(), userId='scheduled-trader';
 const sessionStart=Date.UTC(2026,10,11,0,30);
 let at=sessionStart-1000;
 const service=createAutoTradeService({store,allowLocalEaDemoExecution:true,
  commandSigningKey:'schedule-test-signing-key-longer-than-thirty-two',now:()=>at});
 const {podToken}=await service.connectLocalEa(userId);
 await service.heartbeat(podToken,{accountFingerprint:'a'.repeat(64),accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',
  tradeMode:'DEMO',terminalConnected:true,terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,
  demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',positions:[],directEntryPolicy:D.POLICY,cashLayerPolicy:'USD_TP050_SL200_V1'});
 const settings={capitalUsd:500,lotPerLayer:.01,layers:8,symbols:['XAUUSD'],riskAcknowledged:true};
 const save=enabled=>service.saveSettings(userId,{...settings,tradingSchedule:Core.malaysiaTradingSchedule(enabled,false)});
 const signal=()=>{const m=event();return {...m,entryAuthorizedAt:at,signalObservedAt:at,receivedAt:at,setupMeta:{...m.setupMeta,completedAt:at}};};
 await save(true);
 await store.setControl(userId,{desiredState:'ON',effectiveState:'ON'});
 a.equal((await service.dispatchMarkets([signal()])).queued,0);
 at=sessionStart;
 await store.saveSettings(userId,{entryExitStrategy:'LOW_RISK'});
 a.equal((await service.state(userId)).control.canEnter,false);
 a.equal((await service.dispatchMarkets([signal()])).queued,0,'old saved strategy does not silently switch to Normal');
 await a.rejects(service.saveSettings(userId,{...settings,entryExitStrategy:'LOW_RISK'}),{code:'VALIDATION_ERROR'});
 at=sessionStart-1000;
 await store.saveSettings(userId,{entryExitStrategy:'NORMAL'});
 await store.saveSettings(userId,{tradingSchedule:Core.malaysiaTradingSchedule(false,false)});
 at++;
 a.equal((await service.dispatchMarkets([signal()])).queued,1);
 // Simulate a settings change racing a command that is already queued.
 await store.saveSettings(userId,{tradingSchedule:Core.malaysiaTradingSchedule(true,false)});
 a.equal((await service.nextCommand(podToken)).command,null,'new schedule applies even to an already queued setup');
 at=sessionStart;
 a.equal((await service.dispatchMarkets([signal()])).queued,1);
 const {command}=await service.nextCommand(podToken);
 a.equal(command.expiresAt,sessionStart+3*60*60*1000);
 a.equal(command.payload.layers,8);
 const pending=[...store.commands.values()].flat().find(item=>item.id===command.id);
 pending.payload.analysisSnapshot.cashLayerPolicy='USD_TP050_SL200_V1';
 a.equal((await service.nextCommand(podToken)).command,null,'queued Low Risk orders cannot reach the Connector');
 at=command.expiresAt;
 a.equal((await service.nextCommand(podToken)).command,null,'expired setup cannot replay in a later session');
});

test('Pine follow-up queues only without an open same-strategy position and rechecks before delivery', async () => {
 const {MemoryAutoTradeStore}=require('../auto-trade-store');
 const {createAutoTradeService}=require('../auto-trade-service');
 const store=new MemoryAutoTradeStore(),userId='followup-trader';
 let at=Date.UTC(2026,10,11,1,0);
 const service=createAutoTradeService({store,allowLocalEaDemoExecution:true,
  commandSigningKey:'overlap-test-signing-key-longer-than-thirty-two',now:()=>at});
 const {podToken}=await service.connectLocalEa(userId);
 await service.heartbeat(podToken,{accountFingerprint:'a'.repeat(64),accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',
  tradeMode:'DEMO',terminalConnected:true,terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,
  demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',positions:[],directEntryPolicy:D.POLICY});
 await service.saveSettings(userId,{capitalUsd:500,lotPerLayer:.01,layers:8,symbols:['XAUUSD'],riskAcknowledged:true,
  tradingSchedule:Core.malaysiaTradingSchedule(false,false)});
 await store.setControl(userId,{desiredState:'ON',effectiveState:'ON'});
 const signal=()=> {
  const m=event('1','SELL');
  return {...m,entryAuthorizedAt:at,signalObservedAt:at,receivedAt:at,
   setupMeta:{...m.setupMeta,completedAt:at,cycleKind:'FOLLOWUP'}};
 };
 const remainingLayer={ticket:'last-layer',symbol:'XAUUSD',side:'BUY',origin:'ZENCORE',strategyMode:'TF2_SCALPING'};
 const tf15Layer={...remainingLayer,ticket:'tf15',strategyMode:'TF15_INTRA'};
 await store.replacePositions(userId,[remainingLayer],at);
 a.equal((await service.dispatchMarkets([signal()])).queued,0);
 await store.replacePositions(userId,[tf15Layer],at);
 a.equal((await service.dispatchMarkets([signal()])).queued,1);
 await store.replacePositions(userId,[tf15Layer,remainingLayer],at);
 a.equal((await service.nextCommand(podToken)).command,null);
 await store.replacePositions(userId,[tf15Layer],++at);
 a.equal((await service.dispatchMarkets([signal()])).queued,1);
 a.equal((await service.nextCommand(podToken)).command.payload.layers,8);
});

test('global stop blocks Pine dispatch, queued delivery and EA entry leases without disabling manual actions', async () => {
 const {MemoryAutoTradeStore}=require('../auto-trade-store');
 const {createAutoTradeService}=require('../auto-trade-service');
 const store=new MemoryAutoTradeStore(),userId='global-stop-trader';
 let at=Date.UTC(2026,10,11,1,0),gate={paused:false,changedAt:0};
 const service=createAutoTradeService({store,allowLocalEaDemoExecution:true,
  getAutoEntryPause:async()=>gate,commandSigningKey:'global-stop-test-key-longer-than-thirty-two',now:()=>at});
 const {podToken}=await service.connectLocalEa(userId);
 const heartbeat={accountFingerprint:'a'.repeat(64),accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',
  tradeMode:'DEMO',terminalConnected:true,terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,
  demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',positions:[],directEntryPolicy:D.POLICY,
  manualMarketOrderVersion:'MANUAL_MARKET_ORDER_V2',manualCloseAllVersion:'ACCOUNT_POSITIONS_V1'};
 await service.heartbeat(podToken,heartbeat);
 await service.saveSettings(userId,{capitalUsd:500,lotPerLayer:.01,layers:8,symbols:['XAUUSD'],riskAcknowledged:true,
  tradingSchedule:Core.malaysiaTradingSchedule(false,false)});
 await store.setControl(userId,{desiredState:'ON',effectiveState:'ON'});
 const signal=(stamp=at)=> {
  const m=event();
  return {...m,entryAuthorizedAt:stamp,signalObservedAt:stamp,receivedAt:stamp,
   setupMeta:{...m.setupMeta,completedAt:stamp}};
 };
 a.equal((await service.dispatchMarkets([signal()])).queued,1);
 gate={paused:true,changedAt:++at};
 a.equal((await service.heartbeat(podToken,heartbeat)).desiredState,'STOPPED');
 a.equal((await service.nextCommand(podToken)).command,null);
 a.equal((await service.dispatchMarkets([signal()])).queued,0);
 await a.rejects(()=>service.turnOn(userId,{confirmation:'AKTIFKAN DEMO'}),{code:'GLOBAL_ENTRY_PAUSED'});
 const state=await service.state(userId);
 a.equal(state.control.canEnter,false);
 a.equal(state.control.canTurnOn,false);
 a.equal(state.manualOrderReady,true);
 a.ok(state.manualCloseAllBinding);
 a.equal((await store.getProfile(userId)).desiredState,'ON');
 const prior=at;
 gate={paused:false,changedAt:++at};
 a.equal((await service.dispatchMarkets([signal(prior)])).queued,0);
 {
  at++;
  a.equal((await service.dispatchMarkets([signal()])).queued,1);
  gate={paused:true,changedAt:++at};
  gate={paused:false,changedAt:++at};
  a.equal((await service.nextCommand(podToken)).command,null);
 }
 a.equal((await service.heartbeat(podToken,heartbeat)).desiredState,'ON');
 at++;
 a.equal((await service.dispatchMarkets([signal()])).queued,1);
 a.equal((await service.nextCommand(podToken)).command.type,'PLACE_SETUP');
});

test('XAUUSD M1 SOLID retest accepts a later confirmed touch at the original SOLID only', () => {
 const {SOLID_RETEST_LOCK,SOLID_RETEST_RISK}=require('../tf2-ribbon-scalping');
 const at=120001,settings={capitalUsd:500,lotPerLayer:.01,layers:1,symbols:['XAUUSD']};
 for(const side of ['BUY','SELL']){
  const sign=side==='BUY'?1:-1,base=event('1',side),entry=3568.50;
  const m={...base,confirmed:true,time:60000,low:3568.45,high:3571.06,
   entryAuthorizedAt:at,signalObservedAt:at,receivedAt:at,normal3Entry:entry,
   initialSl:entry-sign*3,tp1:entry+sign*1.5,tp2:entry+sign*3,tp3:entry+sign*4.5,
   setupMeta:{...base.setupMeta,completedAt:at,sourceEntry:entry,solidRetestSopClose:60000,
    riskPlanVersion:SOLID_RETEST_RISK,exitLockVersion:SOLID_RETEST_LOCK}};
  a.equal(D.decision(m).snapshot.entry,entry);
  a.equal(Core.buildSetupCommand(m,settings,null,at).notAfterMs,at+60000);
  a.equal(D.decision({...m,low:3568.51}),null);
  a.equal(D.decision({...m,time:0}),null);
  a.equal(D.decision({...m,confirmed:false}),null);
  a.equal(D.decision({...m,setupMeta:{...m.setupMeta,sourceEntry:3571.06}}),null);
 }
});

test('staged XAUUSD commands share a candle identity, expire, and require opposite confirmation outcomes',()=>{
 const bar=120000, closeAt=bar+60000;
 const settings={capitalUsd:500,lotPerLayer:.01,layers:8,symbols:['XAUUSD']};
 for(const side of ['BUY','SELL']){
  const base=event('1',side),sign=side==='BUY'?1:-1,entry=3568.5;
  const signal=phase=>{
   const at=phase==='EARLY'?bar+20000:closeAt+100;
   return {...base,time:bar,entryEvent:false,confirmed:phase!=='EARLY',open:entry,close:entry+sign,
    signalObservedAt:at,receivedAt:at,setupMeta:{...base.setupMeta,sourceEntry:entry,
     nativeSolid:{barTime:bar,pulse:true},solidSplit:{phase,bar,side,entry}}};
  };
  const early=signal('EARLY'), confirm=signal('CONFIRM'), abort=signal('ABORT');
  const commands=[early,confirm,abort].map(m=>Core.buildSetupCommand(m,settings,null,m.signalObservedAt));
  a.equal(commands[0].notAfterMs,closeAt);
  a.equal(commands[1].notAfterMs,closeAt+15000);
  a.equal(commands[0].payload.analysisSnapshot.setupKey,commands[1].payload.analysisSnapshot.setupKey);
  a.equal(new Set(commands.map(c=>c.signalKey)).size,3);
  a.equal(Core.buildSetupCommand(early,settings,null,closeAt),null);
  a.equal(Core.buildSetupCommand(confirm,settings,null,closeAt+15000),null);
  a.equal(D.decision({...confirm,open:confirm.close}),null);
  a.equal(D.decision({...confirm,time:bar+60000}),null);
  a.equal(D.decision({...early,confirmed:true}),null);
  a.ok(D.decision({...abort,close:entry-sign,hema20:base.hema40}));
  const cp=require('node:child_process').spawnSync('python3',['-c',
    "import json,sys;sys.path.insert(0,'ea-local-connector');from protocol import command_fields;print(json.dumps([command_fields(c,{'account':'123','server':'TEST'}) for c in json.load(sys.stdin)]))"],
   {input:JSON.stringify(commands.map(c=>({type:'PLACE_SETUP',id:'test',expiresAt:c.notAfterMs,payload:c.payload}))),encoding:'utf8'});
  a.equal(cp.status,0,cp.stderr);
  a.deepEqual(JSON.parse(cp.stdout).map(c=>[c.type,c.solidSplitPhase,c.solidSplitBar]),[
   ['PLACE_SOLID_SPLIT','EARLY',bar],['PLACE_SOLID_SPLIT','CONFIRM',bar],['PLACE_SOLID_SPLIT','ABORT',bar]]);
 }
});
