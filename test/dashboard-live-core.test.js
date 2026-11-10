const test=require('node:test'),assert=require('node:assert/strict');
const {fresh,quote,createTape,sparkline}=require('../dashboard-live-core');
const now=1800000000000;
const view=(tf,at,price)=>({timeframe:tf,status:'LIVE',market:{receivedAt:at,signalObservedAt:at,price}});
test('fresh receipt cannot disguise old Pine data; invalid, future and stale data are not live',()=>{
 assert.equal(fresh(view(2,now,4000),now),true);
 for(const v of [view(2,now-60001,4000),view(2,now+5001,4000),{...view(2,now,4000),market:{receivedAt:now,signalObservedAt:now-60001,price:4000}},view(2,0,4000)])assert.equal(fresh(v,now),false);
 assert.equal(quote([view(2,now,null)],now),null);
});
test('newest actual observed quote wins independently of entry direction and timeframe',()=>{
 assert.equal(quote([view(2,now-1000,4000),view(15,now,3999)],now).timeframe,15);
 assert.equal(quote([view(15,now,3999),view(2,now,4000)],now).timeframe,2);
 assert.equal(quote([view(2,now-60001,4000)],now),null);
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


test('dashboard and AI display use TF2 60s freshness without changing TF15',()=>{
 assert.equal(fresh(view(2,now-45000,4000),now),true);
 assert.equal(fresh(view(2,now-60000,4000),now),true);
 assert.equal(fresh(view(15,now-45000,4000),now),false);
});

test('dashboard account summary requires a fresh MT5 snapshot and never invents missing profit',()=>{
 const {accountOverview}=require('../dashboard-live-core');
 const a={pod:{accountMask:'****1234',serverMask:'****Demo',lastSeenAt:now},connection:{online:true},positions:[{strategyMode:'TF2_SCALPING',volume:.01,profitUsd:2},{strategyMode:'TF15_INTRA',volume:.02,profitUsd:-1}]};
 let v=accountOverview(a,now);assert.equal(v.account,'****1234');assert.equal(v.count,2);assert.equal(v.tf2,1);assert.equal(v.tf15,1);assert.equal(v.floating,1);assert.equal(v.lot,.03);
 v=accountOverview({...a,positions:[]},now);assert.equal(v.count,0);assert.equal(v.floating,0);
 for(const changed of [{...a,pod:{...a.pod,lastSeenAt:now-16000}},{...a,connection:{online:false}},{...a,positions:undefined},null]){v=accountOverview(changed,now);assert.equal(v.count,null);assert.equal(v.floating,null);}
 v=accountOverview({...a,positions:[{volume:.01}]},now);assert.equal(v.count,1);assert.equal(v.floating,null);
});

 test('Telegram-style Pine analysis uses actual fields and clears stale or missing readings',()=>{
 const now=Date.now(),view={status:'LIVE',timeframe:2,market:{receivedAt:now,signalObservedAt:now,open:100,close:102,hemaFast:101,hemaSlow:100,rsi:58,momentum:'BUY perlahan',strategyNormal:{side:'BUY',solid:true,sop:{forecast:'BULLISH',marketPower:65}}}};
 const {pineAnalysis}=require('../dashboard-live-core');
 assert.deepEqual(pineAnalysis(view,now),['SOLID BUY aktif • Candle bullish • HEMA hijau','RSI 58.0 • Momentum BUY perlahan','Forecast BULLISH • Skor 65/100']);
 assert.deepEqual(pineAnalysis(view,now+61000),['Menunggu data Pine segar.']);
 delete view.market.rsi;delete view.market.momentum;
 assert.equal(pineAnalysis(view,now)[1],'RSI — • Momentum —');
 });
