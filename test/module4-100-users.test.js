'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const prefix=fs.readFileSync(__dirname+'/pine-position-plan.test.js','utf8').split("\nfor(const tf of ['3','15'])")[0];
const {fixture}=new Function('require',prefix+';return {fixture};')(require);
const {MemoryAutoTradeStore}=require('../auto-trade-store');
const {createAutoTradeService,tokenHash}=require('../auto-trade-service');
const {createEntryCycleReset}=require('../entry-cycle-reset');
const Core=require('../auto-trade-core');
test('100 users preserve isolated step locks, close-all instructions and broker-flat gates',async()=>{
 const now=1792370000000,store=new MemoryAutoTradeStore(),users=[];
 for(let i=0;i<100;i++){
  const tf=i%2?'15':'2',side=i%4<2?'BUY':'SELL',f=fixture(tf,side,'INITIAL');
  const id=crypto.randomUUID(),podId=crypto.randomUUID(),token='zcpod_'+crypto.randomBytes(36).toString('base64url'),hash=tokenHash(token);
  Object.assign(f.command,{id:crypto.randomUUID(),userId:id,podId});
  f.command.payload.analysisSnapshot.exitLockVersion=tf==='15'?'PINE_STEPLOCK_BE_TF15_V1':'PINE_STEPLOCK_150_TP3_PLUS3_V1';
  f.position.setupId=f.command.id.slice(0,20);
  const positions=[{...f.position,ticket:String(i*2+1)},{...f.position,ticket:String(i*2+2)}];
  const pod={id:podId,userId:id,tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:now,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};
  store.podsByUser.set(id,pod);store.podsByToken.set(hash,pod);store.commands.set(podId,[f.command]);store.positions.set(id,positions);
  users.push({...f,id,podId,token,tf,positions});
 }
 const svc=createAutoTradeService({store,now:()=>now,localEaExecutionUserIds:users.map(u=>u.id),commandSigningKey:'module-four-offline-only-key-longer-than-32-bytes'});
 for(const u of users){await svc.saveSettings(u.id,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:u.tf==='15'?'TF15_INTRA':'TF2_SCALPING',riskAcknowledged:true});}
 const queueTimes=[],start=performance.now();let delivered=0,missing=0,duplicates=0;const ids=new Set();
 async function phase(index,close=false){
  for(const u of users){const p=u.command.payload;for(const position of u.positions)position.currentPrice=index===3?p.tp3+u.sign*3.01:p['tp'+(index+1)];}
  const markets=['2','15'].map(tf=>({...users.find(u=>u.tf===tf).market,...(close?{nativeChartExitAll:true}:{}),timeframe:tf}));
  const t=performance.now(),result=await svc.dispatchMarkets(markets);queueTimes.push(performance.now()-t);
  const expected=index===3&&!close?50:100;assert.equal(result.queued,expected);
  for(const u of users){
   const {command}=await svc.nextCommand(u.token);
   if(index===3&&!close&&u.tf==='15'){assert.equal(command,null);continue;}
   if(!command){missing++;continue;}
   delivered++;if(ids.has(command.id))duplicates++;ids.add(command.id);
   assert.equal(command.type,'MANAGE_POSITION');assert.equal(command.payload.strategyMode,u.mode);
   assert.equal(command.payload.analysisSnapshot.entryCommandId,u.command.id);
   const action=command.payload.actions[0];
   if(close){assert.equal(action.type,'CLOSE_PERCENT');assert.equal(action.percent,100);}
   else{
    const p=u.command.payload,target=index===0?(u.tf==='15'?p.entry:p.entry+u.sign*1.5):index===1?p.tp1:index===2?p.tp2:p.tp3;
    assert.equal(action.activeSl,target);for(const position of u.positions)position.activeSl=target;
   }
   // ACK simulation only: no real broker or position changes inferred from ACK.
   await svc.acknowledgeCommand(u.token,command.id,{status:'EXECUTED',code:close?'CLOSED_ALL':'SL_MOVED'});
  }
  assert.equal((await svc.dispatchMarkets(markets)).queued,0,'repeat must not duplicate an action');
 }
 for(let i=0;i<4;i++)await phase(i);
 await phase(3,true);
 const gate=createEntryCycleReset(store);
 for(const u of users){
  const market={symbol:'XAUUSD',timeframe:u.tf,strategyNormal:{side:u.position.side}};
  assert.equal(Core.permitsPositionEntry(market,u.positions),false,'close ACK is not proof of flat');
  await gate.observe(u.id,u.podId,u.positions,[u.positions[0]],now+1000);
  store.positions.set(u.id,[u.positions[0]]);
  assert.equal(await store.lastStrategyCycleReset(u.id,u.podId,u.mode),null);
  assert.equal(Core.permitsPositionEntry(market,[u.positions[0]]),false,'remaining layer blocks entry');
  await gate.observe(u.id,u.podId,[u.positions[0]],[],now+2000);store.positions.set(u.id,[]);
  const reset=await store.lastStrategyCycleReset(u.id,u.podId,u.mode);assert.equal(reset.closedAt,now+2000);
  assert.equal(Core.permitsPositionEntry(market,[]),true,'flat removes position block only, not remaining SOP');
 }
 const sorted=[...queueTimes].sort((a,b)=>a-b);
 console.log(JSON.stringify({scope:'OFFLINE_MEMORY_STORE_NO_EA_OR_BROKER',users:100,tf2:50,tf15:50,expectedManagementCommands:450,delivered,missing,duplicates,partialCloseBlocked:100,flatTransitionsRecorded:100,queueBatchMedianMs:+sorted[Math.floor(sorted.length/2)].toFixed(2),queueBatchMaxMs:+Math.max(...queueTimes).toFixed(2),totalMs:+(performance.now()-start).toFixed(2)}));
 assert.equal(delivered,450);assert.equal(missing,0);assert.equal(duplicates,0);
 for(const u of users){
  for(const position of u.positions){position.activeSl=u.command.payload.sl;position.currentPrice=u.command.payload.tp1;}
  store.positions.set(u.id,u.positions);store.commands.set(u.podId,[u.command]);
 }
 const getPod=store.getPodForUser.bind(store),visited=new Set();
 store.getPodForUser=async id=>{visited.add(id);if(id===users[0].id)throw new Error('simulated one-account failure');return getPod(id);};
 await assert.rejects(()=>svc.dispatchMarkets(['2','15'].map(tf=>users.find(u=>u.tf===tf).market)));
 assert.equal(visited.size,100,'one failed management profile must not skip all other users');
 assert.equal([...store.commands.values()].flat().filter(c=>c.type==='MANAGE_POSITION'&&c.status==='PENDING').length,99,'healthy accounts still receive protection commands');
});

