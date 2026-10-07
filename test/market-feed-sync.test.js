const test=require('node:test');
const assert=require('node:assert/strict');
const {acceptsSnapshot,effectiveReceivedAt}=require('../market-feed-sync');

test('late bar cannot replace latest, but intrabar updates can',()=>{
  const latest={time:1800000000000,barIndex:100,close:2};
  assert.equal(acceptsSnapshot(latest,{time:1799999820000,barIndex:99,close:1}),false);
  assert.equal(acceptsSnapshot(latest,{time:1800000000000,barIndex:100,close:3}),true);
  assert.equal(acceptsSnapshot(latest,{time:1800000180000,barIndex:101,close:4}),true);
  assert.equal(acceptsSnapshot({barIndex:101},{barIndex:100}),false);
});

test('old source candle cannot become fresh by arriving late',()=>{
  const now=Date.now();
  assert.equal(effectiveReceivedAt({time:now-600000,receivedAt:now,timeframe:'3'}),now-420000);
  assert.equal(effectiveReceivedAt({time:now-60000,receivedAt:now,timeframe:'3'}),now);
  assert.equal(effectiveReceivedAt({time:42,receivedAt:now,timeframe:'3'}),now);
});

test('current realtime TF2 outranks legacy main chart on the same candle in either delivery order',()=>{
 const {acceptsFeedSource}=require('../market-feed-sync');
 const chart={time:1800000000000,timeframe:'2',barIndex:100,feedType:'LIVE',normalSopVersion:'TF2_REQUIRED'};
 const live={...chart,feedType:'MULTI_PAIR_BATCH',feedVersion:'TF2_REALTIME_V1',hemaConfirmation:{version:'HEMA23_LIVE_V1'},entryEvent:true,signalObservedAt:1800000000100};
 assert.equal(acceptsFeedSource(chart,live),true);
 assert.equal(acceptsFeedSource(live,chart),false);
 assert.equal(acceptsFeedSource(live,{...live,signalObservedAt:1800000000000}),false);
 assert.equal(acceptsFeedSource(live,{...live,signalObservedAt:1800000000200,entryEvent:false}),true);
 assert.equal(acceptsFeedSource(chart,{...live,hemaConfirmation:{version:'HEMA23_V1'}}),false);
 assert.equal(acceptsFeedSource(live,{...live,time:chart.time-120000}),false);
 assert.equal(acceptsFeedSource(live,{...live,time:chart.time+120000}),true);
});
test('compact ingress retains live feed version used by source priority guard',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const code=fs.readFileSync(require.resolve('../server-v17'),'utf8'),start=code.indexOf('function expandCompactMarket('),end=code.indexOf('function storeSnapshot(',start),ctx={};
 vm.runInNewContext(code.slice(start,end),ctx);
 const row=Array(67).fill(null);row[0]='XAUUSD';row[65]={version:'HEMA23_LIVE_V1'};row[66]={entryEvent:true,setupAt:1800000000000};
 const d=ctx.expandCompactMarket(row,{feedVersion:'TF2_REALTIME_V1',schemaVersion:'32.3-EXIT-STEPLOCK',timeframe:'2',emittedAt:1800000000100});
 assert.equal(d.feedVersion,'TF2_REALTIME_V1');assert.equal(d.hemaConfirmation.version,'HEMA23_LIVE_V1');assert.equal(d.entryEvent,true);
});

test('legacy next-bar snapshots cannot displace TF2 or block its next execution event',()=>{
 const {acceptsFeedSource}=require('../market-feed-sync');
 const live={time:1800000000000,timeframe:'2',barIndex:100,feedVersion:'TF2_REALTIME_V1',hemaConfirmation:{version:'HEMA23_LIVE_V1'},entryEvent:false,signalObservedAt:1800000119000};
 const legacy={time:live.time+120000,timeframe:'2',barIndex:101,feedType:'LIVE',normalSopVersion:'TF2_REQUIRED'};
 assert.equal(acceptsFeedSource(live,legacy),false);
 assert.equal(acceptsFeedSource(live,{...legacy,time:live.time+240000}),false);
 assert.equal(acceptsFeedSource(live,{...live,entryEvent:true,signalObservedAt:1800000119500}),true);
 assert.equal(acceptsFeedSource(live,{...live,time:legacy.time,barIndex:101,entryEvent:true,signalObservedAt:1800000120100}),true);
 assert.equal(acceptsFeedSource(live,{...live,time:live.time-120000,signalObservedAt:1800000120100}),false);
});
