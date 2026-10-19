const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('events');
const {openAnalysisStream}=require('../analysis-stream');
const frame=(tf,at,side='BUY')=>({symbol:'XAUUSD',timeframe:String(tf),receivedAt:at,signalObservedAt:at,strategyNormal:{tf:tf+'m',side}});
function fixture(fetchMarkets){const req=new EventEmitter(),res=new EventEmitter(),bus=new EventEmitter(),writes=[];res.writeHead=()=>{};res.write=s=>writes.push(s);const stream=openAnalysisStream({req,res,bus,symbol:'XAUUSD',fetchMarkets,now:()=>100000});return {req,res,bus,writes,stream};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('market events push immediately and keep TF2/TF15 independent',async()=>{
 const x=fixture(async()=>[frame(2,99000),frame(15,99000,'SELL')]);try{
 await flush();x.bus.emit('market',frame(2,100000,'SELL'));
 const row=JSON.parse(x.writes.at(-1).split('data: ')[1]);
 assert.equal(row.views[0].market.receivedAt,100000);assert.equal(row.views[0].market.strategyNormal.side,'SELL');
 assert.equal(row.views[1].market.receivedAt,99000);
 }finally{x.stream.close();}assert.equal(x.bus.listenerCount('market'),0);
});
test('event arriving before initial HTTP fetch is never overwritten by its older copy',async()=>{
 let resolve;const x=fixture(()=>new Promise(r=>resolve=r));try{
 await flush();x.bus.emit('market',frame(2,100000,'SELL'));resolve([frame(2,90000),frame(15,99000)]);await flush();
 const row=JSON.parse(x.writes.at(-1).split('data: ')[1]);assert.equal(row.views[0].market.strategyNormal.side,'SELL');assert.equal(row.views[1].status,'LIVE');
 x.bus.emit('market',{...frame(2,100001),signalObservedAt:90000});
 assert.equal(JSON.parse(x.writes.at(-1).split('data: ')[1]).views[0].market.receivedAt,100000);
 }finally{x.stream.close();}
});
test('disconnected clients remove subscriptions and late fetch cannot write to closed stream',async()=>{
 let resolve;const x=fixture(()=>new Promise(r=>resolve=r));await flush();x.req.emit('close');
 resolve([frame(2,100000)]);await flush();x.bus.emit('market',frame(2,100000));assert.equal(x.writes.length,0);assert.equal(x.bus.listenerCount('market'),0);
});
