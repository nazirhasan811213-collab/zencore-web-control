'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {evaluateEntrySop}=require('../normal-entry-sop');const {createEntrySetupTracker}=require('../entry-setup-state');const C=require('../analysis-execution-contract');const T=require('../analysis-telegram');
const RULE='TF2_3GREEN_TP1_HEMAGAP_V1';
function frame(side='BUY'){
 const sign=side==='BUY'?1:-1;
 return {symbol:'XAUUSD',timeframe:'2',time:Date.now()-120000,setupKey:'fixture-'+side,open:100,high:100.3,low:99.7,tradeActive:true,normal3Side:side,normal3Entry:100,initialSl:100-sign,tp1:100+sign,tp2:100+sign*2,tp3:100+sign*3,normal3Close:100+sign*.2,normal3Atr:1,normal3Solid:true,normal3PricePastEntry:true,normal3Forecast:side==='BUY'?'BULLISH':'BEARISH',normal3MarketPower:60,
  normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:false,normal3Sop5:false,
  hemaConfirmation:{version:'HEMA23_LIVE_V1',tf2:side==='BUY'?{fast:102,slow:101}:{fast:98,slow:99},tf3:side==='BUY'?{fast:103,slow:102}:{fast:97,slow:98}},
  setupMeta:{policy:'SEQUENTIAL_ATR40_V1',atrBeforeBar:1,entryRuleVersion:RULE,entryExpiryTarget:1}};
}
function market(d,x){return {symbol:'XAUUSD',timeframe:'2',receivedAt:Date.now(),price:d.normal3Close,chopIndex:40,entryEvent:true,strategyNormal:{state:x.standardReady?'READY':'WATCH',tf:'2m',side:x.side,solid:x.solid,entrySopVersion:x.version,plan:{entry:100,sl:d.initialSl,tp1:d.tp1,tp2:d.tp2,tp3:d.tp3},sop:{atrReference:x.atrReference,gates:x.gates,sopGreen:x.green,forecast:x.forecast,marketPower:x.power,hema2:x.hema2,hema3:x.hema3,pullback:x.pullback,eaEntryCompatible:d.normal3Side==='BUY'?d.normal3Close<d.tp1:d.normal3Close>d.tp1}}};}
test('new TF2 minimum is three; unversioned feeds and TF15 retain original four',()=>{
 for(const side of ['BUY','SELL'])for(let mask=0;mask<32;mask++){
  const d=frame(side);let count=0;for(let i=1;i<=5;i++){d['normal3Sop'+i]=!!(mask&(1<<(i-1)));count+=+d['normal3Sop'+i];}
  const x=evaluateEntrySop(createEntrySetupTracker().update(d),'2');assert.equal(x.standardReady,count>=3);
  const legacy={...d,setupMeta:{...d.setupMeta,entryRuleVersion:undefined}};assert.equal(evaluateEntrySop(createEntrySetupTracker().update(legacy),'2').standardReady,count>=4);
 }
 const d=frame();d.timeframe='15';d.hemaConfirmation={version:'HEMA1530_V1',tf15:{fast:102,slow:101},tf30:{fast:102,slow:101}};
 assert.equal(evaluateEntrySop(createEntrySetupTracker().update(d),'15').standardReady,false);
});
test('narrow ribbon blocks independently on either TF, regardless of raw BUY/SELL mode',()=>{
 for(const side of ['BUY','SELL'])for(const key of ['tf2','tf3']){
  const d=frame(side),sign=side==='BUY'?1:-1;
  d.hemaConfirmation[key]={fast:100+sign*.05,slow:100};
  const x=evaluateEntrySop(createEntrySetupTracker().update(d),'2');assert.equal(x.standardReady,false);assert.equal(x['hema'+key.slice(2)].state,'SIDEWAYS');
 }
 const d=frame();d.normal3Atr=10;d.hemaConfirmation.tf2={fast:102,slow:101};d.hemaConfirmation.tf3={fast:104,slow:103};
 assert.equal(evaluateEntrySop(createEntrySetupTracker().update(d),'2').standardReady,false,'exact 10% ATR boundary is blocked');
 d.normal3Atr=0;assert.equal(evaluateEntrySop(createEntrySetupTracker().update(d),'2').standardReady,false);
});
test('valid 3-green entry authorizes below TP1, but TP2 analysis cannot bypass unchanged EA limit',()=>{
 for(const side of ['BUY','SELL']){
  const d=frame(side),tracked=createEntrySetupTracker().update(d),x=evaluateEntrySop(tracked,'2'),m=market(d,x);
  assert.equal(x.standardReady,true);assert.ok(C.createEntryDecision(m));assert.equal(C.entryQuality(m).grade,'C+');
  const event={kind:'ENTRY',id:'GAP',time:Date.now(),symbol:'XAUUSD',side,timeframe:'2',telegramSop:{version:x.version,tf:'2m',solid:true,green:3,gates:x.gates,forecast:x.forecast,power:x.power,hema2:x.hema2,hema3:x.hema3,atrReference:x.atrReference,pullback:x.pullback,eaEntryCompatible:true},telegramQuality:C.entryQuality(m),telegramPlan:m.strategyNormal.plan};
  assert.equal(T.entrySopAllowed(event),true);assert.match(T.telegramMessage(event),/SOLID ENTRY TF2/);
  const later={...d,tp1Hit:true,normal3Close:100+(side==='BUY'?1.2:-1.2)},n=createEntrySetupTracker().update(later),y=evaluateEntrySop(n,'2');assert.equal(y.standardReady,false);
  const lateMarket=market(later,y);assert.equal(C.createEntryDecision(lateMarket),null);
  assert.equal(T.entrySopAllowed({...event,telegramSop:{...event.telegramSop,eaEntryCompatible:false}}),false);
  const forged=structuredClone(m);forged.strategyNormal.sop.hema3.fast=forged.strategyNormal.sop.hema3.slow+(side==='BUY'?.01:-.01);forged.strategyNormal.sop.hema3.gapAtr=999;assert.equal(C.createEntryDecision(forged),null);
 }
});
test('canonical Pine and generated chart use same three-green, width, TP1 and EA compatibility rules',()=>{
 const pine=fs.readFileSync(require.resolve('../ZenCore_TF2_Realtime_Feed.pine'),'utf8');
 assert.match(pine,/greens>=3/);assert.match(pine,/math.abs\(h20-h40\)>a14\*0.10/);assert.match(pine,/math.abs\(f3-s3\)>a14\*0.10/);
 assert.match(pine,/bool targetTouched=false/);assert.match(pine,/c>entry and c<tp1/);assert.match(pine,/eligible and eaEntryWindow/);assert.match(pine,/TF2_3GREEN_TP1_HEMAGAP_V1/);
 const ea=fs.readFileSync(require.resolve('../ea-local-connector/ZenCoreExecutor.mq5'),'utf8');assert.match(ea,/tick.ask>=tp1/);assert.match(ea,/tick.bid<=tp1/);
});
test('directional forecast must exceed 40; neutral still uses strict 50 boundary',()=>{
 for(const side of ['BUY','SELL']){
  for(const power of [40,40.01,49,50,51]){
   const d=frame(side);d.normal3MarketPower=power;
   const x=evaluateEntrySop(createEntrySetupTracker().update(d),'2');assert.equal(x.forecastPass,power>40);
   assert.equal(C.entryConfirmationsPass(market(d,x)),power>40);
   if(power>40)assert.ok(C.createEntryDecision(market(d,x)));
   d.setupMeta.entryRuleVersion=undefined;assert.equal(evaluateEntrySop(createEntrySetupTracker().update(d),'2').forecastPass,power>50);
  }
  for(const power of [49,50,51]){
   const d=frame(side);d.normal3Forecast='NEUTRAL';d.normal3MarketPower=power;
   assert.equal(evaluateEntrySop(createEntrySetupTracker().update(d),'2').forecastPass,side==='BUY'?power>50:power<50);
  }
 }
});

