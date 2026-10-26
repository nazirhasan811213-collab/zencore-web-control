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


for(const side of ['BUY','SELL'])test('TF2 '+side+' rejects checklist 3/5 despite all other confirmations passing, across decision/order/Telegram',async()=>{
 const f=fixture(side);f.row[66].entryPolicyVersion=S.SOLID_POLICY;
 f.row[38]=false;f.row[39]=false;
 const m=Hub.ingest(f.batch,f.now)[0],s=m.strategyNormal.sop;
 a.equal(s.sopGreen,3);a.equal(s.passed,3);a.equal(s.checklistPass,false);
 a.equal(m.strategyNormal.state,'WAIT');a.match(m.strategyNormal.reason,/wajib minimum 4\/5/);
 const forced={...m,strategyNormal:{...m.strategyNormal,state:'READY'}};
 a.equal(C.createEntryDecision(forced,f.now),null,'cached READY must not bypass the new gate');
 a.equal(Core.buildSetupCommand(forced,{capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING'},null,f.now),null);
 const {entrySopAllowed}=require('../analysis-telegram');
 const event={kind:'ENTRY',symbol:'XAUUSD',timeframe:'2',side,telegramPlan:m.strategyNormal.plan,telegramSop:{...s,version:S.VERSION,tf:'2m',green:3,power:s.marketPower,solid:true,solidHoldActive:true,solidClosedAt:null}};
 a.equal(entrySopAllowed(event),false);
 for(const cycleKind of ['INITIAL','FOLLOWUP'])for(const entryPolicyVersion of [S.SOLID_POLICY,S.FORECAST_POLICY,S.POLICY.entryPolicyVersion]){
  const p={...s,cycleKind,entryPolicyVersion};a.equal(S.confirmations(side,p).pass,false);
  for(const bad of [undefined,null,3,3.9,6])a.equal(S.confirmations(side,{...p,sopGreen:bad}).pass,false);
  for(const green of [4,5])a.equal(S.confirmations(side,{...p,sopGreen:green}).pass,true);
 }
});
test('TF15 still accepts its prior 3-of-4 policy when checklist alone fails',()=>{
 const S15=require('../tf15-intraday');
 const s={entryPolicyVersion:S15.SOLID_POLICY,atrReference:2,price:101,sourceEntry:100,sopGreen:3,forecast:'BULLISH',marketPower:74,hema15:{fast:100,slow:99,waveTrend1:4,waveTrend2:1}};
 a.equal(S15.confirmations('BUY',s).pass,true);
});
