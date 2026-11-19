'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const {assess}=require('../setup-strength');
const now=1800000000000;
function market(side='BUY',tf='1') {const d=side==='BUY'?1:-1;return {symbol:'XAUUSD',timeframe:tf,signalObservedAt:now,receivedAt:now,hema20:100+d,hema40:100,ema9:100+2*d,ema20:100+d,ema50:100,waveTrend1:10*d,waveTrend2:0,rsi:50+8*d,chopIndex:40,relativeVolume:1.2,atr:2,open:100,high:102,low:98,close:100+d,strategyNormal:{side,solid:true,plan:{entry:100,sl:100-4*d,tp1:100+1.5*d,tp2:100+2.5*d,tp3:100+3.5*d},sop:{atrReference:2,mtfScore:3*d,forecast:d===1?'BULLISH':'BEARISH',marketPower:75}}};}
test('TF1 and TF15 use symmetric directional scores and monotonic target support without mutations',()=>{for(const tf of ['1','15']){const buy=market('BUY',tf),copy=structuredClone(buy),b=assess(buy,now),s=assess(market('SELL',tf),now);a.equal(b.status,'AVAILABLE');a.equal(b.overall,s.overall);a.equal(b.coverage,100);a.ok(b.targets.tp1>=b.targets.tp2&&b.targets.tp2>=b.targets.tp3);a.ok(b.targets.tp1<=b.overall);a.ok(b.range.high<=buy.strategyNormal.plan.tp3);a.deepEqual(buy,copy);a.equal(b.range.high-100,100-s.range.low);}});
test('opposing MTF and chop cannot produce high Strength',()=>{for(const key of ['mtf','chop']){const m=market();if(key==='forecast')m.strategyNormal.sop.forecast='BEARISH';if(key==='mtf')m.strategyNormal.sop.mtfScore=-3;if(key==='chop')m.chopIndex=65;const r=assess(m,now);a.ok(r.overall<=55);a.ok(r.warnings.length>=2);}});
test('missing, stale, future, absent SOLID and invalid plans never manufacture percentages',()=>{for(const change of [m=>delete m.rsi,m=>m.signalObservedAt=now-60001,m=>m.signalObservedAt=now+5001,m=>m.strategyNormal.solid=false,m=>m.strategyNormal.plan.sl=104]){const m=market();change(m);const r=assess(m,now);a.notEqual(r.status,'AVAILABLE');a.equal(r.overall,null);a.equal(r.range,null);}});
test('record and Telegram use the frozen assessment rather than newer readings',()=>{const {applyEvent}=require('../current-signal-records'),{telegramMessage}=require('../analysis-telegram'),m=market(),snapshot=assess(m,now),e={kind:'ENTRY',symbol:'XAUUSD',timeframe:'1',side:'BUY',time:now,id:'STRENGTH',setupKey:'x',telegramPlan:m.strategyNormal.plan,setupAssessment:snapshot,telegramSop:{solid:true,green:5,gates:Array.from({length:6},()=>({pass:true}))}};const rows=new Map(),[r]=applyEvent(rows,e);a.equal(r.setupAssessment.overall,snapshot.overall);snapshot.overall=1;a.notEqual(r.setupAssessment.overall,1);e.setupAssessment=r.setupAssessment;const text=telegramMessage(e);a.ok(text.includes('Overall Setup Strength '+r.setupAssessment.overall+'%'));a.match(text,/bukan % win/);a.doesNotMatch(text,/Strength —/);});
test('future candle structure cannot alter an earlier snapshot',()=>{const m=market(),before=assess(m,now),after=assess(m,now,[{time:now+120000,confirmed:true,observedAt:now+240000,timeframe:'1',open:100,high:101,low:99,close:100}]);a.deepEqual(before,after);});
test('historical evaluation excludes old scores and keeps timeframe bands separate',()=>{const {evaluate}=require('../setup-strength'),s=assess(market(),now);const r=evaluate([{timeframe:'1',state:'CLOSED',setupAssessment:s,hitTp1:true},{timeframe:'15',state:'OPEN',setupAssessment:s},{timeframe:'1',score:90,hitTp1:true}]);a.equal(r.groups.length,2);a.equal(r.groups.find(x=>x.timeframe==='1').sample,1);a.equal(r.groups.find(x=>x.timeframe==='15').tp1Observed,0);a.equal(r.groups.find(x=>x.timeframe==='15').open,1);});
test('invalid indicator ranges yield no score',()=>{for(const [key,value] of [['rsi',101],['chopIndex',-1],['relativeVolume',-1],['high',98]]){const m=market();m[key]=value;a.equal(assess(m,now).overall,null);}});
test('all real Pine forecast states, including CHOPPY, produce a technical score',()=>{const fs=require('node:fs');for(const tf of ['1','15'])for(const f of ['BULLISH','BEARISH','NEUTRAL','CHOPPY']){a.ok(fs.readFileSync(tf==='1'?'ZenCore_TF2_SOP_V7.pine':'ZenCore_TF15_SOP_V7.pine','utf8').includes(f));const m=market('BUY',tf);m.strategyNormal.sop.forecast=f;const r=assess(m,now);a.equal(r.status,'AVAILABLE',tf+' '+f);if(f==='CHOPPY'){a.equal(r.overall,assess(market('BUY',tf),now).overall);a.ok(!r.groups.some(g=>g.name==='Forecast'));a.match(r.warnings.join(' '),/berulang-alik/);}}});
test('unavailable assessment explains its cause and requires source timestamp',()=>{const missing=market();delete missing.rsi;a.match(assess(missing,now).reason,/rsi/);const inactive=market();inactive.strategyNormal.solid=false;a.match(assess(inactive,now).reason,/SOLID belum aktif/);const noSource=market();delete noSource.signalObservedAt;a.equal(assess(noSource,now).status,'STALE');});

