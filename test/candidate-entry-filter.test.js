const test=require('node:test'),assert=require('node:assert/strict');const {evaluate}=require('../candidate-entry-filter');
const buy={timeframe:'2',side:'BUY',price:100.2,entry:100,atr:1,forecast:'BULLISH',power:65,hemaOwn:{fast:102,slow:101,previousFast:101,previousSlow:100}};
test('research filter keeps direction/slope/extension current without waiting another candle',()=>{
 assert.equal(evaluate(buy).pass,true);
 for(const edit of [{forecast:'NEUTRAL'},{power:64.9},{price:100.36},{price:100},{atr:0},{timeframe:'15'},{power:101},{hemaOwn:{...buy.hemaOwn,fast:100.9}},{hemaOwn:{...buy.hemaOwn,previousSlow:101}}])assert.equal(evaluate({...buy,...edit}).pass,false);
 assert.equal(evaluate({...buy,side:'SELL',price:99.8,forecast:'BEARISH',hemaOwn:{fast:98,slow:99,previousFast:99,previousSlow:100}}).pass,true);
});
