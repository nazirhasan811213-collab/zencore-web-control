'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs');
const C=require('../analysis-execution-contract'),L=require('../setup-lifecycle'),T=require('../analysis-telegram'),H=require('../indicator-chart-history').history;
const {createEntryCycleReset}=require('../entry-cycle-reset');
function fixture(tf,side='BUY'){
 const file=tf==='2'?'tf2-ribbon-system.test.js':'tf15-ribbon.test.js';
 const prefix=fs.readFileSync(__dirname+'/'+file,'utf8').split("\ntest(")[0];
 const base=new Function('require',prefix+';return {fixture,market};')(require);
 const f=base.fixture(side),sign=side==='BUY'?1:-1;
 // Fresh source and independent modules per market keep channel ordering isolated.
 f.row[1]=f.now-Number(tf)*60000;Object.assign(f.row,{3:4100-sign*.5,4:4101,5:4099,6:4100,38:false,39:false,41:false,42:'NEUTRAL',43:0});
 Object.assign(f.row[66],{entryPolicyVersion:'PINE_SOLID_PRICE_WT_HEMA_V6',lifecycleVersion:L.NEW_VERSION,cycleKind:'INITIAL',entryDeliveryVersion:'FIXED_EVENT_RETRY_V1',decisionBarCloseAt:f.now});f.batch.confirmed=true;
 if(tf==='2'){Object.assign(f.row,{23:4100-sign*4,24:4100-sign*4,25:4100+sign*1.5,26:4100+sign*2.5,27:4100+sign*3.5});Object.assign(f.row[66],{atrPeriod:8,riskPlanVersion:require('../tf2-ribbon-scalping').RISK8_CAPS4,entryCandleVersion:'TF2_NATIVE_CANDLE_DIRECTION_V1',decisionTimingVersion:'TF2_BAR_CLOSE_V1',entrySafety:{version:'TF2_ATR_REVERSALS_V2',ready:true,barTime:f.row[1],atr:4,flips:0,chopBlocked:false}});}
 f.row[66].exitLockVersion=require(tf==='2'?'../tf2-ribbon-scalping':'../tf15-intraday').POLICY.exitLockVersion;
 const ingest=()=>{const path=tf==='2'?'../tf2-ribbon-market-hub':'../tf15-market-hub';delete require.cache[require.resolve(path)];return require(path).ingest(f.batch,f.now)[0];};
 return {f,ingest};
}
for(const tf of ['2','15'])for(const side of ['BUY','SELL']){
 test(`V6 TF${tf} ${side}: low checklist/forecast accepted only with all new mandatory gates`,async()=>{
  const {f,ingest}=fixture(tf,side),m=ingest();a.equal(m.strategyNormal.state,'READY',m.strategyNormal.reason);const d=C.createEntryDecision(m);a.ok(d);a.equal(d.snapshot.qualificationPolicyVersion,'PINE_SOLID_PRICE_WT_HEMA_V6');a.equal(m.strategyNormal.sop.total,3);
  const svc=new (require('../analysis-alert-service').AnalysisAlerts)();await svc.init();try{await svc.record(m);const e=svc.events.find(e=>e.kind==='ENTRY');a.ok(e);a.equal(T.entrySopAllowed(e),true);a.match(T.telegramMessage(e),/HEMA (hijau|merah)/);}finally{clearInterval(svc.cleanupTimer);}
 });
 for(const change of ['wt','hema','price','lifecycle','close','expired'])test(`V6 TF${tf} ${side} rejects ${change} even forged READY`,()=>{
  const {f,ingest}=fixture(tf,side),sign=side==='BUY'?1:-1;
  if(change==='wt')f.row[13]=-sign*2;if(change==='hema')f.row[65]['tf'+tf].fast=4100-sign;
  if(change==='price')f.row[66].sourceEntry=4100+sign;
  if(change==='lifecycle')f.row[66].lifecycleVersion='UNKNOWN';if(change==='close')f.batch.confirmed=false;
  if(change==='expired')f.row[66].completedAt=f.now-61000;
  const m=ingest();a.ok(m);a.equal(m.strategyNormal.state,'WAIT');a.equal(C.createEntryDecision({...m,strategyNormal:{...m.strategyNormal,state:'READY'}}),null);
 });
}
test('V6 TF2 requires candle proof, safety proof and ATR8 SL4 policy',()=>{
 for(const mutate of [f=>delete f.row[66].entryCandleVersion,f=>delete f.row[66].entrySafety,f=>f.row[66].riskPlanVersion='TF2_PINE_ATR10_MAX3_PLAN_V5',f=>f.row[40]=false]){
  const {f,ingest}=fixture('2');mutate(f);a.equal(C.createEntryDecision(ingest()),null);
 }
});
for(const tf of ['2','15'])test(`V6 TF${tf} native close retains full-close action`,()=>{
 const {f,ingest}=fixture(tf);Object.assign(f.row,{48:'CLOSED',49:'EXIT_ALL',52:0});f.row[66].nativeExitAll=true;
 const m=ingest();a.equal(m.nativeChartExitAll,true);const d=C.createManagementDecision(m);a.ok(d);a.equal(d.snapshot.actions[0].percent,100);
});
for(const tf of ['2','15'])for(const side of ['BUY','SELL'])test(`V6 TF${tf} ${side} re-entry requires fresh server candles AFTER broker close`,async()=>{
 H.rows.clear();const step=Number(tf)*60000,now=Date.now(),time=now-step,sign=side==='BUY'?1:-1;
 const b=(t,o,c,lo,hi)=>({time:t,timeframe:tf,open:o,close:c,low:lo,high:hi,confirmed:true,observedAt:t+step});
 // A pullback in signed close, followed by breakout of the previous extreme.
 const rows=side==='BUY'?[b(time-3*step,100,102,99,103),b(time-2*step,102,101,100,102),b(time-step,101,101.2,100.5,101.5)]:[b(time-3*step,100,98,97,101),b(time-2*step,98,99,98,100),b(time-step,99,98.8,98.5,99.5)];
 H.rows.set(tf,rows);const current=side==='BUY'?b(time,101,102,100.5,103):b(time,99,98,97,99.5);
 const s={tf:tf+'m',entryPolicyVersion:'PINE_SOLID_PRICE_WT_HEMA_V6',lifecycleVersion:L.NEW_VERSION,cycleKind:'FOLLOWUP',qualifiedAt:now,atrReference:2,currentBar:current,price:current.close,reentryContext:{version:L.NEW_VERSION,parentQualifiedAt:time-5*step,pullbackAtrMinimum:.1,sidewaysAtrMaximum:.75},['hema'+tf]:{fast:100+sign,slow:100,waveTrend1:sign,waveTrend2:0}};
 a.ok(L.reentry(side,s,time-4*step,now));a.equal(L.reentry(side,s,time-step/2,now),null);
 const reset=time-4*step,store={lastStrategyCycleReset:async()=>({closedAt:reset}),latestExecutedSetupForMode:async()=>({id:'last',acknowledgedAt:reset-1})};
 const gate=createEntryCycleReset(store),market={timeframe:tf,signalObservedAt:now,strategyNormal:{side,sop:s}};
 a.equal((await gate.check('user','pod',market)).allowed,true);
 const gate2=createEntryCycleReset({...store,lastStrategyCycleReset:async()=>({closedAt:time-step/2})});a.equal((await gate2.check('user','pod',market)).allowed,false);
 H.rows.clear();a.equal(L.reentry(side,s,time-4*step,now),null);
});
for(const tf of ['2','15'])test(`V6 TF${tf} queues once, delivers compatible connector command with original lot/layers`,async()=>{
 const {f,ingest}=fixture(tf),m=ingest(),Core=require('../auto-trade-core');
 const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService,tokenHash}=require('../auto-trade-service');
 const store=new MemoryAutoTradeStore(),token='zcpod_'+'b'.repeat(48),hash=tokenHash(token),user='v6-'+tf;
 const pod={id:'v6pod'+tf,userId:user,tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:f.now,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};
 store.podsByUser.set(user,pod);store.podsByToken.set(hash,pod);
 const svc=createAutoTradeService({store,now:()=>f.now,scalpingTimeframe:'2',localEaExecutionUserIds:[user],allowedDemoSymbols:Core.TRADE_SYMBOLS,commandSigningKey:'a-test-signing-key-longer-than-thirty-two-bytes',getLatestMarket:(sym,frame)=>frame===tf?m:null});
 await svc.saveSettings(user,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:tf==='15'?'TF15_INTRA':'TF2_SCALPING',riskAcknowledged:true});await store.setControl(user,{desiredState:'ON',effectiveState:'ON'});
 a.equal((await svc.dispatchMarkets([m])).queued,1);a.equal((await svc.dispatchMarkets([m])).queued,0);
 const {command}=await svc.nextCommand(token);a.ok(command);a.equal(command.payload.layers,2);a.equal(command.payload.lotPerLayer,.01);a.equal(command.expiresAt,f.now+60000);
 const cp=require('child_process').spawnSync('python',['-c',"import json,sys;sys.path.insert(0,'ea-local-connector');from protocol import command_fields;print(json.dumps(command_fields(json.load(sys.stdin),{'account':'123','server':'TEST','tradeMode':'DEMO'})))"],{input:JSON.stringify(command),encoding:'utf8'});
 a.equal(cp.status,0,cp.stderr);a.equal(JSON.parse(cp.stdout).exitLockVersion,tf==='15'?'PINE_STEPLOCK_BE_TF15_V1':'PINE_STEPLOCK_150_TP3_PLUS3_V1');
});
test('V6 Pine TF2 and TF15 retain the structured feed and immutable close retry',()=>{
 for(const tf of ['2','15']){const s=fs.readFileSync(require('node:path').join(__dirname,'..',`ZenCore_TF${tf}_SOP_V6.pine`),'utf8');a.equal((s.match(/\balert\(/g)||[]).length,1);a.match(s,/zc24_closed_entry_packet := zc24_payload/);a.match(s,/timenow-zc24_closed_entry_at <= 60000/);a.match(s,/PINE_SOLID_PRICE_WT_HEMA_V6/);a.doesNotMatch(s,/bool zc_hold_qualify =[^\n]*zc24_greens/);}
});
test('V6 Telegram deduplicates retries per broker cycle but permits later cycles in the same SOLID',()=>{
 const {notificationKey:key}=require('../telegram-notification-key');for(const timeframe of ['2','15']){
  const e={kind:'ENTRY',timeframe,symbol:'XAUUSD',side:'BUY',telegramSop:{lifecycleVersion:L.NEW_VERSION,cycleKind:'FOLLOWUP',sourceSetupAt:100,qualifiedAt:200}};
  a.equal(key(e),key({...e,id:'retry'}));a.notEqual(key(e),key({...e,telegramSop:{...e.telegramSop,qualifiedAt:300}}));
  a.equal(key({...e,brokerCycle:'broker1'}),key({...e,brokerCycle:'broker1',telegramSop:{...e.telegramSop,qualifiedAt:300}}));a.notEqual(key({...e,brokerCycle:'broker1'}),key({...e,brokerCycle:'broker2'}));
 }
});
