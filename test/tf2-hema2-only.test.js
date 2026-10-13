'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateEntrySop}=require('../normal-entry-sop');
const C=require('../analysis-execution-contract'),T=require('../analysis-telegram');
test('BUY and SELL can authorize with opposite, flat or missing HEMA3; HEMA2 and forecast remain mandatory',()=>{
 for(const side of ['BUY','SELL'])for(const higher of [undefined,{fast:100,slow:100},side==='BUY'?{fast:98,slow:99}:{fast:102,slow:101}]){
  const sign=side==='BUY'?1:-1,at=Date.now();
  const d={timeframe:'2',normal3Side:side,normal3Solid:true,normal3SetupArmed:true,normal3SetupPolicy:'SEQUENTIAL_ATR40_V1',
   pullback:{pass:true,required:false},normal3Entry:100,normal3Close:100+sign*.2,normal3Atr:1,tp1:100+sign,
   normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:false,normal3Sop5:false,
   normal3Forecast:side==='BUY'?'BULLISH':'BEARISH',normal3MarketPower:41,
   setupMeta:{entryRuleVersion:'TF2_3GREEN_TP1_HEMAGAP_V1'},
   hemaConfirmation:{version:'HEMA23_LIVE_V1',tf2:{fast:100+sign,slow:100},tf3:higher}};
  const x=evaluateEntrySop(d,'2');assert.equal(x.standardReady,true);assert.equal(x.gates.length,6);assert.ok(!x.gates.some(g=>g.key==='hema3'));
  const market={symbol:'XAUUSD',timeframe:'2',receivedAt:at,signalObservedAt:at,entryAuthorizedAt:at,feedChannel:'EXECUTION',entryEvent:true,
   feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',price:d.normal3Close,chopIndex:40,
   strategyNormal:{state:'READY',side,tf:'2m',solid:true,entrySopVersion:x.version,
    plan:{entry:100,sl:100-sign,tp1:100+sign,tp2:100+sign*2,tp3:100+sign*3},
    sop:{gates:x.gates,sopGreen:x.green,forecast:x.forecast,marketPower:x.power,hema2:x.hema2,hema3:x.hema3,atrReference:1,pullback:x.pullback}}};
  const decision=C.createEntryDecision(market);assert.ok(decision);assert.deepEqual(decision.snapshot.confirmationEvidence.hemaRequiredTimeframes,['2']);
  const e={kind:'ENTRY',id:1,time:at,timeframe:'2',symbol:'XAUUSD',side,telegramQuality:C.entryQuality(market),telegramPlan:market.strategyNormal.plan,
   telegramSop:{version:x.version,tf:'2m',solid:true,green:3,gates:x.gates,forecast:x.forecast,power:x.power,hema2:x.hema2,hema3:x.hema3,atrReference:1,pullback:x.pullback}};
  assert.equal(T.entrySopAllowed(e),true);assert.doesNotMatch(T.telegramMessage(e),/HEMA TF3/);assert.match(T.telegramMessage(e),/HEMA TF2:/);
  const thin={...d,hemaConfirmation:{...d.hemaConfirmation,tf2:{fast:100+sign*.01,slow:100}}};assert.equal(evaluateEntrySop(thin,'2').standardReady,false);
  assert.equal(evaluateEntrySop({...d,normal3Forecast:side==='BUY'?'BEARISH':'BULLISH'},'2').standardReady,false);
  const stale={...market,signalObservedAt:at-31000,entryAuthorizedAt:at-31000};assert.equal(C.createEntryDecision(stale),null);
  assert.equal(C.createEntryDecision({...market,feedChannel:'DASHBOARD'}),null);
 }
});