test('forecast and power cannot inflate a technical score, and RR is derived from the plan',()=>{
 const m=market(),before=assess(m,now);
 m.strategyNormal.sop.forecast='BEARISH';m.strategyNormal.sop.marketPower=100;
 const after=assess(m,now);
 a.equal(after.overall,before.overall);
 a.ok(after.warnings.some(w=>w.includes('melawan arah')));
 a.deepEqual(after.geometry.rewardToRisk,{tp1:0.38,tp2:0.63,tp3:0.88});
});
test('BTC analysis uses BTC structure and excludes other pairs and candles received after the signal',()=>{
 const m=market();m.symbol='BTCUSD';m.atr=10;m.strategyNormal.sop.atrReference=10;
 const candles=[9,10,8].map((high,i)=>({symbol:'BTCUSD',time:now-(3-i)*120000,observedAt:now-(2-i)*120000,timeframe:'1',confirmed:true,open:101,close:102,low:98,high:100+high}));
 const out=assess(m,now,candles);a.equal(out.geometry.directionalObstacle,110);
 a.equal(assess(m,now,candles.map(c=>({...c,symbol:'XAUUSD'}))).geometry.directionalObstacle,null);
 a.equal(assess(m,now+1000,candles.map(c=>({...c,observedAt:now+1}))).geometry.directionalObstacle,null);
});

test('TF1 staged exit shows realised reward and the runner split for BTC BUY and SELL',()=>{
 for(const side of ['BUY','SELL']){
  const m=market(side),sign=side==='BUY'?1:-1,entry=64000;m.symbol='BTCUSD';
  m.strategyNormal.plan={entry,sl:entry-300*sign,tp1:entry+150*sign,tp2:entry+250*sign,tp3:entry+400*sign};
  a.deepEqual(assess(m,now).geometry.stagedExit,{
   realisedAtTp1R:0.25,realisedAtTp2R:0.46,totalIfRunnerStopsAtTp1R:0.58
  });
 }
 a.equal(assess(market('BUY','15'),now).geometry.stagedExit,undefined);
});
test('confirmed Pine MTF context is used by analysis when quality entry is enabled',()=>{
 const m=market();
 m.setupMeta={entryQuality:{confirmedMtf:-3}};
 a.equal(assess(m,now).overall,55);
});

test('TF1 market analysis is available before a trade plan and SOLID qualify',()=>{
 const m=market(),original=structuredClone(m);
 m.strategyNormal.plan=null;m.strategyNormal.solid=false;
 const expected=assess(original,now);
 const reading=assess(m,now,[],{marketOnly:true});
 a.equal(reading.status,'AVAILABLE');
 a.equal(reading.overall,expected.overall);
 a.equal(reading.scope,'MARKET');
 a.equal(reading.targets,null);
 a.equal(reading.geometry,undefined);
 a.equal(reading.range,null);
 a.equal(m.strategyNormal.plan,null);
 a.equal(assess(m,now).overall,null);
 const {dualAnalysis}=require('../analysis-dual-model');
 m.strategyNormal.tf='1m';
 const view=dualAnalysis([m],'XAUUSD',now).views[0];
 a.equal(view.marketAssessment.status,'AVAILABLE');
 a.equal(view.assessment.status,'INCOMPLETE');
 a.equal(view.market.strategyNormal.plan,null);
});

test('market readings retain source freshness and indicator validation',()=>{
 for(const change of [m=>m.signalObservedAt=now-60001,m=>m.signalObservedAt=now+5001,m=>delete m.rsi,m=>m.rsi=110]){
  const m=market();m.strategyNormal.plan=null;change(m);
  a.equal(assess(m,now,[],{marketOnly:true}).overall,null);
 }
});
