const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../auto-trade-core'),Contract=require('../analysis-execution-contract'),Hub=require('../strategy-market-hub');
const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService}=require('../auto-trade-service');
const {telegramMessage,entrySopAllowed,entryFresh}=require('../analysis-telegram');
const {AnalysisAlerts}=require('../analysis-alert-service');
const now=Date.now(),opened=now-now%900000;
function batch(symbol='XAUUSD'){
 const row=Array(67).fill(null);const h={fast:102,slow:101,previousFast:101,previousSlow:100};
 Object.assign(row,{0:symbol,1:opened,6:100.1,16:40,21:1,22:100,23:99,24:99,25:102,26:104,27:106,34:'BUY',35:true,37:true,38:true,39:true,42:'BULLISH',43:60,49:'EXIT_ALL',
  65:{version:'HEMA1545_V1',tf15:h,tf45:{...h,confirmed:true}},66:{version:'TF15_ENTRY_EVENT_V1',entryEvent:true,setupAt:opened}});
 return {feedVersion:'TF15_REALTIME_V1',timeframe:'15',confirmed:false,emittedAt:now,markets:[row]};
}
function market(tf='2',symbol='XAUUSD'){
 return {symbol,timeframe:tf,receivedAt:now,price:100.1,feedMode:'INTRABAR',signalObservedAt:now,sourceBarTime:opened,
 strategyNormal:{tf:tf+'m',state:'READY',side:'BUY',solid:true,entrySopVersion:tf==='2'?'SOLID_TF2_3GREEN_HEMA23_V2':'SOLID_TF15_3GREEN_HEMA1545_2L_V1',
 sop:{sopGreen:3,forecast:'BULLISH',marketPower:60,gates:Array.from({length:6},()=>({pass:true}))},plan:{entry:100,sl:99,tp1:102,tp2:104,tp3:106}}};
}
const settings=mode=>({capitalUsd:1000,lotPerLayer:.01,layers:3,symbols:['XAUUSD','GBPUSD','GBPJPY'],strategyMode:mode});
test('TF2/TF15/Both choose own timeframe and sizing; other entry pairs rejected',()=>{
 for(const mode of Core.STRATEGY_MODES){const s=Core.validateSettings(settings(mode));assert.equal(s.ok,true);
  for(const tf of ['2','15']){const c=Core.buildSetupCommand(market(tf),s.value,null,now);const allowed=mode==='BOTH'||mode===(tf==='2'?'TF2_SCALPING':'TF15_INTRA');
   assert.equal(!!c,allowed);if(c){assert.equal(c.payload.layers,tf==='15'?2:3);assert.equal(c.payload.exitPolicy!==null,tf==='2');}}
 }
 assert.equal(Contract.createEntryDecision(market('2','EURUSD')),null);
 assert.equal(Core.validateSettings({...settings('BOTH'),symbols:['EURUSD']}).ok,false);
});
test('TF15 compact ingress authorizes unconfirmed entry and isolates management',()=>{
 const [m]=Hub.ingest(batch(),now);assert.equal(m.strategyNormal.state,'READY');assert.equal(m.timeframe,'15');assert.equal(m.positionManagement.action,'IDLE');
 assert.ok(Core.buildSetupCommand(m,settings('TF15_INTRA'),null,now));assert.ok(Hub.markets().includes(m));
 assert.deepEqual(Hub.ingest(batch('EURUSD'),now),[]);
 const bad=batch();bad.markets[0][65].tf45.confirmed=false;
 assert.equal(Hub.ingest(bad,now)[0].strategyNormal.state,'WATCH');
});
test('Both dispatches separate strategy commands and management cannot cross timeframe',async()=>{
 const store=new MemoryAutoTradeStore();const service=createAutoTradeService({store,now:()=>now,allowDemoExecution:false,localEaExecutionUserIds:['owner'],allowedDemoSymbols:Core.TRADE_SYMBOLS,commandSigningKey:'test-signing-key-longer-than-thirty-two-bytes'});
 store.podsByUser.set('owner',{id:'pod-owner',userId:'owner',ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:now,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.2.0-ea-local',symbolSpecs:{}});
 await service.saveSettings('owner',{...settings('BOTH'),riskAcknowledged:true});await store.setControl('owner',{desiredState:'ON',effectiveState:'ON'});
 assert.deepEqual(await service.dispatchMarkets([market('2','XAUUSD'),market('15','GBPUSD')]),{queued:2});
 const rows=store.commands.get('pod-owner');assert.deepEqual(rows.map(r=>r.payload.strategyMode),['TF2_SCALPING','TF15_INTRA']);
 await store.replacePositions('owner',[{ticket:'1',symbol:'GBPUSD',strategyMode:'TF15_INTRA'}],now);
 const wrong={...market('2','GBPUSD'),positionManagement:{action:'EXIT_ALL'}};
 assert.deepEqual(await service.dispatchMarkets([wrong]),{queued:0});
 const correct={...wrong,timeframe:'15'};assert.deepEqual(await service.dispatchMarkets([correct]),{queued:1});assert.equal(rows.at(-1).payload.strategyMode,'TF15_INTRA');
});
test('Telegram state dedupe is independent for two timeframes on the same pair',async()=>{
 const alerts=new AnalysisAlerts({fetchFn:()=>{throw Error('No external sends');}});await alerts.init();
 await alerts.record(market('2'));await alerts.record(market('15'));
 const entry=alerts.events.filter(e=>e.kind==='ENTRY');assert.equal(entry.length,2);
 for(const e of entry){assert.ok(entrySopAllowed(e));assert.ok(entryFresh(e,now));assert.match(telegramMessage(e),new RegExp('SOLID ENTRY TF'+e.timeframe));}
 assert.match(telegramMessage(entry[1]),/INTRA/);clearInterval(alerts.cleanupTimer);
});
