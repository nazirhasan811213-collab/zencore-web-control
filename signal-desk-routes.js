'use strict';
const fs=require('node:fs'),path=require('node:path');
const PREFIX='/signal-desk/';
const bundle=['styles.css','app.js','evidence.js','fusion.js','fusion-ui.js','live.js','website.js','visual-live.js'];
const native=['native-host.js','native-mount.js','native-mount.css'];
const enabled=(env=process.env)=>/^(1|true|yes|on)$/i.test(env.ZENCORE_AUTH_ENABLED||'')&&env.ZENCORE_PRODUCT_NAME==='ZenCore Errante';
const deskCsp="default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'";
function analysisHtml(html){
 return html.replace('</head>','<link rel="stylesheet" href="/signal-desk/native-mount.css?v=1"><script defer src="/signal-desk/native-mount.js?v=1"></script></head>');
}
function deskHtml(html){
 return html.replace('</head>','<meta name="zencore-desk-host" content="errante"><script defer src="native-host.js"></script></head>');
}
function sendHtml(res,html,embedded=false){
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, no-cache, must-revalidate','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':embedded?'SAMEORIGIN':'DENY',...(embedded?{'Content-Security-Policy':deskCsp}:{}),'Permissions-Policy':'camera=(), microphone=(), geolocation=()'});
 res.end(html);
}
function createHandler({active,requireSession,sendAsset,sendJson,root=__dirname}){
 return async function handle(req,res,pathname){
  if(pathname!=='/signal-desk'&&!pathname.startsWith(PREFIX))return false;
  if(!active){sendJson(res,404,{ok:false,error:'Not found'});return true;}
  if(!await requireSession(req,res,req.method==='GET'?'/login':null))return true;
  if(req.method!=='GET'){sendJson(res,405,{ok:false,error:'Paparan baca sahaja.'},{Allow:'GET'});return true;}
  if(pathname==='/signal-desk'){res.writeHead(302,{Location:PREFIX,'Cache-Control':'no-store'});res.end();return true;}
  const file=pathname.slice(PREFIX.length);
  if(file===''||file==='index.html')sendHtml(res,deskHtml(fs.readFileSync(path.join(root,'signal-desk/index.html'),'utf8')),true);
  else if(bundle.includes(file)||native.includes(file))sendAsset(res,path.join(native.includes(file)?'signal-desk-native':'signal-desk',file),file.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8');
  else sendJson(res,404,{ok:false,error:'Not found'});
  return true;
 };
}
module.exports={enabled,analysisHtml,deskHtml,sendHtml,createHandler};
