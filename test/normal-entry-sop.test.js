const test=require('node:test');
const assert=require('node:assert/strict');
const {normalEntrySop}=require('../normal-entry-sop');
const {signals}=require('../analysis-alert-core');

const base={normal3Side:'SELL',normal3Entry:4261,normal3Close:4260,normal3Atr:2,
  normal3Solid:true,normal3PriceCrossEntry:true,
  normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:true,normal3Sop5:false,
  normal3Forecast:'BEARISH',normal3MarketPower:62};

test('solid SELL needs cross, four of five green and directional forecast',()=>{
  assert.equal(normalEntrySop(base).standardReady,true);
  for(const field of ['normal3Solid','normal3PriceCrossEntry','normal3Sop4']){
    const altered={...base,[field]:false};
    if(field==='normal3Sop4')altered.normal3Sop3=false;
    assert.equal(normalEntrySop(altered).standardReady,false,field);
  }
  assert.equal(normalEntrySop({...base,normal3Forecast:'NEUTRAL',normal3MarketPower:49}).standardReady,true);
  assert.equal(normalEntrySop({...base,normal3Forecast:'NEUTRAL',normal3MarketPower:50}).standardReady,false);
  assert.equal(normalEntrySop({...base,normal3Forecast:'BEARISH',normal3MarketPower:50}).standardReady,false);
  assert.equal(normalEntrySop({...base,normal3PriceCrossEntry:undefined,normal3PricePastEntry:true}).standardReady,false);
});

test('solid BUY forecast accepts bullish or neutral over 50 only',()=>{
  const buy={...base,normal3Side:'BUY',normal3Forecast:'BULLISH',normal3MarketPower:51};
  assert.equal(normalEntrySop(buy).standardReady,true);
  assert.equal(normalEntrySop({...buy,normal3Forecast:'NEUTRAL'}).standardReady,true);
  assert.equal(normalEntrySop({...buy,normal3MarketPower:50}).standardReady,false);
  assert.equal(normalEntrySop({...buy,normal3Forecast:'BEARISH'}).standardReady,false);
});

test('re-entry is a single explicit NORMAL or HIGH event with HEMA gate',()=>{
  for(const side of ['BUY','SELL'])for(const strength of ['NORMAL','HIGH']){
    const re={normal3ReentrySignal:strength,normal3ReentrySide:side,normal3ReentryHemaPass:true,normal3Close:100,normal3Atr:1};
    assert.equal(normalEntrySop(re).reentryReady,true);
    assert.equal(normalEntrySop({...re,normal3ReentryHemaPass:false}).reentryReady,false);
    assert.equal(normalEntrySop({...re,normal3ReentrySignal:'WEAK'}).reentryReady,false);
  }
  assert.equal(normalEntrySop({normal3ReentrySignal:'HIGH',normal3ReentrySide:'SELL',normal3ReentryHemaPass:true}).reentryReady,false);
});

test('READY re-entry uses the same Analysis contract for Telegram events',()=>{
  const now=Date.now();
  const event=signals({symbol:'XAUUSD',receivedAt:now,strategyNormal:{state:'READY',side:'SELL',entryType:'HIGH_REENTRY',
    plan:{entry:100,sl:102,tp1:98,tp2:96,tp3:94}}},now);
  assert.match(event.items[0].message,/RE-ENTRY SELL/);
  assert.equal(event.items[0].kind,'ENTRY');
});
