'use strict';
const test=require('node:test'),a=require('node:assert/strict'),F=require('../signal-desk/fusion');
const now=Date.now(),packet={mode:'ZENCORE_READONLY',pine:{symbol:'XAUUSD',timeframe:'2',signalObservedAt:now,receivedAt:now,close:100,strategyNormal:{side:'BUY',state:'READY',plan:{entry:100,sl:99,tp1:101,tp2:102,tp3:103}}},history:{symbol:'XAUUSD',timeframe:'2',candles:[]}};
test('authenticated partial feed displays actual price/plan without manufacturing technical approval',()=>{
 const data=F.normalize(packet,{originVerified:true}),r=F.analyze(data,now,30);
 a.equal(r.reference.price,100);a.equal(r.reference.plan.entry,100);a.equal(r.reference.plan.sl,99);a.equal(r.warmup,0);a.equal(r.rsi,null);a.equal(r.reference.support,null);a.equal(r.reference.resistance,null);a.equal(r.aligned,false);a.equal(r.liveSignal,false);a.equal(r.orderExecution,false);a.ok(r.rows.every(x=>x.status==='WAIT'));a.match(r.title,/Tunggu candle/);
});
test('manual files cannot claim trusted empty history; stale partial feeds remain stale',()=>{
 a.throws(()=>F.normalize(packet),/candle/);a.throws(()=>F.normalize({...packet,mode:'MANUAL'},{originVerified:true}),/candle/);
 const r=F.analyze(F.normalize(packet,{originVerified:true}),now+61000,30);a.equal(r.fresh,false);a.match(r.title,/Data lama/);
});
