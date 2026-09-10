const http=require('http');
const fs=require('fs');
const path=require('path');

const PUBLIC_PORT=Number(process.env.PORT||8080);
const CORE_PORT=PUBLIC_PORT===10001?10002:10001;
process.env.PORT=String(CORE_PORT);
require('./server-v9.js');
process.env.PORT=String(PUBLIC_PORT);

const DEFAULT_MARKETS=['XAUUSD','EURUSD','GBPUSD','USDJPY','AUDUSD','NZDUSD','USDCAD','USDCHF','EURJPY','GBPJPY','EURGBP','AUDJPY'];
const latestBySymbol=new Map();
const historyBySymbol=new Map();
const marketClients=new Set();
const pairClients=new Map();

const N=v=>{if(v===null||v===undefined||v===''||v==='null')return null;const x=Number(v);return Number.isFinite(x)?x:null};
const U=v=>String(v||'').toUpperCase();
const normSymbol=v=>U(v).replace(/^.*:/,'').replace(/[^A-Z0-9._-]/g,'');
function actionDir(v){const s=U(v);if(s==='BUY'||s.includes('LONG'))return'BUY';if(s==='SELL'||s.includes('SHORT'))return'SELL';return'WAIT'}
function grade(d){const p=N(d?.setupProbability)||0,s=N(d?.confluenceStars)||0;if(p>=85&&s>=4)return'A+';if(p>=75&&s>=4)return'A';if(p>=65&&s>=3)return'B';if(p>=55)return'C';return'D'}
function rr(d){const e=N(d?.entry),sl=N(d?.sl),tp=N(d?.tp3);if(e==null||sl==null||tp==null)return null;const r=Math.abs(e-sl);return r?Math.abs(tp-e)/r:null}
function freshness(ts){const age=Math.max(0,Date.now()-(N(ts)||0));return age<120000?'LIVE':age<300000?'STALE':'OFFLINE'}
function zoneInfo(d){const e=N(d?.entry),a=N(d?.atr),c=N(d?.close);if(e==null||a==null||a<=0||c==null)return{state:'NO DATA',near:false,inZone:false,dist:null};const lo=e-a*.15,hi=e+a*.15,inZone=c>=lo&&c<=hi,dist=c<lo?lo-c:c>hi?c-hi:0,near=!inZone&&dist<=a*.25;return{state:inZone?'IN ENTRY ZONE':near?'NEAR ENTRY':c<lo?'BELOW ZONE':'ABOVE ZONE',near,inZone,dist,lo,hi}}
function stability(symbol){const arr=(historyBySymbol.get(symbol)||[]).slice(-12).map(x=>actionDir(x.action)).filter(x=>x!=='WAIT');if(!arr.length)return 0;let flips=0;for(let i=1;i<arr.length;i++)if(arr[i]!==arr[i-1])flips++;const last=arr[arr.length-1],same=arr.filter(x=>x===last).length,share=same/arr.length;let run=0;for(let i=arr.length-1;i>=0&&arr[i]===last;i--)run++;let score=100-flips*15-(1-share)*40+Math.min(run*3,12);if(arr.length<5)score-=15;return Math.max(0,Math.min(100,Math.round(score)))}
function mtfAlign(d,dir){return [N(d?.mtf1),N(d?.mtf2),N(d?.mtf3)].filter(v=>v!=null&&(dir==='BUY'?v>0:dir==='SELL'?v<0:false)).length}
function readiness(d,symbol){const dir=actionDir(d?.action),z=zoneInfo(d),r=rr(d);let score=(N(d?.setupProbability)||0)*.35+(N(d?.confluenceStars)||0)*8+mtfAlign(d,dir)*5;if(z.inZone)score+=10;else if(z.near)score+=6;if(r!=null&&r>=1.5)score+=5;if(freshness(d?.receivedAt)!=='LIVE')score-=25;if(dir==='WAIT')score-=10;return Math.max(0,Math.min(100,Math.round(score)))}
function radarScore(d,symbol){const g=grade(d),gPts={'A+':25,'A':22,'B':16,'C':9,'D':4}[g]||0,z=zoneInfo(d),st=stability(symbol),rd=readiness(d,symbol),r=rr(d);let score=gPts+st*.3+rd*.3+(z.inZone?12:z.near?7:0)+(r!=null?Math.min(8,r*2):0);if(d?.tradeActive===true&&!d?.tp3Hit&&!d?.slHit)score+=15;if(freshness(d?.receivedAt)!=='LIVE')score-=35;return Math.max(0,Math.min(100,Math.round(score)))}
function statusOf(d,symbol){if(!d)return'OFFLINE';const fresh=freshness(d.receivedAt);if(fresh==='OFFLINE')return'OFFLINE';if(fresh==='STALE')return'STALE';if(d.tradeActive===true&&!d.tp3Hit&&!d.slHit)return'TRADE ACTIVE';const exact=['BUY','SELL'].includes(U(d.action)),g=grade(d),st=stability(symbol),rd=readiness(d,symbol),z=zoneInfo(d),r=rr(d);if(exact&&['A+','A'].includes(g)&&st>=65&&rd>=70&&r!=null&&r>=1.5&&(z.inZone||z.near))return'HOT SETUP';if((exact||g==='B')&&rd>=55&&(z.inZone||z.near))return'WATCH';if(z.near||z.inZone)return'NEAR ENTRY';return'WAIT'}
function marketSummary(symbol){const d=latestBySymbol.get(symbol);if(!d)return{symbol,online:false,freshness:'OFFLINE',status:'OFFLINE',signal:'WAIT',grade:'—',stability:0,readiness:0,radarScore:0,zone:'NO DATA',rr:null,price:null,timeframe:'—',receivedAt:null,tradeActive:false};const z=zoneInfo(d);return{symbol,online:true,freshness:freshness(d.receivedAt),status:statusOf(d,symbol),signal:actionDir(d.action),rawAction:d.action||'WAIT',grade:grade(d),stability:stability(symbol),readiness:readiness(d,symbol),radarScore:radarScore(d,symbol),zone:z.state,rr:rr(d),price:N(d.close),timeframe:String(d.timeframe||'—'),receivedAt:N(d.receivedAt),tradeActive:d.tradeActive===true&&!d.tp3Hit&&!d.slHit,setupProbability:N(d.setupProbability),confluence:N(d.confluenceStars),mtfAligned:mtfAlign(d,actionDir(d.action))}}
function priority(m){return m.status==='TRADE ACTIVE'?600:m.status==='HOT SETUP'?500:m.status==='NEAR ENTRY'?400:m.status==='WATCH'?350:m.status==='WAIT'?200:m.status==='STALE'?80:0}
function marketsPayload(){const symbols=[...new Set([...DEFAULT_MARKETS,...latestBySymbol.keys()])];const markets=symbols.map(marketSummary).sort((a,b)=>(priority(b)+b.radarScore)-(priority(a)+a.radarScore));const count=s=>markets.filter(m=>m.status===s).length;const live=markets.filter(m=>m.freshness==='LIVE').length;const best=markets.filter(m=>m.status!=='OFFLINE'&&m.freshness==='LIVE').sort((a,b)=>b.radarScore-a.radarScore)[0]||null;return{ok:true,generatedAt:Date.now(),summary:{markets:markets.length,live,hot:count('HOT SETUP'),active:count('TRADE ACTIVE'),near:count('NEAR ENTRY'),watch:count('WATCH'),offline:count('OFFLINE')},best,markets}}
function broadcastMarkets(){const payload=JSON.stringify(marketsPayload());for(const res of marketClients){try{res.write(`event: markets\ndata: ${payload}\n\n`)}catch(_){marketClients.delete(res)}}}
function broadcastPair(symbol,name,data){const set=pairClients.get(symbol);if(!set)return;const packet=`${name&&name!=='message'?`event: ${name}\n`:''}data: ${JSON.stringify(data)}\n\n`;for(const res of set){try{res.write(packet)}catch(_){set.delete(res)}}}
function broadcastAlertAll(message){for(const [symbol] of pairClients)broadcastPair(symbol,'alert',{time:Date.now(),message:String(message||'').slice(0,2000)})}
function captureBody(body){let parsed=null;try{parsed=JSON.parse(body)}catch(_){}
  if(parsed&&parsed.source==='ZenCore AI Dashboard Pro + Alerts'){
    const symbol=normSymbol(parsed.symbol||parsed.tickerid);if(!symbol)return;
    const d={...parsed,symbol,receivedAt:Date.now(),feedType:parsed.feedType||'LIVE'};
    latestBySymbol.set(symbol,d);const arr=historyBySymbol.get(symbol)||[];arr.push(d);if(arr.length>500)arr.splice(0,arr.length-500);historyBySymbol.set(symbol,arr);
    broadcastPair(symbol,'message',d);broadcastMarkets();
  }else if(body&&body.trim())broadcastAlertAll(parsed&&typeof parsed==='string'?parsed:body.trim());
}
function send(res,code,body,type='application/json; charset=utf-8'){res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store, no-cache, must-revalidate','Access-Control-Allow-Origin':'*'});res.end(body)}
function serveFile(res,file,type){try{return send(res,200,fs.readFileSync(path.join(__dirname,file)),type)}catch(e){return send(res,404,JSON.stringify({ok:false,error:'Asset not found'}))}}
function readBody(req,limit=120000){return new Promise(resolve=>{let body='';req.on('data',c=>{if(body.length<limit)body+=c});req.on('end',()=>resolve(body))})}
function proxySimple(req,res){const headers={...req.headers,host:`127.0.0.1:${CORE_PORT}`};const p=http.request({hostname:'127.0.0.1',port:CORE_PORT,path:req.url,method:req.method,headers},u=>{res.writeHead(u.statusCode||200,u.headers);u.pipe(res)});p.on('error',e=>send(res,503,JSON.stringify({ok:false,error:'ZenCore core starting',detail:e.message})));req.pipe(p)}
function proxyBody(req,res,body){const headers={...req.headers,host:`127.0.0.1:${CORE_PORT}`,'content-length':Buffer.byteLength(body)};const p=http.request({hostname:'127.0.0.1',port:CORE_PORT,path:req.url,method:req.method,headers},u=>{res.writeHead(u.statusCode||200,u.headers);u.pipe(res)});p.on('error',e=>send(res,503,JSON.stringify({ok:false,error:'ZenCore core starting',detail:e.message})));p.end(body)}
function pairHtml(res,symbol){const p=http.request({hostname:'127.0.0.1',port:CORE_PORT,path:'/',method:'GET',headers:{host:`127.0.0.1:${CORE_PORT}`}},u=>{const chunks=[];u.on('data',c=>chunks.push(c));u.on('end',()=>{let html=Buffer.concat(chunks).toString('utf8');const head=`<script>window.__ZENCORE_PAIR__=${JSON.stringify(symbol)};</script><script src="/pair-context-v16.js?v=16.0"></script>`;html=html.replace('</head>',head+'</head>');html=html.replace('</body>','<script src="/v14-ui.js?v=14.2"></script><script src="/v15-chart.js?v=15.0"></script></body>');html=html.replace(/<title>[^<]*<\/title>/i,`<title>ZenCore ${symbol} — Pair Analysis</title>`);send(res,u.statusCode||200,html,'text/html; charset=utf-8')})});p.on('error',e=>send(res,503,JSON.stringify({ok:false,error:'Pair analysis starting',detail:e.message})));p.end()}

const gateway=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`),pathname=url.pathname;
  if(req.method==='OPTIONS')return send(res,204,'');
  if(req.method==='POST'&&pathname==='/webhook'){const body=await readBody(req);captureBody(body);return proxyBody(req,res,body)}
  if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html'))return serveFile(res,'market-radar-v16.html','text/html; charset=utf-8');
  if(req.method==='GET'&&pathname==='/radar-v16.css')return serveFile(res,'radar-v16.css','text/css; charset=utf-8');
  if(req.method==='GET'&&pathname==='/radar-v16.js')return serveFile(res,'radar-v16.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/pair-context-v16.js')return serveFile(res,'pair-context-v16.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/v14-ui.js')return serveFile(res,'v14-ui.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/v15-chart.js')return serveFile(res,'v15-chart.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/api/markets')return send(res,200,JSON.stringify(marketsPayload()));
  if(req.method==='GET'&&pathname==='/market-events'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*','X-Accel-Buffering':'no'});marketClients.add(res);res.write(`event: markets\ndata: ${JSON.stringify(marketsPayload())}\n\n`);const ping=setInterval(()=>{try{res.write(': ping\n\n')}catch(_){}},25000);req.on('close',()=>{clearInterval(ping);marketClients.delete(res)});return;
  }
  let m=pathname.match(/^\/api\/market\/([A-Za-z0-9._-]+)$/);if(req.method==='GET'&&m){const symbol=normSymbol(m[1]);return send(res,200,JSON.stringify(latestBySymbol.get(symbol)||{}))}
  m=pathname.match(/^\/api\/history\/([A-Za-z0-9._-]+)$/);if(req.method==='GET'&&m){const symbol=normSymbol(m[1]);return send(res,200,JSON.stringify(historyBySymbol.get(symbol)||[]))}
  m=pathname.match(/^\/api\/journal\/([A-Za-z0-9._-]+)$/);if(req.method==='GET'&&m){const symbol=normSymbol(m[1]);const rows=(historyBySymbol.get(symbol)||[]).filter(x=>['BUY','SELL'].includes(U(x.action)));return send(res,200,JSON.stringify(rows))}
  m=pathname.match(/^\/events\/([A-Za-z0-9._-]+)$/);if(req.method==='GET'&&m){const symbol=normSymbol(m[1]);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*','X-Accel-Buffering':'no'});if(!pairClients.has(symbol))pairClients.set(symbol,new Set());pairClients.get(symbol).add(res);const d=latestBySymbol.get(symbol);if(d)res.write(`data: ${JSON.stringify(d)}\n\n`);const ping=setInterval(()=>{try{res.write(': ping\n\n')}catch(_){}},25000);req.on('close',()=>{clearInterval(ping);pairClients.get(symbol)?.delete(res)});return}
  m=pathname.match(/^\/pair\/([A-Za-z0-9._-]+)\/?$/);if(req.method==='GET'&&m)return pairHtml(res,normSymbol(m[1]));
  return proxySimple(req,res);
});

gateway.listen(PUBLIC_PORT,'0.0.0.0',()=>console.log(`ZenCore V16 Multi-Pair Command Center running on port ${PUBLIC_PORT} -> core ${CORE_PORT}`));
