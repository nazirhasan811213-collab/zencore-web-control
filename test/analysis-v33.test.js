const test=require('node:test'),assert=require('node:assert/strict');
const {PAIRS,forecastGate,analyse,PositionTracker}=require('../analysis-v33');
const {AnalysisAIService,aggregate3m,externalTechnical,scalpScenario,setupVerdict}=require('../analysis-ai-service');
const now=1800000000000;
function context(symbol='XAUUSD',scale=1){return {schema:'33.0',symbol,dataAt:now,setupAt:now-180000,confirmed3:true,confirmed1:true,momentum:'BUY',forecast:'BULLISH',strength:70,dominance:80,hema:'BUY',basisSide:'BUY',candleSide:'BUY',choppy:false,price:100*scale,atr:2*scale,zone:100*scale,tickSize:.01*scale,spread:.05*scale,swingLow:99*scale,swingHigh:101*scale,support:92*scale,resistance:108*scale,trigger1:'BUY',barOpen1:now-60000,high1:100.5*scale,low1:99.5*scale};}
test('forecast direction rules distinguish dominance from strength',()=>{
 assert(forecastGate('BUY','BULLISH',51,10));assert(forecastGate('SELL','BEARISH',51,90));
 assert(forecastGate('SELL','NEUTRAL',90,49));assert(!forecastGate('SELL','NEUTRAL',20,70));
 assert(!forecastGate('BUY','CHOPPY',99,99));assert(!forecastGate('BUY','NEUTRAL',99,50));assert(!forecastGate('BUY','NEUTRAL',99,null));
});
test('all eleven pairs produce ordered tick-aligned BUY/SELL plans',()=>{
 PAIRS.forEach((symbol,i)=>{const c=context(symbol,symbol.endsWith('JPY')?1:symbol==='US30'?400:symbol==='BTCUSD'?600:symbol==='XAUUSD'?20:.01);
 for(const side of ['BUY','SELL']){Object.assign(c,{momentum:side,hema:side,basisSide:side,candleSide:side,trigger1:side,forecast:side==='BUY'?'BULLISH':'BEARISH'});
 const d=analyse(c,now);assert.equal(d.status,'ENTRY_READY',symbol);const p=d.plan,sign=side==='BUY'?1:-1;
 assert((p.entry-p.sl)*sign>0);assert((p.tp1-p.entry)*sign>0);assert((p.tp2-p.tp1)*sign>0);assert((p.tp3-p.tp2)*sign>0);
 for(const k of ['entry','sl','tp1','tp2','tp3'])assert(Math.abs(p[k]/p.tickSize-Math.round(p[k]/p.tickSize))<.00001);
 }});
});
test('missing feed, choppy, stale, future, unconfirmed, no spread all fail closed',()=>{
 for(const change of [{schema:'32.3'},{choppy:true},{dataAt:now-100000},{dataAt:now+60000},{confirmed3:false},{spread:null},{confirmed1:false}])assert.notEqual(analyse({...context(),...change},now).status,'ENTRY_READY');
});
test('extension and nearby resistance block chasing',()=>{
 assert.equal(analyse({...context(),price:102},now).status,'WAIT_PULLBACK');
 assert.equal(analyse({...context(),resistance:100.2},now).plan,null);
});
test('position immutable, deduplicated, entry range ignored and next bar resolves',()=>{
 const t=new PositionTracker(),c=context(),d=analyse(c,now);c.low1=0;c.high1=1000;
 let p=t.update(c,d,now);assert.equal(p.status,'ACTIVE');assert.equal(p.targetStage,0);
 p=t.update({...c,dataAt:now+60000,barOpen1:now,price:101,high1:101,low1:99.5},analyse({...c,price:101},now+60000),now+60000);assert.equal(p.plan.entry,100);
 p=t.update({...c,dataAt:now+120000,barOpen1:now+60000,low1:98,high1:102},d,now+120000);assert.equal(p.status,'CLOSED');
 assert.equal(t.update({...c,dataAt:now+180000},d,now+180000),null);
});
test('15 minute horizon closes research record without sending orders',()=>{
 const t=new PositionTracker(),c=context(),d=analyse(c,now);t.update(c,d,now);
 const p=t.update({...c,dataAt:now+900000,barOpen1:now+840000,price:100.1,low1:99.9,high1:100.2},d,now+900000);
 assert.equal(p.exitReason,'TIME_REVIEW_15M');assert.equal(t.history.length,1);
});
test('3M aggregation rejects missing, duplicate and partial minutes',()=>{
 const rows=[0,60000,120000,180000,240000].map(time=>({time,open:10,high:12,low:9,close:11}));
 const bars=aggregate3m([...rows,rows[0]],300000);assert.equal(bars.length,1);assert.equal(bars[0].time,0);
 assert.equal(aggregate3m(rows.slice(1),300000).length,0);
});
test('external data gaps and age never become current analysis',()=>{
 const bars=Array.from({length:30},(_,i)=>({time:now-(30-i)*180000,close:100+i,open:99+i,high:101+i,low:98+i}));
 assert.equal(externalTechnical(bars,now).status,'AVAILABLE');assert.equal(externalTechnical(bars,now+300000).status,'STALE');
 bars[4].time-=60000;assert.equal(externalTechnical(bars,now).status,'GAPPED_DATA');
});
test('unconfigured integrations do not invent external or GPT analysis',async()=>{
 const s=new AnalysisAIService({env:{},now:()=>now,fetchImpl:()=>{throw Error('must not call');}});
 const r=await s.generate('XAUUSD','test');assert.equal(r.external.status,'NOT_CONFIGURED');assert.equal(r.gpt.status,'NOT_CONFIGURED');assert.equal(r.comparison,'TIDAK CUKUP DATA');
 assert.equal((await s.generate('XAUUSD','test')).code,429);
});
test('external source reports a fresh minute price and completed 3M analysis',async()=>{
 const values=Array.from({length:150},(_,i)=>{
  const t=now-(i+1)*60000;
  return {datetime:new Date(t).toISOString().slice(0,19).replace('T',' '),open:'100',high:'102',low:'99',close:String(100+(149-i)*.01)};
 });
 const s=new AnalysisAIService({env:{TWELVE_DATA_API_KEY:'test'},now:()=>now,
  fetchImpl:async url=>{assert.equal(url.searchParams.get('symbol'),'XAU/USD');return {ok:true,json:async()=>({meta:{interval:'1min'},values})};}});
 const result=await s.external('XAUUSD');
 assert.equal(result.status,'AVAILABLE');assert.equal(result.currentPrice,101.49);
 assert.equal(result.priceAt,now-60000);assert.equal(result.dataAt,now);
 assert.equal(result.timeframe,'3M');
 assert(result.atr3m>0);
});
test('3M scenario is conditional and blocks stale, conflict, chase and adverse prices',()=>{
 const external={status:'AVAILABLE',bias:'BUY',currentPrice:100,priceAt:now-60000,atr3m:2,dataAt:now};
 const sop={symbol:'XAUUSD',dataAt:now,side:'BUY',state:'READY',plan:{entry:100,sl:98}};
 const run=(e=external,s= sop)=>scalpScenario({external:e,liveSop:s,now});
 assert.equal(run().status,'NEAR_ENTRY');
 assert.equal(run().next3m.low,99);assert.equal(run().next15m.high,103);
 assert.equal(run({...external,currentPrice:101}).status,'CHASE');
 assert.equal(run({...external,currentPrice:99}).status,'ADVERSE');
 assert.equal(run({...external,bias:'SELL'}).status,'DIVERGENT');
 assert.equal(run({...external,priceAt:now-180000}).status,'WAIT_DATA');
 assert.equal(run({...external,priceAt:now-30000}).status,'WAIT_DATA');
 assert.equal(run(external,null).status,'NO_SOP');
 assert.equal(run(external,{...sop,state:'WATCH'}).status,'WAIT_SETUP');
});
test('post-signal verdict uses existing grade and plan without claiming win probability',()=>{
 const sop={side:'BUY',state:'READY',score:100,grade:'A',stability:72,readiness:85,
  plan:{entry:100,sl:98,tp1:102.5}};
 const external={atr3m:2},near={status:'NEAR_ENTRY',reason:'near'};
 const solid=setupVerdict(near,sop,external);
 assert.equal(solid.label,'SETUP SOLID · BERSYARAT');assert.equal(solid.profitView,'TP1 DALAM JULAT 15M');
 assert.equal(solid.rrTp1,1.25);
 assert.equal(setupVerdict(near,{...sop,stability:40},external).label,'SETUP PERLU SEMAKAN');
 assert.equal(setupVerdict(near,{...sop,grade:'C'},external).label,'SETUP PERLU SEMAKAN');
 assert.equal(setupVerdict({...near,status:'CHASE',reason:'Harga terkejar'},sop,external).label,'TUNGGU / ELAK');
 assert.equal(setupVerdict(near,{...sop,plan:{...sop.plan,tp1:105}},external).profitView,'TP1 DI LUAR JULAT 15M');
 assert.equal(setupVerdict(near,{...sop,score:null},external).label,'DATA BELUM CUKUP');
});
test('GPT receives verified current SOP and scenario without changing entry decision',async()=>{
 let modelInput;
 const values=Array.from({length:150},(_,i)=>{
  const t=now-(i+1)*60000;
  return {datetime:new Date(t).toISOString().slice(0,19).replace('T',' '),open:'100',high:'102',low:'99',close:String(100+(149-i)*.01)};
 });
 const service=new AnalysisAIService({env:{TWELVE_DATA_API_KEY:'test',OPENAI_API_KEY:'test',ZENCORE_AI_MODEL:'test'},now:()=>now,
  liveSopProvider:async symbol=>({symbol,dataAt:now,sourceBarTime:now-180000,side:'BUY',state:'READY',plan:{entry:101.49,sl:99}}),
  fetchImpl:async (url,opts)=>{
   if(url instanceof URL)return {ok:true,json:async()=>({meta:{interval:'1min'},values})};
   modelInput=JSON.parse(JSON.parse(opts.body).input);
   return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'Senario bersyarat.'}]}]})};
  }});
 const result=await service.generate('XAUUSD','user');
 assert.equal(result.liveSop.state,'READY');assert.equal(result.scenario.status,'NEAR_ENTRY');
 assert.equal(modelInput.liveSop.plan.entry,101.49);assert.equal(modelInput.scenario.status,'NEAR_ENTRY');
 assert.equal(result.comparison,'SELARAS');
});
test('a newly received old source candle cannot authorize a scalp scenario',async()=>{
 const service=new AnalysisAIService({env:{},now:()=>now,
  liveSopProvider:async symbol=>({symbol,dataAt:now,sourceBarTime:now-600000,side:'BUY',state:'READY',plan:{entry:100,sl:98}})});
 service.external=async()=>({status:'AVAILABLE',bias:'BUY',currentPrice:100,priceAt:now-60000,atr3m:2,dataAt:now});
 const result=await service.generate('XAUUSD','user');
 assert.equal(result.liveSop,null);assert.equal(result.scenario.status,'NO_SOP');
 assert.equal(result.comparison,'TIDAK CUKUP DATA');
});
test('GPT does not spend tokens when both analysis feeds lack current data',async()=>{
 const s=new AnalysisAIService({env:{OPENAI_API_KEY:'test',ZENCORE_AI_MODEL:'test'},now:()=>now,
  fetchImpl:async()=>{throw Error('must not call');}});
 assert.equal((await s.generate('XAUUSD','test')).gpt.status,'WAIT_DATA');
});
test('feed authentication, ordering and symbol validation',()=>{
 const s=new AnalysisAIService({env:{ZENCORE_V33_FEED_SECRET:'test-secret-long-enough-for-feed'},now:()=>now});
 assert.equal(s.ingest({context:context()}).code,403);
 const b={token:'test-secret-long-enough-for-feed',context:context()};assert.equal(s.ingest(b).code,200);assert(s.ingest(b).duplicate);
 assert.equal(s.snapshot('XAUUSD').status,'ENTRY_READY');
});
