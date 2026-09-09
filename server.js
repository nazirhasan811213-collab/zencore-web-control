const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
let latest = null;
let history = [];
let journal = [];
let alertTape = [];
let webhookPosts = 0;
let lastWebhookError = null;
const sseClients = new Set();

function send(res, code, body, type="application/json; charset=utf-8") {
  res.writeHead(code, {"Content-Type": type,"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Cache-Control":"no-store"});
  res.end(body);
}

function serveFile(res, filename, type) {
  try { return send(res, 200, fs.readFileSync(path.join(__dirname, filename)), type); }
  catch (_) { return send(res, 404, JSON.stringify({ok:false,error:"Asset not found"})); }
}

function broadcast(data) {
  const packet = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) { try { client.write(packet); } catch (_) { sseClients.delete(client); } }
}

function broadcastAlert(alert) {
  const packet = `event: alert\ndata: ${JSON.stringify(alert)}\n\n`;
  for (const client of sseClients) { try { client.write(packet); } catch (_) { sseClients.delete(client); } }
}

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
    const key = `${latest.symbol || ""}|${latest.time || latest.receivedAt}|${action}`;
    if (!journal.some(x => x._journalKey === key)) {
      journal.push({...latest, _journalKey:key});
      journal = journal.slice(-150);
    }
  }
  broadcast(latest);
}

function webhookStatus() {
  return {ok:true,status:latest?"DATA_RECEIVED":"WAITING_FOR_TRADINGVIEW",webhookPosts,lastWebhookError,connectedDashboards:sseClients.size,historyCount:history.length,journalCount:journal.length,alertCount:alertTape.length,lastReceivedAt:latest?latest.receivedAt:null,lastSymbol:latest?latest.symbol||null:null,lastTimeframe:latest?latest.timeframe||null:null,feedType:latest?latest.feedType||null:null};
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") return send(res, 204, "");

  if (req.method === "GET" && pathname === "/events") {
    res.writeHead(200, {"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive","Access-Control-Allow-Origin":"*","X-Accel-Buffering":"no"});
    res.write(": ZenCore SSE connected\n\n");
    sseClients.add(res);
    if (latest) res.write(`data: ${JSON.stringify(latest)}\n\n`);
    const keepAlive = setInterval(() => { try { res.write(": ping\n\n"); } catch (_) {} }, 25000);
    req.on("close", () => { clearInterval(keepAlive); sseClients.delete(res); });
    return;
  }

  if (req.method === "POST" && pathname === "/webhook") {
    webhookPosts += 1;
    let body = "";
    req.on("data", c => { if (body.length < 20000) body += c; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        if (data && data.source === "ZenCore AI Dashboard Pro + Alerts") {
          lastWebhookError = null;
          saveFeed(data, "LIVE");
          console.log(`[ZenCore] ${latest.symbol || ""} ${latest.timeframe || ""} ${latest.action || ""}`);
          return send(res, 200, JSON.stringify({ok:true,type:"snapshot",receivedAt:latest.receivedAt}));
        }
        const item = addAlert(typeof data === "string" ? data : JSON.stringify(data));
        lastWebhookError = null;
        return send(res, 200, JSON.stringify({ok:true,type:"alert",receivedAt:item.time}));
      } catch (_) {
        if (body.trim()) {
          const item = addAlert(body.trim());
          lastWebhookError = null;
          return send(res, 200, JSON.stringify({ok:true,type:"text-alert",receivedAt:item.time}));
        }
        lastWebhookError = "Empty webhook body";
        return send(res, 400, JSON.stringify({ok:false,error:lastWebhookError}));
      }
    });
    return;
  }

  if (req.method === "GET" && pathname === "/webhook") return send(res,200,JSON.stringify({...webhookStatus(),endpoint:"/webhook",methodRequired:"POST"},null,2));

  if (req.method === "GET" && pathname === "/debug/test-feed") {
    const now=Date.now();
    const sample={source:"ZenCore AI Dashboard Pro + Alerts",symbol:"XAUUSD",tickerid:"OANDA:XAUUSD",timeframe:"1",tradeMode:"Scalping",time:now,open:3498.20,high:3502.10,low:3497.80,close:3500.25,volume:1840,action:"BUY",barStatus:"TEST FEED",marketStructure:"Bullish",momentum:"Bullish",demand:"Demand",hemaTrend:"Bullish",ema9:3499.6,ema20:3497.8,ema50:3492.4,hemaFast:3499.4,hemaSlow:3496.9,rsi:61.2,waveTrend1:22.4,waveTrend2:17.8,chopIndex:32.4,dxyStatus:"Weak",sdClearance:"Clear",whaleState:"Accumulation",relativeVolume:1.42,globalTrend:1,setupProbability:78,confluenceStars:4,riskState:"LOW",atr:4.25,bullObTop:3495.4,bullObBottom:3493.8,bearObTop:3508.2,bearObBottom:3506.7,entry:3500.25,sl:3495.00,tp1:3505.50,tp2:3510.75,tp3:3516.00,tradeActive:true,tradeIsBuy:true,tp1Hit:false,tp2Hit:false,tp3Hit:false,slHit:false,mtf1:1,mtf2:1,mtf3:1,mtfTotal:3,mtfOverall:"BULLISH",forecast3Bars:"Bullish continuation",marketPower:76,powerText:"BUYERS STRONG",proTip:"SERVER TEST FEED — replace with TradingView live data",sop1:true,sop2:true,sop3:true,sop4:true,sop5:true};
    saveFeed(sample,"TEST");
    addAlert("TEST ALERT TAPE • Runner management ready");
    return send(res,200,JSON.stringify({ok:true,message:"Test feed injected",receivedAt:latest.receivedAt}));
  }

  if (req.method === "GET" && pathname === "/health") return send(res,200,JSON.stringify({service:"zencore-web-control",...webhookStatus()}));
  if (req.method === "GET" && pathname === "/api/status") return send(res,200,JSON.stringify(webhookStatus()));
  if (req.method === "GET" && pathname === "/api/latest") return send(res,200,JSON.stringify(latest||{}));
  if (req.method === "GET" && pathname === "/api/history") return send(res,200,JSON.stringify(history));
  if (req.method === "GET" && pathname === "/api/journal") return send(res,200,JSON.stringify(journal));
  if (req.method === "GET" && pathname === "/api/alerts") return send(res,200,JSON.stringify(alertTape));

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) return serveFile(res,"index.html","text/html; charset=utf-8");
  if (req.method === "GET" && pathname === "/style-v3.css") return serveFile(res,"style-v3.css","text/css; charset=utf-8");
  if (req.method === "GET" && pathname === "/app-v3.js") return serveFile(res,"app-v3.js","application/javascript; charset=utf-8");
  if (req.method === "GET" && pathname === "/alerts-v3.js") return serveFile(res,"alerts-v3.js","application/javascript; charset=utf-8");
  if (req.method === "GET" && pathname === "/favicon.ico") return send(res,204,"","image/x-icon");

  return send(res,404,JSON.stringify({ok:false,error:"Not found",path:pathname}));
});

server.listen(PORT,"0.0.0.0",()=>console.log(`ZenCore Total Analysis Terminal V3 running on port ${PORT}`));
