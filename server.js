const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
let latest = null;
let history = [];
let webhookPosts = 0;
let lastWebhookError = null;

function send(res, code, body, type="application/json; charset=utf-8") {
  res.writeHead(code, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function saveFeed(data) {
  latest = {...data, receivedAt: Date.now()};
  history.unshift(latest);
  history = history.slice(0, 100);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  console.log(`[HTTP] ${req.method} ${pathname}`);

  if (req.method === "OPTIONS") return send(res, 204, "");

  if (req.method === "POST" && pathname === "/webhook") {
    webhookPosts += 1;
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        if (data.source !== "ZenCore AI Dashboard Pro + Alerts") {
          lastWebhookError = "Invalid ZenCore source";
          console.log(`[Webhook rejected] source=${data.source || "missing"}`);
          return send(res, 401, JSON.stringify({ok:false, error:lastWebhookError}));
        }

        lastWebhookError = null;
        saveFeed(data);
        console.log(`[ZenCore] ${latest.symbol || ""} ${latest.timeframe || ""} ${latest.action || ""}`);
        return send(res, 200, JSON.stringify({ok:true, receivedAt:latest.receivedAt}));
      } catch (e) {
        lastWebhookError = "Invalid JSON";
        console.log(`[Webhook invalid JSON] ${body.slice(0, 300)}`);
        return send(res, 400, JSON.stringify({ok:false, error:lastWebhookError}));
      }
    });
    return;
  }

  if (req.method === "GET" && pathname === "/webhook") {
    return send(res, 200, JSON.stringify({
      ok:true,
      endpoint:"/webhook",
      methodRequired:"POST",
      status: latest ? "DATA_RECEIVED" : "WAITING_FOR_TRADINGVIEW",
      webhookPosts,
      lastWebhookError,
      lastReceivedAt: latest ? latest.receivedAt : null,
      lastSymbol: latest ? latest.symbol || null : null,
      note:"Opening this URL in a browser uses GET. TradingView must send POST."
    }, null, 2));
  }

  if (req.method === "GET" && pathname === "/debug/test-feed") {
    const sample = {
      source:"ZenCore AI Dashboard Pro + Alerts",
      symbol:"XAUUSD",
      timeframe:"1",
      tradeMode:"Scalping",
      time:Date.now(),
      close:3500.25,
      action:"BUY",
      barStatus:"TEST FEED",
      marketStructure:"Bullish",
      momentum:"Bullish",
      demand:"Demand",
      hemaTrend:"Bullish",
      chopIndex:32.4,
      dxyStatus:"Weak",
      sdClearance:"Clear",
      whaleState:"Accumulation",
      relativeVolume:1.42,
      globalTrend:1,
      setupProbability:78,
      confluenceStars:4,
      riskState:"LOW",
      atr:4.25,
      entry:3500.25,
      sl:3495.00,
      tp1:3505.50,
      tp2:3510.75,
      tp3:3516.00,
      tradeActive:true,
      tradeIsBuy:true,
      tp1Hit:false,
      tp2Hit:false,
      tp3Hit:false,
      slHit:false,
      mtf1:1,
      mtf2:1,
      mtf3:1,
      mtfTotal:3,
      mtfOverall:"BULLISH",
      forecast3Bars:"Bullish continuation",
      marketPower:76,
      powerText:"BUYERS STRONG",
      proTip:"SERVER TEST FEED — replace with TradingView live data",
      sop1:true,
      sop2:true,
      sop3:true,
      sop4:true,
      sop5:true
    };
    saveFeed(sample);
    console.log("[Debug] Test feed injected");
    return send(res, 200, JSON.stringify({ok:true, message:"Test feed injected", receivedAt:latest.receivedAt}));
  }

  if (req.method === "GET" && pathname === "/health")
    return send(res, 200, JSON.stringify({ok:true, service:"zencore-web-control", status:latest?"DATA_RECEIVED":"WAITING_FOR_TRADINGVIEW", webhookPosts, lastWebhookError}));

  if (req.method === "GET" && pathname === "/api/latest")
    return send(res, 200, JSON.stringify(latest || {}));

  if (req.method === "GET" && pathname === "/api/history")
    return send(res, 200, JSON.stringify(history));

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    const p = path.join(__dirname, "index.html");
    return send(res, 200, fs.readFileSync(p), "text/html; charset=utf-8");
  }

  if (req.method === "GET" && pathname === "/favicon.ico")
    return send(res, 204, "", "image/x-icon");

  return send(res, 404, JSON.stringify({ok:false, error:"Not found", path:pathname}));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ZenCore Web Control running on port ${PORT}`);
  console.log(`Webhook endpoint: /webhook`);
});
