const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

let latest = null;
let history = [];
let journal = [];
let alertTape = [];
let webhookPosts = 0;
let recoveredPosts = 0;
let lastWebhookError = null;
const sseClients = new Set();

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
  try {
    const file = fs.readFileSync(path.join(__dirname, filename));
    return send(res, 200, file, type);
  } catch (_) {
    return send(res, 404, JSON.stringify({ok:false,error:'Asset not found'}));
  }
}

function readBody(req, limit = 50000) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => {
      if (body.length < limit) body += chunk;
    });
    req.on('end', () => resolve(body));
  });
}

function safeJson(body) {
  try { return JSON.parse(body || '{}'); } catch (_) { return null; }
}

function num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function broadcastEvent(name, data) {
  const packet = `${name && name !== 'message' ? `event: ${name}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(packet); } catch (_) { sseClients.delete(client); }
  }
}

function addAlert(message) {
  const item = {time: Date.now(), message: String(message || '').slice(0, 1600)};
  alertTape.push(item);
  alertTape = alertTape.slice(-150);
  broadcastEvent('alert', item);
  console.log(`[Pine Alert] ${item.message.slice(0, 240)}`);
  return item;
}

function saveFeed(data, feedType = 'LIVE') {
  latest = {...data, feedType, receivedAt: Date.now()};
  history.unshift(latest);
  history = history.slice(0, 1000);

  const action = String(latest.action || '').toUpperCase();
  if (action === 'BUY' || action === 'SELL') {
    const key = `${latest.symbol || ''}|${latest.time || latest.receivedAt}|${action}`;
    if (!journal.some(x => x._journalKey === key)) {
      journal.push({...latest, _journalKey: key});
      journal = journal.slice(-250);
    }
  }
  broadcastEvent('message', latest);
}

