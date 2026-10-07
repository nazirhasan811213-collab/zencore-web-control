const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../auto-trade-core');
const {MemoryAutoTradeStore}=require('../auto-trade-store');
const {createAutoTradeService}=require('../auto-trade-service');
const schedule=Core.malaysiaTradingSchedule(true);
const my=(hours,minutes=0,seconds=0)=>Date.UTC(2026,9,5,hours-8,minutes,seconds);

test('Malaysia overnight session has exact start/end and all news boundaries',()=>{
 for(const [h,m,s,allowed] of [[6,59,59,false],[7,0,0,true],[0,0,0,true],[2,59,59,true],[3,0,0,false],
  [20,29,59,true],[20,30,0,false],[20,59,59,false],[21,0,0,true],[21,29,59,true],[21,30,0,false],
  [21,59,59,false],[22,0,0,false],[22,29,59,false],[22,30,0,true],
  [1,59,59,true],[2,0,0,false],[2,29,59,false],[2,30,0,true]])
  assert.equal(Core.tradingWindow(schedule,my(h,m,s)).allowed,allowed,`${h}:${m}:${s}`);
 assert.equal(Core.tradingWindow(schedule,my(20,30)).reason,'NEWS_PAUSE');
 assert.equal(Core.tradingWindow(schedule,my(4)).reason,'OUTSIDE_SESSION');
 assert.equal(Core.tradingWindow(schedule,NaN).allowed,false);
});
test('queued setup deadline ends precisely at news/session boundary, including midnight',()=>{
 assert.equal(Core.tradingWindow(schedule,my(20,29,58)).validUntil,my(20,30));
 assert.equal(Core.tradingWindow(schedule,my(23)).validUntil,my(24+2));
 assert.equal(Core.tradingWindow(schedule,my(2,59,59)).validUntil,my(3));
 assert.equal(Core.tradingWindow({enabled:false},my(4)).allowed,true);
});
async function harness(at,positions=[]) {
 const store=new MemoryAutoTradeStore(),userId='test-owner';
 const service=createAutoTradeService({store,allowDemoExecution:true,requiredDemoConnectorVersion:'1.4.0-demo-execution',
  allowedDemoOwnershipModes:['INTERNAL_DEMO'],commandSigningKey:'test-long-key-over-thirty-two-characters',now:()=>at});
 store.podsByUser.set(userId,{id:'test-pod',userId,ownershipMode:'TRADER_OWNED_EA_LOCAL',tradeMode:'DEMO',
  demoExecutionUnlocked:true,terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,
  connectorVersion:'1.1.0-ea-local',lastSeenAt:at,symbolSpecs:{}});
 await service.saveSettings(userId,{capitalUsd:100,lotPerLayer:.01,layers:3,symbols:['XAUUSD'],riskAcknowledged:true,tradingSchedule:schedule});
 await store.setControl(userId,{desiredState:'ON',effectiveState:'ON'});store.positions.set(userId,positions);
 const market={symbol:'XAUUSD',timeframe:'2',receivedAt:at,strategyNormal:{state:'READY',tf:'2m',solid:true,side:'BUY',
  entrySopVersion:'SOLID_TF2_3GREEN_HEMA23_V2',sop:{gates:Array.from({length:6},()=>({pass:true}))},
  plan:{entry:100,sl:99,tp1:101,tp2:102,tp3:103}}};
 return {store,service,market,userId};
}
test('dispatcher rejects news entries but continues position management',async()=>{
 const {store,service,market}=await harness(my(20,30),[{symbol:'XAUUSD',ticket:'1',side:'BUY'}]);
 market.positionManagement={action:'EXIT_ALL',reason:'TEST_CLOSE'};
 assert.deepEqual(await service.dispatchMarkets([market]),{queued:1});
 assert.deepEqual([...store.commands.values()].flat().map(c=>c.type),['MANAGE_POSITION']);
});
test('dispatcher expires signed entry before pause even when ordinary TTL is 15 seconds',async()=>{
 const at=my(20,29,58),{store,service,market}=await harness(at);
 assert.deepEqual(await service.dispatchMarkets([market]),{queued:1});
 const command=[...store.commands.values()].flat()[0];assert.equal(command.type,'PLACE_SETUP');
 assert.equal(command.expiresAt,my(20,30));assert.equal(JSON.parse(Buffer.from(command.signedEnvelope,'base64url')).expiresAt,my(20,30));
});
test('per-account setting persists; old client updates retain enabled schedule',async()=>{
 const {store,service,userId}=await harness(my(10));
 await service.saveSettings(userId,{capitalUsd:200,lotPerLayer:.01,layers:3,symbols:['XAUUSD'],riskAcknowledged:true});
 assert.deepEqual((await store.getProfile(userId)).tradingSchedule,schedule);
 assert.equal((await service.state(userId)).control.tradingWindow.allowed,true);
});

test('new TF2 policy blocks old executor entries but keeps management available',async()=>{
 const {store,service,market,userId}=await harness(my(10));
 store.podsByUser.get(userId).connectorVersion='1.0.0-ea-local';
 const state=await service.state(userId);assert.equal(state.control.exitPolicyReady,false);assert.equal(state.control.canEnter,false);
 assert.deepEqual(await service.dispatchMarkets([market]),{queued:0});
 await assert.rejects(service.turnOn(userId,{confirmation:'AKTIFKAN DEMO'}),e=>e.code==='TF2_EA_UPGRADE_REQUIRED');
});

test('news choice is independent of overnight session and survives validation',()=>{
 const trade=Core.malaysiaTradingSchedule(true,false);
 assert.equal(Core.tradingWindow(trade,my(20,30)).allowed,true);
 assert.equal(Core.tradingWindow(trade,my(4)).allowed,false);
 assert.equal(Core.tradingWindow(trade,my(20,29,58)).validUntil,my(24+3));
 const skip=Core.malaysiaTradingSchedule(false,true);
 assert.equal(Core.tradingWindow(skip,my(4)).allowed,true);
 assert.equal(Core.tradingWindow(skip,my(20,30)).allowed,false);
 assert.equal(Core.tradingWindow(skip,my(20,29,58)).validUntil,my(20,30));
 const settings={capitalUsd:100,lotPerLayer:.01,layers:1,symbols:['XAUUSD'],tradingSchedule:trade};
 assert.equal(Core.validateSettings(settings).value.tradingSchedule.skipNews,false);
 settings.tradingSchedule=skip;
 assert.equal(Core.validateSettings(settings).value.tradingSchedule.skipNews,true);
});
