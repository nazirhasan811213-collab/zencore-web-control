'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRealtimeDispatcher}=require('../realtime-dispatcher');
const {evaluateEntrySop}=require('../normal-entry-sop');
function ready(tf='2'){
 const ribbon={fast:102,slow:101};
 const d={timeframe:tf,normal3Side:'BUY',normal3Entry:100,normal3Close:100.1,normal3Atr:1,normal3Solid:true,
  normal3PricePastEntry:true,normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:true,
  normal3Forecast:'NEUTRAL',normal3MarketPower:51,normal5Position:'ABOVE',hemaConfirmation:{version:tf==='15'?'HEMA1530_V1':'HEMA23_LIVE_V1',['tf'+tf]:ribbon,['tf'+(tf==='15'?'30':'3')]:ribbon}};
 const x=evaluateEntrySop(d,tf);return {symbol:'XAUUSD',timeframe:tf,receivedAt:Date.now(),price:100.1,
 strategyNormal:{state:'READY',side:'BUY',solid:true,tf:tf+'m',entrySopVersion:x.version,
 sop:{gates:x.gates,sopGreen:x.green,forecast:x.forecast,marketPower:x.power,...Object.fromEntries(Object.entries(x).filter(([k])=>k.startsWith('hema')))},plan:{entry:100,sl:99,tp1:101,tp2:102,tp3:103}}};
}
test('intrabar event starts dispatch immediately without HTTP reread or candle-close timer',async()=>{
 const m=ready(),seen=[];let fetched=0;
 const d=createRealtimeDispatcher({dispatch:async batch=>seen.push(batch),fetchMarkets:async()=>{fetched++;return [];}});
 const p=d.onMarket(m);assert.equal(seen.length,1);assert.equal(seen[0][0],m);await p;assert.equal(fetched,0);
});
test('latest WAIT revokes a pending entry while another dispatch is busy; both TFs stay separate',async()=>{
 let release,active=0,max=0;const seen=[],wait=new Promise(r=>release=r);
 const d=createRealtimeDispatcher({dispatch:async batch=>{active++;max=Math.max(max,active);seen.push(batch);if(seen.length===1)await wait;active--;},fetchMarkets:async()=>[]});
 const first=d.onMarket(ready());d.onMarket(ready('15'));d.onMarket({...ready('15'),strategyNormal:{state:'WATCH'}});
 release();await first;assert.equal(max,1);assert.equal(seen.length,2);assert.equal(seen[1][0].timeframe,'15');assert.equal(seen[1][0].strategyNormal.state,'WATCH');
});
test('events arriving during fallback fetch supersede its stale result',async()=>{
 let release;const wait=new Promise(r=>release=r),seen=[];
 const d=createRealtimeDispatcher({dispatch:async batch=>seen.push(batch),fetchMarkets:async()=>{await wait;return [{symbol:'OLD'}];}});
 const first=d.tick();d.onMarket(ready());release();await first;assert.equal(seen[0][0].symbol,'XAUUSD');
});
test('sequential TF2 pending entry is revoked when a later feed no longer confirms it',async()=>{
 let release;const wait=new Promise(r=>release=r),seen=[];
 const d=createRealtimeDispatcher({dispatch:async batch=>{seen.push(batch);if(seen.length===1)await wait;},fetchMarkets:async()=>[]});
 const first=d.onMarket(ready('15'));
 const m=ready();m.strategyNormal.entrySopVersion='NORMAL_20261001_TF2_SEQ_V3';
 d.onMarket(m);d.onMarket({...m,strategyNormal:{...m.strategyNormal,state:'WATCH',plan:null}});
 release();await first;
 assert.equal(seen[1][0].strategyNormal.state,'WATCH');
});
test('HEMA mode requires both ribbons to match BUY or SELL; equality/missing/opposite reject, slopes/confirmation not required',()=>{
 for(const tf of ['2','15'])for(const side of ['BUY','SELL']){
  const m=ready(tf),higher=tf==='15'?'30':'3',r=side==='BUY'?{fast:102,slow:101,previousFast:110,previousSlow:109}:{fast:98,slow:99,previousFast:90,previousSlow:91};
  const d={timeframe:tf,normal3Side:side,normal3Entry:100,normal3Close:100.1,normal3Atr:1,normal3Solid:true,normal3PricePastEntry:true,
   normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:true,normal3Forecast:side==='BUY'?'BULLISH':'BEARISH',normal3MarketPower:60,
   normal5Position:side==='BUY'?'ABOVE':'BELOW',hemaConfirmation:{version:tf==='15'?'HEMA1530_V1':'HEMA23_LIVE_V1',['tf'+tf]:r,['tf'+higher]:{...r,confirmed:false}}};
  assert.equal(evaluateEntrySop(d,tf).standardReady,true);
  for(const key of ['tf'+tf,'tf'+higher])for(const bad of [undefined,{fast:100,slow:100},{fast:r.slow,slow:r.fast}])
   assert.equal(evaluateEntrySop({...d,hemaConfirmation:{...d.hemaConfirmation,[key]:bad}},tf).standardReady,false);
 }
});
test('obsolete closed TF3 and TF45 confirmation feeds cannot authorize the new live SOP',()=>{
 const ribbon={fast:102,slow:101};
 const d={timeframe:'2',normal3Side:'BUY',normal3Entry:100,normal3Close:100.1,normal3Atr:1,normal3Solid:true,normal3PricePastEntry:true,
 normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:true,normal3Forecast:'BULLISH',normal3MarketPower:60,normal5Position:'ABOVE',
 hemaConfirmation:{version:'HEMA23_V1',tf2:ribbon,tf3:ribbon}};
 assert.equal(evaluateEntrySop(d,'2').standardReady,false);
 const {decodeTf15Market}=require('../tf15-feed');const row=Array(67).fill(null);row[65]={version:'HEMA1545_V1',tf15:ribbon,tf45:ribbon};row[66]={version:'TF15_ENTRY_EVENT_V1'};
 assert.equal(decodeTf15Market(row,{feedVersion:'TF15_REALTIME_V1',timeframe:'15'}),null);
});

test('direction changes invalidate an in-flight entry before order creation',async()=>{
 let release;const gate=new Promise(r=>release=r);let allowed;
 const d=createRealtimeDispatcher({dispatch:async(batch,isCurrent)=>{if(allowed===undefined){await gate;allowed=isCurrent(batch[0]);}},fetchMarkets:async()=>[]});
 const m=ready(),p=d.onMarket(m);
 d.onMarket({...m,receivedAt:m.receivedAt+1,strategyNormal:{state:'WATCH',side:'SELL'}});
 release();await p;assert.equal(allowed,false);
});
test('older delivery cannot roll direction back',async()=>{
 const seen=[],d=createRealtimeDispatcher({dispatch:async batch=>seen.push(batch),fetchMarkets:async()=>[]});
 const m={...ready(),signalObservedAt:200};await d.onMarket(m);
 await d.onMarket({...m,signalObservedAt:100,strategyNormal:{state:'READY',side:'SELL'}});
 assert.equal(seen.length,1);assert.equal(d.getLatestMarket('XAUUSD','2').strategyNormal.side,'BUY');
});
