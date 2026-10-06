'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEntrySetupTracker,POLICY}=require('../entry-setup-state');
const {evaluateEntrySop}=require('../normal-entry-sop');
const Contract=require('../analysis-execution-contract'),Core=require('../auto-trade-core');
const {entrySopAllowed,telegramMessage}=require('../analysis-telegram');
test('legacy alerts retain original six gates until each TF upgrades its Pine policy',()=>{
 const tracker=createEntrySetupTracker();
 for(const tf of ['2','15']){
  const d={...fixture(tf),normal3PricePastEntry:true,setupMeta:{entryEvent:true}};
  const legacy=tracker.update(d);
  assert.equal(legacy,d);
  assert.equal(evaluateEntrySop(legacy,tf).version,`NORMAL_20261001_TF${tf}_V2`);
  assert.equal(evaluateEntrySop(legacy,tf).gates.length,6);
  assert.equal(evaluateEntrySop(legacy,tf).standardReady,true);
  const upgraded=tracker.update({...d,setupMeta:{policy:POLICY,atrBeforeBar:1}});
  assert.equal(evaluateEntrySop(upgraded,tf).gates.length,7);
  assert.equal(upgraded.pullback.state,'WAIT_PULLBACK');
 }
});
test('ATR40 preserves every original SOP gate for both TFs and directions',()=>{
 for(const tf of ['2','15'])for(const side of ['BUY','SELL']){
  const higher=tf==='2'?'3':'30',buy=side==='BUY';
  const d={...fixture(tf,side),normal3SetupPolicy:POLICY,normal3SetupArmed:true,pullback:{pass:true,state:'PULLBACK_READY'}};
  assert.equal(evaluateEntrySop(d,tf).standardReady,true);
  const mutations=[
   ['solid',{normal3SetupArmed:false}],
   ['entry',{normal3Close:100}],
   ['sop',{normal3Sop1:false,normal3Sop2:false}],
   ['forecast',{normal3Forecast:buy?'BEARISH':'BULLISH'}],
   ['hema'+tf,{hemaConfirmation:{...d.hemaConfirmation,['tf'+tf]:{fast:100,slow:100}}}],
   ['hema'+higher,{hemaConfirmation:{...d.hemaConfirmation,['tf'+higher]:{fast:100,slow:100}}}]
  ];
  for(const [key,change] of mutations){
   const result=evaluateEntrySop({...d,...change},tf);
   assert.equal(result.standardReady,false,`${tf} ${side} cannot bypass ${key}`);
   assert.equal(result.gates.find(g=>g.key===key).pass,false);
  }
 }
});
function fixture(tf='2',side='BUY'){
 const buy=side==='BUY',r=buy?{fast:102,slow:101}:{fast:98,slow:99},higher=tf==='15'?'30':'3';
 return {symbol:'XAUUSD',timeframe:tf,setupKey:'SETUP-'+tf+'-'+side,time:1000000,tradeActive:true,
  normal3Side:side,normal3Entry:100,initialSl:buy?98:102,tp1:buy?106:94,tp2:buy?112:88,tp3:buy?118:82,
  open:100,high:buy?104:100.1,low:buy?99.9:96,normal3Close:buy?103.5:96.5,normal3Atr:1,
  normal3Solid:true,normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:true,
  normal3Forecast:buy?'BULLISH':'BEARISH',normal3MarketPower:70,
  setupMeta:{policy:POLICY,atrBeforeBar:1},hemaConfirmation:{version:tf==='15'?'HEMA1530_V1':'HEMA23_LIVE_V1',['tf'+tf]:r,['tf'+higher]:r}};
}
function market(d){const x=evaluateEntrySop(d,d.timeframe),at=Date.now();return {symbol:d.symbol,timeframe:d.timeframe,receivedAt:at,signalObservedAt:at,setupKey:d.setupKey,price:d.normal3Close,
 strategyNormal:{tf:d.timeframe+'m',side:x.side,state:x.standardReady?'READY':'WATCH',solid:x.solid,entrySopVersion:x.version,
  sop:{gates:x.gates,pullback:x.pullback,sopGreen:x.green,forecast:x.forecast,marketPower:x.power,...Object.fromEntries(Object.entries(x).filter(([k])=>k.startsWith('hema')))},
  plan:{entry:100,sl:d.initialSl,tp1:d.tp1,tp2:d.tp2,tp3:d.tp3}}};}
