const http=require('http');
const fs=require('fs');
const path=require('path');

const PUBLIC_PORT=Number(process.env.PORT||8080);
const V17_PORT=10003;
const SITE_MODE=String(process.env.SITE_MODE||'legacy').toLowerCase();

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

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  const pathname=url.pathname;

  if(req.method==='GET'&&pathname==='/precision-entry.css')return sendAsset(res,'precision-entry.css','text/css; charset=utf-8');
  if(req.method==='GET'&&pathname==='/precision-entry.js')return sendAsset(res,'precision-entry.js','application/javascript; charset=utf-8');

  if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html')){
    if(SITE_MODE==='precision-entry')return sendAsset(res,'precision-entry.html','text/html; charset=utf-8');
    return sendAsset(res,'retired.html','text/html; charset=utf-8');
  }

  if(SITE_MODE!=='precision-entry'&&req.method==='GET'){
    return sendAsset(res,'retired.html','text/html; charset=utf-8');
  }

  return proxy(req,res);
});

server.listen(PUBLIC_PORT,'0.0.0.0',()=>{
  console.log(`ZenCore ${SITE_MODE==='precision-entry'?'Precision Entry':'Retired Legacy'} gateway running on port ${PUBLIC_PORT} -> V17 ${V17_PORT}`);
});
