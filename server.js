const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
const MT5_BRIDGE_TOKEN = process.env.MT5_BRIDGE_TOKEN || "";
const WEB_TRADE_PIN = process.env.WEB_TRADE_PIN || "";
const MT5_MAX_LOT = Math.max(0.01, Number(process.env.MT5_MAX_LOT || 1));
const SIGNAL_TTL_MS = 5 * 60 * 1000;

let latest = null;
let history = [];
let journal = [];
let alertTape = [];
let webhookPosts = 0;
let lastWebhookError = null;
let lastEntrySignal = null;
const sseClients = new Set();

let mt5Commands = [];
let mt5State = {
  lastSeen: null,
  broker: null,
  server: null,
  login: null,
  balance: null,
  equity: null,
  freeMargin: null,
  positions: 0,
  lastResult: null
};

function send(res, code, body, type="application/json; charset=utf-8") {
  res.writeHead(code, {
    "Content-Type": type,
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Headers":"Content-Type, X-ZenCore-Token",
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
    "Cache-Control":"no-store"
  });
  res.end(body);
}

function serveFile(res, filename, type) {
  try { return send(res, 200, fs.readFileSync(path.join(__dirname, filename)), type); }
  catch (_) { return send(res, 404, JSON.stringify({ok:false,error:"Asset not found"})); }
}

function readBody(req, limit=30000) {
  return new Promise(resolve => {
    let body = "";
    req.on("data", c => { if (body.length < limit) body += c; });
    req.on("end", () => resolve(body));
  });
}

function safeJson(body) {
  try { return JSON.parse(body || "{}"); } catch (_) { return null; }
}

function secureEqual(a,b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa,bb);
}