for(const tf of ['2','15'])for(const side of ['BUY','SELL'])test(`TF${tf} ${side}: large candle waits for 40%, later candle confirms without new SOLID`,()=>{
 const tracker=createEntrySetupTracker(),d=fixture(tf,side),first=tracker.update(d);
 assert.equal(first.pullback.state,'WAIT_PULLBACK');assert.equal(evaluateEntrySop(first,tf).standardReady,false);
 const buy=side==='BUY',level=buy?102.4:97.6;
 assert.ok(Math.abs(first.pullback.level-level)<1e-9);
 const later=tracker.update({...d,time:d.time+Number(tf)*60000,normal3Solid:false,open:buy?103:97,high:buy?103.1:97.1,low:buy?102:96.9,normal3Close:level});
 assert.equal(later.pullback.pass,true);const m=market(later),decision=Contract.createEntryDecision(m);assert.ok(decision);
 const command=Core.buildSetupCommand(m,{capitalUsd:1000,lotPerLayer:.01,layers:3,symbols:['XAUUSD'],strategyMode:'BOTH',tradingSchedule:{enabled:false}},{tickSize:.01,tickValue:1});
 assert.ok(command);assert.equal(command.payload.layers,tf==='15'?2:3);assert.equal(command.payload.sl,d.initialSl);
 const s=m.strategyNormal.sop,event={symbol:'XAUUSD',side,timeframe:tf,kind:'ENTRY',id:'TEST',time:Date.now(),telegramQuality:{score:70,grade:'B+'},telegramPlan:m.strategyNormal.plan,
  telegramSop:{version:m.strategyNormal.entrySopVersion,tf:tf+'m',solid:true,green:s.sopGreen,gates:s.gates,pullback:s.pullback,forecast:s.forecast,power:s.marketPower,...Object.fromEntries(Object.entries(s).filter(([k])=>k.startsWith('hema')))}};
 assert.equal(entrySopAllowed(event),true);assert.match(telegramMessage(event),new RegExp('SOLID ENTRY TF'+tf));assert.match(telegramMessage(event),/Pullback: 40%/);
 assert.equal(entrySopAllowed({...event,telegramSop:{...event.telegramSop,pullback:{pass:false}}}),false);
 assert.equal(Contract.createEntryDecision({...m,strategyNormal:{...m.strategyNormal,sop:{...s,pullback:{pass:false}}}}),null);
});
test('normal candle needs no pullback; 1.5 ATR is inclusive; missing ATR cannot bypass guard',()=>{
 for(const tf of ['2','15']){
  const d=fixture(tf),tracker=createEntrySetupTracker();
  const small=tracker.update({...d,high:101.49,normal3Close:101.4});assert.equal(small.pullback.required,false);assert.equal(small.pullback.pass,true);
  const large=tracker.update({...d,high:101.5,normal3Close:101.5});assert.equal(large.pullback.required,true);assert.equal(large.pullback.pass,false);
  const missing=createEntrySetupTracker().update({...d,setupMeta:{policy:POLICY},normal3Atr:999});assert.equal(missing.pullback.state,'WAIT_ATR');
 }
});
test('new high recalculates pullback; later ordinary candle preserves original impulse level',()=>{
 const tracker=createEntrySetupTracker(),d=fixture();tracker.update(d);
 const pulled=tracker.update({...d,normal3Solid:false,normal3Close:102.4});assert.equal(pulled.pullback.pass,true);
 const extended=tracker.update({...d,normal3Solid:false,high:105,normal3Close:103.1});assert.equal(extended.pullback.level,103);assert.equal(extended.pullback.pass,false);
 const next=tracker.update({...d,time:1120000,normal3Solid:false,open:103.1,high:103.2,low:102.8,normal3Close:103});assert.equal(next.pullback.level,103);assert.equal(next.pullback.pass,true);
});
test('TFs use their own ATR and maintain isolated setup state',()=>{
 const tracker=createEntrySetupTracker();const a=tracker.update(fixture('2'));
 const b=tracker.update({...fixture('15'),setupMeta:{policy:POLICY,atrBeforeBar:3}});
 assert.equal(a.pullback.required,true);assert.equal(b.pullback.required,false);
 assert.equal(tracker.update({...fixture('2'),tradeActive:false}).normal3SetupArmed,false);
 assert.equal(tracker.update({...fixture('15'),normal3Solid:false,setupMeta:{policy:POLICY,atrBeforeBar:3}}).normal3SetupArmed,true);
});
test('current confirmations still block entry after pullback; closed setup cannot rearm',()=>{
 for(const tf of ['2','15']){
  const tracker=createEntrySetupTracker(),d=fixture(tf);tracker.update(d);
  const pulled={...d,normal3Solid:false,normal3Close:102.4};
  const wrong=tracker.update({...pulled,normal3Forecast:'BEARISH'});assert.equal(wrong.pullback.pass,true);assert.equal(evaluateEntrySop(wrong,tf).standardReady,false);
  assert.equal(evaluateEntrySop(tracker.update(pulled),tf).standardReady,true);
  tracker.update({...pulled,tradeActive:false});assert.equal(tracker.update(d).normal3SetupArmed,false);
 }
});
test('restart restores the Pine impulse; a missing restoration cannot silently bypass a required pullback',()=>{
 const d=fixture('15');
 const recovered=createEntrySetupTracker().update({...d,normal3Solid:false,time:1900000,open:103.5,high:103.6,low:103.4,
  setupMeta:{policy:POLICY,solidLatched:true,atrBeforeBar:1,impulseRequired:true,impulseBar:1000000,impulseOpen:100,impulseExtreme:104,impulseAtr:1}});
 assert.equal(recovered.normal3SetupArmed,true);assert.equal(recovered.pullback.level,102.4);assert.equal(recovered.pullback.pass,false);
 const bad=createEntrySetupTracker().update({...d,normal3Solid:false,time:1900000,open:103.5,high:103.6,low:103.4,
  setupMeta:{policy:POLICY,solidLatched:true,atrBeforeBar:1,impulseRequired:true}});
 assert.equal(bad.pullback.state,'WAIT_IMPULSE_DATA');assert.equal(bad.pullback.pass,false);
});
test('a later Pine impulse replaces an older impulse even when its candle was missed by the server',()=>{
 const tracker=createEntrySetupTracker(),d=fixture();tracker.update(d);
 const next=tracker.update({...d,normal3Solid:false,time:1240000,open:105,high:105.1,low:104.9,normal3Close:105,
  setupMeta:{policy:POLICY,solidLatched:true,atrBeforeBar:1,impulseRequired:true,impulseBar:1120000,impulseOpen:102,impulseExtreme:106,impulseAtr:1}});
 assert.equal(next.pullback.level,104.4);assert.equal(next.pullback.pass,false);
});
