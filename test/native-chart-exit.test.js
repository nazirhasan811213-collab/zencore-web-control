'use strict';
const test=require('node:test'),a=require('node:assert/strict'),{forActiveSetup}=require('../native-chart-exit');
test('native close targets executed TF strategy after newer SOLID; no virtual or dashboard rebinding',()=>{
 const now=Date.now(),policy='PINE_3TRIGGERS_4OF5_V2';
 for(const tf of ['3','15']) {
  const mode=tf==='15'?'TF15_INTRA':'TF2_SCALPING';
  const m={symbol:'XAUUSD',timeframe:tf,setupKey:'NEW',nativeChartExitAll:true,feedChannel:'EXECUTION',signalObservedAt:now,setupMeta:{entryPolicyVersion:policy},strategyNormal:{side:'SELL'}};
  const latest={status:'EXECUTED',payload:{analysisSnapshot:{entryPolicyVersion:policy,executionTimeframe:tf,setupKey:'EXECUTED',side:'BUY',analysisSopVersion:`NORMAL_20261001_TF${tf}_RIBBON_V1`}}};
  const p=[{symbol:'XAUUSD',strategyMode:mode,origin:'ZENCORE'}];
  const out=forActiveSetup(m,latest,p,mode,now);
  a.equal(out.setupKey,'EXECUTED');a.equal(out.strategyNormal.side,'BUY');a.equal(out.positionManagement.action,'EXIT_ALL');a.equal(m.setupKey,'NEW');
  const decision=require('../analysis-execution-contract').createManagementDecision({...out,receivedAt:now});
  a.equal(decision.snapshot.actions[0].percent,100);a.equal(decision.snapshot.setupKey,'EXECUTED');
  for(const change of [{nativeChartExitAll:false},{feedChannel:'DASHBOARD'},{signalObservedAt:now-31000},{timeframe:'30'}]) {
   const invalid={...m,...change};a.equal(forActiveSetup(invalid,latest,p,mode,now),invalid);
  }
  a.equal(forActiveSetup(m,latest,[{...p[0],origin:'MANUAL'}],mode,now),m);
  a.equal(forActiveSetup(m,{...latest,status:'FAILED'},p,mode,now),m);
 }
});

test('confirmed opposite yellow binds to the executed side even after the chart changes setup',()=>{
 const now=Date.now(),time=now-120000,mode='TF2_SCALPING';
 const market={symbol:'BTCUSD',timeframe:'2',time,confirmed:true,feedChannel:'EXECUTION',signalObservedAt:now,
  setupKey:'chart-new',strategyNormal:{side:'SELL'},setupMeta:{entryPolicyVersion:'PINE_NATIVE_SOLID_ENTRY_V7',
   yellowExit:{version:'BJ_OPPOSITE_YELLOW_V1',barTime:time,confirmed:true,fast:101,slow:100,close:99}}};
 const latest={status:'EXECUTED',payload:{analysisSnapshot:{entryPolicyVersion:'PINE_3TRIGGERS_3OF4_CHOP50_V3',
  executionTimeframe:'2',setupKey:'broker-active',side:'BUY',analysisSopVersion:'NORMAL_20261001_TF2_RIBBON_V1'}}};
 const positions=[{symbol:'BTCUSD',strategyMode:mode,origin:'ZENCORE'}];
 const close=forActiveSetup(market,latest,positions,mode,now);
 a.equal(close.setupKey,'broker-active');
 a.equal(close.positionManagement.action,'EXIT_ALL');
 a.equal(close.positionManagement.confirmedChartClose,true);
 a.equal(forActiveSetup({...market,confirmed:false},latest,positions,mode,now).setupKey,'chart-new');
 a.equal(forActiveSetup({...market,time:time-120000},latest,positions,mode,now).setupKey,'chart-new');
});
