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

for(const updated of [false,true])for(const side of ['BUY','SELL'])for(const planMode of ['Fixed R:R','Fibonacci'])test('ATR8 '+side+' '+planMode+' caps TP1 and SL at 3; preserves full flow and ATR10 compatibility',async()=>{
 for(const atr of [.5,2,3,8,20]){
  const f=fixture(side),sign=side==='BUY'?1:-1,entry=4100,sl=entry-sign*Math.min(atr,3);
  const targets=planMode==='Fibonacci'?[1.618,2.618,4.236].map(r=>sl+(entry-sl)*r):[1,2,3].map(r=>entry+sign*atr*r);
  targets[0]=entry+sign*Math.min(Math.abs(targets[0]-entry),3);
  Object.assign(f.row,{21:atr,23:sl,24:sl,25:targets[0],26:targets[1],27:targets[2]});
  Object.assign(f.row[66],{entryPolicyVersion:S.SOLID_POLICY,riskPlanVersion:S.RISK8,atrPeriod:8,riskAtrReference:atr,planMode});
  const m=Hub.ingest(f.batch,f.now)[0];a.equal(m.strategyNormal.state,'READY');
  const d=C.createEntryDecision(m);a.ok(d);a.equal(d.snapshot.confirmationEvidence.atrPeriod,8);
  a.ok(Math.abs(d.snapshot.tp1-d.snapshot.entry)<=3+1e-8);a.ok(Math.abs(d.snapshot.sl-d.snapshot.entry)<=3+1e-8);
  const settings={capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING'};
  const before=JSON.stringify(settings),cmd=Core.buildSetupCommand(m,settings,null,f.now);a.ok(cmd);a.equal(JSON.stringify(settings),before);
  const {AnalysisAlerts}=require('../analysis-alert-service'),alerts=new AnalysisAlerts();await alerts.init();await alerts.record(m);
  const e=alerts.events.find(e=>e.kind==='ENTRY');a.ok(e);a.equal(e.telegramSop.atrPeriod,8);a.equal(require('../analysis-telegram').entrySopAllowed(e),true);
  const cp=require('node:child_process'),result=cp.spawnSync('python',['-c',"import sys,json;sys.path.insert(0,'ea-local-connector');from protocol import command_fields;print(json.dumps(command_fields(json.load(sys.stdin),{'account':'123456','server':'TEST','tradeMode':'DEMO'})))"],{input:JSON.stringify({id:'00000000-0000-4000-8000-000000000000',type:'PLACE_SETUP',expiresAt:f.now+30000,payload:cmd.payload}),encoding:'utf8'});
  a.equal(result.status,0,result.stderr);a.equal(JSON.parse(result.stdout).exitLockVersion,S.POLICY.exitLockVersion);
  a.equal(S.entryDecision({...m,strategyNormal:{...m.strategyNormal,sop:{...m.strategyNormal.sop,atrPeriod:10}}},f.now),null);
  a.equal(S.planPass(side,{...m.strategyNormal.plan,tp1:entry+sign*3.01},m.strategyNormal.sop),false);
 }
 const old=fixture(side),legacy=Hub.ingest(old.batch,old.now)[0];a.ok(S.entryDecision(legacy,old.now));a.equal(legacy.strategyNormal.sop.atrPeriod,10);
});
test('Pine ATR8 chart and execution TP1 share the cap; metadata and download match',()=>{
 const fs=require('node:fs'),source=fs.readFileSync('ZenCore_TF2_ATR8_TP1Max3.pine','utf8');
 a.match(source,/atr\s*= ta\.atr\(8\)/);a.doesNotMatch(source,/atr\s*= ta\.atr\(10\)/);
 a.ok(source.includes('\\"atrPeriod\\":8'));a.match(source,/TF2_PINE_ATR8_SL4_TP150_250_350_CAPS_V3/);
 a.match(source,/zc_seq_tp1 := zc_seq_entry\+planSign\*math\.min\(math\.abs\(zc_seq_tp1-zc_seq_entry\),1\.5\)/);
 a.match(source,/tp1 := isBuy \? ENTRY \+ math\.min/);
 a.match(fs.readFileSync('server-analysis.js','utf8'),/downloads\/ZenCore_TF2_ATR8_TP1Max3\.pine/);
});

for(const updated of [false,true])for(const side of ['BUY','SELL'])for(const planMode of ['Fixed R:R','Fibonacci'])test('ATR8 '+side+' '+planMode+' cap version '+(updated?'SL3 TP250':'SL2 TP230')+' preserves exit SOP',async()=>{
 for(const atr of [.5,2,3,8,20]){
  const f=fixture(side),sign=side==='BUY'?1:-1,entry=4100,sl=entry-sign*Math.min(atr,updated?3:2);
  const targets=planMode==='Fibonacci'?[1.618,2.618,4.236].map(r=>sl+(entry-sl)*r):[1,2,3].map(r=>entry+sign*atr*r);
  targets.forEach((v,i)=>targets[i]=entry+sign*Math.min(Math.abs(v-entry),[1.5,updated?2.5:2.3,3.5][i]));
  Object.assign(f.row,{21:atr,23:sl,24:sl,25:targets[0],26:targets[1],27:targets[2]});
  Object.assign(f.row[66],{entryPolicyVersion:S.SOLID_POLICY,riskPlanVersion:updated?S.RISK8_CAPS3:S.RISK8_CAPS,atrPeriod:8,riskAtrReference:atr,planMode});
  const m=Hub.ingest(f.batch,f.now)[0];a.equal(m.strategyNormal.state,'READY');
  const d=C.createEntryDecision(m);a.ok(d);a.equal(d.snapshot.confirmationEvidence.atrPeriod,8);
  a.ok(Math.abs(d.snapshot.sl-d.snapshot.entry)<=(updated?3:2)+1e-8);
  for(const [i,key] of ['tp1','tp2','tp3'].entries()){a.ok(Math.abs(d.snapshot[key]-entry)<=[1.5,updated?2.5:2.3,3.5][i]+1e-8);a.equal(S.planPass(side,{...m.strategyNormal.plan,[key]:entry+sign*([1.5,updated?2.5:2.3,3.5][i]+.01)},m.strategyNormal.sop),false);}
  a.equal(d.snapshot.confirmationEvidence.riskPlanVersion,updated?S.RISK8_CAPS3:S.RISK8_CAPS);
  a.equal(d.snapshot.exitLockVersion,'PINE_STEPLOCK_150_TP3_PLUS3_V1');
  const settings={capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING'};
  const before=JSON.stringify(settings),cmd=Core.buildSetupCommand(m,settings,null,f.now);a.ok(cmd);a.equal(JSON.stringify(settings),before);
  const {AnalysisAlerts}=require('../analysis-alert-service'),alerts=new AnalysisAlerts();await alerts.init();await alerts.record(m);
  const e=alerts.events.find(e=>e.kind==='ENTRY');a.ok(e);a.equal(e.telegramSop.atrPeriod,8);a.equal(require('../analysis-telegram').entrySopAllowed(e),true);
  const cp=require('node:child_process'),result=cp.spawnSync('python',['-c',"import sys,json;sys.path.insert(0,'ea-local-connector');from protocol import command_fields;print(json.dumps(command_fields(json.load(sys.stdin),{'account':'123456','server':'TEST','tradeMode':'DEMO'})))"],{input:JSON.stringify({id:'00000000-0000-4000-8000-000000000000',type:'PLACE_SETUP',expiresAt:f.now+30000,payload:cmd.payload}),encoding:'utf8'});
  a.equal(result.status,0,result.stderr);a.equal(JSON.parse(result.stdout).exitLockVersion,S.POLICY.exitLockVersion);
  a.equal(S.entryDecision({...m,strategyNormal:{...m.strategyNormal,sop:{...m.strategyNormal.sop,atrPeriod:10}}},f.now),null);
  a.equal(S.planPass(side,{...m.strategyNormal.plan,tp1:entry+sign*3.01},m.strategyNormal.sop),false);
 }
 const old=fixture(side),legacy=Hub.ingest(old.batch,old.now)[0];a.ok(S.entryDecision(legacy,old.now));a.equal(legacy.strategyNormal.sop.atrPeriod,10);
});

for(const side of ['BUY','SELL'])for(const mode of ['Fixed R:R','Fibonacci'])test('new SL4 version '+side+' '+mode+' permits four while preserving old SL3 and TP caps',()=>{
 const sign=side==='BUY'?1:-1;
 for(const atr of [.5,2,3,3.5,4,6]){
  const f=fixture(side),entry=4100,sl=entry-sign*Math.min(atr,4),targets=mode==='Fibonacci'?[1.618,2.618,4.236].map(r=>sl+(entry-sl)*r):[1,2,3].map(r=>entry+sign*atr*r);
  targets.forEach((v,i)=>targets[i]=entry+sign*Math.min(Math.abs(v-entry),[1.5,2.5,3.5][i]));
  Object.assign(f.row,{21:atr,23:sl,24:sl,25:targets[0],26:targets[1],27:targets[2]});
  Object.assign(f.row[66],{entryPolicyVersion:S.SOLID_POLICY,riskPlanVersion:S.RISK8_CAPS4,atrPeriod:8,riskAtrReference:atr,planMode:mode});
  const m=Hub.ingest(f.batch,f.now)[0],decision=C.createEntryDecision(m);a.ok(decision);a.equal(decision.snapshot.confirmationEvidence.slMaximumPrice,4);a.equal(decision.snapshot.confirmationEvidence.tp2MaximumPrice,2.5);
  const command=Core.buildSetupCommand(m,{capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING'},null,f.now);a.ok(command);a.equal(command.payload.sl,sl);
  a.equal(S.planPass(side,{...m.strategyNormal.plan,sl:entry-sign*4.01},m.strategyNormal.sop),false);
  if(atr>3)a.equal(S.planPass(side,m.strategyNormal.plan,{...m.strategyNormal.sop,riskPlanVersion:S.RISK8_CAPS3}),false);
 }
});
