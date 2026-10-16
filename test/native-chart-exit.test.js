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