function decodeJsonString(v) {
  if (v == null) return null;
  try { return JSON.parse(`\"${v}\"`); } catch (_) { return String(v).replace(/\\\"/g,'\"').replace(/\\n/g,' ').replace(/\\r/g,' '); }
}

function extractString(body, key) {
  const re = new RegExp(`\"${key}\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"`);
  const m = body.match(re);
  return m ? decodeJsonString(m[1]) : null;
}

function extractNumber(body, key) {
  const re = new RegExp(`\"${key}\"\\s*:\\s*(-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)`);
  const m = body.match(re);
  return m ? num(m[1]) : null;
}

function extractBool(body, key) {
  const re = new RegExp(`\"${key}\"\\s*:\\s*(true|false)`, 'i');
  const m = body.match(re);
  return m ? m[1].toLowerCase() === 'true' : null;
}

function recoverZenCore(body) {
  if (!body || !body.includes('ZenCore AI Dashboard Pro + Alerts')) return null;

  const out = {source: 'ZenCore AI Dashboard Pro + Alerts'};
  const stringKeys = [
    'symbol','tickerid','timeframe','tradeMode','action','barStatus','marketStructure','momentum','demand',
    'hemaTrend','dxyStatus','sdClearance','whaleState','riskState','mtfOverall','forecast3Bars','powerText','proTip'
  ];
  const numberKeys = [
    'time','open','high','low','close','volume','ema9','ema20','ema50','hemaFast','hemaSlow','rsi','waveTrend1','waveTrend2',
    'chopIndex','relativeVolume','globalTrend','setupProbability','confluenceStars','atr','bullObTop','bullObBottom',
    'bearObTop','bearObBottom','entry','sl','tp1','tp2','tp3','mtf1','mtf2','mtf3','mtfTotal','marketPower'
  ];
  const boolKeys = ['tradeActive','tradeIsBuy','tp1Hit','tp2Hit','tp3Hit','slHit','sop1','sop2','sop3','sop4','sop5'];

  for (const key of stringKeys) {
    const v = extractString(body, key);
    if (v != null) out[key] = v;
  }
  for (const key of numberKeys) {
    const v = extractNumber(body, key);
    if (v != null) out[key] = v;
  }
  for (const key of boolKeys) {
    const v = extractBool(body, key);
    if (v != null) out[key] = v;
  }

  if (!out.symbol && !out.tickerid) return null;
  if (out.close == null && !out.action) return null;
  return out;
}

function webhookStatus() {
  return {
    ok: true,
    status: latest ? 'DATA_RECEIVED' : 'WAITING_FOR_TRADINGVIEW',
    webhookPosts,
    recoveredPosts,
    lastWebhookError,
    connectedDashboards: sseClients.size,
    historyCount: history.length,
    journalCount: journal.length,
    alertCount: alertTape.length,
    lastReceivedAt: latest ? latest.receivedAt : null,
    lastSymbol: latest ? latest.symbol || null : null,
    lastTimeframe: latest ? latest.timeframe || null : null,
    lastAction: latest ? latest.action || null : null,
    feedType: latest ? latest.feedType || null : null
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (req.method === 'GET' && pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no'
    });
    res.write(': ZenCore V6 SSE connected\n\n');
    sseClients.add(res);
    if (latest) res.write(`data: ${JSON.stringify(latest)}\n\n`);
    const keepAlive = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) {}
    }, 25000);
    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/webhook') {
    webhookPosts += 1;
    const body = await readBody(req);
    const parsed = safeJson(body);

    if (parsed && parsed.source === 'ZenCore AI Dashboard Pro + Alerts') {
      lastWebhookError = null;
      saveFeed(parsed, 'LIVE');
      console.log(`[ZenCore] ${latest.symbol || ''} ${latest.timeframe || ''} ${latest.action || ''}`);
      return send(res, 200, JSON.stringify({ok:true,type:'snapshot',receivedAt:latest.receivedAt}));
    }

    const recovered = recoverZenCore(body);
    if (recovered) {
      recoveredPosts += 1;
      lastWebhookError = null;
      saveFeed(recovered, 'LIVE-RECOVERED');
      console.log(`[ZenCore Recovered] ${latest.symbol || ''} ${latest.timeframe || ''} ${latest.action || ''}`);
      return send(res, 200, JSON.stringify({ok:true,type:'recovered-snapshot',receivedAt:latest.receivedAt}));
    }

    if (body.trim()) {
      const item = addAlert(parsed ? (typeof parsed === 'string' ? parsed : JSON.stringify(parsed)) : body.trim());
      lastWebhookError = parsed ? null : 'Payload treated as text alert';
      return send(res, 200, JSON.stringify({ok:true,type:parsed?'alert':'text-alert',receivedAt:item.time}));
    }

    lastWebhookError = 'Empty webhook body';
    return send(res, 400, JSON.stringify({ok:false,error:lastWebhookError}));
  }

  if (req.method === 'GET' && pathname === '/webhook') {
    return send(res, 200, JSON.stringify({...webhookStatus(), endpoint:'/webhook', methodRequired:'POST'}, null, 2));
  }

  if (req.method === 'GET' && pathname === '/debug/test-feed') {
    const now = Date.now();
    const sample = {
      source:'ZenCore AI Dashboard Pro + Alerts',symbol:'XAUUSD',tickerid:'OANDA:XAUUSD',timeframe:'1',tradeMode:'Scalping',time:now,
      open:4400.10,high:4405.50,low:4398.80,close:4403.20,volume:1500,action:'LONG_BIAS',barStatus:'Confirmed',
      marketStructure:'Bullish',momentum:'Bullish',demand:'Demand',hemaTrend:'Bullish',ema9:4402.5,ema20:4400.2,ema50:4395.1,
      hemaFast:4402.0,hemaSlow:4399.8,rsi:61.5,waveTrend1:24.2,waveTrend2:17.4,chopIndex:34.0,dxyStatus:'Weak',
      sdClearance:'Clear',whaleState:'Accumulation',relativeVolume:1.35,globalTrend:1,setupProbability:81,confluenceStars:4,
      riskState:'Normal',atr:3.2,bullObTop:4398.5,bullObBottom:4396.8,bearObTop:4410.0,bearObBottom:4408.5,
      entry:4401.0,sl:4397.8,tp1:4404.2,tp2:4407.4,tp3:4410.6,tradeActive:false,tradeIsBuy:true,
      tp1Hit:false,tp2Hit:false,tp3Hit:false,slHit:false,mtf1:1,mtf2:1,mtf3:1,mtfTotal:3,mtfOverall:'BULLISH',
      forecast3Bars:'Bullish continuation',marketPower:72,powerText:'BUYERS STRONG',proTip:'Test V6 feed',
      sop1:true,sop2:true,sop3:true,sop4:true,sop5:true
    };
    saveFeed(sample, 'TEST');
    return send(res, 200, JSON.stringify({ok:true,message:'V6 test feed injected',receivedAt:latest.receivedAt}));
  }

  if (req.method === 'GET' && pathname === '/health') return send(res, 200, JSON.stringify({service:'zencore-v6',...webhookStatus()}));
  if (req.method === 'GET' && pathname === '/api/status') return send(res, 200, JSON.stringify(webhookStatus()));
  if (req.method === 'GET' && pathname === '/api/latest') return send(res, 200, JSON.stringify(latest || {}));
  if (req.method === 'GET' && pathname === '/api/history') return send(res, 200, JSON.stringify(history));
  if (req.method === 'GET' && pathname === '/api/journal') return send(res, 200, JSON.stringify(journal));
  if (req.method === 'GET' && pathname === '/api/alerts') return send(res, 200, JSON.stringify(alertTape));
  if (req.method === 'GET' && pathname === '/api/mt5/status') return send(res, 200, JSON.stringify({ok:true,connected:false,mode:'DISABLED_IN_V6',lastSignal:null,maxLot:1}));

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) return serveFile(res, 'index.html', 'text/html; charset=utf-8');
  if (req.method === 'GET' && pathname === '/style-v5.css') return serveFile(res, 'style-v5.css', 'text/css; charset=utf-8');
  if (req.method === 'GET' && pathname === '/app-v5.js') return serveFile(res, 'app-v5.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && pathname === '/alerts-v3.js') return serveFile(res, 'alerts-v3.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && pathname === '/favicon.ico') return send(res, 204, '', 'image/x-icon');

  return send(res, 404, JSON.stringify({ok:false,error:'Not found',path:pathname}));
});

server.listen(PORT, '0.0.0.0', () => console.log(`ZenCore V6 Decision Engine running on port ${PORT}`));
