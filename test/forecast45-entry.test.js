'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');

{
const S=require('../tf2-ribbon-scalping'),Hub=require('../tf2-ribbon-market-hub'),C=require('../analysis-execution-contract'),Core=require('../auto-trade-core');let seq=0;
function fixture(side='BUY'){
 const now=Date.now()+ ++seq,sign=side==='BUY'?1:-1,row=Array(67).fill(null),t=now-180000;
 Object.assign(row,{0:'XAUUSD',1:t,6:4100,13:sign*2,14:sign,16:35,21:4,22:4100,23:4100-sign*3,24:4100-sign*3,25:4100+sign*4,26:4100+sign*8,27:4100+sign*12,28:true,29:side==='BUY',34:side,35:true,36:true,37:true,38:true,39:true,40:true,41:true,42:side==='BUY'?'BULLISH':'BEARISH',43:60,48:'HOLD',49:'HOLD',52:100,56:0,57:'INITIAL',58:'NONE',59:false});
 row[65]={version:'HEMA2_LIVE_V1',tf2:{fast:4100+sign,slow:4100,fastPreviousBar:4100,slowPreviousBar:4100-sign}};
 row[66]={entryRuleVersion:S.RULE,exitLockVersion:S.POLICY.exitLockVersion,entryPolicyVersion:S.POLICY.entryPolicyVersion,planMode:"Fixed R:R",riskPlanVersion:S.RISK,atrPeriod:10,solidSide:side,solidHoldActive:true,solidClosedAt:null,solidTriggeredAt:t,setupAt:t,sourceEntry:4100-sign,solidEligible:true,completedAt:now,completionPrice:4100,riskAtrReference:4,riskStructure:4100-sign*2,riskTick:.01,entryEvent:true,entryAuthorizedAt:now,dashboardAi:{momentum:side==='BUY'?'Bullish 🟢':'Bearish 🔴',mtfScore:sign,dashboard:{mtfTimeframes:['3','5','10']}}};
 return {row,now,batch:{feedVersion:'TF2_REALTIME_V1',timeframe:'2',schemaVersion:'32.3-EXIT-STEPLOCK',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedChannel:'EXECUTION',confirmed:false,emittedAt:now,markets:[row]}};
}

 for(const side of ['BUY','SELL']){
 test('TF2 '+side+' Forecast45 feed -> server -> signed setup; legacy still supported',()=>{
  const f=fixture(side);f.row[66].entryPolicyVersion=S.FORECAST_POLICY;
  f.row[16]=99;f.row[66].dashboardAi.mtfScore=0;delete f.row[66].dashboardAi.dashboard;
  const m=Hub.ingest(f.batch,f.now)[0];a.equal(m.strategyNormal.state,'READY');
  const d=C.createEntryDecision(m,f.now);a.ok(d);a.equal(d.snapshot.entryPolicyVersion,S.FORECAST_POLICY);
  const settings={capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING',tradingSchedule:{enabled:false}};
  const before=JSON.stringify(settings);const cmd=Core.buildSetupCommand(m,settings,null,f.now);a.ok(cmd);a.equal(JSON.stringify(settings),before);
  a.equal(Core.permitsPositionEntry(m,[{symbol:'XAUUSD',strategyMode:settings.strategyMode,origin:'ZENCORE'}]),false);
  a.equal(Core.permitsPositionEntry(m,[{symbol:'XAUUSD',strategyMode:settings.strategyMode==='TF2_SCALPING'?'TF15_INTRA':'TF2_SCALPING',origin:'ZENCORE'}]),true);
  a.equal(cmd.payload.analysisSnapshot.exitLockVersion,S.POLICY.exitLockVersion);
  const s=m.strategyNormal.sop;
  for(const [forecast,power,pass] of [['NEUTRAL',45,false],['NEUTRAL',side==='BUY'?45.01:44.99,true],[side==='BUY'?'BULLISH':'BEARISH',50,false],[side==='BUY'?'BULLISH':'BEARISH',50.01,true],['CHOPPY',99,false],['NEUTRAL',null,false]]){
   a.equal(S.confirmations(side,{...s,forecast,marketPower:power}).gates.find(g=>g.key==='forecast').pass,pass);
  }
  a.equal(S.confirmations(side,{...s,forecast:'CHOPPY'}).passed,3);
  a.equal(S.confirmations(side,{...s,forecast:'CHOPPY',sopGreen:3}).pass,false);
  a.equal(S.confirmations(side,{...s,['hema2']:{...s['hema2'],fast:s['hema2'].slow}}).pass,false);
  a.equal(S.confirmations(side,{...s,advisor:{momentum:'Neutral'}}).pass,false);
  const dash={...m,feedChannel:'DASHBOARD'};a.equal(C.createEntryDecision(dash,f.now),null);
  a.equal(S.entryDecision(m,f.now+61000),null);
  const old=fixture(side),legacy=Hub.ingest(old.batch,old.now)[0];a.ok(C.createEntryDecision(legacy,old.now));
 });
 }
}

{
const S=require('../tf15-intraday'),Hub=require('../tf15-market-hub'),C=require('../analysis-execution-contract'),Core=require('../auto-trade-core');let seq=0;
function fixture(side='BUY'){
 const now=Date.now()+ ++seq,sign=side==='BUY'?1:-1,row=Array(67).fill(null),t=now-180000;
 Object.assign(row,{0:'XAUUSD',1:t,6:4100,13:sign*2,14:sign,16:35,21:4,22:4100,23:4100-sign*4,24:4100-sign*4,25:4100+sign*4,26:4100+sign*8,27:4100+sign*12,28:true,29:side==='BUY',34:side,35:true,36:true,37:true,38:true,39:true,40:true,41:true,42:side==='BUY'?'BULLISH':'BEARISH',43:60,48:'HOLD',49:'HOLD',52:100,56:0,57:'INITIAL',58:'NONE',59:false});
 row[65]={version:'HEMA15_LIVE_V1',tf15:{fast:4100+sign,slow:4100,fastPreviousBar:4100,slowPreviousBar:4100-sign}};
 row[66]={entryRuleVersion:S.RULE,exitLockVersion:S.POLICY.exitLockVersion,entryPolicyVersion:S.POLICY.entryPolicyVersion,planMode:"Fixed R:R",riskPlanVersion:S.RISK,atrPeriod:14,solidSide:side,solidHoldActive:true,solidClosedAt:null,solidTriggeredAt:t,setupAt:t,sourceEntry:4100-sign,solidEligible:true,completedAt:now,completionPrice:4100,riskAtrReference:4,riskStructure:4100-sign*2,riskTick:.01,entryEvent:true,entryAuthorizedAt:now,dashboardAi:{momentum:side==='BUY'?'Bullish 🟢':'Bearish 🔴',mtfScore:sign,dashboard:{mtfTimeframes:['15','30','45']}}};
 return {row,now,batch:{feedVersion:'TF15_REALTIME_V1',timeframe:'15',schemaVersion:'32.3-EXIT-STEPLOCK',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedChannel:'EXECUTION',confirmed:false,emittedAt:now,markets:[row]}};
}

 for(const side of ['BUY','SELL']){
 test('TF15 '+side+' Forecast45 feed -> server -> signed setup; legacy still supported',()=>{
  const f=fixture(side);f.row[66].entryPolicyVersion=S.FORECAST_POLICY;
  f.row[16]=99;f.row[66].dashboardAi.mtfScore=0;delete f.row[66].dashboardAi.dashboard;
  const m=Hub.ingest(f.batch,f.now)[0];a.equal(m.strategyNormal.state,'READY');
  const d=C.createEntryDecision(m,f.now);a.ok(d);a.equal(d.snapshot.entryPolicyVersion,S.FORECAST_POLICY);
  const settings={capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF15_INTRA',tradingSchedule:{enabled:false}};
  const before=JSON.stringify(settings);const cmd=Core.buildSetupCommand(m,settings,null,f.now);a.ok(cmd);a.equal(JSON.stringify(settings),before);
  a.equal(Core.permitsPositionEntry(m,[{symbol:'XAUUSD',strategyMode:settings.strategyMode,origin:'ZENCORE'}]),false);
  a.equal(Core.permitsPositionEntry(m,[{symbol:'XAUUSD',strategyMode:settings.strategyMode==='TF2_SCALPING'?'TF15_INTRA':'TF2_SCALPING',origin:'ZENCORE'}]),true);
  a.equal(cmd.payload.analysisSnapshot.exitLockVersion,S.POLICY.exitLockVersion);
  const s=m.strategyNormal.sop;
  for(const [forecast,power,pass] of [['NEUTRAL',45,false],['NEUTRAL',side==='BUY'?45.01:44.99,true],[side==='BUY'?'BULLISH':'BEARISH',50,false],[side==='BUY'?'BULLISH':'BEARISH',50.01,true],['CHOPPY',99,false],['NEUTRAL',null,false]]){
   a.equal(S.confirmations(side,{...s,forecast,marketPower:power}).gates.find(g=>g.key==='forecast').pass,pass);
  }
  a.equal(S.confirmations(side,{...s,forecast:'CHOPPY'}).passed,3);
  a.equal(S.confirmations(side,{...s,forecast:'CHOPPY',sopGreen:3}).pass,false);
  a.equal(S.confirmations(side,{...s,['hema15']:{...s['hema15'],fast:s['hema15'].slow}}).pass,false);
  a.equal(S.confirmations(side,{...s,advisor:{momentum:'Neutral'}}).pass,false);
  const dash={...m,feedChannel:'DASHBOARD'};a.equal(C.createEntryDecision(dash,f.now),null);
  a.equal(S.entryDecision(m,f.now+61000),null);
  const old=fixture(side),legacy=Hub.ingest(old.batch,old.now)[0];a.ok(C.createEntryDecision(legacy,old.now));
 });
 }
}

test('new Pine scripts use own-TF forecast vote and remove Chop entry veto without changing exits',()=>{
 const fs=require('node:fs');
 for(const [tf,original] of [['2','ZenCore_TF2_Scalp.pine'],['15','ZenCore_TF15_Intraday.pine']]){
  const old=fs.readFileSync(original,'utf8'),source=fs.readFileSync('ZenCore_TF'+tf+'_Forecast45.pine','utf8');
  a.match(source,/PINE_3TRIGGERS_3OF4_FORECAST45_V4/);
  a.match(source,/market_power > 45/);a.match(source,/market_power < 45/);a.match(source,/market_power > 50/);
  const votes=source.split('\n').find(l=>l.startsWith('int zc80_passed ='));
  a.match(votes,/zc24_forecast/);a.doesNotMatch(votes,/zc_seq_mtf/);
  for(const line of source.split('\n').filter(l=>/^(bool zc_followup|bool zc_hold_qualify|bool zc24_ready|zc24_ready :=)/.test(l))) a.doesNotMatch(line,/zc_chop_pass/);
  const exitLines=s=>s.split('\n').filter(l=>/xc_sl|xc_tp|slLock|exitLockVersion/.test(l)&&!l.includes('zc24_meta_json'));
  a.deepEqual(exitLines(source),exitLines(old));
 }
});
