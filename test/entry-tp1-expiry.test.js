'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEntrySetupTracker,POLICY}=require('../entry-setup-state');
const {evaluateEntrySop}=require('../normal-entry-sop');
const {decodeTf15Market}=require('../tf15-feed');
const {createEntryDecision}=require('../analysis-execution-contract');
const {entrySopAllowed}=require('../analysis-telegram');

function fixture(tf,side){
 const buy=side==='BUY',hema=buy?{fast:102,slow:101}:{fast:98,slow:99};
 return {symbol:'XAUUSD',timeframe:tf,setupKey:`TF${tf}|${side}|1000000`,time:1000000,
  tradeActive:true,normal3Side:side,normal3Solid:true,normal3Entry:100,initialSl:buy?98:102,
  tp1:buy?102:98,tp2:buy?104:96,tp3:buy?106:94,normal3Close:buy?101:99,
  open:100,high:101.1,low:98.9,normal3Atr:2,normal3PricePastEntry:true,
  normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:true,
  normal3Forecast:buy?'BULLISH':'BEARISH',normal3MarketPower:70,
  setupMeta:{policy:POLICY,atrBeforeBar:2,solidLatched:true},
  hemaConfirmation:{version:tf==='15'?'HEMA1530_V1':'HEMA23_LIVE_V1',
   ['tf'+tf]:hema,['tf'+(tf==='15'?'30':'3')]:hema}};
}
function market(d){
 const sop=evaluateEntrySop(d,d.timeframe),at=Date.now();
 return {symbol:d.symbol,timeframe:d.timeframe,setupKey:d.setupKey,receivedAt:at,signalObservedAt:at,price:d.normal3Close,
  strategyNormal:{tf:d.timeframe+'m',side:sop.side,state:sop.standardReady?'READY':'WATCH',solid:sop.solid,entrySopVersion:sop.version,
   plan:{entry:d.normal3Entry,sl:d.initialSl,tp1:d.tp1,tp2:d.tp2,tp3:d.tp3},
   sop:{...sop,sopGreen:sop.green,marketPower:sop.power}}};
}
for(const tf of ['2','15'])for(const side of ['BUY','SELL']){
 test(`TF${tf} ${side}: TP1 ends entry even after pullback and repeated SOLID; new setup must arm separately`,()=>{
  const tracker=createEntrySetupTracker(),d=fixture(tf,side);
  assert.ok(createEntryDecision(market(tracker.update(d))));
  const touched=tracker.update({...d,normal3Close:d.tp1,tp1Hit:true});
  assert.equal(touched.normal3EntryExpired,true);
  const pulled=tracker.update({...d,normal3Solid:true,tp1Hit:false});
  assert.equal(pulled.normal3SetupArmed,false);
  assert.equal(pulled.pullback.state,'TP1_TOUCHED_WAIT_NEW_SOLID');
  assert.equal(evaluateEntrySop(pulled,tf).standardReady,false);
  const m=market(pulled);
  assert.equal(createEntryDecision(m),null);
  const x=evaluateEntrySop(pulled,tf);
  assert.equal(entrySopAllowed({symbol:'XAUUSD',side,timeframe:tf,kind:'ENTRY',
   telegramSop:{...x,tf:tf+'m'}}),false);
  // Re-entry/target changes on the same setup identity cannot clear expiry.
  assert.equal(tracker.update({...d,tp1:side==='BUY'?103:97}).normal3EntryExpired,true);
  const fresh={...d,setupKey:d.setupKey+'-NEW',normal3Solid:false,setupMeta:{policy:POLICY,atrBeforeBar:2}};
  assert.equal(evaluateEntrySop(tracker.update(fresh),tf).standardReady,false);
  assert.equal(evaluateEntrySop(tracker.update({...fresh,normal3Solid:true}),tf).standardReady,true);
 });
 test(`TF${tf} ${side}: historical TP1 survives restart, without using candle extremes before setup`,()=>{
  const d=fixture(tf,side);
  for(const flag of [{tp1Hit:true},{tp2Hit:true},{tp3Hit:true},{slLockStage:1},
   {setupMeta:{...d.setupMeta,entryExpired:true}}]){
   assert.equal(createEntrySetupTracker().update({...d,...flag}).normal3EntryExpired,true);
  }
  // Whole-candle high/low may precede the SOLID, so use Pine's hit flags or current quote.
  assert.equal(createEntrySetupTracker().update({...d,high:200,low:1}).normal3EntryExpired,false);
  assert.equal(createEntrySetupTracker().update({...d,close:d.tp1}).normal3EntryExpired,true);
 });
}
test('legacy six-gate alerts also expire without changing their SOP or exit payload',()=>{
 for(const tf of ['2','15']){
  const tracker=createEntrySetupTracker(),d={...fixture(tf,'SELL'),setupMeta:{},
   positionExitAction:'HOLD',activeSl:100,slMoveTriggered:true,slMoveAction:'MOVE_SL_ENTRY'};
  assert.equal(evaluateEntrySop(tracker.update(d),tf).gates.length,6);
  const expired=tracker.update({...d,tp1Hit:true});
  assert.equal(evaluateEntrySop(expired,tf).standardReady,false);
  assert.equal(expired.positionExitAction,d.positionExitAction);
  assert.equal(expired.activeSl,d.activeSl);assert.equal(expired.slMoveAction,d.slMoveAction);
  assert.equal(expired.slMoveTriggered,true);
  assert.equal(evaluateEntrySop(tracker.update(d),tf).standardReady,false);
 }
});
test('expiry is isolated between TF2 and TF15',()=>{
 const tracker=createEntrySetupTracker();
 tracker.update({...fixture('2','SELL'),tp1Hit:true});
 assert.equal(evaluateEntrySop(tracker.update(fixture('15','SELL')),'15').standardReady,true);
});
test('TF15 decoder retains historical target hits and protection for the entry guard',()=>{
 const row=Array(67).fill(null);row[0]='XAUUSD';row[1]=1000000;row[34]='SELL';
 row[30]=true;row[31]=false;row[32]=false;row[56]=1;row[49]='HOLD';row[24]=100;
 row[65]={version:'HEMA1530_V1'};row[66]={version:'TF15_ENTRY_EVENT_V1',setupAt:1000000};
 const decoded=decodeTf15Market(row,{feedVersion:'TF15_REALTIME_V1',timeframe:'15',emittedAt:1000100});
 assert.equal(decoded.pine.tp1Hit,true);assert.equal(decoded.pine.slLockStage,1);
 assert.equal(decoded.pineExit.activeSl,100);assert.equal(decoded.pineExit.action,'IDLE');
});
