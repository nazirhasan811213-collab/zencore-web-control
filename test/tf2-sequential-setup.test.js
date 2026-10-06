'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTf2SetupTracker}=require('../tf2-setup-state');
const {normalEntrySop}=require('../normal-entry-sop');
const Contract=require('../analysis-execution-contract');
const {entrySopAllowed}=require('../analysis-telegram');
const base={symbol:'XAUUSD',setupKey:'TF2|XAUUSD|BUY|1',timeframe:'2',tradeActive:true,
 normal3Side:'BUY',normal3Entry:100,normal3Close:100.1,normal3Atr:1,initialSl:99,tp1:101,tp2:102,tp3:103,
 normal3Solid:true,normal3PricePastEntry:true,normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:true,
 normal3Forecast:'NEUTRAL',normal3MarketPower:60,
 hemaConfirmation:{version:'HEMA23_LIVE_V1',tf2:{fast:102,slow:101},tf3:{fast:102,slow:101}}};
test('SOLID in one candle is held until current confirmations pass in a later candle',()=>{
 const tracker=createTf2SetupTracker();
 const first=tracker.update({...base,normal3MarketPower:40});assert.equal(normalEntrySop(first).standardReady,false);
 const later=tracker.update({...base,normal3Solid:false,time:240000,normal3MarketPower:60});
 const x=normalEntrySop(later);assert.equal(x.standardReady,true);assert.equal(x.version,'NORMAL_20261001_TF2_SEQ_V3');
 const m={symbol:'XAUUSD',timeframe:'2',receivedAt:Date.now(),price:100.1,
 strategyNormal:{state:'READY',side:x.side,solid:x.solid,tf:'2m',entrySopVersion:x.version,
 sop:{gates:x.gates,sopGreen:x.green,forecast:x.forecast,marketPower:x.power,hema2:x.hema2,hema3:x.hema3},
 plan:{entry:100,sl:99,tp1:101,tp2:102,tp3:103}}};
 assert.ok(Contract.createEntryDecision(m));
 assert.equal(entrySopAllowed({symbol:'XAUUSD',side:'BUY',timeframe:'2',telegramQuality:{score:60},
 telegramSop:{version:x.version,tf:'2m',solid:x.solid,green:x.green,gates:x.gates,hema2:x.hema2,hema3:x.hema3}}),true);
});
test('historical confirmation passes are not accumulated; opposite HEMA or forecast blocks until current recovery',()=>{
 const tracker=createTf2SetupTracker();tracker.update(base);
 for(const edit of [{normal3MarketPower:40},{normal3Sop4:false},{hemaConfirmation:{...base.hemaConfirmation,tf3:{fast:100,slow:101}}}])
  assert.equal(normalEntrySop(tracker.update({...base,normal3Solid:false,...edit})).standardReady,false);
 assert.equal(normalEntrySop(tracker.update({...base,normal3Solid:false})).standardReady,true);
});
test('price beyond TP1 retains the setup but cannot authorize; pullback before TP1 can authorize',()=>{
 const tracker=createTf2SetupTracker();tracker.update(base);
 function decision(price){const d=tracker.update({...base,normal3Solid:false,normal3Close:price});const x=normalEntrySop(d);
  return Contract.createEntryDecision({symbol:'XAUUSD',timeframe:'2',receivedAt:Date.now(),price,
   strategyNormal:{state:'READY',side:'BUY',solid:x.solid,tf:'2m',entrySopVersion:x.version,
   sop:{gates:x.gates,sopGreen:x.green,forecast:x.forecast,marketPower:x.power,hema2:x.hema2,hema3:x.hema3},plan:{entry:100,sl:99,tp1:101,tp2:102,tp3:103}}});}
 assert.equal(decision(101.4),null);assert.equal(decision(99.8),null);assert.ok(decision(100.3));
});
test('SELL holds its own SOLID and confirms on a later candle with current SELL HEMA and forecast',()=>{
 const tracker=createTf2SetupTracker(),sell={...base,setupKey:'TF2|XAUUSD|SELL|2',normal3Side:'SELL',
  normal3Close:99.9,initialSl:101,tp1:99,tp2:98,tp3:97,normal3Forecast:'BEARISH',normal3MarketPower:60,
  hemaConfirmation:{version:'HEMA23_LIVE_V1',tf2:{fast:98,slow:99},tf3:{fast:98,slow:99}}};
 assert.equal(normalEntrySop(tracker.update({...sell,normal3Sop4:false})).standardReady,false);
 assert.equal(normalEntrySop(tracker.update({...sell,normal3Solid:false})).standardReady,true);
});
test('closed/SL setup cannot rearm with a late SOLID; new setup and opposite direction do not inherit it',()=>{
 for(const edit of [{tradeActive:false},{slHit:true},{positionExitStage:'CLOSED'},{normal3Close:99}]){
  const tracker=createTf2SetupTracker();tracker.update(base);assert.equal(tracker.update({...base,...edit}).normal3SetupArmed,false);
  assert.equal(tracker.update(base).normal3SetupArmed,false);
  assert.equal(tracker.update({...base,setupKey:'NEW',normal3Solid:false}).normal3SetupArmed,false);
  assert.equal(tracker.update({...base,setupKey:'NEW'}).normal3SetupArmed,true);
  assert.equal(tracker.update({...base,setupKey:'SELL',normal3Side:'SELL',normal3Entry:100,initialSl:101,normal3Solid:false}).normal3SetupArmed,false);
 }
});
test('Pine latch can restore server state after restart, but never restore a closed setup or affect TF15',()=>{
 const tracker=createTf2SetupTracker();const d={...base,normal3Solid:false,tf2SetupMeta:{policy:'TF2_SEQUENTIAL_V1',solidLatched:true}};
 assert.equal(tracker.update(d).normal3SetupArmed,true);
 assert.equal(tracker.update({...d,tradeActive:false}).normal3SetupArmed,false);
 const tf15={...d,timeframe:'15'};assert.equal(tracker.update(tf15),tf15);
});