function num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function broadcastEvent(name, data) {
  const packet = `${name && name !== "message" ? `event: ${name}\n` : ""}data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(packet); } catch (_) { sseClients.delete(client); }
  }
}

function broadcast(data) { broadcastEvent("message", data); }
function broadcastAlert(alert) { broadcastEvent("alert", alert); }
function broadcastMt5(data) { broadcastEvent("mt5", data); }

function addAlert(message) {
  const item = {time:Date.now(), message:String(message || "").slice(0,1200)};
  alertTape.push(item);
  alertTape = alertTape.slice(-120);
  broadcastAlert(item);
  console.log(`[Pine Alert] ${item.message.slice(0,220)}`);
  return item;
}

function saveFeed(data, feedType = "LIVE") {
  latest = {...data, feedType, receivedAt: Date.now()};
  history.unshift(latest);
  history = history.slice(0, 800);

  const action = String(latest.action || "").toUpperCase();
  if (action === "BUY" || action === "SELL") {
    lastEntrySignal = latest;
    const key = `${latest.symbol || ""}|${latest.time || latest.receivedAt}|${action}`;
    if (!journal.some(x => x._journalKey === key)) {
      journal.push({...latest, _journalKey:key});
      journal = journal.slice(-150);
    }
  }
  broadcast(latest);
}

function signalPublic() {
  if (!lastEntrySignal) return null;
  return {
    side: String(lastEntrySignal.action || "").toUpperCase(),
    symbol: lastEntrySignal.symbol || null,
    time: lastEntrySignal.time || null,
    receivedAt: lastEntrySignal.receivedAt || null,
    entry: num(lastEntrySignal.entry),
    sl: num(lastEntrySignal.sl),
    tp1: num(lastEntrySignal.tp1),
    tp2: num(lastEntrySignal.tp2),
    tp3: num(lastEntrySignal.tp3),
    probability: num(lastEntrySignal.setupProbability),
    validUntil: (lastEntrySignal.receivedAt || 0) + SIGNAL_TTL_MS
  };
}

function webhookStatus() {
  return {
    ok:true,
    status:latest?"DATA_RECEIVED":"WAITING_FOR_TRADINGVIEW",
    webhookPosts,lastWebhookError,
    connectedDashboards:sseClients.size,
    historyCount:history.length,
    journalCount:journal.length,
    alertCount:alertTape.length,
    lastReceivedAt:latest?latest.receivedAt:null,
    lastSymbol:latest?latest.symbol||null:null,
    lastTimeframe:latest?latest.timeframe||null:null,
    feedType:latest?latest.feedType||null:null
  };
}

function maskLogin(v) {
  const s = String(v || "");
  if (!s) return null;
  return s.length <= 4 ? `***${s}` : `${"*".repeat(Math.max(3,s.length-4))}${s.slice(-4)}`;
}

function mt5PublicStatus() {
  const connected = !!mt5State.lastSeen && Date.now() - mt5State.lastSeen < 15000;
  return {
    ok:true,
    connected,
    lastSeen:mt5State.lastSeen,
    broker:mt5State.broker,
    server:mt5State.server,
    login:maskLogin(mt5State.login),
    balance:mt5State.balance,
    equity:mt5State.equity,
    freeMargin:mt5State.freeMargin,
    positions:mt5State.positions,
    lastResult:mt5State.lastResult,
    queued:mt5Commands.filter(x => x.status === "PENDING" || x.status === "SENT").length,
    maxLot:MT5_MAX_LOT,
    lastSignal:signalPublic()
  };
}

function mt5Authorized(req) {
  return !!MT5_BRIDGE_TOKEN && secureEqual(req.headers["x-zencore-token"], MT5_BRIDGE_TOKEN);
}

function sanitizeSymbol(v) {
  const s = String(v || "").trim().toUpperCase();
  return /^[A-Z0-9._-]{3,30}$/.test(s) ? s : null;
}

function commandPublic(c) {
  return c ? {
    id:c.id, side:c.side, symbol:c.symbol, volume:c.volume, sl:c.sl, tp:c.tp,
    createdAt:c.createdAt, status:c.status, sentAt:c.sentAt || null,
    completedAt:c.completedAt || null, result:c.result || null
  } : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") return send(res, 204, "");

  if (req.method === "GET" && pathname === "/events") {
    res.writeHead(200, {"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive","Access-Control-Allow-Origin":"*","X-Accel-Buffering":"no"});
    res.write(": ZenCore SSE connected\n\n");
    sseClients.add(res);
    if (latest) res.write(`data: ${JSON.stringify(latest)}\n\n`);
    res.write(`event: mt5\ndata: ${JSON.stringify(mt5PublicStatus())}\n\n`);
    const keepAlive = setInterval(() => { try { res.write(": ping\n\n"); } catch (_) {} }, 25000);
    req.on("close", () => { clearInterval(keepAlive); sseClients.delete(res); });
    return;
  }

  if (req.method === "POST" && pathname === "/webhook") {
    webhookPosts += 1;
    const body = await readBody(req, 20000);
    const data = safeJson(body);
    if (data && data.source === "ZenCore AI Dashboard Pro + Alerts") {
      lastWebhookError = null;
      saveFeed(data, "LIVE");
      console.log(`[ZenCore] ${latest.symbol || ""} ${latest.timeframe || ""} ${latest.action || ""}`);
      return send(res, 200, JSON.stringify({ok:true,type:"snapshot",receivedAt:latest.receivedAt}));
    }
    if (body.trim()) {
      const item = addAlert(data ? (typeof data === "string" ? data : JSON.stringify(data)) : body.trim());
      lastWebhookError = null;
      return send(res, 200, JSON.stringify({ok:true,type:data?"alert":"text-alert",receivedAt:item.time}));
    }
    lastWebhookError = "Empty webhook body";
    return send(res, 400, JSON.stringify({ok:false,error:lastWebhookError}));
  }

  if (req.method === "GET" && pathname === "/webhook") return send(res,200,JSON.stringify({...webhookStatus(),endpoint:"/webhook",methodRequired:"POST"},null,2));

  // ---- MT5 bridge: public read-only status ----
  if (req.method === "GET" && pathname === "/api/mt5/status") return send(res,200,JSON.stringify(mt5PublicStatus()));
  if (req.method === "GET" && pathname === "/api/mt5/orders") return send(res,200,JSON.stringify(mt5Commands.slice(-20).reverse().map(commandPublic)));

  // ---- MT5 bridge: EA heartbeat ----
  if (req.method === "POST" && pathname === "/api/mt5/heartbeat") {
    if (!mt5Authorized(req)) return send(res,401,JSON.stringify({ok:false,error:"Invalid MT5 bridge token"}));
    const data = safeJson(await readBody(req));
    if (!data) return send(res,400,JSON.stringify({ok:false,error:"Invalid JSON"}));
    mt5State = {
      ...mt5State,
      lastSeen:Date.now(),
      broker:String(data.broker || "").slice(0,80) || null,
      server:String(data.server || "").slice(0,80) || null,
      login:String(data.login || "").slice(0,32) || null,
      balance:num(data.balance), equity:num(data.equity), freeMargin:num(data.freeMargin),
      positions:Math.max(0, Math.floor(num(data.positions) || 0))
    };
    const status = mt5PublicStatus();
    broadcastMt5(status);
    return send(res,200,JSON.stringify(status));
  }

  // ---- MT5 bridge: EA polls next command. Plain text keeps EA parser simple. ----
  if (req.method === "GET" && pathname === "/api/mt5/next") {
    if (!mt5Authorized(req)) return send(res,401,"UNAUTHORIZED","text/plain; charset=utf-8");
    const now = Date.now();
    let cmd = mt5Commands.find(x => x.status === "PENDING");
    if (!cmd) cmd = mt5Commands.find(x => x.status === "SENT" && now - (x.sentAt || 0) > 10000 && (x.retries || 0) < 3);
    if (!cmd) return send(res,200,"NONE","text/plain; charset=utf-8");
    cmd.status = "SENT";
    cmd.sentAt = now;
    cmd.retries = (cmd.retries || 0) + 1;
    const line = [cmd.id,cmd.side,cmd.symbol,cmd.volume,cmd.sl ?? 0,cmd.tp ?? 0].join("|");
    broadcastMt5(mt5PublicStatus());
    return send(res,200,line,"text/plain; charset=utf-8");
  }

  // ---- MT5 bridge: EA reports execution result ----
  if (req.method === "POST" && pathname === "/api/mt5/result") {
    if (!mt5Authorized(req)) return send(res,401,JSON.stringify({ok:false,error:"Invalid MT5 bridge token"}));
    const data = safeJson(await readBody(req));
    if (!data || !data.id) return send(res,400,JSON.stringify({ok:false,error:"Missing command id"}));
    const cmd = mt5Commands.find(x => x.id === String(data.id));
    if (!cmd) return send(res,404,JSON.stringify({ok:false,error:"Command not found"}));
    const status = String(data.status || "ERROR").toUpperCase();
    cmd.status = ["FILLED","REJECTED","BLOCKED","ERROR"].includes(status) ? status : "ERROR";
    cmd.completedAt = Date.now();
    cmd.result = {
      ticket:String(data.ticket || "").slice(0,40) || null,
      deal:String(data.deal || "").slice(0,40) || null,
      retcode:String(data.retcode || "").slice(0,40) || null,
      message:String(data.message || "").slice(0,240) || null
    };
    mt5State.lastSeen = Date.now();
    mt5State.lastResult = commandPublic(cmd);
    addAlert(`MT5 ${cmd.status} • ${cmd.side} ${cmd.symbol} ${cmd.volume} lot${cmd.result.message ? ` • ${cmd.result.message}` : ""}`);
    broadcastMt5(mt5PublicStatus());
    return send(res,200,JSON.stringify({ok:true,command:commandPublic(cmd)}));
  }

  // ---- Browser queues an order. Requires PIN + a recent exact ZenCore BUY/SELL signal. ----
  if (req.method === "POST" && pathname === "/api/mt5/order") {
    const data = safeJson(await readBody(req));
    if (!data) return send(res,400,JSON.stringify({ok:false,error:"Invalid JSON"}));
    if (!WEB_TRADE_PIN || !secureEqual(data.pin, WEB_TRADE_PIN)) return send(res,401,JSON.stringify({ok:false,error:"Invalid trade PIN"}));

    const pub = mt5PublicStatus();
    if (!pub.connected) return send(res,409,JSON.stringify({ok:false,error:"MT5 bridge is not connected"}));

    const side = String(data.side || "").toUpperCase();
    if (!['BUY','SELL'].includes(side)) return send(res,400,JSON.stringify({ok:false,error:"Side must be BUY or SELL"}));
    const symbol = sanitizeSymbol(data.symbol);
    if (!symbol) return send(res,400,JSON.stringify({ok:false,error:"Invalid symbol"}));
    const volumeRaw = num(data.volume);
    if (volumeRaw == null || volumeRaw <= 0 || volumeRaw > MT5_MAX_LOT) return send(res,400,JSON.stringify({ok:false,error:`Volume must be > 0 and <= ${MT5_MAX_LOT}`}));
    const volume = Math.round(volumeRaw * 100) / 100;
    const sl = num(data.sl);
    const tp = num(data.tp);
    if (sl == null || tp == null || sl <= 0 || tp <= 0) return send(res,400,JSON.stringify({ok:false,error:"SL and TP are required"}));

    const sig = lastEntrySignal;
    if (!sig || Date.now() - (sig.receivedAt || 0) > SIGNAL_TTL_MS) return send(res,409,JSON.stringify({ok:false,error:"No recent exact ZenCore BUY/SELL signal. Wait for a new entry signal."}));
    const sigSide = String(sig.action || "").toUpperCase();
    if (sigSide !== side || String(sig.symbol || "").toUpperCase() !== symbol) return send(res,409,JSON.stringify({ok:false,error:`Order must match recent ZenCore signal: ${sigSide} ${sig.symbol || ""}`}));

    const signalKey = `${sig.symbol}|${sig.time || sig.receivedAt}|${sigSide}`;
    const duplicate = mt5Commands.some(x => x.signalKey === signalKey && !["REJECTED","BLOCKED","ERROR"].includes(x.status));
    if (duplicate) return send(res,409,JSON.stringify({ok:false,error:"An MT5 order has already been queued for this ZenCore signal"}));

    const cmd = {
      id:`ZC-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      signalKey, side, symbol, volume, sl, tp,
      createdAt:Date.now(), status:"PENDING", retries:0,
      signalTime:sig.time || null,
      probability:num(sig.setupProbability)
    };
    mt5Commands.push(cmd);
    mt5Commands = mt5Commands.slice(-100);
    addAlert(`MT5 ORDER QUEUED • ${side} ${symbol} ${volume} lot • SL ${sl} • TP ${tp}`);
    broadcastMt5(mt5PublicStatus());
    return send(res,202,JSON.stringify({ok:true,command:commandPublic(cmd)}));
  }

  if (req.method === "GET" && pathname === "/debug/test-feed") {
    const now=Date.now();
    const sample={source:"ZenCore AI Dashboard Pro + Alerts",symbol:"XAUUSD",tickerid:"OANDA:XAUUSD",timeframe:"1",tradeMode:"Scalping",time:now,open:3498.20,high:3502.10,low:3497.80,close:3500.25,volume:1840,action:"BUY",barStatus:"TEST FEED",marketStructure:"Bullish",momentum:"Bullish",demand:"Demand",hemaTrend:"Bullish",ema9:3499.6,ema20:3497.8,ema50:3492.4,hemaFast:3499.4,hemaSlow:3496.9,rsi:61.2,waveTrend1:22.4,waveTrend2:17.8,chopIndex:32.4,dxyStatus:"Weak",sdClearance:"Clear",whaleState:"Accumulation",relativeVolume:1.42,globalTrend:1,setupProbability:78,confluenceStars:4,riskState:"LOW",atr:4.25,bullObTop:3495.4,bullObBottom:3493.8,bearObTop:3508.2,bearObBottom:3506.7,entry:3500.25,sl:3495.00,tp1:3505.50,tp2:3510.75,tp3:3516.00,tradeActive:true,tradeIsBuy:true,tp1Hit:false,tp2Hit:false,tp3Hit:false,slHit:false,mtf1:1,mtf2:1,mtf3:1,mtfTotal:3,mtfOverall:"BULLISH",forecast3Bars:"Bullish continuation",marketPower:76,powerText:"BUYERS STRONG",proTip:"SERVER TEST FEED — replace with TradingView live data",sop1:true,sop2:true,sop3:true,sop4:true,sop5:true};
    saveFeed(sample,"TEST");
    addAlert("TEST ALERT TAPE • Runner management ready");
    return send(res,200,JSON.stringify({ok:true,message:"Test feed injected",receivedAt:latest.receivedAt}));
  }

  if (req.method === "GET" && pathname === "/health") return send(res,200,JSON.stringify({service:"zencore-web-control",...webhookStatus(),mt5:mt5PublicStatus()}));
  if (req.method === "GET" && pathname === "/api/status") return send(res,200,JSON.stringify(webhookStatus()));
  if (req.method === "GET" && pathname === "/api/latest") return send(res,200,JSON.stringify(latest||{}));
  if (req.method === "GET" && pathname === "/api/history") return send(res,200,JSON.stringify(history));
  if (req.method === "GET" && pathname === "/api/journal") return send(res,200,JSON.stringify(journal));
  if (req.method === "GET" && pathname === "/api/alerts") return send(res,200,JSON.stringify(alertTape));

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) return serveFile(res,"index.html","text/html; charset=utf-8");
  if (req.method === "GET" && pathname === "/style-v3.css") return serveFile(res,"style-v3.css","text/css; charset=utf-8");
  if (req.method === "GET" && pathname === "/app-v3.js") return serveFile(res,"app-v3.js","application/javascript; charset=utf-8");
  if (req.method === "GET" && pathname === "/alerts-v3.js") return serveFile(res,"alerts-v3.js","application/javascript; charset=utf-8");
  if (req.method === "GET" && pathname === "/style-v5.css") return serveFile(res,"style-v5.css","text/css; charset=utf-8");
  if (req.method === "GET" && pathname === "/app-v5.js") return serveFile(res,"app-v5.js","application/javascript; charset=utf-8");
  if (req.method === "GET" && pathname === "/ZenCore_MT5_Bridge.mq5") return serveFile(res,"ZenCore_MT5_Bridge.mq5","text/plain; charset=utf-8");
  if (req.method === "GET" && pathname === "/favicon.ico") return send(res,204,"","image/x-icon");

  return send(res,404,JSON.stringify({ok:false,error:"Not found",path:pathname}));
});

server.listen(PORT,"0.0.0.0",()=>console.log(`ZenCore Real Trading Terminal V5 running on port ${PORT}`));
