'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateEntrySop,normalEntrySop}=require('../normal-entry-sop');
const Contract=require('../analysis-execution-contract'),Core=require('../auto-trade-core');
const {entrySopAllowed,telegramMessage,messageQuality}=require('../analysis-telegram');
const base={timeframe:'2',normal3Side:'BUY',normal3Entry:100,normal3Close:100.1,normal3Atr:1,
 normal3Solid:true,normal3PricePastEntry:true,normal3Forecast:'NEUTRAL',normal3MarketPower:51,normal5Position:'ABOVE',
 hemaConfirmation:{version:'HEMA23_LIVE_V1',tf2:{fast:102,slow:101},tf3:{fast:102,slow:101},tf15:{fast:102,slow:101},tf30:{fast:102,slow:101}},
 normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:true,normal3Sop5:false};
test('October 1 gates are extended by two directional HEMA gates, without slope or close gates',()=>{
 for(const tf of ['2','15']){
  const d={...base,timeframe:tf,chopIndex:90,hemaConfirmation:{...base.hemaConfirmation,version:tf==='15'?'HEMA1530_V1':'HEMA23_LIVE_V1'}};
  const x=evaluateEntrySop(d,tf);assert.equal(x.standardReady,true);assert.equal(x.gates.length,7);
  for(const edit of [{normal3Solid:false},{normal3PricePastEntry:false},{normal3Sop4:false},{normal3MarketPower:50},{normal5Position:'INSIDE'},{normal3Atr:0},{timeframe:'3'}])
   assert.equal(evaluateEntrySop({...d,...edit},tf).standardReady,false,JSON.stringify(edit));
 }
 assert.deepEqual(evaluateEntrySop(base,'2').gates.slice(0,5),evaluateEntrySop({...base,timeframe:'15'},'15').gates.slice(0,5));
});
test('all checklist combinations retain the original minimum four, in both timeframes',()=>{
 for(const tf of ['2','15'])for(let mask=0;mask<32;mask++){
  const d={...base,timeframe:tf,hemaConfirmation:{...base.hemaConfirmation,version:tf==='15'?'HEMA1530_V1':'HEMA23_LIVE_V1'}};let count=0;
  for(let i=1;i<=5;i++){d['normal3Sop'+i]=!!(mask&(1<<(i-1)));count+=+d['normal3Sop'+i];}
  assert.equal(evaluateEntrySop(d,tf).standardReady,count>=4);
 }
});
test('original strict forecast boundaries are restored on BUY and SELL',()=>{
 for(const tf of ['2','15'])for(const side of ['BUY','SELL']){
  const ribbon=side==='BUY'?{fast:102,slow:101}:{fast:98,slow:99};
  const d={...base,timeframe:tf,normal3Side:side,normal5Position:side==='BUY'?'ABOVE':'BELOW',hemaConfirmation:{version:tf==='15'?'HEMA1530_V1':'HEMA23_LIVE_V1',['tf'+tf]:ribbon,['tf'+(tf==='15'?'30':'3')]:ribbon}};
  const cases=side==='BUY'?[['NEUTRAL',51,true],['BULLISH',51,true],['NEUTRAL',50,false],['BEARISH',70,false]]:
   [['NEUTRAL',49,true],['NEUTRAL',45,true],['NEUTRAL',50,false],['BEARISH',51,true],['BEARISH',50,false],['BULLISH',70,false]];
  for(const [forecast,power,want] of cases)assert.equal(evaluateEntrySop({...d,normal3Forecast:forecast,normal3MarketPower:power},tf).standardReady,want);
 }
});
test('TF15 decoder, analysis, execution and Telegram share original SOP and correct candle timeframe',()=>{
 const at=Date.now(),row=Array(67).fill(null);
 Object.assign(row,{0:'XAUUSD',1:at-1000,6:100.1,21:1,22:100,23:99,24:99,25:101,26:102,27:103,
  34:'BUY',35:true,36:true,37:true,38:true,39:true,40:true,41:false,42:'NEUTRAL',43:51,44:'ABOVE',
  65:{version:'HEMA1530_V1',tf15:{fast:102,slow:101},tf30:{fast:102,slow:101,confirmed:false}},66:{version:'TF15_ENTRY_EVENT_V1',entryEvent:true,setupAt:at-1000}});
 const hub=require('../strategy-market-hub');
 const [market]=hub.ingest({feedVersion:'TF15_REALTIME_V1',timeframe:'15',confirmed:false,emittedAt:at,markets:[row]},at);
 assert.equal(market.strategyNormal.state,'READY');assert.equal(market.strategyNormal.plan.sourceTimeframe,'15');
 assert.equal(Contract.createEntryDecision(market).snapshot.analysisSopVersion,'NORMAL_20261001_TF15_V2');
 const settings={capitalUsd:1000,lotPerLayer:.01,layers:3,symbols:['XAUUSD'],strategyMode:'BOTH',strategyExitPolicies:{TF2_SCALPING:{version:'TF2_TIGHT_SL_3C_V1'}}};
 for(const tf of ['2','15']){
  const x=evaluateEntrySop({...base,timeframe:tf,hemaConfirmation:{...base.hemaConfirmation,version:tf==='15'?'HEMA1530_V1':'HEMA23_LIVE_V1'}},tf);
  const m={...market,timeframe:tf,strategyNormal:{...market.strategyNormal,tf:tf+'m',entrySopVersion:x.version,sop:{...market.strategyNormal.sop,gates:x.gates,...Object.fromEntries(Object.entries(x).filter(([k])=>k.startsWith('hema')))}}};
  const cmd=Core.buildSetupCommand(m,settings,{tickSize:.01,tickValue:1},at);
  assert.ok(cmd);assert.equal(cmd.payload.exitPolicy,null);assert.equal(cmd.payload.sl,99);
  const q=messageQuality(m),event={kind:'ENTRY',timeframe:tf,symbol:'XAUUSD',side:'BUY',id:'TEST',time:at,telegramPlan:m.strategyNormal.plan,telegramQuality:q,
   telegramSop:{version:x.version,tf:tf+'m',solid:true,green:4,gates:x.gates,forecast:x.forecast,power:x.power,m5Position:'ABOVE',...Object.fromEntries(Object.entries(x).filter(([k])=>k.startsWith('hema')))}};
  assert.equal(entrySopAllowed(event),true);assert.match(telegramMessage(event),new RegExp('SOLID ENTRY TF'+tf));assert.match(telegramMessage(event),/HEMA5: ABOVE/);
  assert.equal(entrySopAllowed({...event,telegramQuality:{score:49}}),false);
 }
 const late={...market,price:101};assert.equal(Contract.createEntryDecision(late),null);
 row[36]=false;assert.equal(hub.ingest({feedVersion:'TF15_REALTIME_V1',timeframe:'15',confirmed:false,emittedAt:at+1,markets:[row]},at+1)[0].strategyNormal.state,'WATCH');
});