test('100 manual-exit configurations stay user-scoped and never turn entry ON',async()=>{
 const store=new MemoryAutoTradeStore(),now=1792370000000;
 const svc=createAutoTradeService({store,now:()=>now,commandSigningKey:'offline-manual-exit-test-key-longer-than-32-bytes'});
 for(let i=0;i<100;i++){
  const user=crypto.randomUUID(),{podToken}=await svc.connectLocalEa(user);
  await svc.heartbeat(podToken,{accountMask:'****'+String(i).padStart(4,'0'),serverMask:'****Demo',brokerMask:'****Broker',tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',accountFingerprint:crypto.createHash('sha256').update(user).digest('hex'),manualExitVersion:'MANUAL_TF2_EXIT_V3',manualExitCustomSupported:true,positions:[]});
  const settings={capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],riskAcknowledged:true,manualExit:{enabled:true,tp1:1.5,tp2:4,tp3:6,sl:4+i%3}};
  const state=await svc.saveSettings(user,settings);assert.equal(state.control.desiredState,'STOPPED');
  let {command}=await svc.nextCommand(podToken);assert.equal(command.type,'MANUAL_EXIT_CONFIG');assert.equal(command.payload.manualExit.sl,4+i%3);
  await svc.acknowledgeCommand(podToken,command.id,{status:'EXECUTED',code:'MANUAL_EXIT_ON'});
  await svc.saveSettings(user,{...settings,manualExit:{...settings.manualExit,enabled:false}});
  ({command}=await svc.nextCommand(podToken));assert.equal(command.type,'MANUAL_EXIT_CONFIG');assert.equal(command.payload.manualExit.enabled,false);
 }
 assert.equal([...store.commands.values()].flat().length,200);
 assert.equal([...store.commands.values()].flat().some(c=>['SYSTEM_ON','PLACE_SETUP'].includes(c.type)),false);
});
