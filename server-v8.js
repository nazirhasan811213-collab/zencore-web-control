const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 8080;
const DATABASE_URL = process.env.DATABASE_URL || '';

let latest = null;
let history = [];
let journal = [];
let alertTape = [];
let performanceTrades = [];
let webhookPosts = 0;
let recoveredPosts = 0;
let lastWebhookError = null;
const sseClients = new Set();

const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
}) : null;

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache'
  });
  res.end(body);
}

function serveFile(res, filename, type) {
  try { return send(res, 200, fs.readFileSync(path.join(__dirname, filename)), type); }
  catch (_) { return send(res, 404, JSON.stringify({ok:false,error:'Asset not found'})); }
}

function serveIndexV8(res){
  try{
    let html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
    if(!html.includes('/performance-v8.js')) html=html.replace('</body>','<script src="/performance-v8.js"></script>\n</body>');
    html=html.replace(/<title>[^<]*<\/title>/i,'<title>ZenCore V8 — Pro Analysis + Performance Terminal</title>');
    return send(res,200,html,'text/html; charset=utf-8');
  }catch(_){return send(res,404,JSON.stringify({ok:false,error:'Index not found'}))}
}

function readBody(req, limit = 60000) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => { if (body.length < limit) body += chunk; });
    req.on('end', () => resolve(body));
  });
}
function safeJson(body){ try{return JSON.parse(body||'{}')}catch(_){return null} }
function num(v){ const x=Number(v); return Number.isFinite(x)?x:null; }
function upper(v){ return String(v||'').toUpperCase(); }

function broadcastEvent(name,data){
  const packet=`${name&&name!=='message'?`event: ${name}\n`:''}data: ${JSON.stringify(data)}\n\n`;
  for(const client of sseClients){ try{client.write(packet)}catch(_){sseClients.delete(client)} }
}

function grade(d){
  const p=num(d?.setupProbability)||0, s=num(d?.confluenceStars)||0;
  if(p>=85&&s>=4)return'A+';
  if(p>=75&&s>=4)return'A';
  if(p>=65&&s>=3)return'B';
  if(p>=55)return'C';
  return'D';
}
function sessionName(ts){
  const h=new Date(ts||Date.now()).getUTCHours();
  if(h>=12&&h<16)return'LONDON + NEW YORK';
  if(h>=7&&h<12)return'LONDON';
  if(h>=16&&h<21)return'NEW YORK';
  if(h<7)return'ASIA';
  return'OFF-PEAK';
}
function regimeOf(d){
  const chop=num(d?.chopIndex), structure=upper(d?.marketStructure), hema=upper(d?.hemaTrend);
  if(chop!=null&&chop>=62)return'RANGE / CHOP';
  if(chop!=null&&chop<=38){
    if((/UPTREND|BULL/.test(structure)&&/BULL/.test(hema))||(/DOWNTREND|BEAR/.test(structure)&&/BEAR/.test(hema)))return'TREND KUAT';
    return'TREND / MOMENTUM';
  }
  if(/SIDEWAY|FLAT|CHOP/.test(structure))return'RANGE / TRANSITION';
  return'TRANSITION';
}
function actionDir(v){
  const a=upper(v);
  if(a==='BUY'||a.includes('LONG'))return'BUY';
  if(a==='SELL'||a.includes('SHORT'))return'SELL';
  return'WAIT';
}
function stabilityAtSignal(symbol,timeframe,dir){
  const arr=history.filter(b=>(!symbol||b.symbol===symbol)&&(!timeframe||String(b.timeframe)===String(timeframe))).slice(0,24).reverse();
  const ds=arr.map(b=>actionDir(b.action)).filter(x=>x!=='WAIT');
  if(!ds.length)return 35;
  let flips=0; for(let i=1;i<ds.length;i++)if(ds[i]!==ds[i-1])flips++;
  const opposite=ds.filter(x=>x!==dir).length;
  const share=opposite/ds.length;
  let run=0; for(let i=ds.length-1;i>=0;i--){if(ds[i]===dir)run++;else break}
  let score=100-flips*17-share*45+Math.min(run*3,15);
  if(ds.length<5)score-=12;
  return Math.max(0,Math.min(100,Math.round(score)));
}
function signalKey(d){
  return `${d.symbol||''}|${d.time||d.receivedAt||Date.now()}|${upper(d.action)}`;
}
function makeTrade(d){
  const side=upper(d.action), st=stabilityAtSignal(d.symbol,d.timeframe,side);
  return {
    id:`SIG-${d.symbol||'NA'}-${d.time||d.receivedAt||Date.now()}-${side}`,
    signalKey:signalKey(d), symbol:d.symbol||null, timeframe:String(d.timeframe||''), side,
    signalTime:num(d.time)||null, receivedAt:num(d.receivedAt)||Date.now(),
    entry:num(d.entry), sl:num(d.sl), tp1:num(d.tp1), tp2:num(d.tp2), tp3:num(d.tp3),
    probability:num(d.setupProbability), confluence:num(d.confluenceStars), grade:grade(d),
    session:sessionName(num(d.time)||num(d.receivedAt)||Date.now()), regime:regimeOf(d),
    stabilityScore:st, status:'OPEN', tp1Hit:false,tp2Hit:false,tp3Hit:false,slHit:false,
    firstOutcome:null, firstOutcomeAt:null, maxR:0, benchmarkR:null, closedAt:null,
    lastPrice:num(d.close), feedType:d.feedType||'LIVE'
  };
}

