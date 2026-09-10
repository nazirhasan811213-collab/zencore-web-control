const http=require('http');

const PUBLIC_PORT=Number(process.env.PORT||8080);
const V17_PORT=10003;

// Run the existing prediction + analysis stack internally.
process.env.PORT=String(V17_PORT);
require('./server-v17.js');
process.env.PORT=String(PUBLIC_PORT);

function proxy(req,res,targetPath){
  const headers={...req.headers,host:`127.0.0.1:${V17_PORT}`};
  const p=http.request({
    hostname:'127.0.0.1',
    port:V17_PORT,
    path:targetPath||req.url,
    method:req.method,
    headers
  },u=>{
    res.writeHead(u.statusCode||200,u.headers);
    u.pipe(res);
  });
  p.on('error',e=>{
    if(res.headersSent){try{res.end()}catch(_){};return;}
    res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify({ok:false,error:'ZenCore analysis stack is starting',detail:e.message}));
  });
  req.pipe(p);
}

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  const pathname=url.pathname;

  // Analysis-first product: homepage is the XAUUSD analysis terminal.
  if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html')){
    return proxy(req,res,'/pair/XAUUSD');
  }

  // Radar UI intentionally disabled. Keep its backend internals untouched for now.
  if(req.method==='GET'&&(
    pathname==='/radar' ||
    pathname==='/market-radar' ||
    pathname==='/market-radar-v16.html' ||
    pathname==='/market-radar-v17.html' ||
    pathname==='/radar-v16.js' ||
    pathname==='/radar-v17.js'
  )){
    res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
    return res.end('Market Radar disabled. ZenCore is in Analysis Focus mode.');
  }

  return proxy(req,res);
});

server.listen(PUBLIC_PORT,'0.0.0.0',()=>{
  console.log(`ZenCore Analysis Focus gateway running on port ${PUBLIC_PORT} -> V17 ${V17_PORT}`);
});
