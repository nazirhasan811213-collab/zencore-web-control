'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs');
const prefix=fs.readFileSync(__dirname+'/sop-v6.test.js','utf8').split("\nfor(const tf of ['2','15'])for(const side")[0];
const {fixture}=new Function('require','__dirname',prefix+';return {fixture};')(require,__dirname);
const C=require('../analysis-execution-contract');
function native(tf,side){const {f,ingest}=fixture(tf,side),sign=side==='BUY'?1:-1;Object.assign(f.row[66],{entryPolicyVersion:'PINE_NATIVE_SOLID_ENTRY_V7',nativeSolid:{version:'NATIVE_SOLID_LABEL_V1',barTime:f.row[1],pulse:true,basis:4100-sign,rsi:50}});return {f,ingest,sign};}
for(const tf of ['2','15'])for(const side of ['BUY','SELL']) {
 test(`Native V7 TF${tf} ${side} accepts opposite HEMA and candle, low checklist, blocked ATR telemetry`,()=>{
 const {f,ingest,sign}=native(tf,side);f.row[65]['tf'+tf].fast=4100-sign;f.row[3]=4100+sign*.5;f.row[40]=false;
 if(tf==='2')Object.assign(f.row[66].entrySafety,{flips:3,atr:5,chopBlocked:true});
 const m=ingest();a.equal(m.strategyNormal.state,'READY',m.strategyNormal.reason);a.ok(C.createEntryDecision(m));
 });
 for(const bad of ['wt','basis','rsi','pulse','bar','confirmed','price'])test(`Native V7 TF${tf} ${side} rejects ${bad}`,()=>{
 const {f,ingest,sign}=native(tf,side),e=f.row[66].nativeSolid;
 if(bad==='wt')f.row[13]=-sign*2;if(bad==='basis')e.basis=4100+sign;if(bad==='rsi')e.rsi=side==='BUY'?75:25;if(bad==='pulse')e.pulse=false;if(bad==='bar')e.barTime--;if(bad==='confirmed')f.batch.confirmed=false;if(bad==='price')f.row[66].sourceEntry=4100+sign;
 const m=ingest();a.equal(m.strategyNormal.state,'WAIT');a.equal(C.createEntryDecision({...m,strategyNormal:{...m.strategyNormal,state:'READY'}}),null);
 });
}
const Exit=require('../native-chart-exit');
for(const tf of ['2','15'])for(const side of ['BUY','SELL'])test(`V7 yellow closes actual ${side} TF${tf} without partial/profit gate`,()=>{
 const now=Date.now(),step=Number(tf)*60000,sign=side==='BUY'?1:-1;
 const y={version:'BJ_OPPOSITE_YELLOW_V1',barTime:now-step,fast:100+sign,slow:100,close:100-sign,confirmed:true};
 const market={symbol:'XAUUSD',timeframe:tf,time:now-step,signalObservedAt:now,confirmed:true,feedChannel:'EXECUTION',setupMeta:{entryPolicyVersion:'PINE_NATIVE_SOLID_ENTRY_V7',yellowExit:y},strategyNormal:{}};
 const latest={status:'EXECUTED',payload:{analysisSnapshot:{side,entryPolicyVersion:'PINE_SOLID_PRICE_WT_HEMA_V6',executionTimeframe:tf,setupKey:'actual',analysisSopVersion:'existing'}}},mode=tf==='2'?'TF2_SCALPING':'TF15_INTRA',pos=[{symbol:'XAUUSD',strategyMode:mode}];
 const close=Exit.forActiveSetup(market,latest,pos,mode,now);a.equal(close.positionManagement.action,'EXIT_ALL');a.equal(close.setupKey,'actual');
 for(const e of [{...y,confirmed:false},{...y,fast:100},{...y,barTime:now}])a.equal(Exit.forActiveSetup({...market,setupMeta:{...market.setupMeta,yellowExit:e}},latest,pos,mode,now).positionManagement,undefined);
 a.equal(Exit.forActiveSetup(market,latest,[{...pos[0],origin:'MANUAL'}],mode,now).positionManagement,undefined);
});
test('V7 scripts preserve risk/re-entry, use one structured alert and unconditional confirmed yellow exit',()=>{
 for(const tf of ['2','15']){const s=fs.readFileSync(`${__dirname}/../ZenCore_TF${tf}_SOP_V7.pine`,'utf8');a.equal((s.match(/\balert\(/g)||[]).length,1);a.match(s,/CLOSED_PAUSE_RESUME_V2/);a.match(s,/bool xc_yellow_exit = xc_buy \? \(v2_dr and not v2_dc\) : \(v2_ur and not v2_uc\)/);a.match(s,/if xc_yellow_exit or xc_stop/);a.match(s,/nativeSolid/);a.match(s,/NATIVE_SOLID_LABEL_V1/);a.match(s,/zc24_closed_entry_packet := zc24_payload/);if(tf==='2')a.match(s,/bool zs_pass = true/);}
});
for(const tf of ['2','15'])for(const side of ['BUY','SELL'])test(`V7 TF${tf} ${side}: signal queues once, connector receives full lot/layers and exit policy`,async()=>{
 const {f,ingest,sign}=native(tf,side);
 if(tf==='2'){f.row[3]=4100+sign*.5;f.row[40]=false;f.row[65].tf2.fast=4100-sign;Object.assign(f.row[66].entrySafety,{flips:3,atr:5,chopBlocked:true});}
 const m=ingest(),Core=require('../auto-trade-core');
 const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService,tokenHash}=require('../auto-trade-service');
 const store=new MemoryAutoTradeStore(),token='zcpod_'+'v'.repeat(48),hash=tokenHash(token),user='v7-'+tf+side;
 const pod={id:'v7pod'+tf+side,userId:user,tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:f.now,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};
 store.podsByUser.set(user,pod);store.podsByToken.set(hash,pod);
 const svc=createAutoTradeService({store,now:()=>f.now,scalpingTimeframe:'2',localEaExecutionUserIds:[user],allowedDemoSymbols:Core.TRADE_SYMBOLS,commandSigningKey:'a-test-signing-key-longer-than-thirty-two-bytes',getLatestMarket:(sym,frame)=>frame===tf?m:null});
 await svc.saveSettings(user,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:tf==='15'?'TF15_INTRA':'TF2_SCALPING',riskAcknowledged:true});await store.setControl(user,{desiredState:'ON',effectiveState:'ON'});
 a.equal((await svc.dispatchMarkets([m])).queued,1);a.equal((await svc.dispatchMarkets([m])).queued,0);
 const {command}=await svc.nextCommand(token);a.ok(command);a.equal(command.payload.side,side);a.equal(command.payload.layers,2);a.equal(command.payload.lotPerLayer,.01);a.equal(command.expiresAt,f.now+60000);
 const cp=require('child_process').spawnSync('python',['-c',"import json,sys;sys.path.insert(0,'ea-local-connector');from protocol import command_fields;print(json.dumps(command_fields(json.load(sys.stdin),{'account':'123','server':'TEST','tradeMode':'DEMO'})))"],{input:JSON.stringify(command),encoding:'utf8'});
 a.equal(cp.status,0,cp.stderr);a.equal(JSON.parse(cp.stdout).exitLockVersion,tf==='15'?'PINE_STEPLOCK_BE_TF15_V1':'PINE_STEPLOCK_150_TP3_PLUS3_V1');
});
for(const tf of ['2','15'])test(`V7 TF${tf}: Dashboard cannot replace or revoke authenticated EXECUTION candidate`,async()=>{
 const {f,ingest}=native(tf,'BUY'),m=ingest(),{createRealtimeDispatcher}=require('../realtime-dispatcher');let release,valid;const wait=new Promise(r=>release=r),batches=[];
 const d=createRealtimeDispatcher({dispatch:async(batch,current)=>{batches.push(batch);await wait;valid=current(batch[0]);},fetchMarkets:async()=>[]});
 const first=d.onMarket(m);await d.onMarket({...m,feedChannel:'DASHBOARD',signalObservedAt:f.now+1,entryEvent:false,strategyNormal:{...m.strategyNormal,state:'WAIT',plan:null}});
 a.equal(d.getLatestMarket('XAUUSD',tf),m);release();await first;a.equal(valid,true);a.equal(batches.length,1);
});
test('V7.1 native SOLID cannot be cancelled by the removed HEMA entry filter; follow-up HEMA remains required',()=>{
 for(const tf of ['2','15']){
  const s=fs.readFileSync(`${__dirname}/../ZenCore_TF${tf}_SOP_V7.pine`,'utf8');a.match(s,/bool zc_held_colour_end = false/);a.match(s,new RegExp(`TF${tf}-NATIVE-SOLID-V7.1`));a.match(s,/bool zn_entry = zc_cycle_kind == "INITIAL" \?[^\n]+: \(zn_data and zc24_price_past and zn_wt and zn_hema/);
 }
});
for(const side of ['BUY','SELL'])test(`V7 ${side} delivery skips removed initial colour veto but preserves FOLLOWUP candle rule`,()=>{
 const {f,ingest,sign}=native('2',side);f.row[3]=4100+sign*.5;f.row[40]=false;const m=ingest(),d=C.createEntryDecision(m),check=require('../entry-delivery-check').checkEntryDelivery;
 a.ok(d);const payload={...d.snapshot,side,analysisSnapshot:d.snapshot};a.equal(check({payload},m,f.now).ok,true);
 const follow={...m,strategyNormal:{...m.strategyNormal,sop:{...m.strategyNormal.sop,cycleKind:'FOLLOWUP'}}};a.equal(check({payload:{...payload,analysisSnapshot:{...d.snapshot,cycleKind:'FOLLOWUP'}}},follow,f.now).reason,'TF2_HOLD_CANDLE_DIRECTION');
 a.equal(check({payload:{...payload,analysisSnapshot:{...d.snapshot,entryAuthorizedAt:f.now-61000}}},m,f.now).reason,'ENTRY_EVENT_EXPIRED');
});