function tradePublic(t){ return {...t}; }
function getOpenTrade(d,sideHint=null){
  const symbol=d?.symbol||null, tf=String(d?.timeframe||'');
  return performanceTrades.find(t=>t.status==='OPEN'&&(!symbol||t.symbol===symbol)&&(!tf||String(t.timeframe)===tf)&&(!sideHint||t.side===sideHint))||null;
}
function applyOutcome(t, kind, at=Date.now()){
  if(!t)return false;
  let changed=false;
  if(kind==='TP1'&&!t.tp1Hit){t.tp1Hit=true;t.maxR=Math.max(t.maxR||0,1);changed=true}
  if(kind==='TP2'&&!t.tp2Hit){t.tp2Hit=true;t.maxR=Math.max(t.maxR||0,2);changed=true}
  if(kind==='TP3'&&!t.tp3Hit){t.tp3Hit=true;t.maxR=Math.max(t.maxR||0,3);changed=true}
  if(kind==='SL'&&!t.slHit){t.slHit=true;changed=true}
  if(!t.firstOutcome&&(kind==='TP1'||kind==='SL')){
    t.firstOutcome=kind; t.firstOutcomeAt=at; t.benchmarkR=kind==='TP1'?1:-1; changed=true;
  }
  if(kind==='TP3'||kind==='SL'){
    t.status='CLOSED'; t.closedAt=at; changed=true;
  }
  return changed;
}

function updateTradeFromSnapshot(d){
  const activeSide=d.tradeIsBuy===true?'BUY':d.tradeIsBuy===false?'SELL':null;
  let t=getOpenTrade(d,activeSide)||getOpenTrade(d);
  if(!t)return;
  t.lastPrice=num(d.close);
  let changed=false;
  if(d.tp1Hit===true) changed=applyOutcome(t,'TP1',Date.now())||changed;
  if(d.tp2Hit===true) changed=applyOutcome(t,'TP2',Date.now())||changed;
  if(d.tp3Hit===true) changed=applyOutcome(t,'TP3',Date.now())||changed;
  if(d.slHit===true) changed=applyOutcome(t,'SL',Date.now())||changed;
  if(changed) persistTrade(t);
}

function parseAlertOutcome(message){
  const s=String(message||'');
  let kind=null;
  if(/TARGET PROFIT 3 HIT/i.test(s))kind='TP3';
  else if(/TARGET PROFIT 2 HIT/i.test(s))kind='TP2';
  else if(/TARGET PROFIT 1 HIT/i.test(s))kind='TP1';
  else if(/STOPLOSS HIT|STOP LOSS HIT/i.test(s))kind='SL';
  if(!kind)return null;
  const side=/Long/i.test(s)?'BUY':/Short/i.test(s)?'SELL':null;
  return{kind,side};
}
function updateTradeFromAlert(message){
  const evt=parseAlertOutcome(message); if(!evt)return;
  const t=performanceTrades.find(x=>x.status==='OPEN'&&(!evt.side||x.side===evt.side));
  if(!t)return;
  if(applyOutcome(t,evt.kind,Date.now())){ persistTrade(t); broadcastPerformance(); }
}

function addAlert(message){
  const item={time:Date.now(),message:String(message||'').slice(0,1600)};
  alertTape.push(item); alertTape=alertTape.slice(-200);
  broadcastEvent('alert',item);
  updateTradeFromAlert(item.message);
  console.log(`[Pine Alert] ${item.message.slice(0,240)}`);
  return item;
}

