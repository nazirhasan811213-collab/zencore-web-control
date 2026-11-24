'use strict';
const test=require('node:test'),a=require('node:assert/strict');
const D=require('../pine-direct-entry'),Core=require('../auto-trade-core');
function event(tf='1',side='BUY'){
 const sign=side==='BUY'?1:-1;
 return {hema20:4000+sign,hema40:4000,symbol:'XAUUSD',timeframe:tf,feedChannel:'EXECUTION',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',entryEvent:true,
 setupKey:`${tf}|test`,entryAuthorizedAt:1000,signalObservedAt:1000,receivedAt:1000,
 setupMeta:{entryPolicyVersion:'PINE_NATIVE_SOLID_ENTRY_V7',solidSide:side,completedAt:1000,cycleKind:'INITIAL'},
 normal3Entry:4000,initialSl:4000-sign*2,tp1:4000+sign*1.5,tp2:4000+sign*2.5,tp3:4000+sign*3.5};
}
for(const tf of ['1','15'])for(const side of ['BUY','SELL'])test(`Pine direct ${tf} ${side}: Pine retains signal qualification and ZenCore enforces the selected schedule`,()=>{
 const m=event(tf,side),s={capitalUsd:100,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:tf==='15'?'TF15_INTRA':'TF2_SCALPING',riskAcknowledgedAt:1,tradingSchedule:{enabled:true,skipNews:true}};
 const d=D.decision(m);a.ok(d);a.equal(d.snapshot.entry,m.normal3Entry);a.equal(d.snapshot.sl,m.initialSl);
 const openAt=Date.UTC(2026,10,11,0,30), endAt=Date.UTC(2026,10,11,3,30);
 const timed={...m,entryAuthorizedAt:openAt,signalObservedAt:openAt,receivedAt:openAt,
  setupMeta:{...m.setupMeta,completedAt:openAt}};
 a.equal(Core.buildSetupCommand(timed,s,null,openAt-1),null);
 a.equal(Core.buildSetupCommand(m,s,null,openAt),null,'previous-session signal cannot open on the next session');
 const c=Core.buildSetupCommand(timed,s,null,openAt);a.ok(c);a.equal(c.notAfterMs,endAt);
 a.equal(Core.buildSetupCommand(timed,s,null,endAt),null);
 a.equal(Core.buildSetupCommand(m,{...s,tradingSchedule:{enabled:false,skipNews:false}},null,endAt).notAfterMs,Infinity);
 a.equal(require('../entry-delivery-check').checkEntryDelivery({type:'PLACE_SETUP',payload:c.payload},null).ok,true);
 a.equal(D.decision({...m,feedChannel:'DASHBOARD'}),null);
 a.equal(D.decision({...m,entryEvent:false}),null);
 a.equal(D.decision({...m,initialSl:m.normal3Entry}),null);
 a.equal(D.decision({...m,tp2:m.tp1}),null);
 a.equal(D.decision({...m,entryAuthorizedAt:999}),null);
});

test('Low Risk preserves the chosen lot and layers and adds a cash exit policy to Pine Direct', () => {
 const m = event();
 const settings = {capitalUsd:500, lotPerLayer:.01, layers:8, symbols:['XAUUSD']};
 const normal = Core.buildSetupCommand(m, settings);
 const lowRisk = Core.buildSetupCommand(m, {...settings, entryExitStrategy:'LOW_RISK'});
 a.equal(normal.payload.analysisSnapshot.cashLayerPolicy, undefined);
 a.equal(lowRisk.payload.lotPerLayer, .01);
 a.equal(lowRisk.payload.layers, 8);
 a.equal(lowRisk.payload.totalLot, .08);
 a.equal(lowRisk.payload.risk.riskUsd, 16);
 a.equal(lowRisk.payload.analysisSnapshot.cashLayerPolicy, 'USD_TP050_SL200_V1');
 a.equal(Core.validateSettings({...settings, entryExitStrategy:'unsupported'}).ok, false);
});


test('Pine Direct Low Risk is gated at dispatch and when the Connector takes the queued command', async () => {
 const {MemoryAutoTradeStore}=require('../auto-trade-store');
 const {createAutoTradeService}=require('../auto-trade-service');
 const store=new MemoryAutoTradeStore(), userId='scheduled-trader';
 const sessionStart=Date.UTC(2026,10,11,0,30);
 let at=sessionStart-1000;
 const service=createAutoTradeService({store,allowLocalEaDemoExecution:true,
  commandSigningKey:'schedule-test-signing-key-longer-than-thirty-two',now:()=>at});
 const {podToken}=await service.connectLocalEa(userId);
 await service.heartbeat(podToken,{accountFingerprint:'a'.repeat(64),accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',
  tradeMode:'DEMO',terminalConnected:true,terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,
  demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',positions:[],directEntryPolicy:D.POLICY,cashLayerPolicy:'USD_TP050_SL200_V1'});
 const settings={capitalUsd:500,lotPerLayer:.01,layers:8,symbols:['XAUUSD'],riskAcknowledged:true,entryExitStrategy:'LOW_RISK'};
 const save=enabled=>service.saveSettings(userId,{...settings,tradingSchedule:Core.malaysiaTradingSchedule(enabled,false)});
 const signal=()=>{const m=event();return {...m,entryAuthorizedAt:at,signalObservedAt:at,receivedAt:at,setupMeta:{...m.setupMeta,completedAt:at}};};
 await save(true);
 await store.setControl(userId,{desiredState:'ON',effectiveState:'ON'});
 a.equal((await service.dispatchMarkets([signal()])).queued,0);
 await store.saveSettings(userId,{tradingSchedule:Core.malaysiaTradingSchedule(false,false)});
 at++;
 a.equal((await service.dispatchMarkets([signal()])).queued,1);
 // Simulate a settings change racing a command that is already queued.
 await store.saveSettings(userId,{tradingSchedule:Core.malaysiaTradingSchedule(true,false)});
 a.equal((await service.nextCommand(podToken)).command,null,'new schedule applies even to an already queued setup');
 at=sessionStart;
 a.equal((await service.dispatchMarkets([signal()])).queued,1);
 const {command}=await service.nextCommand(podToken);
 a.equal(command.expiresAt,sessionStart+3*60*60*1000);
 a.equal(command.payload.layers,8);
 at=command.expiresAt;
 a.equal((await service.nextCommand(podToken)).command,null,'expired setup cannot replay in a later session');
});
