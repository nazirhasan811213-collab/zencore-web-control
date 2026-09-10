const http=require('http');
const fs=require('fs');
const path=require('path');

const PUBLIC_PORT=Number(process.env.PORT||8080);
const V17_PORT=10003;

process.env.PORT=String(V17_PORT);
require('./server-v17.js');
process.env.PORT=String(PUBLIC_PORT);

function sendAsset(res,file,type){
  try{
    const body=fs.readFileSync(path.join(__dirname,file));
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store, no-cache, must-revalidate'});
    return res.end(body);
  }catch(e){
    res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});
    return res.end('Asset not found');
  }
}

function proxy(req,res,targetPath){
  const headers={...req.headers,host:`127.0.0.1:${V17_PORT}`};
  const p=http.request({hostname:'127.0.0.1',port:V17_PORT,path:targetPath||req.url,method:req.method,headers},u=>{
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

function proxyHtml(req,res,targetPath){
  const headers={...req.headers,host:`127.0.0.1:${V17_PORT}`};
  const p=http.request({hostname:'127.0.0.1',port:V17_PORT,path:targetPath,method:'GET',headers},u=>{
    const chunks=[];
    u.on('data',c=>chunks.push(c));
    u.on('end',()=>{
      let html=Buffer.concat(chunks).toString('utf8');
      if(!html.includes('/v18-chart.js'))html=html.replace('</body>','<script src="/v18-chart.js?v=18.0"></script></body>');
      if(!html.includes('/precision-ui-v19.js'))html=html.replace('</body>','<script src="/precision-ui-v19.js?v=19.0"></script></body>');
      if(!html.includes('/v19-state-consistency.js'))html=html.replace('</body>','<script src="/v19-state-consistency.js?v=19.1"></script></body>');
      html=html.replace(/<title>[^<]*<\/title>/i,'<title>ZenCore V19.1 — Precision Analysis Terminal</title>');
      res.writeHead(u.statusCode||200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, no-cache, must-revalidate'});
      res.end(html);
    });
  });
  p.on('error',e=>{
    res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify({ok:false,error:'ZenCore analysis page is starting',detail:e.message}));
  });
  p.end();
}

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  const pathname=url.pathname;

  if(req.method==='GET'&&pathname==='/v18-chart.js')return sendAsset(res,'v18-chart.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/precision-ui-v19.js')return sendAsset(res,'precision-ui-v19.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/v19-state-consistency.js')return sendAsset(res,'v19-state-consistency.js','application/javascript; charset=utf-8');

  if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html')){
    return proxyHtml(req,res,'/pair/XAUUSD');
  }

  if(req.method==='GET'&&/^\/pair\/[A-Za-z0-9._-]+\/?$/.test(pathname)){
    return proxyHtml(req,res,req.url);
  }

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
  console.log(`ZenCore V19.1 Precision Analysis gateway running on port ${PUBLIC_PORT} -> V17 ${V17_PORT}`);
});
