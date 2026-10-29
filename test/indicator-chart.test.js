const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../indicator-chart-core'),{ChartHistory}=require('../indicator-chart-history');
const now=Date.now(),bar=Math.floor(now/120000)*120000;
const frame=(tf='2',time=bar)=>({symbol:'XAUUSD',timeframe:tf,sourceBarTime:time,signalObservedAt:now,
 open:4100,high:4103,low:4098,close:4102,hema20:4101,hema40:4100,strategyNormal:{solid:true,side:'BUY',sop:{triggerAt:time+1},plan:{entry:4102,sl:4099,tp1:4105,tp2:4108,tp3:4111}}});
test('chart projection uses actual OHLC/HEMA without altering the trading object or inventing missing candles',()=>{
 const m=frame(),original=structuredClone(m),p=Core.point(m);assert.equal(p.open,4100);assert.equal(p.hema20,4101);assert.equal(p.solid,'BUY');assert.deepEqual(m,original);
 for(const edit of [{open:null},{open:'4100'},{high:4000},{low:4200},{close:NaN},{symbol:'EURUSD'},{timeframe:'3'}])assert.equal(Core.point({...m,...edit}),null);
 assert.equal(Core.point({...m,sourceBarTime:bar+120000}).solid,null,'held SOLID is not redrawn on every candle');
});
test('separate TF histories deduplicate intrabar updates and reject stale updates without fabricating gaps',()=>{
 const h=new ChartHistory();h.observe(frame(),now);h.observe({...frame(),close:4101,signalObservedAt:now-1},now);
 h.observe(frame('15'),now);let s=h.snapshot('2',now);assert.equal(s.candles.length,1);assert.equal(s.candles[0].close,4102);
 h.observe({...frame(),close:4103,signalObservedAt:now+1},now);assert.equal(h.snapshot('2',now).candles[0].close,4103);
 h.observe(frame('2',bar-360000),now);assert.equal(h.snapshot('2',now).candles.length,2,'missing intermediate bars stay missing');
 assert.equal(h.snapshot('15',now).candles.length,1);assert.deepEqual(h.snapshot('2',now+Core.MAX_AGE+120000).candles,[]);
 assert.deepEqual(new ChartHistory().snapshot('2',now).candles,[],'restart starts empty');
 s.candles[0].close=1;assert.notEqual(h.snapshot('15',now).candles[0].close,1,'returned points are detached');
});
test('retention, response size and timeframe isolation are bounded',()=>{
 const p=Core.point(frame()),input=Array.from({length:500},(_,i)=>({...p,time:now-i*1000}));
 const merged=Core.merge(input,[{...p,time:now+6000},{...p,time:now-Core.MAX_AGE-1},{...p,timeframe:'15'}],'2',now);
 assert.equal(merged.length,Core.MAX_BARS);assert(merged.every(p=>p.timeframe==='2'&&p.time<=now&&p.time>=now-Core.MAX_AGE));
});

test('confirmed close survives newer intrabar snapshot and persists across history restart',async()=>{
 const records=new Map();let writes=0;const pool={query:async(sql,args=[])=>{
  if(sql.startsWith('SELECT data'))return{rows:[...records.values()].map(data=>({data}))};
  if(sql.startsWith('INSERT INTO')){writes++;for(const x of JSON.parse(args[0]))records.set(x.tf+'|'+x.bar_time,x.data);}return{rows:[]};
 }};
 const h=new ChartHistory();await h.init(pool,now);try{
  const closed={...frame('2',bar-120000),confirmed:true,signalObservedAt:bar,atr:2,waveTrend1:3,waveTrend2:1};h.observe(closed,now);h.observe({...closed,confirmed:false,signalObservedAt:bar+1000,close:4101},now);
  assert.equal(h.snapshot('2',now).candles.at(-1).confirmed,true);assert.equal(h.snapshot('2',now).candles.at(-1).close,4102);await h.flush(now);assert.equal(writes,1);
  const restored=new ChartHistory();await restored.init(pool,now);try{assert.equal(restored.snapshot('2',now).candles.length,1);assert.equal(restored.snapshot('2',now).candles[0].atr,2);}finally{clearInterval(restored.timer);}
 }finally{clearInterval(h.timer);}
});
