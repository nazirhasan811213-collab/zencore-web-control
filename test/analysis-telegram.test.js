const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {AnalysisAlerts}=require('../analysis-alert-service');
const {messageQuality,telegramMessage,qualityGrade}=require('../analysis-telegram');
const market=(t=Date.now())=>({symbol:'US30',receivedAt:t,strategyNormal:{state:'READY',side:'BUY',plan:{entry:51522.4,sl:51503.139,tp1:51541.661,tp2:51560.922,tp3:51580.183000000005}},positionManagement:{action:'HOLD'}});
test('Telegram entry remains once per pair/direction/position without changing popup transitions or filtering ordinary entries',async()=>{
 const s=new AnalysisAlerts();await s.init();const m=market();let n=0;
 const frame=async edit=>s.record({...m,receivedAt:m.receivedAt+n++,...edit});
 try{
  await frame({});
  await frame({strategyNormal:{...m.strategyNormal,plan:{...m.strategyNormal.plan,sl:51503.336}}});
  await frame({strategyNormal:{state:'WAIT'}});
  s.states=new Map(JSON.parse(JSON.stringify([...s.states])));
  await frame({});
  let events=(await s.feed('0')).events;
  assert.equal(events.length,3,'original popup events are unchanged');
  assert.equal(events.filter(e=>e.kind==='ENTRY'&&!e.telegramDuplicate).length,1);
  assert.equal(events[0].telegramQuality.high,false,'ordinary READY entry still allowed');
  await frame({positionManagement:{action:'CLOSE_50_NOW'}});
  await frame({strategyNormal:{state:'WAIT'}});await frame({});
  assert.equal((await s.feed('0')).events.filter(e=>e.kind==='ENTRY'&&!e.telegramDuplicate).length,1,'partial exit does not rearm');
  await frame({positionManagement:{action:'EXIT_ALL'}});
  await frame({strategyNormal:{...m.strategyNormal,plan:{...m.strategyNormal.plan,sl:51503.337}}});
  assert.equal((await s.feed('0')).events.filter(e=>e.kind==='ENTRY'&&!e.telegramDuplicate).length,1,'stale READY after close is not a new entry');
  await frame({strategyNormal:{state:'WAIT'}});await frame({});
  assert.equal((await s.feed('0')).events.filter(e=>e.kind==='ENTRY'&&!e.telegramDuplicate).length,2,'new position after close is allowed immediately');
  await frame({strategyNormal:{...m.strategyNormal,side:'SELL'}});
  await frame({symbol:'XAUUSD'});
  assert.equal((await s.feed('0')).events.filter(e=>e.kind==='ENTRY'&&!e.telegramDuplicate).length,4,'direction and pair are independent');
 }finally{clearInterval(s.cleanupTimer);}
});
test('Telegram quality labels match existing displayed Analysis quality, not a new strategy',()=>{
 const src=fs.readFileSync(require.resolve('../precision-entry.js'),'utf8');
 const rr=src.slice(src.indexOf('function rrFromPlan('),src.indexOf('function gateMarkup('));
 const quality=src.slice(src.indexOf('function qualityLayer('),src.indexOf('function qualityMarkup('));
 const context={};vm.runInNewContext("const num=v=>Number.isFinite(+v)?+v:null;const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));"+rr+quality+';this.existing=qualityLayer;',context);
 for(let i=0;i<100;i++){
  const m=market();Object.assign(m,{predictionConfidence:i,stability:i,confluence:i%6,setupProbability:i,sidewaysGuard:i%3===0});
  Object.assign(m.strategyNormal,{side:i%2?'BUY':'SELL',sop:{marketPower:i%7===0?null:i,forecast:['BULLISH','BEARISH','NEUTRAL'][i%3],sopGreen:i%6,gates:Array.from({length:5},(_,j)=>({pass:j<i%6}))}});
  const q=context.existing(m),actual=messageQuality(m);
  assert.equal(qualityGrade(actual.score),q.grade);assert.equal(actual.score,q.score);assert.equal(actual.high,q.aPlusExecution);
 }
});
test('message shows current Analysis quality grade without historical win rate',()=>{
 const m=market();const event={kind:'ENTRY',symbol:m.symbol,side:'BUY',time:Date.UTC(2026,8,25,11,12),id:'45',telegramPlan:m.strategyNormal.plan,telegramQuality:{score:85,high:true}};
 const text=telegramMessage(event);
 assert.match(text,/TP3: 51,580.183/);assert.doesNotMatch(text,/000000000005|Win rate|validasi selesai/);
 assert.match(text,/A\+ PROFIT QUALITY/);assert.match(text,/Gred: A • Quality: 85\/100/);
 assert.match(text,/POTENSI TINGGI/);assert.match(text,/19:12 MYT/);
 const low=telegramMessage({...event,telegramQuality:{score:25,high:false}});
 assert.match(low,/Gred: C • Quality: 25\/100/);assert.match(low,/LOW QUALITY/);
 assert.doesNotMatch(low,/POTENSI TINGGI/);
});
