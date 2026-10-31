'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),{dataset}=require('./ib-demo-data');
const EMAIL='ib.demo@zencore.invalid',SALT='89f9f0ccdfa9321d8419ed9b77fc68f7',HASH='480d95aef7bb5e6ab179aa4b8bf1cd152f50db2d898b9003f692f10aa5ed89cd7d633fce799bc539892c7f4c5c2b402ecafc4650bec1748154e42c16a222ae8b',TTL=8*60*60*1000;
function createDemoHandler({now=Date.now,secure=true,credentials={email:EMAIL,salt:SALT,hash:HASH}}={}){
 const sessions=new Map(),attempts=new Map();
 const reply=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
 const cookie=(req,value,age)=>`zc_ib_demo=${value}; Path=/demo; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`;
 async function json(req){let body='';for await(const c of req){body+=c;if(body.length>8192)throw Object.assign(Error('Permintaan terlalu besar.'),{status:413});}try{const x=JSON.parse(body);if(!x||typeof x!=='object'||Array.isArray(x))throw Error();return x;}catch{throw Object.assign(Error('Permintaan tidak sah.'),{status:400});}}
 return async function handle(req,res,pathname){
  if(!pathname.startsWith('/demo/ib')||!(/^\/demo\/ib(?:\/|$)/.test(pathname)))return false;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  for(const [k,v]of sessions)if(v.expires<=now())sessions.delete(k);
  const token=(req.headers.cookie||'').match(/(?:^|;\s*)zc_ib_demo=([0-9a-f]{64})(?:;|$)/)?.[1],session=sessions.get(token);
  try{
   if(req.method==='GET'&&['/demo/ib','/demo/ib/','/demo/ib/app.js','/demo/ib/style.css'].includes(pathname)){
    const type=pathname.endsWith('.js')?'application/javascript':pathname.endsWith('.css')?'text/css':'text/html',file=pathname.endsWith('.js')?'ib-demo.js':pathname.endsWith('.css')?'ib-demo.css':'ib-demo.html';res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(fs.readFileSync(path.join(__dirname,file)));return true;
   }
   if(req.method==='POST'){
    let origin;try{origin=new URL(req.headers.origin).host}catch{}
    if(!origin||origin!==req.headers.host){reply(res,403,{ok:false,error:'Origin tidak dibenarkan.'});return true;}
   }
   if(req.method==='POST'&&pathname==='/demo/ib/login'){
    const key=req.socket.remoteAddress||'unknown';for(const[k,v]of attempts)if(v.until<=now())attempts.delete(k);
    if(attempts.size>=5000&&!attempts.has(key)){reply(res,429,{ok:false,error:'Cuba lagi kemudian.'});return true;}
    const limiter=attempts.get(key)||{count:0,until:now()+60000};attempts.set(key,limiter);if(++limiter.count>10){reply(res,429,{ok:false,error:'Terlalu banyak cubaan. Tunggu 1 minit.'});return true;}
    const b=await json(req),pass=typeof b.password==='string'?b.password:'';
    const match=pass.length<=200&&crypto.timingSafeEqual(await new Promise((resolve,reject)=>crypto.scrypt(pass,credentials.salt,64,(e,x)=>e?reject(e):resolve(x))),Buffer.from(credentials.hash,'hex'));
    if(b.email!==credentials.email||!match){reply(res,401,{ok:false,error:'ID atau kata laluan demo tidak sah.'});return true;}
    if(sessions.size>=64)sessions.delete(sessions.keys().next().value);
    const id=crypto.randomBytes(32).toString('hex');sessions.set(id,{expires:now()+TTL,data:dataset(),messages:[]});res.setHeader('Set-Cookie',cookie(req,id,TTL/1000));reply(res,200,{ok:true,demo:true});return true;
   }
   if(!session){reply(res,401,{ok:false,error:'Log masuk akaun IB demo.'});return true;}
   if(req.method==='GET'&&pathname==='/demo/ib/data'){reply(res,200,{ok:true,...session.data,messages:session.messages});return true;}
   if(req.method==='POST'&&pathname==='/demo/ib/logout'){sessions.delete(token);res.setHeader('Set-Cookie',cookie(req,'',0));reply(res,200,{ok:true});return true;}
   if(req.method==='POST'&&pathname==='/demo/ib/reset'){session.data=dataset();session.messages=[];reply(res,200,{ok:true,demo:true});return true;}
   if(req.method==='POST'&&pathname==='/demo/ib/client'){
    const b=await json(req),u=session.data.clients.find(x=>x.id===b.id);if(!u){reply(res,404,{ok:false,error:'Client demo tidak dijumpai.'});return true;}
    if(['expired','pending'].includes(u.status)){reply(res,403,{ok:false,error:'Akaun expired / pending memerlukan admin, termasuk dalam simulasi.'});return true;}
    if(!['active','disabled'].includes(b.status)){reply(res,400,{ok:false,error:'Status demo tidak sah.'});return true;}u.status=b.status;reply(res,200,{ok:true,demo:true});return true;
   }
   if(req.method==='POST'&&pathname==='/demo/ib/settings'){
    const b=await json(req);if(!['TF2','TF15'].includes(b.tf)||!Number.isFinite(b.lot)||b.lot<.01||b.lot>1||!Number.isInteger(b.layers)||b.layers<1||b.layers>5||typeof b.enabled!=='boolean'){reply(res,400,{ok:false,error:'Tetapan demo tidak sah.'});return true;}session.data.settings[b.tf]={lot:b.lot,layers:b.layers,enabled:b.enabled};reply(res,200,{ok:true,demo:true});return true;
   }
   if(req.method==='POST'&&pathname==='/demo/ib/message'){
    const b=await json(req),ids=Array.isArray(b.userIds)?[...new Set(b.userIds)]:[],text=typeof b.message==='string'?b.message.trim():'';
    if(!text||text.length>1000||!ids.length||ids.some(id=>!session.data.clients.some(x=>x.id===id))){reply(res,400,{ok:false,error:'Pilih client demo dan isi mesej maksimum 1000 aksara.'});return true;}
    if(session.messages.length>=50){reply(res,409,{ok:false,error:'Had demo dicapai. Reset demo untuk bermula semula.'});return true;}
    const m={id:'DEMO-M'+(session.messages.length+1),time:new Date(now()).toISOString(),type:'ADMIN',tf:'SEMUA',title:'📩 MESEJ IB DEMO',text:'🧪 DEMO • TIDAK DIHANTAR KE TELEGRAM\n\n'+text,recipients:ids,status:'SIMULATED_ONLY'};session.messages.unshift(m);reply(res,200,{ok:true,demo:true,message:m});return true;
   }
   reply(res,404,{ok:false,error:'Fungsi ini tiada dalam demo.'});return true;
  }catch(e){reply(res,e.status||500,{ok:false,error:e.status?e.message:'Demo tidak tersedia. Cuba lagi.'});return true;}
 };
}
module.exports={createDemoHandler,EMAIL};
