const {readyMarket}=require('./fixtures/current-market');
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryAutoTradeStore } = require('../auto-trade-store');
const { createAutoTradeService } = require('../auto-trade-service');
const crypto = require('node:crypto');
const userId='11111111-1111-4111-8111-111111111111';
function setup(allowDemoExecution=true) {
  let clock=1791000000000;
  const store=new MemoryAutoTradeStore();
  const service=createAutoTradeService({store,commandSigningKey:'test-signing-key-more-than-32-characters',
    allowDemoExecution,allowedDemoSymbols:['XAUUSD','EURUSD'],now:()=>clock});
  return {store,service,advance:ms=>clock+=ms};
}
const hb={accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',tradeMode:'DEMO',
  terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,
  connectorVersion:'1.3.0-ea-local',positions:[],symbolSpecs:[]};
const settings={capitalUsd:100,lotPerLayer:0.01,layers:3,symbols:['XAUUSD'],riskAcknowledged:true};
test('login pairing returns automatic machine credentials and web can arm approved EA transport',async()=>{
 const {store,service}=setup();const connected=await service.connectLocalEa(userId);
 assert.match(connected.podToken,/^zcpod_/);assert.equal(connected.connectorVersion,'1.0.0-ea-local');
 const key=crypto.createHmac('sha256','test-signing-key-more-than-32-characters')
   .update('zencore-pod-command-v1:'+connected.podId).digest('base64url');
 assert.equal(connected.commandSigningKey,key);
 await service.heartbeat(connected.podToken,hb);await service.saveSettings(userId,settings);
 const state=await service.turnOn(userId,{confirmation:'AKTIFKAN DEMO'});
 assert.equal(state.connection.ready,true);assert.equal(state.control.effectiveState,'ARMING');
 const {command}=await service.nextCommand(connected.podToken);
 assert.equal(command.type,'SYSTEM_ON');assert.deepEqual(command.payload.settings.symbols,['XAUUSD']);
 const signature=crypto.createHmac('sha256',key).update(Buffer.from(command.signedEnvelope,'base64url')).digest('hex');
 assert.equal(command.signature,signature);
 await service.acknowledgeCommand(connected.podToken,command.id,{status:'EXECUTED',code:'ARMED'});
 assert.equal((await service.state(userId)).control.canEnter,true);
 await service.saveSettings(userId,{...settings,lotPerLayer:0.02,symbols:['XAUUSD']});
 const updated=await service.nextCommand(connected.podToken);
 assert.equal(updated.command.type,'SYSTEM_ON');assert.equal(updated.command.payload.settings.lotPerLayer,0.02);
 assert.deepEqual(updated.command.payload.settings.symbols,['XAUUSD']);
});
test('EA transport refuses REAL heartbeat and unapproved pair',async()=>{
 const {service}=setup();const c=await service.connectLocalEa(userId);
 await assert.rejects(service.heartbeat(c.podToken,{...hb,connectorVersion:'1.0.0-ea-local',tradeMode:'REAL'}),e=>e.code==='REAL_EA_UPGRADE_REQUIRED');
 await assert.rejects(service.saveSettings(userId,{...settings,symbols:['BTCUSD']}),e=>e.code==='DEMO_SYMBOL_NOT_VALIDATED');
});
test('pairing refuses active old engine, open positions and running control',async()=>{
 const {store,service}=setup();const c=await service.connectLocalEa(userId);await service.heartbeat(c.podToken,hb);
 await assert.rejects(service.connectLocalEa(userId),e=>e.code==='OLD_CONNECTOR_ACTIVE');
 await store.setControl(userId,{desiredState:'ON',effectiveState:'ON'});
 await assert.rejects(service.connectLocalEa(userId),e=>e.code==='STOP_BEFORE_PAIRING');
});
test('local EA heartbeat routes around stale hosted account without touching other clients',async()=>{
 const {store,service}=setup();
 const rawGet=store.getHostedAccount.bind(store);
 store.getHostedAccount=async id=>id===userId?{id:'old',userId,lastSeenAt:0,status:'ERROR'}:rawGet(id);
 const c=await service.connectLocalEa(userId);await service.heartbeat(c.podToken,hb);
 const state=await service.state(userId);
 assert.equal(state.hostedAccount,null);assert.equal(state.pod.ownershipMode,'TRADER_OWNED_EA_LOCAL');
 assert.equal(state.connection.ready,true);
 assert.equal((await service.state('22222222-2222-4222-8222-222222222222')).pod,null);
});
test('server rollout lock cannot be bypassed by automatic connector pairing',async()=>{
 const {service}=setup(false);const c=await service.connectLocalEa(userId);await service.heartbeat(c.podToken,hb);
 await service.saveSettings(userId,settings);
 await assert.rejects(service.turnOn(userId,{confirmation:'AKTIFKAN DEMO'}),e=>e.code==='EXECUTION_ROLLOUT_LOCKED');
});
test('Analysis entry, deduplication, OFF and Analysis close use the same local command stream',async()=>{
 const {store,service}=setup();const c=await service.connectLocalEa(userId);
 await service.heartbeat(c.podToken,hb);await service.saveSettings(userId,settings);
 await service.turnOn(userId,{confirmation:'AKTIFKAN DEMO'});
 let command=(await service.nextCommand(c.podToken)).command;
 await service.acknowledgeCommand(c.podToken,command.id,{status:'EXECUTED'});
 const market={symbol:'XAUUSD',receivedAt:1791000000000,predictionConfidence:85,stability:80,
   confluence:4,setupProbability:75,sidewaysGuard:false,strategyNormal:{state:'READY',side:'BUY',
     sop:{forecast:'BULLISH',marketPower:80,sopGreen:5,gates:[{pass:true},{pass:true}]},
     plan:{entry:2500,sl:2490,tp1:2505,tp2:2510,tp3:2520}}};
 Object.assign(market,readyMarket({at:market.receivedAt,plan:market.strategyNormal.plan}));
 assert.equal((await service.dispatchMarkets([market])).queued,1);
 assert.equal((await service.dispatchMarkets([market])).queued,0);
 command=(await service.nextCommand(c.podToken)).command;
 assert.equal(command.type,'PLACE_SETUP');assert.equal(command.payload.lotPerLayer,0.01);
 assert.equal(command.payload.layers,3);assert.equal(command.payload.analysisSnapshot.decisionOwner,'ZENCORE_ANALYSIS');
 await service.acknowledgeCommand(c.podToken,command.id,{status:'EXECUTED',brokerOrderId:'1234'});
 await service.heartbeat(c.podToken,{...hb,positions:[{ticket:'1234',symbol:'XAUUSD',side:'BUY',volume:0.03,entry:2500,activeSl:2490}]});
 await service.stop(userId);command=(await service.nextCommand(c.podToken)).command;
 assert.equal(command.type,'SYSTEM_STOP');await service.acknowledgeCommand(c.podToken,command.id,{status:'EXECUTED'});
 const managed={...market,receivedAt:1791000000001,positionManagement:{action:'CLOSE_50_NOW',slMoveTriggered:true,slMoveAction:'MOVE_SL_ENTRY',activeSl:2500}};
 assert.equal((await service.dispatchMarkets([managed])).queued,1);
 command=(await service.nextCommand(c.podToken)).command;
 assert.equal(command.type,'MANAGE_POSITION');
 assert.deepEqual(command.payload.actions.map(a=>a.type),['MOVE_SL_ENTRY','CLOSE_PERCENT']);
 assert.equal(command.payload.actions[1].percent,50);
});
test('replaced hosted transport cannot poll or ACK to change this user control',async()=>{
 const {store,service}=setup();await service.connectLocalEa(userId);
 store.validateHostedLease=async()=>userId;
 const ids={accountId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',leaseId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
 await assert.rejects(service.nextHostedCommand({},ids),e=>e.code==='TRANSPORT_REPLACED');
 await assert.rejects(service.acknowledgeHostedCommand({},'cccccccc-cccc-4ccc-8ccc-cccccccccccc',{...ids,status:'EXECUTED'}),e=>e.code==='TRANSPORT_REPLACED');
 assert.equal((await service.state(userId)).control.desiredState,'STOPPED');
});

test('universal connector supports real accounts and binds signed commands to the full hashed identity',async()=>{
 const {service}=setup(); const c=await service.connectLocalEa(userId);
 const binding={...hb,tradeMode:'REAL',connectorVersion:'1.4.0-ea-local',accountFingerprint:'a'.repeat(64)};
 await service.heartbeat(c.podToken,binding); await service.saveSettings(userId,settings);
 assert.equal((await service.state(userId)).connection.ready,true);
 await service.turnOn(userId,{confirmation:'AKTIFKAN REAL'});
 const {command}=await service.nextCommand(c.podToken);
 assert.equal(command.payload.accountFingerprint,binding.accountFingerprint);
 const signed=JSON.parse(Buffer.from(command.signedEnvelope,'base64url'));
 assert.equal(signed.payload.accountFingerprint,binding.accountFingerprint);
});

test('same-mask account switch and protocol downgrade cannot replace bound positions',async()=>{
 const {store,service}=setup();const c=await service.connectLocalEa(userId);
 const binding={...hb,connectorVersion:'1.4.0-ea-local',accountFingerprint:'a'.repeat(64)};
 await service.heartbeat(c.podToken,{...binding,positions:[{ticket:'789',symbol:'XAUUSD',side:'BUY',volume:.01,entry:2500}]});
 await assert.rejects(service.heartbeat(c.podToken,{...binding,accountFingerprint:'b'.repeat(64)}),e=>e.code==='ACCOUNT_BINDING_CHANGED');
 await assert.rejects(service.heartbeat(c.podToken,hb),e=>e.code==='ACCOUNT_BINDING_CHANGED');
 assert.equal((await store.listPositions(userId))[0].ticket,'789');
});

test('re-pair after OFF rotates token, clears old account binding and retires queued commands',async()=>{
 const {store,service,advance}=setup();const c=await service.connectLocalEa(userId);
 await service.heartbeat(c.podToken,{...hb,connectorVersion:'1.4.0-ea-local',accountFingerprint:'a'.repeat(64)});
 await service.saveSettings(userId,settings);
 await store.setControl(userId,{desiredState:'STOPPED',effectiveState:'STOPPED'});
 advance(120001);
 const newer=await service.connectLocalEa(userId);
 assert.notEqual(newer.podToken,c.podToken);
 await assert.rejects(service.nextCommand(c.podToken),e=>e.code==='INVALID_POD_TOKEN');
 await service.heartbeat(newer.podToken,{...hb,tradeMode:'REAL',connectorVersion:'1.4.0-ea-local',accountFingerprint:'b'.repeat(64)});
 assert.equal((await service.state(userId)).control.desiredState,'STOPPED');
 assert.equal((await service.nextCommand(newer.podToken)).command,null);
});

test('different ZenCore users cannot poll or acknowledge each other commands',async()=>{
 const {service}=setup();const c1=await service.connectLocalEa(userId);
 const u2='22222222-2222-4222-8222-222222222222';const c2=await service.connectLocalEa(u2);
 await service.heartbeat(c1.podToken,hb);await service.saveSettings(userId,settings);
 await service.turnOn(userId,{confirmation:'AKTIFKAN DEMO'});
 const {command}=await service.nextCommand(c1.podToken);
 assert.equal((await service.nextCommand(c2.podToken)).command,null);
 await assert.rejects(service.acknowledgeCommand(c2.podToken,command.id,{status:'EXECUTED'}),e=>e.code==='COMMAND_NOT_FOUND');
});

test('web reset revokes only own link, preserves settings and drains old lease before pairing',async()=>{
 const {store,service,advance}=setup();const old=await service.connectLocalEa(userId);
 await service.saveSettings(userId,settings);
 const other='22222222-2222-4222-8222-222222222222';const otherLink=await service.connectLocalEa(other);
 const before=(await service.state(userId)).settings;
 const reset=await service.resetLocalEaLink(userId);assert.equal(reset.code,'RESET');
 assert.equal(await service.authenticatePod(old.podToken),null);
 await assert.rejects(service.heartbeat(old.podToken,hb),e=>e.code==='INVALID_POD_TOKEN');
 await assert.rejects(service.nextCommand(old.podToken),e=>e.code==='INVALID_POD_TOKEN');
 assert.ok(await service.authenticatePod(otherLink.podToken));
 assert.equal((await service.state(userId)).pod,null);
 assert.deepEqual((await service.state(userId)).settings,before);
 await assert.rejects(service.connectLocalEa(userId),e=>e.code==='LINK_RESET_WAIT');
 advance(30000);const fresh=await service.connectLocalEa(userId);
 assert.notEqual(fresh.podToken,old.podToken);
 assert.equal((await service.state(userId)).control.desiredState,'STOPPED');
 assert.equal((await service.state(userId)).control.canEnter,false);
});
test('reset refuses running control and open positions without invalidating account',async()=>{
 const {store,service}=setup();const old=await service.connectLocalEa(userId);
 await store.setControl(userId,{desiredState:'ON',effectiveState:'ON'});
 await assert.rejects(service.resetLocalEaLink(userId),e=>e.code==='STOP_BEFORE_RESET');
 assert.ok(await service.authenticatePod(old.podToken));
 await store.setControl(userId,{desiredState:'STOPPED',effectiveState:'STOPPED'});
 await store.replacePositions(userId,[{ticket:'123',symbol:'XAUUSD',side:'BUY',volume:0.01}],Date.now());
 await assert.rejects(service.resetLocalEaLink(userId),e=>e.code==='POSITIONS_OPEN');
 assert.ok(await service.authenticatePod(old.podToken));
});