function saveFeed(data,feedType='LIVE'){
  latest={...data,feedType,receivedAt:Date.now()};
  history.unshift(latest); history=history.slice(0,1500);
  const action=upper(latest.action);
  if(action==='BUY'||action==='SELL'){
    const key=signalKey(latest);
    if(!journal.some(x=>x._journalKey===key)){
      journal.push({...latest,_journalKey:key}); journal=journal.slice(-500);
    }
    if(!performanceTrades.some(t=>t.signalKey===key)){
      const t=makeTrade(latest); performanceTrades.unshift(t); performanceTrades=performanceTrades.slice(0,1000);
      persistTrade(t);
    }
  }
  updateTradeFromSnapshot(latest);
  persistSnapshot(latest);
  broadcastEvent('message',latest);
  broadcastPerformance();
}

function decodeJsonString(v){
  if(v==null)return null;
  try{return JSON.parse(`"${v}"`)}catch(_){return String(v).replace(/\\"/g,'"').replace(/\\n/g,' ').replace(/\\r/g,' ')}
}
function extractString(body,key){
  const re=new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const m=body.match(re); return m?decodeJsonString(m[1]):null;
}
function extractNumber(body,key){
  const re=new RegExp(`"${key}"\\s*:\\s*(-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)`);
  const m=body.match(re); return m?num(m[1]):null;
}
function extractBool(body,key){
  const re=new RegExp(`"${key}"\\s*:\\s*(true|false)`,'i');
  const m=body.match(re); return m?m[1].toLowerCase()==='true':null;
}
function recoverZenCore(body){
  if(!body||!body.includes('ZenCore AI Dashboard Pro + Alerts'))return null;
  const out={source:'ZenCore AI Dashboard Pro + Alerts'};
  const stringKeys=['schemaVersion','symbol','tickerid','timeframe','tradeMode','action','barStatus','marketStructure','momentum','demand','hemaTrend','dxyStatus','sdClearance','whaleState','riskState','mtfOverall','forecast3Bars','powerText','proTip'];
  const numberKeys=['time','barIndex','open','high','low','close','volume','ema9','ema20','ema50','hemaFast','hemaSlow','rsi','waveTrend1','waveTrend2','chopIndex','relativeVolume','globalTrend','setupProbability','confluenceStars','atr','bullObTop','bullObBottom','bearObTop','bearObBottom','entry','sl','tp1','tp2','tp3','mtf1','mtf2','mtf3','mtfTotal','marketPower'];
  const boolKeys=['confirmed','exactEntry','tradeActive','tradeIsBuy','tp1Hit','tp2Hit','tp3Hit','slHit','sop1','sop2','sop3','sop4','sop5'];
  for(const k of stringKeys){const v=extractString(body,k);if(v!=null)out[k]=v}
  for(const k of numberKeys){const v=extractNumber(body,k);if(v!=null)out[k]=v}
  for(const k of boolKeys){const v=extractBool(body,k);if(v!=null)out[k]=v}
  if(!out.symbol&&!out.tickerid)return null;
  if(out.close==null&&!out.action)return null;
  return out;
}

function benchmarkMetrics(trades){
  const all=trades||[];
  const resolved=all.filter(t=>t.firstOutcome==='TP1'||t.firstOutcome==='SL');
  const wins=resolved.filter(t=>t.firstOutcome==='TP1').length;
  const losses=resolved.filter(t=>t.firstOutcome==='SL').length;
  const winRate=resolved.length?wins/resolved.length*100:null;
  const expectancy=resolved.length?resolved.reduce((s,t)=>s+(num(t.benchmarkR)||0),0)/resolved.length:null;
  const profitFactor=losses?wins/losses:(wins?Infinity:null);
  const tp1=all.filter(t=>t.tp1Hit).length,tp2=all.filter(t=>t.tp2Hit).length,tp3=all.filter(t=>t.tp3Hit).length;
  const avgMaxR=all.length?all.reduce((s,t)=>s+(num(t.maxR)||0),0)/all.length:null;
  let eq=0,peak=0,maxDD=0;
  for(const t of [...resolved].sort((a,b)=>(a.firstOutcomeAt||a.receivedAt)-(b.firstOutcomeAt||b.receivedAt))){
    eq+=num(t.benchmarkR)||0; peak=Math.max(peak,eq); maxDD=Math.max(maxDD,peak-eq);
  }
  return{
    total:all.length,resolved:resolved.length,open:all.filter(t=>t.status==='OPEN').length,
    wins,losses,winRate,expectancy,profitFactor:Number.isFinite(profitFactor)?profitFactor:null,
    profitFactorInfinite:profitFactor===Infinity,
    tp1Rate:all.length?tp1/all.length*100:null,tp2Rate:all.length?tp2/all.length*100:null,tp3Rate:all.length?tp3/all.length*100:null,
    avgMaxR,maxDrawdownR:maxDD
  };
}
function groupMetrics(trades,keyFn){
  const map=new Map();
  for(const t of trades){const k=keyFn(t)||'LAIN-LAIN';if(!map.has(k))map.set(k,[]);map.get(k).push(t)}
  return [...map.entries()].map(([key,arr])=>({key,...benchmarkMetrics(arr)})).sort((a,b)=>b.total-a.total);
}
function performancePayload(){
  const trades=performanceTrades.slice();
  const status=webhookStatus();
  return{
    ok:true,method:'TP1-vs-SL benchmark',note:'Win = TP1 dicapai sebelum SL. Loss = SL berlaku sebelum TP1. Ini prestasi signal, bukan P/L sebenar MT5.',
    summary:benchmarkMetrics(trades),
    byGrade:groupMetrics(trades,t=>t.grade),
    bySide:groupMetrics(trades,t=>t.side),
    bySession:groupMetrics(trades,t=>t.session),
    byRegime:groupMetrics(trades,t=>t.regime),
    byStability:groupMetrics(trades,t=>t.stabilityScore>=75?'STABIL 75+':t.stabilityScore>=55?'SEDERHANA 55-74':'RENDAH <55'),
    dataQuality:{webhookPosts:status.webhookPosts,recoveredPosts:status.recoveredPosts,nativePosts:Math.max(0,status.webhookPosts-status.recoveredPosts),nativeRate:status.webhookPosts?Math.max(0,(status.webhookPosts-status.recoveredPosts)/status.webhookPosts*100):null,database:pool?'CONNECTED':'MEMORY ONLY'},
    recent:trades.slice(0,40).map(tradePublic)
  };
}
function broadcastPerformance(){ broadcastEvent('performance',performancePayload()); }

function webhookStatus(){
  return{
    ok:true,status:latest?'DATA_RECEIVED':'WAITING_FOR_TRADINGVIEW',webhookPosts,recoveredPosts,lastWebhookError,
    connectedDashboards:sseClients.size,historyCount:history.length,journalCount:journal.length,performanceTrades:performanceTrades.length,
    alertCount:alertTape.length,lastReceivedAt:latest?latest.receivedAt:null,lastSymbol:latest?latest.symbol||null:null,
    lastTimeframe:latest?latest.timeframe||null:null,lastAction:latest?latest.action||null:null,feedType:latest?latest.feedType||null:null,
    database:pool?'CONNECTED':'DISCONNECTED'
  };
}

async function initDb(){
  if(!pool){console.log('[DB] DATABASE_URL not set; performance runs in memory only');return}
  try{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS zencore_snapshots(
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT,
        timeframe TEXT,
        bar_time BIGINT,
        received_at BIGINT NOT NULL,
        feed_type TEXT,
        payload JSONB NOT NULL,
        UNIQUE(symbol,timeframe,bar_time)
      );
      CREATE TABLE IF NOT EXISTS zencore_trades(
        id TEXT PRIMARY KEY,
        signal_key TEXT UNIQUE NOT NULL,
        symbol TEXT,
        timeframe TEXT,
        side TEXT,
        signal_time BIGINT,
        received_at BIGINT,
        entry DOUBLE PRECISION,
        sl DOUBLE PRECISION,
        tp1 DOUBLE PRECISION,
        tp2 DOUBLE PRECISION,
        tp3 DOUBLE PRECISION,
        probability DOUBLE PRECISION,
        confluence DOUBLE PRECISION,
        grade TEXT,
        session TEXT,
        regime TEXT,
        stability_score DOUBLE PRECISION,
        status TEXT,
        tp1_hit BOOLEAN DEFAULT FALSE,
        tp2_hit BOOLEAN DEFAULT FALSE,
        tp3_hit BOOLEAN DEFAULT FALSE,
        sl_hit BOOLEAN DEFAULT FALSE,
        first_outcome TEXT,
        first_outcome_at BIGINT,
        max_r DOUBLE PRECISION DEFAULT 0,
        benchmark_r DOUBLE PRECISION,
        closed_at BIGINT,
        last_price DOUBLE PRECISION,
        feed_type TEXT,
        updated_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS zencore_trades_signal_time_idx ON zencore_trades(signal_time DESC);
      CREATE INDEX IF NOT EXISTS zencore_snapshots_bar_time_idx ON zencore_snapshots(bar_time DESC);
    `);
    const sr=await pool.query(`SELECT payload,feed_type,received_at FROM zencore_snapshots ORDER BY bar_time DESC NULLS LAST,received_at DESC LIMIT 1000`);
    history=sr.rows.map(r=>({...r.payload,feedType:r.feed_type||r.payload.feedType||'DB',receivedAt:Number(r.received_at)||Date.now()}));
    latest=history[0]||null;
    journal=history.filter(x=>['BUY','SELL'].includes(upper(x.action))).slice(0,500).reverse();
    const tr=await pool.query(`SELECT * FROM zencore_trades ORDER BY signal_time DESC NULLS LAST,received_at DESC LIMIT 1000`);
    performanceTrades=tr.rows.map(r=>({
      id:r.id,signalKey:r.signal_key,symbol:r.symbol,timeframe:r.timeframe,side:r.side,signalTime:num(r.signal_time),receivedAt:num(r.received_at),
      entry:num(r.entry),sl:num(r.sl),tp1:num(r.tp1),tp2:num(r.tp2),tp3:num(r.tp3),probability:num(r.probability),confluence:num(r.confluence),
      grade:r.grade,session:r.session,regime:r.regime,stabilityScore:num(r.stability_score),status:r.status,
      tp1Hit:!!r.tp1_hit,tp2Hit:!!r.tp2_hit,tp3Hit:!!r.tp3_hit,slHit:!!r.sl_hit,firstOutcome:r.first_outcome,
      firstOutcomeAt:num(r.first_outcome_at),maxR:num(r.max_r)||0,benchmarkR:num(r.benchmark_r),closedAt:num(r.closed_at),
      lastPrice:num(r.last_price),feedType:r.feed_type
    }));
    console.log(`[DB] ready • ${history.length} snapshots • ${performanceTrades.length} trades loaded`);
  }catch(e){console.error('[DB init]',e.message)}
}
function persistSnapshot(d){
  if(!pool)return;
  const payload={...d}; delete payload.receivedAt;
  pool.query(`
    INSERT INTO zencore_snapshots(symbol,timeframe,bar_time,received_at,feed_type,payload)
    VALUES($1,$2,$3,$4,$5,$6::jsonb)
    ON CONFLICT(symbol,timeframe,bar_time) DO UPDATE SET received_at=EXCLUDED.received_at,feed_type=EXCLUDED.feed_type,payload=EXCLUDED.payload
  `,[d.symbol||null,String(d.timeframe||''),num(d.time),num(d.receivedAt)||Date.now(),d.feedType||'LIVE',JSON.stringify(payload)]).catch(e=>console.error('[DB snapshot]',e.message));
}
function persistTrade(t){
  if(!pool)return;
  pool.query(`
    INSERT INTO zencore_trades(id,signal_key,symbol,timeframe,side,signal_time,received_at,entry,sl,tp1,tp2,tp3,probability,confluence,grade,session,regime,stability_score,status,tp1_hit,tp2_hit,tp3_hit,sl_hit,first_outcome,first_outcome_at,max_r,benchmark_r,closed_at,last_price,feed_type,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
    ON CONFLICT(id) DO UPDATE SET
      status=EXCLUDED.status,tp1_hit=EXCLUDED.tp1_hit,tp2_hit=EXCLUDED.tp2_hit,tp3_hit=EXCLUDED.tp3_hit,sl_hit=EXCLUDED.sl_hit,
      first_outcome=EXCLUDED.first_outcome,first_outcome_at=EXCLUDED.first_outcome_at,max_r=EXCLUDED.max_r,benchmark_r=EXCLUDED.benchmark_r,
      closed_at=EXCLUDED.closed_at,last_price=EXCLUDED.last_price,updated_at=EXCLUDED.updated_at
  `,[t.id,t.signalKey,t.symbol,t.timeframe,t.side,t.signalTime,t.receivedAt,t.entry,t.sl,t.tp1,t.tp2,t.tp3,t.probability,t.confluence,t.grade,t.session,t.regime,t.stabilityScore,t.status,t.tp1Hit,t.tp2Hit,t.tp3Hit,t.slHit,t.firstOutcome,t.firstOutcomeAt,t.maxR,t.benchmarkR,t.closedAt,t.lastPrice,t.feedType,Date.now()]).catch(e=>console.error('[DB trade]',e.message));
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`), pathname=url.pathname;
  if(req.method==='OPTIONS')return send(res,204,'');

  if(req.method==='GET'&&pathname==='/events'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*','X-Accel-Buffering':'no'});
    res.write(': ZenCore V8 SSE connected\n\n'); sseClients.add(res);
    if(latest)res.write(`data: ${JSON.stringify(latest)}\n\n`);
    res.write(`event: performance\ndata: ${JSON.stringify(performancePayload())}\n\n`);
    const keepAlive=setInterval(()=>{try{res.write(': ping\n\n')}catch(_){}},25000);
    req.on('close',()=>{clearInterval(keepAlive);sseClients.delete(res)}); return;
  }

  if(req.method==='POST'&&pathname==='/webhook'){
    webhookPosts++;
    const body=await readBody(req), parsed=safeJson(body);
    if(parsed&&parsed.source==='ZenCore AI Dashboard Pro + Alerts'){
      lastWebhookError=null; saveFeed(parsed,'LIVE');
      console.log(`[ZenCore Native] ${latest.symbol||''} ${latest.timeframe||''} ${latest.action||''} schema=${latest.schemaVersion||'legacy'}`);
      return send(res,200,JSON.stringify({ok:true,type:'snapshot',native:true,receivedAt:latest.receivedAt}));
    }
    const recovered=recoverZenCore(body);
    if(recovered){
      recoveredPosts++; lastWebhookError='Recovered malformed Pine JSON'; saveFeed(recovered,'LIVE-RECOVERED');
      console.log(`[ZenCore Recovered] ${latest.symbol||''} ${latest.timeframe||''} ${latest.action||''}`);
      return send(res,200,JSON.stringify({ok:true,type:'recovered-snapshot',native:false,receivedAt:latest.receivedAt}));
    }
    if(body.trim()){
      const item=addAlert(parsed?(typeof parsed==='string'?parsed:JSON.stringify(parsed)):body.trim());
      return send(res,200,JSON.stringify({ok:true,type:'text-alert',receivedAt:item.time}));
    }
    lastWebhookError='Empty webhook body';
    return send(res,400,JSON.stringify({ok:false,error:lastWebhookError}));
  }

  if(req.method==='GET'&&pathname==='/webhook')return send(res,200,JSON.stringify({...webhookStatus(),endpoint:'/webhook',methodRequired:'POST'},null,2));
  if(req.method==='GET'&&pathname==='/health')return send(res,200,JSON.stringify({service:'zencore-v8-analysis',...webhookStatus()}));
  if(req.method==='GET'&&pathname==='/api/status')return send(res,200,JSON.stringify(webhookStatus()));
  if(req.method==='GET'&&pathname==='/api/latest')return send(res,200,JSON.stringify(latest||{}));
  if(req.method==='GET'&&pathname==='/api/history')return send(res,200,JSON.stringify(history));
  if(req.method==='GET'&&pathname==='/api/journal')return send(res,200,JSON.stringify(journal));
  if(req.method==='GET'&&pathname==='/api/alerts')return send(res,200,JSON.stringify(alertTape));
  if(req.method==='GET'&&pathname==='/api/performance')return send(res,200,JSON.stringify(performancePayload()));
  if(req.method==='GET'&&pathname==='/api/mt5/status')return send(res,200,JSON.stringify({ok:true,connected:false,mode:'AUTO_TRADE_DISABLED',lastSignal:null,maxLot:1}));

  if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html'))return serveIndexV8(res);
  if(req.method==='GET'&&pathname==='/style-v5.css')return serveFile(res,'style-v5.css','text/css; charset=utf-8');
  if(req.method==='GET'&&pathname==='/app-v5.js')return serveFile(res,'app-v5.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/alerts-v3.js')return serveFile(res,'alerts-v3.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/performance-v8.js')return serveFile(res,'performance-v8.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/favicon.ico')return send(res,204,'','image/x-icon');
  return send(res,404,JSON.stringify({ok:false,error:'Not found',path:pathname}));
});

initDb().finally(()=>{
  server.listen(PORT,'0.0.0.0',()=>console.log(`ZenCore V8 Analysis + Performance Engine running on port ${PORT}`));
});
