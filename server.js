const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
const WEBHOOK_SECRET = process.env.ZENCORE_SECRET || "CHANGE_ME";
let latest = null;
let history = [];

function send(res, code, body, type="application/json; charset=utf-8") {
  res.writeHead(code, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "");

  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        if (WEBHOOK_SECRET !== "CHANGE_ME" && data.secret !== WEBHOOK_SECRET) {
          return send(res, 401, JSON.stringify({ok:false, error:"Invalid secret"}));
        }
        latest = {...data, receivedAt: Date.now()};
        history.unshift(latest);
        history = history.slice(0, 100);
        console.log(`[ZenCore] ${latest.symbol || ""} ${latest.timeframe || ""} ${latest.action || ""}`);
        send(res, 200, JSON.stringify({ok:true}));
      } catch (e) {
        send(res, 400, JSON.stringify({ok:false, error:"Invalid JSON"}));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/health")
    return send(res, 200, JSON.stringify({ok:true, service:"zencore-web-control"}));

  if (req.method === "GET" && req.url === "/api/latest")
    return send(res, 200, JSON.stringify(latest || {}));

  if (req.method === "GET" && req.url === "/api/history")
    return send(res, 200, JSON.stringify(history));

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const p = path.join(__dirname, "index.html");
    return send(res, 200, fs.readFileSync(p), "text/html; charset=utf-8");
  }

  send(res, 404, JSON.stringify({ok:false, error:"Not found"}));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ZenCore Web Control running: http://localhost:${PORT}`);
  console.log(`TradingView webhook endpoint: http://YOUR_SERVER:${PORT}/webhook`);
});
