const test=require('node:test');
const assert=require('node:assert/strict');
const {analyse}=require('../gold-copilot-core');
const now=100000;
function view(tf=2,side='BUY'){
 const buy=side==='BUY';
 return {timeframe:tf,status:'LIVE',entryReady:true,market:{receivedAt:now,signalObservedAt:now,price:2001,strategyNormal:{state:'READY',solid:true,side,sop:{gates:[{label:'SOP',pass:true}],forecast:buy?'BULLISH':'BEARISH',marketPower:70,['hema'+tf]:{mode:side},['hema'+(tf===2?3:30)]:{mode:side},hemaShape:{pass:true,state:'TREND'}},plan:buy?{entry:2000,sl:1990,tp1:2010,tp2:2020,tp3:2030}:{entry:2002,sl:2010,tp1:1990,tp2:1980,tp3:1970}}}};
}
test('TF2 and TF15 evaluate their own direction and HEMA confirmations',()=>{
 const a=view(2,'SELL'),b=view(15);b.market.strategyNormal.sop.hema30.mode='SELL';b.entryReady=false;
 assert.equal(analyse([a,b],2,now).status,'QUALIFIED');
 assert.equal(analyse([a,b],15,now).status,'WAIT_CONFIRMATION');
 assert.equal(analyse([a,b],2,now).forecast.horizonMinutes,20);
 assert.equal(analyse([a,b],15,now).forecast.horizonMinutes,150);
});
test('fresh receipt and another timeframe cannot revive an old setup',()=>{
 const a=view(),b=view(15);a.market.signalObservedAt=now-31000;
 assert.equal(analyse([a,b],2,now).status,'WAIT_DATA');
 assert.equal(analyse([],2,now).status,'WAIT_DATA');
});
test('newest quote prevents chasing TP1 and detects SL invalidation',()=>{
 const a=view(),b=view(15);b.market.signalObservedAt=now+1;b.market.price=2011;
 assert.equal(analyse([a,b],2,now).status,'WAIT_RANGE');
 b.market.price=1989;assert.equal(analyse([a,b],2,now).status,'INVALIDATED');
 a.market.strategyNormal.side='SELL';a.market.strategyNormal.plan={entry:2002,sl:2010,tp1:1990,tp2:1980,tp3:1970};b.market.price=2010;
 assert.equal(analyse([a,b],2,now).status,'INVALIDATED');
});
test('missing or reversed levels never produce actionable targets',()=>{
 const a=view();delete a.market.strategyNormal.plan.sl;
 assert.equal(analyse([a],2,now).levels,null);
 assert.notEqual(analyse([a],2,now).status,'QUALIFIED');
 a.market.strategyNormal.plan.sl=2020;assert.equal(analyse([a],2,now).levels,null);
});
test('HEMA shape or an individual failing SOP blocks qualification',()=>{
 const a=view();a.market.strategyNormal.sop.hemaShape.pass=false;
 assert.equal(analyse([a],2,now).status,'WAIT_CONFIRMATION');
 a.market.strategyNormal.sop.hemaShape.pass=true;a.market.strategyNormal.sop.gates[0].pass=false;
 assert.match(analyse([a],2,now).reason,/SOP/);
 assert.equal(analyse([a],2,now).status,'WAIT_CONFIRMATION');
});
test('entry and TP1 boundaries and invalid prices do not qualify',()=>{
 const a=view();for(const price of [2000,2010,NaN,0,-1]){a.market.price=price;assert.notEqual(analyse([a],2,now).status,'QUALIFIED');}
});
