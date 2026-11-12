const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../auto-trade-core');
const {MemoryAutoTradeStore}=require('../auto-trade-store');
const {createAutoTradeService}=require('../auto-trade-service');
const at=1790000000000,userId='11111111-1111-4111-8111-111111111111';
const cfg={version:'MANUAL_TF2_EXIT_V2',enabled:true,timeframeMinutes:2,tp1:2,tp2:4,tp3:6,sl:3,maxActiveLayers:10,limitAction:"WARN_ONLY"};
const settings={capitalUsd:100,lotPerLayer:.01,layers:1,symbols:['XAUUSD'],riskAcknowledged:true,manualExit:cfg};
async function setup(capability=true, clock=()=>at){
 const store=new MemoryAutoTradeStore(),service=createAutoTradeService({store,commandSigningKey:'test-signing-key-that-is-longer-than-thirty-two-bytes',allowDemoExecution:true,allowedDemoOwnershipModes:['TRADER_OWNED_EA_LOCAL'],now:clock});
 const {podToken}=await service.connectLocalEa(userId);
 await service.heartbeat(podToken,{accountMask:'****1234',serverMask:'****Demo',brokerMask:'****Stellar',tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.3.0-ea-local',manualExitVersion:capability==='step'?'MANUAL_STEPLOCK_V4':capability==='custom'?'MANUAL_TF2_EXIT_V3':capability?'MANUAL_TF2_EXIT_V2':null,manualExitCustomSupported:['custom','step'].includes(capability),positions:[]});
 return {store,service,podToken};
}
test('manual distances accept custom values and use defaults per blank field',()=>{
 assert.equal(Core.validateSettings({...settings,manualExit:undefined}).value.manualExit.enabled,false);
 for(const lot of [.01,.1,1]) {
  const result=Core.validateSettings({...settings,lotPerLayer:lot,manualExit:{enabled:true,tp1:'1.5',tp2:'',tp3:'  ',sl:'4'}});
  assert.equal(result.ok,true);assert.deepEqual(result.value.manualExit,{...cfg,version:'MANUAL_TF2_EXIT_V3',tp1:1.5,sl:4});
 }
 assert.deepEqual(Core.validateSettings({...settings,manualExit:{enabled:true,tp1:'',tp2:null,tp3:undefined,sl:' '}}).value.manualExit,cfg);
 for(const bad of [{tp1:0},{sl:-1},{sl:Infinity},{sl:'abc'},{sl:true},{tp1:4},{tp2:7},{tp3:4}])assert.equal(Core.validateSettings({...settings,manualExit:{...cfg,...bad}}).ok,false);
});
test('custom configuration requires both upgraded Connector and EA; legacy defaults still work',async()=>{
 const custom={...settings,manualExit:{...cfg,tp1:1.5,sl:4}};
 const old=await setup();await assert.rejects(old.service.saveSettings(userId,custom),e=>e.code==='MANUAL_EXIT_CUSTOM_UPGRADE_REQUIRED');
 const fresh=await setup('custom');const state=await fresh.service.saveSettings(userId,custom);
 assert.equal(state.settings.manualExit.sl,4);assert.equal(state.control.desiredState,'STOPPED');
 const {command}=await fresh.service.nextCommand(fresh.podToken);assert.deepEqual(command.payload.manualExit,{...cfg,version:'MANUAL_TF2_EXIT_V3',tp1:1.5,sl:4});
 const raw={accountMask:'****1234',serverMask:'****Demo',brokerMask:'****Broker',tradeMode:'DEMO',manualExitVersion:'MANUAL_TF2_EXIT_V3'};
 assert.equal(Core.normaliseHeartbeat(raw).value.manualExitVersion,null);
 assert.equal(Core.normaliseHeartbeat({...raw,manualExitCustomSupported:true}).value.manualExitVersion,'MANUAL_TF2_EXIT_V3');
});
test('custom queued settings are rejected after edit; OFF remains compatible after downgrade',async()=>{
 const {service,podToken,store}=await setup('custom');await service.saveSettings(userId,{...settings,manualExit:{...cfg,sl:4}});
 await service.saveSettings(userId,{...settings,manualExit:{...cfg,sl:5}});
 assert.equal((await service.nextCommand(podToken)).command,null);
 const {command}=await service.nextCommand(podToken);assert.equal(command.payload.manualExit.sl,5);
 await service.acknowledgeCommand(podToken,command.id,{status:'EXECUTED',code:'MANUAL_EXIT_ON'});
 const pod=await store.getPodForUser(userId);pod.manualExitVersion='MANUAL_TF2_EXIT_V2';
 await service.saveSettings(userId,{...settings,manualExit:{enabled:false,sl:5}});
 const off=(await service.nextCommand(podToken)).command;assert.equal(off.payload.manualExit.enabled,false);assert.equal(off.payload.manualExit.version,'MANUAL_TF2_EXIT_V2');
 assert.equal((await service.state(userId)).settings.manualExit.sl,5);
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

test('manual settings save separately without arming or changing entry presets',async()=>{
 const {service,store,podToken}=await setup('custom');await service.saveSettings(userId,settings);
 const before=await store.getProfile(userId);
 const state=await service.saveManualExit(userId,{enabled:true,tp1:1.5,tp2:2.5,tp3:3.5,sl:4});
 assert.equal(state.settings.manualExit.sl,4);assert.equal(state.control.desiredState,'STOPPED');
 assert.deepEqual(state.settings.modeSettings,before.modeSettings);
 assert.equal([...store.commands.values()].flat().some(c=>['SYSTEM_ON','PLACE_SETUP'].includes(c.type)),false);
 await assert.rejects(service.saveManualExit(userId,{enabled:true,tp1:5,tp2:2,tp3:3,sl:4}),e=>e.code==='VALIDATION_ERROR');
 assert.equal((await store.getProfile(userId)).manualExit.sl,4);
});
test('manual config remains deliverable after a disconnected minute, with latest-value validation',async()=>{
 let clock=at;const {service,podToken}=await setup('custom',()=>clock);
 await service.saveSettings(userId,settings);clock+=60000;
 const {command}=await service.nextCommand(podToken);
 assert.equal(command.type,'MANUAL_EXIT_CONFIG');assert.ok(command.expiresAt>clock);
});
test('OFF revokes queued manual closes and prevents further manual actions',async()=>{
 const {service,store,podToken}=await setup('custom');await service.saveSettings(userId,settings);
 const config=(await service.nextCommand(podToken)).command;
 await service.acknowledgeCommand(podToken,config.id,{status:'EXECUTED',code:'MANUAL_EXIT_ON'});
 await store.replacePositions(userId,[{ticket:'555',positionId:'666',origin:'MANUAL',symbol:'XAUUSD',side:'SELL',strategyMode:'TF2_SCALPING',volume:.02,entry:4000,openedAt:at-1000}],at);
 const market={symbol:'XAUUSD',timeframe:'2',receivedAt:at,signalObservedAt:at,strategyNormal:{side:'SELL'},positionManagement:{action:'CLOSE_50_NOW'}};
 await service.dispatchMarkets([market]);
 await service.saveManualExit(userId,{enabled:false});
 for(let i=0;i<3;i++){const c=(await service.nextCommand(podToken)).command;assert.notEqual(c?.type,'MANUAL_EXIT_ACTION');if(c)await service.acknowledgeCommand(podToken,c.id,{status:'EXECUTED',code:'MANUAL_EXIT_OFF'});}
 await service.dispatchMarkets([market]);
 const actions=[...store.commands.values()].flat().filter(c=>c.type==='MANUAL_EXIT_ACTION');
 assert.equal(actions.length,1);assert.equal(actions[0].status,'REJECTED');
});

test('manual step lock accepts custom presets but never dispatches Pine close instructions',async()=>{
 const {service,store,podToken}=await setup('step');
 const state=await service.saveSettings(userId,{...settings,manualExit:{...cfg,tp1:1.5,tp2:2.5,tp3:3.5,sl:4}});
 assert.equal(state.pod.manualExitVersion,'MANUAL_STEPLOCK_V4');assert.equal(state.settings.manualExit.sl,4);
 const config=(await service.nextCommand(podToken)).command;assert.equal(config.type,'MANUAL_EXIT_CONFIG');
 await service.acknowledgeCommand(podToken,config.id,{status:'EXECUTED',code:'MANUAL_EXIT_ON'});
 await store.replacePositions(userId,[{ticket:'555',positionId:'666',origin:'MANUAL',symbol:'XAUUSD',side:'SELL',strategyMode:'TF2_SCALPING',volume:.02,entry:4000,openedAt:at-1000}],at);
 for(const action of ['CLOSE_50_NOW','EXIT_REMAINING','EXIT_ALL','EXIT_SL'])await service.dispatchMarkets([{symbol:'XAUUSD',timeframe:'2',receivedAt:at,signalObservedAt:at,strategyNormal:{side:'SELL'},positionManagement:{action,oppositeYellow:true}}]);
 assert.equal([...store.commands.values()].flat().filter(c=>['MANUAL_EXIT_ACTION','MANAGE_POSITION','PLACE_SETUP'].includes(c.type)).length,0);
});
