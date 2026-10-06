const test=require('node:test'),assert=require('node:assert/strict');
const {fresh,quote,createTape,sparkline}=require('../dashboard-live-core');
const now=1800000000000;
const view=(tf,at,price)=>({timeframe:tf,status:'LIVE',market:{receivedAt:at,signalObservedAt:at,price}});
test('fresh receipt cannot disguise old Pine data; invalid, future and stale data are not live',()=>{
 assert.equal(fresh(view(2,now,4000),now),true);
 for(const v of [view(2,now-30001,4000),view(2,now+5001,4000),{...view(2,now,4000),market:{receivedAt:now,signalObservedAt:now-60000,price:4000}},view(2,0,4000)])assert.equal(fresh(v,now),false);
 assert.equal(quote([view(2,now,null)],now),null);
});
test('newest actual observed quote wins independently of entry direction and timeframe',()=>{
 assert.equal(quote([view(2,now-1000,4000),view(15,now,3999)],now).timeframe,15);
 assert.equal(quote([view(15,now,3999),view(2,now,4000)],now).timeframe,2);
 assert.equal(quote([view(2,now-60000,4000)],now),null);
});
test('only new observations append points; repeated polling or older reconnect frames never create motion',()=>{
 const t=createTape();assert.equal(t.push(view(2,now,4000)).delta,null);
 assert.equal(t.push(view(2,now,4000)),null);assert.equal(t.push(view(15,now-1000,4005)),null);
 assert.equal(t.push(view(2,now+1000,4001)).delta,1);
 assert.equal(t.push(view(2,now+2000,4000.5)).delta,-.5);
 assert.equal(t.push(view(2,now+3000,4000.5)).delta,0);
 for(let i=4;i<80;i++)t.push(view(2,now+i*1000,4000+i));assert.equal(t.points().length,60);
});
test('trace uses actual sample times and prices; insufficient data never draws a fabricated chart',()=>{
 assert.equal(sparkline([]),'');assert.equal(sparkline([{price:4000,at:now}]),'');
 assert.equal(sparkline([{price:4000,at:now},{price:4000,at:now+1000}]),'M12.00,75.00 L608.00,75.00');
 const s=sparkline([{price:4000,at:now},{price:4001,at:now+1000},{price:4000,at:now+3000}]);assert.match(s,/L210.67,12.00/);assert.doesNotMatch(s,/NaN|Infinity/);
});
