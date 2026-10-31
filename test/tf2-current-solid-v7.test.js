'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {RULE,VERSION}=require('../tf2-current-solid-sop'),{evaluateEntrySop}=require('../normal-entry-sop');
const {createEntrySetupTracker}=require('../entry-setup-state');
const C=require('../analysis-execution-contract'),T=require('../analysis-telegram');
function frame(side='BUY'){
 const sign=side==='BUY'?1:-1;
 return {timeframe:'2',normal3Side:side,normal3Entry:100,normal3Close:100+sign*.2,normal3Atr:1,normal3Solid:true,
  normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Forecast:side==='BUY'?'BULLISH':'BEARISH',normal3MarketPower:51,
  setupMeta:{entryRuleVersion:RULE,currentSolidOnly:true},normal3SetupArmed:true,normal3SetupPolicy:'SEQUENTIAL_ATR40_V1',
  normal3EntryExpired:true,pullback:{pass:false},chopIndex:90,sidewaysGuard:true,
  hemaConfirmation:{version:'HEMA23_LIVE_V1',tf2:{fast:100+sign*.05,slow:100+sign*.08},tf3:{fast:100-sign,slow:100}}};
}
function market(d){
 const x=evaluateEntrySop(d,'2'),sign=d.normal3Side==='BUY'?1:-1,at=Date.now();
 return {symbol:'XAUUSD',timeframe:'2',receivedAt:at,signalObservedAt:at,entryAuthorizedAt:at,price:d.normal3Close,
  feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedChannel:'EXECUTION',entryEvent:true,chopIndex:90,sidewaysGuard:true,
  strategyNormal:{state:x.standardReady?'READY':'WATCH',side:x.side,tf:'2m',solid:x.solid,entrySopVersion:x.version,
   plan:{entry:100,sl:100-sign,tp1:100+sign,tp2:100+sign*2,tp3:100+sign*3},
   sop:{gates:x.gates,sopGreen:x.green,forecast:x.forecast,marketPower:x.power,hema2:x.hema2}}};
}
test('V7 has exactly the five requested current gates for all checklist masks and both directions',()=>{
 for(const side of ['BUY','SELL'])for(let mask=0;mask<32;mask++){
  const d=frame(side);for(let i=1;i<=5;i++)d['normal3Sop'+i]=!!(mask&(1<<(i-1)));
  const x=evaluateEntrySop(createEntrySetupTracker().update(d),'2');assert.equal(x.version,VERSION);
  assert.deepEqual(x.gates.map(g=>g.key),['solid','entry','sop','forecast','hema2']);
  assert.equal(x.standardReady,x.green>=3);assert.equal(x.sequential,false);assert.equal(x.pullback,null);
 }
});
test('current SOLID disappearing immediately revokes entry despite a previously armed setup',()=>{
 for(const side of ['BUY','SELL']){
  const tracker=createEntrySetupTracker(),d=frame(side);assert.equal(evaluateEntrySop(tracker.update(d),'2').standardReady,true);
  const gone=tracker.update({...d,normal3Solid:false});assert.equal(evaluateEntrySop(gone,'2').standardReady,false);assert.equal(C.createEntryDecision(market(gone)),null);
 }
});
test('strict fifty forecast boundary and price outside both HEMA values; no ribbon-order/width or higher-TF requirement',()=>{
 for(const side of ['BUY','SELL']){
  const d=frame(side);
  for(const power of [40,50,50.01,80])assert.equal(evaluateEntrySop({...d,normal3MarketPower:power},'2').forecastPass,power>50);
  for(const power of [49.99,50,50.01])assert.equal(evaluateEntrySop({...d,normal3Forecast:'NEUTRAL',normal3MarketPower:power},'2').forecastPass,side==='BUY'?power>50:power<50);
  for(const ribbon of [{fast:99,slow:101},{fast:d.normal3Close,slow:d.normal3Close},{}])assert.equal(evaluateEntrySop({...d,hemaConfirmation:{...d.hemaConfirmation,tf2:ribbon}},'2').standardReady,false);
  const reversed={...d,hemaConfirmation:{version:'HEMA23_LIVE_V1',tf2:{fast:d.hemaConfirmation.tf2.slow,slow:d.hemaConfirmation.tf2.fast}}};assert.equal(evaluateEntrySop(reversed,'2').standardReady,true);
  assert.ok(C.createEntryDecision(market(reversed)));
 }
});
test('execution and Telegram agree on V7, reject stale events and cached READY with price back inside ribbon',()=>{
 for(const side of ['BUY','SELL']){
  const d=frame(side),m=market(d),decision=C.createEntryDecision(m);assert.ok(decision);
  const x=evaluateEntrySop(d,'2'),e={kind:'ENTRY',time:Date.now(),id:1,timeframe:'2',symbol:'XAUUSD',side,
   telegramSop:{version:VERSION,tf:'2m',solid:true,green:x.green,forecast:x.forecast,power:x.power,hema2:x.hema2,gates:x.gates},
   telegramMarket:{price:m.price,timeframe:'2'},telegramQuality:C.entryQuality(m),telegramPlan:m.strategyNormal.plan};
  assert.equal(T.entrySopAllowed(e),true);assert.match(T.telegramMessage(e),/ENTRY TF2/);assert.doesNotMatch(T.telegramMessage(e),/SETUP DIPEGANG|HEMA TF3|Pullback/);
  const badPrice=(x.hema2.fast+x.hema2.slow)/2;assert.equal(C.createEntryDecision({...m,price:badPrice}),null);
  assert.equal(T.entrySopAllowed({...e,telegramMarket:{...e.telegramMarket,price:badPrice}}),false);
  assert.equal(C.createEntryDecision({...m,feedChannel:'DASHBOARD'}),null);
  assert.equal(C.createEntryDecision({...m,signalObservedAt:m.receivedAt-31000,entryAuthorizedAt:m.receivedAt-31000}),null);
 }
});
test('canonical Pine scanner including existing exit behavior is byte-identical to V6',()=>{
 const pine=fs.readFileSync(require.resolve('../ZenCore_TF2_Realtime_Feed.pine'),'utf8');
 const scan=pine.slice(pine.indexOf('f_scan3()=>'),pine.indexOf('var string[] symbols='));
 assert.equal(crypto.createHash('sha256').update(scan).digest('hex'),'6bc43afea0109de33fc207e9fee2edb02b792eca13efb6fff18307e7102d5466');
 assert.match(pine,/power>50/);assert.match(pine,/bool solidLatched=solid/);assert.match(pine,/m5close>math.max\(m5h20,m5h40\)/);
 assert.match(pine,/TF2_SEP24_4GREEN_HEMA5_V1/);assert.doesNotMatch(pine.match(/bool eligible=.*$/m)[0],/pullbackReady|solidLatched|higherHema|ch<|entryRange/);
});
test('Analysis builds the live-anchored plan from raw current SOLID while execution still requires its fresh event',()=>{
 const vm=require('node:vm'),code=fs.readFileSync(require.resolve('../server-v17'),'utf8');
 const start=code.indexOf('function normalScalpStrategy('),end=code.indexOf('function validationKey(',start);
 const ctx={normalEntrySop:require('../normal-entry-sop').normalEntrySop,chartTradePlan:require('../chart-trade-plan').chartTradePlan,
  levelsAtLivePrice:require('../live-entry-levels').levelsAtFill,N:v=>v==null?null:Number(v),U:v=>String(v||'').toUpperCase(),
  signalCoreBySymbol:new Map([['XAUUSD',{stage:'COOLDOWN'}]]),sidewaysGuardBySymbol:new Map([['XAUUSD',{active:true}]])};
 vm.runInNewContext(code.slice(start,end),ctx);
 const d={...frame(),normalSopVersion:'32.4',entry:100,close:100.2,initialSl:99,tp1:101,tp2:102,tp3:103,entryEvent:false};
 const n=ctx.normalScalpStrategy('XAUUSD',d);assert.equal(n.state,'READY');assert.equal(n.plan.entryAnchor,'LIVE_SIGNAL_PRICE_V1');assert.equal(n.plan.entry,100.2);
 const m={...market(d),entryEvent:false,strategyNormal:n};assert.equal(C.createEntryDecision(m),null);
 assert.ok(C.createEntryDecision({...m,entryEvent:true}));
 assert.notEqual(ctx.normalScalpStrategy('XAUUSD',{...d,normal3Solid:false}).state,'READY');
});
