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
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") return send(res, 204, "");

  if (req.method === "POST" && pathname === "/webhook") {
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
        return send(res, 200, JSON.stringify({ok:true}));
      } catch (e) {
        return send(res, 400, JSON.stringify({ok:false, error:"Invalid JSON"}));
      }
    });
    return;
  }

  if (req.method === "GET" && pathname === "/health")
    return send(res, 200, JSON.stringify({ok:true, service:"zencore-web-control"}));

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
