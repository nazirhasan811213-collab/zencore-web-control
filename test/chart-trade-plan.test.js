const test=require('node:test');
const assert=require('node:assert/strict');
const {chartTradePlan}=require('../chart-trade-plan');

test('BUY Fibonacci plan preserves the exact Pine chart levels',()=>{
  const entry=2500,sl=2490;
  const snapshot={entry,initialSl:sl,tp1:sl+10*1.618,tp2:sl+10*2.618,tp3:sl+10*4.236,tpMode:'Fibonacci',close:2502,atr:8};
  const plan=chartTradePlan(snapshot,'BUY');
  assert.deepEqual([plan.entry,plan.sl,plan.tp1,plan.tp2,plan.tp3],
    [entry,sl,snapshot.tp1,snapshot.tp2,snapshot.tp3]);
  assert.equal(plan.tpMode,'Fibonacci');
  assert.ok(Math.abs(plan.rr1-0.618)<1e-9);
});

test('SELL chart Fixed R:R plan stays independent of current close and ATR',()=>{
  const snapshot={entry:1.2,initialSl:1.21,tp1:1.19,tp2:1.18,tp3:1.17,tpMode:'Fixed R:R',close:1.195,atr:.006};
  const plan=chartTradePlan(snapshot,'SELL');
  assert.equal(plan.entry,1.2);assert.equal(plan.sl,1.21);assert.equal(plan.tp3,1.17);
  assert.equal(plan.tpMode,'Fixed R:R');
});

test('missing or inverted Pine levels cannot authorize an entry plan',()=>{
  const valid={entry:100,initialSl:98,tp1:101,tp2:102,tp3:103};
  assert.equal(chartTradePlan({...valid,tp2:null},'BUY'),null);
  assert.equal(chartTradePlan({...valid,initialSl:101},'BUY'),null);
  assert.equal(chartTradePlan({...valid,tp1:99},'BUY'),null);
  assert.equal(chartTradePlan(valid,'WAIT'),null);
});