test('TP1 touch permanently expires TF2 setup even after pullback',()=>{
 for(const side of ['BUY','SELL']){
  const d=frame(side),tracker=createEntrySetupTracker();tracker.update(d);
  const hit=tracker.update({...d,tp1Hit:true,slLockStage:1,normal3Close:100+(side==='BUY'?1.1:-1.1)});
  assert.equal(hit.normal3EntryExpired,true);assert.equal(hit.normal3EntryExpiryReason,'TP1_TOUCHED_WAIT_NEW_SOLID');
  const returned=tracker.update(d);assert.equal(returned.normal3EntryExpired,true);
  const x=evaluateEntrySop(returned,'2');assert.equal(x.standardReady,false);assert.equal(x.entryExpiryTarget,'TP1');
  assert.equal(C.createEntryDecision(market(d,x)),null);
 }
});
test('unfilled return policy survives TP2 and chart StepLock exit, rechecks all gates inside TP1',()=>{
 for(const side of ['BUY','SELL']){
  const d=frame(side);d.setupMeta.pendingEntryReturn=true;d.setupMeta.entryExpiryTarget=0;
  const tracker=createEntrySetupTracker();tracker.update(d);const sign=side==='BUY'?1:-1;
  const beyond={...d,tp1Hit:true,tp2Hit:true,slLockStage:2,normal3Close:100+sign*2.2};
  const waiting=tracker.update(beyond);assert.equal(waiting.normal3SetupArmed,true);assert.equal(waiting.normal3EntryExpired,false);
  assert.equal(evaluateEntrySop(waiting,'2').standardReady,false);
  const back={...beyond,normal3Close:100+sign*.5,tradeActive:false,slHit:true,positionExitStage:'CLOSED',positionExitAction:'EXIT_SL'};
  const returned=tracker.update(back),x=evaluateEntrySop(returned,'2');assert.equal(x.standardReady,true);assert.ok(C.createEntryDecision(market(back,x)));
  const thin={...back,hemaConfirmation:{...back.hemaConfirmation,tf3:{fast:100,slow:100}}};
  assert.equal(evaluateEntrySop(tracker.update(thin),'2').standardReady,false);
  const invalid=tracker.update({...back,normal3Close:d.initialSl});assert.equal(invalid.normal3SetupArmed,false);
 }
});
test('fill-anchor specification preserves each TP and SL distance for BUY and SELL',()=>{
 const {levelsAtFill}=require('../live-entry-levels');
 for(const side of ['BUY','SELL']){
  const sign=side==='BUY'?1:-1,plan={side,entry:4000,sl:4000-sign*3,tp1:4000+sign*2,tp2:4000+sign*4,tp3:4000+sign*6};
  const levels=levelsAtFill(plan,4001.37);assert.equal(levels.entry,4001.37);
  for(const key of ['sl','tp1','tp2','tp3'])assert.ok(Math.abs((levels[key]-levels.entry)-(plan[key]-plan.entry))<1e-9);
  assert.equal(plan.entry,4000);
 }
 assert.throws(()=>levelsAtFill({side:'BUY',entry:100,sl:101,tp1:102,tp2:103,tp3:104},100));
});
