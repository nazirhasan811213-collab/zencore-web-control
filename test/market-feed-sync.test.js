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
