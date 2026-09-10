const http = require('http');

const PUBLIC_PORT = Number(process.env.PORT || 8080);
const CORE_PORT = PUBLIC_PORT === 10001 ? 10002 : 10001;

// Keep the proven ZenCore analysis server untouched on an internal port.
process.env.PORT = String(CORE_PORT);
require('./server-v9.js');
process.env.PORT = String(PUBLIC_PORT);

function injectV14(html){
  if(html.includes('/v14-ui.js')) return html;
  return html.replace('</body>','<script src="/v14-ui.js?v=14.0"></script>\n</body>');
}

const gateway = http.createServer((req,res)=>{
  const pathname = new URL(req.url,`http://${req.headers.host || 'localhost'}`).pathname;

  if(req.method === 'GET' && pathname === '/v14-ui.js'){
    try{
      const fs = require('fs');
      const path = require('path');
      const body = fs.readFileSync(path.join(__dirname,'v14-ui.js'));
      res.writeHead(200,{
        'Content-Type':'application/javascript; charset=utf-8',
        'Cache-Control':'no-store, no-cache, must-revalidate',
        'Access-Control-Allow-Origin':'*'
      });
      return res.end(body);
    }catch(e){
      res.writeHead(404,{'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:false,error:'V14 UI asset not found'}));
    }
  }

  const headers={...req.headers,host:`127.0.0.1:${CORE_PORT}`};
  const proxy=http.request({
    hostname:'127.0.0.1',
    port:CORE_PORT,
    path:req.url,
    method:req.method,
    headers
  },upstream=>{
    const type=String(upstream.headers['content-type']||'');
    const isHtml=(pathname==='/'||pathname==='/index.html')&&type.includes('text/html');

    if(!isHtml){
      res.writeHead(upstream.statusCode||200,upstream.headers);
      upstream.pipe(res);
      return;
    }

    const chunks=[];
    upstream.on('data',c=>chunks.push(c));
    upstream.on('end',()=>{
      const body=injectV14(Buffer.concat(chunks).toString('utf8'));
      const outHeaders={...upstream.headers};
      delete outHeaders['content-length'];
      outHeaders['content-length']=Buffer.byteLength(body);
      outHeaders['cache-control']='no-store, no-cache, must-revalidate';
      res.writeHead(upstream.statusCode||200,outHeaders);
      res.end(body);
    });
  });

  proxy.on('error',err=>{
    if(res.headersSent){try{res.end()}catch(_){};return;}
    res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Retry-After':'1'});
    res.end(JSON.stringify({ok:false,error:'ZenCore core is starting',detail:err.message}));
  });

  req.pipe(proxy);
});

gateway.listen(PUBLIC_PORT,'0.0.0.0',()=>{
  console.log(`ZenCore V14 Visual Intelligence gateway running on port ${PUBLIC_PORT} -> core ${CORE_PORT}`);
});
