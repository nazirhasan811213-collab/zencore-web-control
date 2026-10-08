const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../auto-trade-core');
const {MemoryAutoTradeStore}=require('../auto-trade-store');
const {createAutoTradeService}=require('../auto-trade-service');
const at=1790000000000,userId='11111111-1111-4111-8111-111111111111';
const cfg={version:'MANUAL_TF2_EXIT_V2',enabled:true,timeframeMinutes:2,tp1:2,tp2:4,tp3:6,sl:3,maxActiveLayers:10,limitAction:"WARN_ONLY"};
const settings={capitalUsd:100,lotPerLayer:.01,layers:1,symbols:['XAUUSD'],riskAcknowledged:true,manualExit:cfg};
async function setup(capability=true){
 const store=new MemoryAutoTradeStore(),service=createAutoTradeService({store,commandSigningKey:'test-signing-key-that-is-longer-than-thirty-two-bytes',allowDemoExecution:true,allowedDemoOwnershipModes:['TRADER_OWNED_EA_LOCAL'],now:()=>at});
 const {podToken}=await service.connectLocalEa(userId);
 await service.heartbeat(podToken,{accountMask:'****1234',serverMask:'****Demo',brokerMask:'****Stellar',tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.3.0-ea-local',manualExitVersion:capability?'MANUAL_TF2_EXIT_V2':null,positions:[]});
 return {store,service,podToken};
}
test('manual policy pins requested distances and warning-only ten layers, independent of lot',()=>{
 assert.equal(Core.validateSettings({...settings,manualExit:undefined}).value.manualExit.enabled,false);
 for(const lot of [.01,.1,1]){
  const value=Core.validateSettings({...settings,lotPerLayer:lot,manualExit:{enabled:true,tp1:99,sl:100}}).value.manualExit;
  assert.deepEqual(value,{version:'MANUAL_TF2_EXIT_V2',enabled:true,timeframeMinutes:2,tp1:2,tp2:4,tp3:6,sl:3,maxActiveLayers:10,limitAction:'WARN_ONLY'});
 }
});
test('saving manual exit while entry STOPPED issues only a signed exit config, never ON or entry',async()=>{
 const {store,service,podToken}=await setup();
 const state=await service.saveSettings(userId,settings);
 assert.equal(state.settings.manualExit.tp1,2);assert.equal(state.control.desiredState,'STOPPED');
 const {command}=await service.nextCommand(podToken);
 assert.equal(command.type,'MANUAL_EXIT_CONFIG');assert.equal(command.payload.manualExit.enabled,true);
 assert.ok(command.signature);assert.ok(command.signedEnvelope);
 assert.equal([...store.commands.values()].flat().some(c=>c.type==='SYSTEM_ON'||c.type==='PLACE_SETUP'),false);
});
test('old EA cannot opt into manual takeover',async()=>{
 const {service}=await setup(false);
 await assert.rejects(service.saveSettings(userId,settings),e=>e.code==='MANUAL_EXIT_EA_UPGRADE_REQUIRED');
});
test('manual control acknowledgement cannot enable automatic entry',async()=>{
 const {service,podToken}=await setup();await service.saveSettings(userId,settings);
 const {command}=await service.nextCommand(podToken);
 await service.acknowledgeCommand(podToken,command.id,{status:'EXECUTED',code:'MANUAL_EXIT_ON'});
 assert.equal((await service.state(userId)).control.desiredState,'STOPPED');
});
test('manual telemetry survives normalization and storage without account credentials',async()=>{
 const {store}=await setup();
 const raw={ticket:'555',positionId:'666',origin:'MANUAL',strategyMode:'TF2_SCALPING',symbol:'XAUUSD',side:'SELL',volume:.02,entry:4000,activeSl:4001,openedAt:at};
 const clean=Core.sanitisePosition(raw);assert.equal(clean.origin,'MANUAL');
 await store.replacePositions(userId,[clean],at);assert.equal((await store.listPositions(userId))[0].positionId,'666');
});
test('TF2 manual exit acts on exact matching manual ticket; TF15, wrong side and stale data cannot act',async()=>{
 const {service,store}=await setup();await service.saveSettings(userId,settings);
 await store.replacePositions(userId,[{ticket:'555',positionId:'666',origin:'MANUAL',symbol:'XAUUSD',side:'SELL',strategyMode:'TF2_SCALPING',volume:.02,entry:4000,openedAt:at-1000}],at);
 const market={symbol:'XAUUSD',timeframe:'2',receivedAt:at,signalObservedAt:at,strategyNormal:{side:'SELL'},positionManagement:{action:'CLOSE_50_NOW'}};
 for(const m of [{...market,timeframe:'15'},{...market,strategyNormal:{side:'BUY'}},{...market,receivedAt:at-31000,signalObservedAt:at-31000}])await service.dispatchMarkets([m]);
 assert.equal([...store.commands.values()].flat().filter(c=>c.type==='MANUAL_EXIT_ACTION').length,0);
 await service.dispatchMarkets([market]);
 const commands=[...store.commands.values()].flat().filter(c=>c.type==='MANUAL_EXIT_ACTION');assert.equal(commands.length,1);
 assert.equal(commands[0].payload.ticket,'555');assert.equal(commands[0].payload.positionId,'666');assert.equal(commands[0].payload.side,'SELL');
 assert.ok(commands[0].expiresAt<=at+15000);
 assert.equal([...store.commands.values()].flat().some(c=>c.type==='MANAGE_POSITION'),false);
});
test('chart SL/TP exit is not copied onto a manual entry with its own smaller targets',async()=>{
 const {service,store}=await setup();await service.saveSettings(userId,settings);
 await store.replacePositions(userId,[{ticket:'555',positionId:'666',origin:'MANUAL',symbol:'XAUUSD',side:'SELL',volume:.02,openedAt:at-1000}],at);
 await service.dispatchMarkets([{symbol:'XAUUSD',timeframe:'2',receivedAt:at,signalObservedAt:at,strategyNormal:{side:'SELL'},positionManagement:{action:'EXIT_SL',slMoveTriggered:true,slMoveAction:'MOVE_SL_TP1',activeSl:5000}}]);
 assert.equal([...store.commands.values()].flat().filter(c=>['MANUAL_EXIT_ACTION','MANAGE_POSITION'].includes(c.type)).length,0);
});
test('queued manual ON config is revoked after user saves OFF',async()=>{
 const {service,podToken,store}=await setup();await service.saveSettings(userId,settings);
 await service.saveSettings(userId,{...settings,manualExit:{enabled:false}});
 assert.equal((await service.nextCommand(podToken)).command,null);
 const revoked=[...store.commands.values()].flat().find(c=>c.payload.manualExit.enabled===true);
 assert.equal(revoked.status,'REJECTED');
 const {command}=await service.nextCommand(podToken);assert.equal(command.payload.manualExit.enabled,false);
});
