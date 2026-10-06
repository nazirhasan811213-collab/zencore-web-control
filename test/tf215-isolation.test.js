'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../auto-trade-core');
const {evaluateEntrySop}=require('../normal-entry-sop');
const {MemoryAutoTradeStore,PostgresAutoTradeStore}=require('../auto-trade-store');
const {createAutoTradeService}=require('../auto-trade-service');
const {AnalysisAlerts}=require('../analysis-alert-service');
const {entrySopAllowed,telegramMessage}=require('../analysis-telegram');
const {signals}=require('../analysis-alert-core');
function market(tf,side='BUY',at=Date.now()){
 const ribbon=side==='BUY'?{fast:102,slow:101}:{fast:98,slow:99};
 const x=evaluateEntrySop({timeframe:tf,normal3Side:side,normal3Entry:100,normal3Close:100.1,normal3Atr:1,
 normal3Solid:true,normal3PricePastEntry:true,normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:true,
 normal3Forecast:side==='BUY'?'BULLISH':'BEARISH',normal3MarketPower:60,normal5Position:side==='BUY'?'ABOVE':'BELOW',
 hemaConfirmation:{version:tf==='15'?'HEMA1530_V1':'HEMA23_LIVE_V1',['tf'+tf]:ribbon,['tf'+(tf==='15'?'30':'3')]:ribbon}},tf);
 return {symbol:'XAUUSD',timeframe:tf,receivedAt:at,price:100,signalObservedAt:at,feedMode:'INTRABAR',
 strategyNormal:{tf:tf+'m',state:'READY',side,solid:true,entrySopVersion:x.version,
 sop:{gates:x.gates,sopGreen:x.green,forecast:x.forecast,marketPower:x.power,m5Position:side==='BUY'?'ABOVE':'BELOW',
 ...Object.fromEntries(Object.entries(x).filter(([k])=>k.startsWith('hema')))},
 plan:{entry:100,sl:side==='BUY'?99:101,tp1:side==='BUY'?101:99,tp2:side==='BUY'?102:98,tp3:side==='BUY'?103:97}}};
}
async function setup(){
 const at=Date.now(),store=new MemoryAutoTradeStore();
 const svc=createAutoTradeService({store,now:()=>at,allowDemoExecution:false,localEaExecutionUserIds:['owner'],allowedDemoSymbols:Core.TRADE_SYMBOLS,commandSigningKey:'test-signing-key-longer-than-thirty-two-bytes'});
 store.podsByUser.set('owner',{id:'pod',userId:'owner',ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:at,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.2.0-ea-local',symbolSpecs:{}});
 await svc.saveSettings('owner',{capitalUsd:100,lotPerLayer:.01,layers:3,symbols:['XAUUSD'],strategyMode:'BOTH',riskAcknowledged:true});
 await store.setControl('owner',{desiredState:'ON',effectiveState:'ON'});
 return {svc,store,at};
}
test('Both queues TF2 BUY and TF15 SELL independently on the same pair, without duplicates',async()=>{
 const {svc,store,at}=await setup();const rows=[market('2','BUY',at),market('15','SELL',at)];
 assert.equal((await svc.dispatchMarkets(rows)).queued,2);
 assert.equal((await svc.dispatchMarkets(rows)).queued,0);
 const commands=store.commands.get('pod');assert.deepEqual(commands.map(c=>c.payload.strategyMode),['TF2_SCALPING','TF15_INTRA']);
 assert.deepEqual(commands.map(c=>c.payload.layers),[3,2]);
 assert.deepEqual(commands.map(c=>c.payload.side),['BUY','SELL']);
});
test('TF15 WAIT cannot block qualified TF2; TF2 WAIT cannot block qualified TF15',async()=>{
 for(const tf of ['2','15']){
 const {svc,store,at}=await setup(),other=tf==='2'?'15':'2';
 const waiting=market(other,'BUY',at);waiting.strategyNormal.state='WATCH';waiting.strategyNormal.solid=false;
 assert.equal((await svc.dispatchMarkets([waiting,market(tf,'BUY',at)])).queued,1);
 assert.equal(store.commands.get('pod')[0].payload.analysisSnapshot.executionTimeframe,tf);
 }
});
test('position exclusion uses pair and own TF; another TF position does not alter entry SOP',()=>{
 const pos=[{symbol:'XAUUSD',strategyMode:'TF2_SCALPING',side:'BUY'}];
 assert.equal(Core.permitsPositionEntry(market('2'),pos),false);
 assert.equal(Core.permitsPositionEntry(market('15','SELL'),pos),true);
});
test('pending command guard remains per TF in SQL stores',async()=>{
 const seen=[];const store=Object.create(PostgresAutoTradeStore.prototype);store.pool={query:async(sql,args)=>{seen.push({sql,args});return {rowCount:0};}};
 await store.hasRecentEntryCommand('owner','XAUUSD',100,'TF15_INTRA');
 await store.hasRecentHostedEntryCommand('owner','XAUUSD',100,'TF2_SCALPING');
 for(const x of seen){assert.match(x.sql,/COALESCE\(payload->>'strategyMode','TF2_SCALPING'\) = \$4/);assert.equal(x.args.length,4);}
});
test('Telegram entries and close state are separate for TF2 and TF15',async()=>{
 const alerts=new AnalysisAlerts();await alerts.init();const at=Date.now();
 try{
 await alerts.record(market('2','BUY',at));await alerts.record(market('15','SELL',at));
 const entries=alerts.events.filter(e=>e.kind==='ENTRY');assert.equal(entries.length,2);
 for(const e of entries){assert.equal(entrySopAllowed(e),true);const msg=telegramMessage(e);assert.match(msg,new RegExp('SOLID ENTRY TF'+e.timeframe));assert.match(msg,new RegExp('HEMA TF'+(e.timeframe==='2'?'3':'30')));assert.doesNotMatch(msg,new RegExp('HEMA TF'+(e.timeframe==='2'?'30':'3')+':'));}
 const close=market('2','BUY',at+1);close.strategyNormal.state='WATCH';close.positionManagement={action:'EXIT_ALL',reason:'EXIT_ALL'};
 await alerts.record(close);assert.equal(await alerts.activePlan('XAUUSD',2),null);assert.equal((await alerts.activePlan('XAUUSD',15)).side,'SELL');
 assert.match(telegramMessage(alerts.events.at(-1)),/PENGURUSAN POSISI TF2/);
 const e=entries[0];assert.equal(entrySopAllowed({...e,timeframe:'15'}),false);assert.equal(entrySopAllowed({...e,telegramMarket:{...e.telegramMarket,timeframe:'15'}}),false);
 }finally{clearInterval(alerts.cleanupTimer);}
});
test('mismatched or missing timeframe never inherits TF2 for entry or close alerts',()=>{
 const m=market('15');assert.equal(signals({...m,timeframe:'2'}),null);assert.equal(signals({...m,timeframe:undefined}),null);
});

test('delivery rejects queued entry when same-TF direction changes, preserving other TF',async()=>{
 const {svc,store,at}=await setup();const rows=[market('2','BUY',at),market('15','SELL',at)];
 await svc.dispatchMarkets(rows);
 const current=new Map(rows.map(m=>[m.timeframe,m]));current.set('2',{...rows[0],strategyNormal:{state:'WATCH',side:'SELL'}});
 const token='zcpod_'+'t'.repeat(48),hash=require('../auto-trade-service').tokenHash(token);
 store.podsByToken.set(hash,{...store.podsByUser.get('owner'),tokenHash:hash});
 const guarded=createAutoTradeService({store,now:()=>at,commandSigningKey:'test-signing-key-longer-than-thirty-two-bytes',getLatestMarket:(symbol,tf)=>current.get(tf)});
 assert.equal((await guarded.nextCommand(token)).command,null);
 assert.equal(store.commands.get('pod')[0].result.code,'ENTRY_CONFIRMATION_CHANGED');
 assert.equal((await guarded.nextCommand(token)).command.payload.side,'SELL');
});
