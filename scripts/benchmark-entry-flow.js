'use strict';
// Offline service benchmark: no HTTP, VPS, MT5 or broker connection.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {MemoryAutoTradeStore}=require('../auto-trade-store');
const {createAutoTradeService,tokenHash}=require('../auto-trade-service');
const Core=require('../auto-trade-core');
const dir=path.resolve(__dirname,'../test');
const req=require('node:module').createRequire(path.join(dir,'sop-v6.test.js'));
const prefix=fs.readFileSync(path.join(dir,'sop-v6.test.js'),'utf8').split("\nfor(const tf of ['2','15'])for(const side")[0];
const {fixture}=new Function('require','__dirname',prefix+';return {fixture};')(req,dir);
const store=new MemoryAutoTradeStore();
let now=Date.now(),latest=null;
const users=Array.from({length:100},()=>({id:crypto.randomUUID(),token:'zcpod_'+crypto.randomBytes(36).toString('base64url')}));
for(const u of users){const hash=tokenHash(u.token);u.pod={id:crypto.randomUUID(),userId:u.id,tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:now,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};store.podsByUser.set(u.id,u.pod);store.podsByToken.set(hash,u.pod);}
const svc=createAutoTradeService({store,now:()=>now,scalpingTimeframe:'2',localEaExecutionUserIds:users.map(u=>u.id),allowedDemoSymbols:Core.TRADE_SYMBOLS,commandSigningKey:'offline-benchmark-only-signing-key-at-least-32-bytes',getLatestMarket:(symbol,tf)=>latest?.timeframe===tf?latest:null});
const percentile=(xs,q)=>[...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*q)-1)];
(async()=>{
for(const u of users){await svc.saveSettings(u.id,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'BOTH',modeSettings:{TF2_SCALPING:{gold:{enabled:true,lotPerLayer:.01,layers:2},fx:{enabled:false}},TF15_INTRA:{gold:{enabled:true,lotPerLayer:.01,layers:2},fx:{enabled:false}}},riskAcknowledged:true});await store.setControl(u.id,{desiredState:'ON',effectiveState:'ON'});}
const queueMs=[],deliveryMs=[],roundMs=[],counts={signals:100,users:100,expected:10000,queued:0,delivered:0,duplicates:0,missing:0,invalidPayload:0};
const ids=new Set(),realDateNow=Date.now;
const started=performance.now();
try{
for(let i=0;i<100;i++){
 now+=900000;Date.now=()=>now;
 const tf=i%2?'15':'2',side=i%4<2?'BUY':'SELL',sign=side==='BUY'?1:-1;
 const {f,ingest}=fixture(tf,side);
 Object.assign(f.row[66],{entryPolicyVersion:'PINE_NATIVE_SOLID_ENTRY_V7',nativeSolid:{version:'NATIVE_SOLID_LABEL_V1',barTime:f.row[1],pulse:true,basis:4100-sign,rsi:50}});
 latest=ingest();assert.equal(latest.strategyNormal.state,'READY',latest.strategyNormal.reason);
 for(const u of users)u.pod.lastSeenAt=now;
 const start=performance.now(),result=await svc.dispatchMarkets([latest]);counts.queued+=result.queued;queueMs.push(performance.now()-start);
 for(const u of users){
  const {command}=await svc.nextCommand(u.token);
  if(!command){counts.missing++;continue;}
  counts.delivered++;deliveryMs.push(performance.now()-start);
  if(ids.has(command.id))counts.duplicates++;ids.add(command.id);
  if(command.type!=='PLACE_SETUP'||command.payload.side!==side||command.payload.strategyMode!==(tf==='2'?'TF2_SCALPING':'TF15_INTRA')||command.payload.layers!==2)counts.invalidPayload++;
  // Transport-only completion: explicitly do not manufacture a broker fill.
  await svc.acknowledgeCommand(u.token,command.id,{status:'REJECTED',code:'BENCHMARK_NO_BROKER'});
 }
 roundMs.push(performance.now()-start);
 assert.equal((await svc.dispatchMarkets([latest])).queued,0,'duplicate Pine replay');
}
}finally{Date.now=realDateNow;}
const stats=xs=>({medianMs:+percentile(xs,.5).toFixed(2),p95Ms:+percentile(xs,.95).toFixed(2),maxMs:+Math.max(...xs).toFixed(2)});
console.log(JSON.stringify({scope:'OFFLINE_NATIVE_V7_MEMORY_STORE_NO_NETWORK_NO_BROKER',...counts,tf2Signals:50,tf15Signals:50,queueBatch100:stats(queueMs),serverToSimulatedConnector:stats(deliveryMs),round100IncludingAcks:stats(roundMs),totalSeconds:+((performance.now()-started)/1000).toFixed(2),actualBrokerEntries:'NOT_TESTED',simulatedAck:'REJECTED: BENCHMARK_NO_BROKER'},null,2));
assert.equal(counts.queued,counts.expected);assert.equal(counts.delivered,counts.expected);assert.equal(counts.duplicates,0);assert.equal(counts.invalidPayload,0);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
