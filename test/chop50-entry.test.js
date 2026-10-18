'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Contract=require('../analysis-execution-contract'),Core=require('../auto-trade-core');
const delivery=require('../entry-delivery-check').checkEntryDelivery;

function frame(tf,side,{atr=2,chop=35,mode='Fixed R:R'}={}){
 const S=require(tf==='3'?'../tf3-scalping':'../tf15-intraday'),now=Date.now(),sign=side==='BUY'?1:-1,entry=4100;
 const distance=tf==='3'?Math.max(atr,3):atr,sl=entry-sign*distance;
 const targets=mode==='Fibonacci'?[1.618,2.618,4.236].map(r=>sl+(entry-sl)*r):[1,2,3].map(r=>entry+sign*atr*r);
 const d={feedChannel:'EXECUTION',entryEvent:true,feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',entryAuthorizedAt:now,signalObservedAt:now,receivedAt:now,
  timeframe:tf,symbol:'XAUUSD',setupKey:`TF${tf}|${side}|${now}`,normal3Close:entry,price:entry,normal3Entry:entry,initialSl:sl,tp1:targets[0],tp2:targets[1],tp3:targets[2],
  normal3Atr:atr,waveTrend1:sign*2,waveTrend2:sign,chopIndex:chop,
  normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:true,normal3Sop5:true,
  // Forecast intentionally missing: it must not be an entry dependency.
  hemaConfirmation:{['tf'+tf]:{fast:entry+sign,slow:entry}},
  setupMeta:{entryRuleVersion:S.RULE,entryPolicyVersion:S.POLICY.entryPolicyVersion,riskPlanVersion:S.RISK,atrPeriod:14,planMode:mode,
   solidSide:side,solidHoldActive:true,solidClosedAt:null,solidTriggeredAt:now-1000,sourceEntry:entry-sign,
   solidEligible:true,completedAt:now,completionPrice:entry,riskAtrReference:atr,
   dashboardAi:{momentum:side==='BUY'?'Bullish 🟢':'Bearish 🔴',mtfScore:sign,dashboard:{mtfTimeframes:S.POLICY.mtf}}}};
 d.strategyNormal=S.strategy(d,now);return {S,d,now,sign};
}

for(const tf of ['3','15'])for(const side of ['BUY','SELL']){
 test(`TF${tf} ${side}: exactly 3/4 accepted without forecast, 2/4 rejected`,()=>{
  const {S,d,now,sign}=frame(tf,side);d.setupMeta.dashboardAi.mtfScore=-sign;
  d.strategyNormal=S.strategy(d,now);assert.equal(d.strategyNormal.sop.passed,3);assert.equal(d.strategyNormal.sop.total,4);
  assert.equal(d.strategyNormal.sop.requiredPassed,3);assert.ok(Contract.createEntryDecision(d));
  d.setupMeta.sourceEntry=d.price+sign;d.strategyNormal=S.strategy(d,now);
  assert.equal(d.strategyNormal.sop.passed,2);assert.equal(Contract.createEntryDecision(d),null);
 });
 test(`TF${tf} ${side}: strict Chop boundary vetoes initial and queued entry`,()=>{
  for(const chop of [0,49.999,50,61.8,100,null,undefined,NaN,-1,'35']){
   const {S,d,now}=frame(tf,side);d.chopIndex=chop;d.strategyNormal=S.strategy(d,now);
   const pass=typeof chop==='number'&&Number.isFinite(chop)&&chop>=0&&chop<50;
   assert.equal(!!Contract.createEntryDecision(d),pass,String(chop));
  }
  const {d,now}=frame(tf,side),cmd=Core.buildSetupCommand(d,{capitalUsd:1000,lotPerLayer:.01,layers:1,symbols:['XAUUSD'],strategyMode:'BOTH'},null,now);
  assert.ok(cmd);assert.equal(delivery(cmd,d,now).ok,true);
  // Never trust a cached READY flag after the final confirmation changes.
  d.strategyNormal.sop.chopIndex=50;
  assert.equal(delivery(cmd,d,now).reason,'SOP_CONFIRMATION_FAILED');
 });
 test(`TF${tf} ${side}: SL floor and selected target formulas survive snapshot validation`,()=>{
  for(const atr of [1,2.99,3,5])for(const mode of ['Fixed R:R','Fibonacci']){
   const {S,d}=frame(tf,side,{atr,mode}),decision=Contract.createEntryDecision(d);assert.ok(decision,`${atr} ${mode}`);
   const expected=tf==='3'?Math.max(atr,3):atr;
   assert.ok(Math.abs(Math.abs(decision.snapshot.entry-decision.snapshot.sl)-expected)<1e-6);
   assert.equal(decision.snapshot.confirmationEvidence.chopIndex,35);
   const bad={...d.strategyNormal.plan,sl:d.price-(side==='BUY'?1:-1)*(expected+.1)};
   assert.equal(S.planPass(side,bad,d.strategyNormal.sop),false);
  }
 });
}

test('new entries reject the old policy while native exits still protect positions opened under it',()=>{
 const {S,d,now}=frame('3','BUY');d.setupMeta.entryPolicyVersion='PINE_3TRIGGERS_4OF5_V2';d.strategyNormal=S.strategy(d,now);
 assert.equal(Contract.createEntryDecision(d),null);
 const exit=require('../native-chart-exit').forActiveSetup;
 const m={...d,nativeChartExitAll:true,setupMeta:{entryPolicyVersion:S.POLICY.entryPolicyVersion}};
 const result=exit(m,{status:'EXECUTED',payload:{analysisSnapshot:{entryPolicyVersion:'PINE_3TRIGGERS_4OF5_V2',executionTimeframe:'3',side:'BUY',setupKey:'old',analysisSopVersion:S.VERSION}}},
  [{symbol:'XAUUSD',origin:'AUTO',strategyMode:'TF2_SCALPING'}],'TF2_SCALPING',now);
 assert.equal(result.positionManagement.action,'EXIT_ALL');assert.equal(result.setupKey,'old');
});

test('Pine and server agree on Chop boundaries and all qualification/retry gates enforce it',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 for(const tf of ['3','15']){
  const text=fs.readFileSync(`ZenCore_TF${tf}_${tf==='3'?'Scalp':'Intraday'}.pine`,'utf8');
  const expression=text.match(/^bool zc_chop_pass = (.*)$/m)[1].replace(/\band\b/g,'&&').replace(/\bnot\b/g,'!');
  for(const value of [0,49.999,50,100,null]){
   const result=vm.runInNewContext(expression,{chop_val:value,na:x=>x==null});
   const {S,d}=frame(tf,'BUY',{chop:value});
   assert.equal(result,S.confirmations('BUY',d.strategyNormal.sop).chopPass);
  }
  const count=text.match(/^int zc80_passed = (.*)$/m)[1];
  assert.doesNotMatch(count,/forecast/);
  for(const line of text.split('\n').filter(l=>/^(bool zc_hold_qualify =|bool zc_followup =|bool zc24_ready =|zc24_ready :=)/.test(l))){
   assert.match(line,/zc_chop_pass/);assert.match(line,/zc80_passed\s*>=\s*3/);
  }
 }
});
