const http=require('http');
const fs=require('fs');
const path=require('path');

const PUBLIC_PORT=Number(process.env.PORT||8080);
const V16_PORT=PUBLIC_PORT===10001?10002:10001;
process.env.PORT=String(V16_PORT);
require('./server-v16.js');
process.env.PORT=String(PUBLIC_PORT);

const DEFAULT_MARKETS=['XAUUSD','EURUSD','GBPUSD','USDJPY','AUDUSD','NZDUSD','USDCAD','USDCHF','EURJPY','GBPJPY','EURGBP','AUDJPY'];
const latestBySymbol=new Map();
const historyBySymbol=new Map();
const marketClients=new Set();
const predictionClients=new Map();

const N=v=>{if(v===null||v===undefined||v===''||v==='null'||v==='NaN')return null;const x=Number(v);return Number.isFinite(x)?x:null};
const U=v=>String(v||'').toUpperCase();
const normSymbol=v=>U(v).replace(/^.*:/,'').replace(/[^A-Z0-9._-]/g,'');
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));

function dirText(v){
  const s=U(v);
  if(/BULL|BUY|LONG|UP/.test(s)) return 'BUY';
  if(/BEAR|SELL|SHORT|DOWN/.test(s)) return 'SELL';
  return 'WAIT';
}
function rr(d){
  const e=N(d?.entry),sl=N(d?.sl),tp=N(d?.tp3);
  if(e==null||sl==null||tp==null)return null;
  const r=Math.abs(e-sl); return r?Math.abs(tp-e)/r:null;
}
function freshness(ts){
  const age=Math.max(0,Date.now()-(N(ts)||0));
  return age<90000?'LIVE':age<240000?'STALE':'OFFLINE';
}
function zoneInfo(d){
  const e=N(d?.entry),a=N(d?.atr),c=N(d?.close);
  if(e==null||a==null||a<=0||c==null)return{state:'NO DATA',near:false,inZone:false,dist:null};
  const lo=e-a*.15,hi=e+a*.15,inZone=c>=lo&&c<=hi,dist=c<lo?lo-c:c>hi?c-hi:0,near=!inZone&&dist<=a*.28;
  return{state:inZone?'IN ENTRY ZONE':near?'NEAR ENTRY':c<lo?'BELOW ZONE':'ABOVE ZONE',near,inZone,dist,lo,hi};
}
function addEvidence(list,side,weight,label){ list.push({side,weight,label}); }
function recentPriceMomentum(symbol){
  const arr=(historyBySymbol.get(symbol)||[]).slice(-5);
  const closes=arr.map(x=>N(x.close)).filter(x=>x!=null);
  if(closes.length<3)return{dir:'WAIT',strength:0};
  const last=closes[closes.length-1],prev=closes[Math.max(0,closes.length-3)];
  const atr=N(arr[arr.length-1]?.atr); const move=last-prev;
  if(!atr||Math.abs(move)<atr*.10)return{dir:'WAIT',strength:0};
  return{dir:move>0?'BUY':'SELL',strength:Math.min(1.5,Math.abs(move)/atr)};
}
function rawForecastDir(d){
  const f=dirText(d?.forecast3Bars); if(f!=='WAIT')return f;
  const p=dirText(d?.powerText); if(p!=='WAIT')return p;
  return 'WAIT';
}
function predictionStability(symbol){
  const arr=(historyBySymbol.get(symbol)||[]).slice(-10);
  const dirs=arr.map(rawForecastDir).filter(x=>x!=='WAIT');
  if(!dirs.length)return 0;
  let flips=0; for(let i=1;i<dirs.length;i++)if(dirs[i]!==dirs[i-1])flips++;
  const last=dirs[dirs.length-1]; const share=dirs.filter(x=>x===last).length/dirs.length;
  let run=0;for(let i=dirs.length-1;i>=0&&dirs[i]===last;i--)run++;
  return clamp(Math.round(45+share*45+Math.min(10,run*2)-flips*12));
}
function predictionEngine(d,symbol){
  if(!d)return{direction:'WAIT',confidence:0,consensus:0,totalEvidence:0,strength:'NO DATA',horizon:'NEXT 1–3 BARS',reasons:[],conflict:true};
  const ev=[];
  const f3=dirText(d.forecast3Bars); if(f3!=='WAIT')addEvidence(ev,f3,28,'3-bar forecast');
  const p10=dirText(d.powerText); if(p10!=='WAIT')addEvidence(ev,p10,18,'10-bar market power');
  const ms=dirText(d.marketStructure); if(ms!=='WAIT')addEvidence(ev,ms,13,'market structure');
  const hema=dirText(d.hemaTrend); if(hema!=='WAIT')addEvidence(ev,hema,12,'HEMA trend');
  const mom=dirText(d.momentum); if(mom!=='WAIT')addEvidence(ev,mom,11,'momentum');
  const gt=N(d.globalTrend); if(gt!=null&&gt!==0)addEvidence(ev,gt>0?'BUY':'SELL',7,'global trend');
  for(const [k,label] of [['mtf1','MTF-1'],['mtf2','MTF-2'],['mtf3','MTF-3']]){ const v=N(d[k]);if(v!=null&&v!==0)addEvidence(ev,v>0?'BUY':'SELL',5,label); }
  const c=N(d.close),e9=N(d.ema9),e20=N(d.ema20),e50=N(d.ema50);
  if([c,e9,e20,e50].every(v=>v!=null)){
    if(c>e9&&e9>e20&&e20>e50)addEvidence(ev,'BUY',12,'EMA stack');
    else if(c<e9&&e9<e20&&e20<e50)addEvidence(ev,'SELL',12,'EMA stack');
  }
  const hf=N(d.hemaFast),hs=N(d.hemaSlow); if(hf!=null&&hs!=null&&hf!==hs)addEvidence(ev,hf>hs?'BUY':'SELL',8,'HEMA slope');
  const w1=N(d.waveTrend1),w2=N(d.waveTrend2); if(w1!=null&&w2!=null&&Math.abs(w1-w2)>.2)addEvidence(ev,w1>w2?'BUY':'SELL',7,'WaveTrend');
  const rsi=N(d.rsi); if(rsi!=null){if(rsi>=56)addEvidence(ev,'BUY',5,'RSI pressure');else if(rsi<=44)addEvidence(ev,'SELL',5,'RSI pressure');}
  const rpm=recentPriceMomentum(symbol); if(rpm.dir!=='WAIT')addEvidence(ev,rpm.dir,Math.round(7*rpm.strength),'recent price impulse');

  const buy=ev.filter(x=>x.side==='BUY').reduce((a,x)=>a+x.weight,0);
  const sell=ev.filter(x=>x.side==='SELL').reduce((a,x)=>a+x.weight,0);
  const leader=buy>=sell?'BUY':'SELL'; const lead=Math.abs(buy-sell);
  const leaderEvidence=ev.filter(x=>x.side===leader).sort((a,b)=>b.weight-a.weight);
  const totalWeight=buy+sell||1; const agreeWeight=Math.max(buy,sell)/totalWeight; const consensus=leaderEvidence.length;
  const chop=N(d.chopIndex); const chopPenalty=chop!=null?(chop>=65?22:chop>=58?12:chop<=38?-4:0):0;
  const conflict=(f3!=='WAIT'&&p10!=='WAIT'&&f3!==p10) || agreeWeight<.61;
  const freshPenalty=freshness(d.receivedAt)==='LIVE'?0:freshness(d.receivedAt)==='STALE'?18:40;
  const rvol=N(d.relativeVolume); const volumeBoost=rvol!=null&&rvol>=1.2?4:0;
  let confidence=50+lead*.28+(agreeWeight-.5)*42+Math.min(10,consensus*1.5)+volumeBoost-chopPenalty-freshPenalty-(conflict?10:0);
  confidence=clamp(Math.round(confidence));
  let direction='WAIT';
  if(lead>=24&&consensus>=4&&agreeWeight>=.64&&confidence>=68)direction=leader;
  if(chop!=null&&chop>=68&&confidence<84)direction='WAIT';
  if(f3!=='WAIT'&&p10!=='WAIT'&&f3!==p10&&confidence<82)direction='WAIT';

  const strength=direction==='WAIT'?(confidence>=70?'CONFLICT':'LOW'):confidence>=86?'STRONG':confidence>=76?'GOOD':'EARLY';
  const reasons=leaderEvidence.slice(0,4).map(x=>x.label);
  return{direction,confidence,consensus,totalEvidence:ev.length,strength,horizon:'NEXT 1–3 BARS',reasons,conflict,bullScore:buy,bearScore:sell,agreement:Math.round(agreeWeight*100),currentAction:U(d.action||'WAIT'),freshness:freshness(d.receivedAt)};
}
function predictionGrade(p){
  if(p.direction==='WAIT')return p.confidence>=75?'B':'C';
  if(p.confidence>=90&&p.consensus>=7)return'A+';
  if(p.confidence>=82&&p.consensus>=6)return'A';
  if(p.confidence>=74&&p.consensus>=5)return'B';
  if(p.confidence>=66)return'C';
  return'D';
}
function predictionReadiness(d,symbol,p){
  const z=zoneInfo(d),r=rr(d),st=predictionStability(symbol);
  let score=p.confidence*.56+st*.20+(p.consensus>=6?8:p.consensus>=4?4:0);
  if(z.inZone)score+=10;else if(z.near)score+=6;
  if(r!=null&&r>=1.5)score+=5;
  if(p.direction==='WAIT')score-=18;
  if(freshness(d.receivedAt)!=='LIVE')score-=20;
  return clamp(Math.round(score));
}
function predictionRadarScore(d,symbol,p){
  const rd=predictionReadiness(d,symbol,p),st=predictionStability(symbol),z=zoneInfo(d),r=rr(d);
  let score=p.confidence*.48+rd*.24+st*.16+(z.inZone?8:z.near?5:0)+(r!=null?Math.min(6,r*1.5):0);
  if(p.direction==='WAIT')score-=18; if(p.conflict)score-=6; return clamp(Math.round(score));
}
function predictionStatus(d,symbol,p){
  if(!d)return'OFFLINE'; const fresh=freshness(d.receivedAt); if(fresh==='OFFLINE')return'OFFLINE'; if(fresh==='STALE')return'STALE';
  if(d.tradeActive===true&&!d.tp3Hit&&!d.slHit)return'TRADE ACTIVE';
  const z=zoneInfo(d),rd=predictionReadiness(d,symbol,p),st=predictionStability(symbol);
  if(p.direction!=='WAIT'&&p.confidence>=82&&p.consensus>=6&&st>=65&&rd>=70&&(z.inZone||z.near))return'HOT PREDICTION';
  if(p.direction!=='WAIT'&&p.confidence>=74&&p.consensus>=5)return'PREDICTION READY';
  if(p.direction!=='WAIT'&&p.confidence>=68)return'WATCH';
  if(z.inZone||z.near)return'NEAR ENTRY'; return'WAIT';
}
function marketSummary(symbol){
  const d=latestBySymbol.get(symbol);
  if(!d)return{symbol,online:false,freshness:'OFFLINE',status:'OFFLINE',signal:'WAIT',prediction:'WAIT',predictionConfidence:0,predictionConsensus:0,predictionHorizon:'NEXT 1–3 BARS',currentAction:'WAIT',grade:'—',stability:0,readiness:0,radarScore:0,zone:'NO DATA',rr:null,price:null,timeframe:'—',receivedAt:null,tradeActive:false,reasons:[]};
  const p=predictionEngine(d,symbol),z=zoneInfo(d),st=predictionStability(symbol),rd=predictionReadiness(d,symbol,p);
  return{symbol,online:true,freshness:freshness(d.receivedAt),status:predictionStatus(d,symbol,p),signal:p.direction,prediction:p.direction,predictionConfidence:p.confidence,predictionConsensus:p.consensus,predictionEvidence:p.totalEvidence,predictionAgreement:p.agreement,predictionStrength:p.strength,predictionHorizon:p.horizon,predictionConflict:p.conflict,reasons:p.reasons,currentAction:p.currentAction,grade:predictionGrade(p),stability:st,readiness:rd,radarScore:predictionRadarScore(d,symbol,p),zone:z.state,rr:rr(d),price:N(d.close),timeframe:String(d.timeframe||'—'),receivedAt:N(d.receivedAt),tradeActive:d.tradeActive===true&&!d.tp3Hit&&!d.slHit,setupProbability:N(d.setupProbability),confluence:N(d.confluenceStars),feedMode:d.confirmed===false?'INTRABAR':'BAR-CLOSE'};
}
function priority(m){return m.status==='TRADE ACTIVE'?700:m.status==='HOT PREDICTION'?600:m.status==='PREDICTION READY'?500:m.status==='WATCH'?400:m.status==='NEAR ENTRY'?300:m.status==='WAIT'?200:m.status==='STALE'?80:0;}
function marketsPayload(){
  const symbols=[...new Set([...DEFAULT_MARKETS,...latestBySymbol.keys()])];
  const markets=symbols.map(marketSummary).sort((a,b)=>(priority(b)+b.radarScore)-(priority(a)+a.radarScore));
  const count=s=>markets.filter(m=>m.status===s).length; const live=markets.filter(m=>m.freshness==='LIVE').length;
  const best=markets.filter(m=>m.freshness==='LIVE'&&m.prediction!=='WAIT').sort((a,b)=>b.radarScore-a.radarScore)[0]||null;
  return{ok:true,engine:'ZenCore Forward Prediction Ensemble v17',generatedAt:Date.now(),note:'Prediction confidence is an ensemble quality score, not a guaranteed win probability.',summary:{markets:markets.length,live,hot:count('HOT PREDICTION'),ready:count('PREDICTION READY'),active:count('TRADE ACTIVE'),near:count('NEAR ENTRY'),watch:count('WATCH'),offline:count('OFFLINE')},best,markets};
}
function broadcastMarkets(){const payload=JSON.stringify(marketsPayload());for(const res of marketClients){try{res.write(`event: markets\ndata: ${payload}\n\n`)}catch(_){marketClients.delete(res)}}}
function broadcastPrediction(symbol){const set=predictionClients.get(symbol);if(!set)return;const payload=JSON.stringify(marketSummary(symbol));for(const res of set){try{res.write(`event: prediction\ndata: ${payload}\n\n`)}catch(_){set.delete(res)}}}
function captureBody(body){
  let parsed=null;try{parsed=JSON.parse(body)}catch(_){}
  if(parsed&&parsed.source==='ZenCore AI Dashboard Pro + Alerts'){
    const symbol=normSymbol(parsed.symbol||parsed.tickerid);if(!symbol)return;
    const d={...parsed,symbol,receivedAt:Date.now(),feedType:parsed.feedType||'LIVE'}; latestBySymbol.set(symbol,d);
    const arr=historyBySymbol.get(symbol)||[]; const key=N(d.time)||N(d.barIndex)||Date.now();
    const i=arr.findIndex(x=>(N(x.time)||N(x.barIndex))===key); if(i>=0)arr[i]=d;else arr.push(d); if(arr.length>600)arr.splice(0,arr.length-600); historyBySymbol.set(symbol,arr);
    broadcastMarkets();broadcastPrediction(symbol);
  }
}
function send(res,code,body,type='application/json; charset=utf-8'){res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store, no-cache, must-revalidate','Pragma':'no-cache','Access-Control-Allow-Origin':'*'});res.end(body);}
function readBody(req,limit=160000){return new Promise(resolve=>{let b='';req.on('data',c=>{if(b.length<limit)b+=c});req.on('end',()=>resolve(b))})}
function proxy(req,res,body=null){
  const headers={...req.headers,host:`127.0.0.1:${V16_PORT}`}; if(body!==null)headers['content-length']=Buffer.byteLength(body);
  const p=http.request({hostname:'127.0.0.1',port:V16_PORT,path:req.url,method:req.method,headers},u=>{res.writeHead(u.statusCode||200,u.headers);u.pipe(res)});
  p.on('error',e=>send(res,503,JSON.stringify({ok:false,error:'ZenCore V16 core starting',detail:e.message}))); if(body!==null)p.end(body);else req.pipe(p);
}
function serveFile(res,file,type){try{return send(res,200,fs.readFileSync(path.join(__dirname,file)),type)}catch(e){return send(res,404,JSON.stringify({ok:false,error:'Asset not found',file}))}}
function proxyPairHtml(req,res,symbol){
  const p=http.request({hostname:'127.0.0.1',port:V16_PORT,path:req.url,method:'GET',headers:{host:`127.0.0.1:${V16_PORT}`}},u=>{
    const chunks=[];u.on('data',c=>chunks.push(c));u.on('end',()=>{let html=Buffer.concat(chunks).toString('utf8');if(!html.includes('/prediction-ui-v17.js'))html=html.replace('</body>',`<script src="/prediction-ui-v17.js?v=17.0"></script></body>`);html=html.replace(/<title>[^<]*<\/title>/i,`<title>ZenCore ${symbol} — Forward Prediction Analysis</title>`);send(res,u.statusCode||200,html,'text/html; charset=utf-8')});
  });p.on('error',e=>send(res,503,JSON.stringify({ok:false,error:'Pair page starting',detail:e.message})));p.end();
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`),pathname=url.pathname;
  if(req.method==='OPTIONS')return send(res,204,'');
  if(req.method==='POST'&&pathname==='/webhook'){const body=await readBody(req);captureBody(body);return proxy(req,res,body);}
  if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html'))return serveFile(res,'market-radar-v17.html','text/html; charset=utf-8');
  if(req.method==='GET'&&pathname==='/radar-v17.js')return serveFile(res,'radar-v17.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/prediction-ui-v17.js')return serveFile(res,'prediction-ui-v17.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/api/markets')return send(res,200,JSON.stringify(marketsPayload()));
  if(req.method==='GET'&&pathname==='/market-events'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*','X-Accel-Buffering':'no'});marketClients.add(res);res.write(`event: markets\ndata: ${JSON.stringify(marketsPayload())}\n\n`);const ping=setInterval(()=>{try{res.write(': ping\n\n')}catch(_){}},20000);req.on('close',()=>{clearInterval(ping);marketClients.delete(res)});return;
  }
  let m=pathname.match(/^\/api\/prediction\/([A-Za-z0-9._-]+)$/); if(req.method==='GET'&&m){const s=normSymbol(m[1]);return send(res,200,JSON.stringify(marketSummary(s)))}
  m=pathname.match(/^\/prediction-events\/([A-Za-z0-9._-]+)$/); if(req.method==='GET'&&m){const s=normSymbol(m[1]);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*','X-Accel-Buffering':'no'});if(!predictionClients.has(s))predictionClients.set(s,new Set());predictionClients.get(s).add(res);res.write(`event: prediction\ndata: ${JSON.stringify(marketSummary(s))}\n\n`);const ping=setInterval(()=>{try{res.write(': ping\n\n')}catch(_){}},20000);req.on('close',()=>{clearInterval(ping);predictionClients.get(s)?.delete(res)});return;}
  m=pathname.match(/^\/pair\/([A-Za-z0-9._-]+)\/?$/); if(req.method==='GET'&&m)return proxyPairHtml(req,res,normSymbol(m[1]));
  return proxy(req,res);
});

server.listen(PUBLIC_PORT,'0.0.0.0',()=>console.log(`ZenCore V17 Forward Prediction gateway running on port ${PUBLIC_PORT} -> V16 ${V16_PORT}`));
