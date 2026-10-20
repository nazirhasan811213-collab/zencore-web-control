'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const S=require('../tf2-ribbon-scalping'),Core=require('../auto-trade-core');let seq=0;
function fixture(side='BUY'){
 const now=Date.now()+ ++seq,sign=side==='BUY'?1:-1,row=Array(67).fill(null),t=now-180000;
 Object.assign(row,{0:'XAUUSD',1:t,6:4100,13:sign*2,14:sign,16:35,21:4,22:4100,23:4100-sign*3,24:4100-sign*3,25:4100+sign*4,26:4100+sign*8,27:4100+sign*12,28:true,29:side==='BUY',34:side,35:true,36:true,37:true,38:true,39:true,40:true,41:true,42:side==='BUY'?'BULLISH':'BEARISH',43:60,48:'HOLD',49:'HOLD',52:100,56:0,57:'INITIAL',58:'NONE',59:false});
 row[65]={version:'HEMA2_LIVE_V1',tf2:{fast:4100+sign,slow:4100,fastPreviousBar:4100,slowPreviousBar:4100-sign}};
 row[66]={entryRuleVersion:S.RULE,exitLockVersion:S.POLICY.exitLockVersion,entryPolicyVersion:S.POLICY.entryPolicyVersion,planMode:"Fixed R:R",riskPlanVersion:S.RISK,atrPeriod:10,solidSide:side,solidHoldActive:true,solidClosedAt:null,solidTriggeredAt:t,setupAt:t,sourceEntry:4100-sign,solidEligible:true,completedAt:now,completionPrice:4100,riskAtrReference:4,riskStructure:4100-sign*2,riskTick:.01,entryEvent:true,entryAuthorizedAt:now,dashboardAi:{momentum:side==='BUY'?'Bullish 🟢':'Bearish 🔴',mtfScore:sign,dashboard:{mtfTimeframes:['3','5','10']}}};
 return {row,now,batch:{feedVersion:'TF2_REALTIME_V1',timeframe:'2',schemaVersion:'32.3-EXIT-STEPLOCK',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedChannel:'EXECUTION',confirmed:false,emittedAt:now,markets:[row]}};
}

function aged(age,side='BUY'){
 const f=fixture(side),at=Date.now(),t=at-age;f.now=t;f.batch.emittedAt=t;f.row[1]=t-120000;
 Object.assign(f.row[66],{entryPolicyVersion:S.SOLID_POLICY,entryDeliveryVersion:'FIXED_EVENT_RETRY_V1',solidTriggeredAt:t-120000,setupAt:t-120000,completedAt:t,entryAuthorizedAt:t});
 delete require.cache[require.resolve('../tf2-ribbon-market-hub')];
 return {m:require('../tf2-ribbon-market-hub').ingest(f.batch,t)[0],at,f};
}
for(const side of ['BUY','SELL'])test('TF2 '+side+' data and delivery accept through 60s; event expiry never renewed',()=>{
 const Delivery=require('../entry-delivery-check');
 for(const age of [30001,45000,60000,60001]){
  const {m,at}=aged(age,side),pass=age<=60000;
  a.equal(!!S.entryDecision(m,at),pass);
  const snap={...S.entryDecision(m,m.receivedAt).snapshot};
  const command={payload:{side,entry:snap.entry,sl:snap.sl,tp1:snap.tp1,tp2:snap.tp2,tp3:snap.tp3,analysisSnapshot:snap}};
  a.equal(Delivery.checkEntryDelivery(command,m,at).ok,pass);
 }
 const {m,at}=aged(45000,side);m.entryAuthorizedAt=at-60001;m.strategyNormal.sop.qualifiedAt=at-60001;
 a.equal(S.entryDecision(m,at),null);
});
test('TF2 hub accepts data at 60s, rejects 60001ms and keeps TF15/heartbeat limits unchanged',()=>{
 const {f,at}=aged(60000);delete require.cache[require.resolve('../tf2-ribbon-market-hub')];
 const h=require('../tf2-ribbon-market-hub');a.equal(h.ingest(f.batch,at).length,1);
 a.equal(h.ingest({...f.batch,emittedAt:at-60001},at).length,0);
 const Age=require('../entry-data-age');a.equal(Age.maximumAge({timeframe:'15',strategyNormal:{entrySopVersion:'NORMAL_20261001_TF15_RIBBON_V1'}}),30000);
 a.equal(require('../tf15-intraday').entryDecision({...aged(45000).m,timeframe:'15'},at),null);
});
test('fresh local connector can queue a TF2 setup from 45-second data without user setting changes',async()=>{
 const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService,tokenHash}=require('../auto-trade-service');
 const {m,at}=aged(45000),store=new MemoryAutoTradeStore(),user='age60-test',token='zcpod_'+'a'.repeat(48),hash=tokenHash(token);
 const pod={id:'age60-pod',userId:user,tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:at,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};
 store.podsByUser.set(user,pod);store.podsByToken.set(hash,pod);
 const svc=createAutoTradeService({store,now:()=>at,scalpingTimeframe:'2',allowLocalEaDemoExecution:true,allowedDemoSymbols:['XAUUSD'],commandSigningKey:'a-test-signing-key-longer-than-thirty-two-bytes',getLatestMarket:()=>m});
 await svc.saveSettings(user,{capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING',riskAcknowledged:true});await store.setControl(user,{desiredState:'ON',effectiveState:'ON'});
 const before=JSON.stringify(await store.getProfile(user));a.equal((await svc.dispatchMarkets([m])).queued,1);a.ok((await svc.nextCommand(token)).command);a.equal(JSON.stringify(await store.getProfile(user)),before);
});
test('Telegram uses TF2 60s receipt while TF15 remains 30s and original event expiry stays 60s',()=>{
 const {entryFresh}=require('../analysis-telegram'),at=Date.now(),e={time:at-45000,timeframe:'2',telegramSop:{entryPolicyVersion:S.SOLID_POLICY},telegramMarket:{entryAuthorizedAt:at-45000}};
 a.equal(entryFresh(e,at),true);a.equal(entryFresh({...e,timeframe:'15'},at),false);
 a.equal(entryFresh({...e,time:at,telegramMarket:{entryAuthorizedAt:at-60001}},at),false);
});
