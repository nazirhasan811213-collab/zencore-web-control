'use strict';
const test=require('node:test'),a=require('node:assert/strict'),G=require('../telegram-trade-guide'),{AnalysisAlerts}=require('../analysis-alert-service'),{telegramMessage}=require('../analysis-telegram');
const start=Date.UTC(2026,9,27,2,0),market=(tf,t=start)=>({symbol:'XAUUSD',timeframe:tf,signalObservedAt:t,price:101,hema20:100,hema40:99,waveTrend1:4,waveTrend2:1,atr:2,chopIndex:40});
test('MYT half-hour/hour schedules are independent, run once, and never modify market/trade state',async()=>{
 let at=start;const output=[],markets=[market('2'),market('15')],before=JSON.stringify(markets);
 const scheduler=G.createScheduler({now:()=>at,getMarkets:async()=>markets,history:()=>[],record:async e=>output.push(e)});
 await scheduler.tick();await scheduler.tick();a.deepEqual(output.map(e=>e.timeframe),['2','15']);a.match(output[0].guideText,/10:00–10:30 MYT/);a.match(output[1].guideText,/10:00–11:00 MYT/);
 at+=30*60000;await scheduler.tick();a.deepEqual(output.map(e=>e.timeframe),['2','15','2']);
 at+=30*60000;await scheduler.tick();a.deepEqual(output.map(e=>e.timeframe),['2','15','2','2','15']);a.equal(JSON.stringify(markets),before);
});
test('missed windows do not replay old reports, failed persistence retries, overlapping ticks serialize',async()=>{
 let at=start+3*60000,calls=0,release;const promise=new Promise(r=>release=r);
 const s=G.createScheduler({now:()=>at,getMarkets:async()=>{await promise;return [];},history:()=>[],record:async()=>++calls>1});
 await s.tick();a.equal(calls,0);
 at=start+30*60000;const pending=s.tick();await s.tick();release();await pending;a.equal(calls,1);await s.tick();a.equal(calls,2);await s.tick();a.equal(calls,2);
});
test('stale and invalid data never generate a directional guide or a made-up profit probability',()=>{
 for(const tf of ['2','15'])for(const m of [null,{...market(tf),signalObservedAt:start-61000},{...market(tf),signalObservedAt:start+6000},{...market(tf),atr:0}]){
  const e=G.buildGuide(tf,m,[],start);a.equal(e.guideFresh,false);a.match(e.guideText,/DATA BELUM CUKUP/);a.doesNotMatch(e.guideText,/Harga cenderung/);
 }
 const text=telegramMessage(G.buildGuide('2',market('2'),[],start));a.match(text,/PANDUAN ZENCORE/);a.match(text,/% profit belum disahkan/);a.match(text,/AKHIR MESEJ • TF2/);a.doesNotMatch(text,/CLOSE ALL|SOLID ENTRY|\d+%/);
});
test('closed candle evidence and current indicators explain dangerous whipsaw; limited history is disclosed',()=>{
 const candles=Array.from({length:6},(_,i)=>({time:start-(i+1)*2*60000,timeframe:'2',open:100,close:i%2?99.9:100.1,high:101,low:99}));
 const m={...market('2'),hema20:100.05,hema40:100,waveTrend1:0,waveTrend2:1,chopIndex:65};
 const e=G.buildGuide('2',m,candles,start);a.match(e.guideText,/MARKET BAHAYA/);a.match(e.guideText,/Candle kerap bertukar arah/);a.match(e.guideText,/Jangan tambah posisi atau longgarkan SL/);
 a.match(G.buildGuide('15',market('15'),[],start).guideText,/SEJARAH DATA MASIH TERHAD/);
});
test('durable guide slot is claimed once across restart, with Telegram recipients preserving existing opt-ins',async()=>{
 const keys=new Set(),events=[],sqls=[];
 const query=async(sql,args=[])=>{sqls.push(sql);
  if(sql.startsWith('INSERT INTO zencore_notification_keys')){if(keys.has(args[0]))return{rows:[]};keys.add(args[0]);return{rows:[{}]};}
  if(sql.startsWith('INSERT INTO zencore_analysis_alerts')){events.push(args[0]);return{rows:[{id:events.length}]};}
  return{rows:[]};};
 const pool={connect:async()=>({query,release(){}})},one=new AnalysisAlerts({pool}),two=new AnalysisAlerts({pool});one.ready=two.ready=true;
 const e=G.buildGuide('2',market('2'),[],start);await one.recordGuide(e);await two.recordGuide(e);await two.recordGuide(G.buildGuide('15',market('15'),[],start));
 a.equal(events.length,2);a.ok(sqls.some(s=>s.includes("p.data->>'telegramEnabled'='true'")&&s.includes("p.data->>'verified'='true'")&&s.includes('access_expires_at>NOW()')));
});
test('guide events are Telegram-only and never appear as trade popup events',async()=>{
 const alerts=new AnalysisAlerts();await alerts.init();try{await alerts.recordGuide(G.buildGuide('2',market('2'),[],start));const result=await alerts.feed('0');a.equal(result.events.length,0);a.equal(result.cursor,'1');}finally{clearInterval(alerts.cleanupTimer);}
});
test('delivery uses guide wording and shared-chat dedup; expired guides are skipped',async()=>{
 const at=Date.now(),events=[G.buildGuide('2',market('2',at),[],at),G.buildGuide('2',market('2',at),[],at),{...G.buildGuide('15',null,[],at),guideValidUntil:at-1}],sent=[],statuses=[],claims=new Set();
 let batch=events.map((_,i)=>({id:i+1,event_id:i+1,user_id:'user-'+i}));
 const pool={query:async(sql,args=[])=>{
  if(sql.startsWith("UPDATE zencore_telegram_deliveries SET status='sending'")){const rows=batch;batch=[];return{rows};}
  if(sql.startsWith('SELECT status,role'))return{rows:[{status:'active',role:'admin'}]};
  if(sql.startsWith('SELECT data FROM zencore_analysis_alerts'))return{rows:[{data:events[args[0]-1]}]};
  if(sql.startsWith('INSERT INTO zencore_telegram_chat_claims'))return{rows:[{}]};
  if(sql.startsWith('INSERT INTO zencore_telegram_signal_claims')){const key=args.join('|');if(claims.has(key))return{rows:[]};claims.add(key);return{rows:[{}]};}
  if(sql.startsWith('UPDATE zencore_telegram_deliveries SET status=$2')){statuses.push(args[1]);return{rows:[]};}
  throw Error(sql);
 }};
 const s=new AnalysisAlerts({pool});s.get=async()=>({telegramEnabled:true,verified:true,telegramId:'shared-chat'});s.telegram=async(_,text)=>sent.push(text);
 await s.deliver();a.equal(sent.length,1);a.match(sent[0],/PANDUAN 30 MINIT/);a.doesNotMatch(sent[0],/CLOSE ALL/);a.deepEqual(statuses,['sent','skipped','skipped']);
});
