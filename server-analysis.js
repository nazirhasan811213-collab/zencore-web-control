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
      if(!html.includes('/precision-ui-v19.js'))html=html.replace('</body>','<script src="/precision-ui-v19.js?v=28.0"></script></body>');
      if(!html.includes('/v19-state-consistency.js'))html=html.replace('</body>','<script src="/v19-state-consistency.js?v=30.1"></script></body>');
      if(!html.includes('/secure-profit-v20.js'))html=html.replace('</body>','<script src="/secure-profit-v20.js?v=20.2"></script></body>');
      if(!html.includes('/trader-flow-v22.js'))html=html.replace('</body>','<script src="/trader-flow-v22.js?v=22.3"></script></body>');
      if(!html.includes('/smart-motion-v23.js'))html=html.replace('</body>','<script src="/smart-motion-v23.js?v=23.2"></script></body>');
      if(!html.includes('/interactive-layout-v24.js'))html=html.replace('</body>','<script src="/interactive-layout-v24.js?v=24.1"></script></body>');
      if(!html.includes('/trader-cockpit-v25.js'))html=html.replace('</body>','<script src="/trader-cockpit-v25.js?v=30.1"></script></body>');
      if(!html.includes('/dual-strategy-v28.js'))html=html.replace('</body>','<script src="/dual-strategy-v28.js?v=28.1"></script></body>');
      if(!html.includes('/strategy-isolation-v29.js'))html=html.replace('</body>','<script src="/strategy-isolation-v29.js?v=29.2"></script></body>');
      if(!html.includes('/final-layout-v30.js'))html=html.replace('</body>','<script src="/final-layout-v30.js?v=30.1"></script></body>');
      html=html.replace(/<title>[^<]*<\/title>/i,'<title>ZenCore V30.1 — Clean Trader View</title>');
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
  if(req.method==='GET'&&pathname==='/secure-profit-v20.js')return sendAsset(res,'secure-profit-v20.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/trader-flow-v21.js')return sendAsset(res,'trader-flow-v21.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/trader-flow-v22.js')return sendAsset(res,'trader-flow-v22.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/smart-motion-v23.js')return sendAsset(res,'smart-motion-v23.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/interactive-layout-v24.js')return sendAsset(res,'interactive-layout-v24.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/trader-cockpit-v25.js')return sendAsset(res,'trader-cockpit-v25.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/dual-timeframe-v27.js')return sendAsset(res,'dual-timeframe-v27.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/dual-strategy-v28.js')return sendAsset(res,'dual-strategy-v28.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/strategy-isolation-v29.js')return sendAsset(res,'strategy-isolation-v29.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/final-layout-v30.js')return sendAsset(res,'final-layout-v30.js','application/javascript; charset=utf-8');

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
  console.log(`ZenCore V30.1 Clean Trader View gateway running on port ${PUBLIC_PORT} -> V17 ${V17_PORT}`);
});
