'use strict';
const {dualAnalysis}=require('./analysis-dual-model');
const {listConnectionMonitor}=require('./connection-monitor');
const stamp=v=>{const n=typeof v==='number'?v:Date.parse(v);return Number.isFinite(n)&&n>0?n:null;};
const code=v=>String(v||'UNKNOWN').replace(/[^A-Z0-9_.-]/gi,'').slice(0,60);
const hints={CHECK_MT5:'Semak izin Terminal / Akaun / EA yang ditanda ✗.',UPDATE_REQUIRED:'Kemas kini versi Connector.',BLOCKED_REAL:'Akaun REAL memerlukan EA dan Connector yang menyokong REAL.',CONNECTED_LOCKED:'Sambungan ada; akses execution belum dibuka untuk akaun ini.',HOST_BLOCKED:'Host execution belum dibenarkan.',HOSTED_ERROR:'Worker MT5 melaporkan ralat. Semak log worker.',HOSTED_CONNECTED_LOCKED:'Sambungan hosted ada; semak izin MT5, versi Connector dan akses execution.'};
async function bounded(work,ms=6000){let timer;try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('MONITOR_TIMEOUT')),ms);})]);}finally{clearTimeout(timer);}}
function clientView(r,now){
 const lastSeenAt=stamp(r.lastSeenAt), linked=r.transport!=='NOT_LINKED';
 const fresh=lastSeenAt!==null&&lastSeenAt<=now+5000&&now-lastSeenAt<=30000;
 const online=linked&&fresh&&r.connection?.online===true;
 const ready=online&&r.connection?.ready===true;
 return {userId:r.userId,client:{displayName:r.client?.displayName||'',email:r.client?.email||'',ibName:r.client?.ibName||null},tradingActivity:r.tradingActivity||null,lastLoginAt:stamp(r.client?.lastLoginAt),transport:code(r.transport),accountMask:r.accountMask||null,serverMask:r.serverMask||null,tradeMode:['DEMO','REAL'].includes(r.tradeMode)?r.tradeMode:'UNKNOWN',connectorVersion:r.connectorVersion||null,lastSeenAt,online,ready,state:!linked?'NOT_LINKED':!fresh?'OFFLINE':code(r.connection?.state),permissions:{terminal:r.permissions?.terminal===true,account:r.permissions?.account===true,expert:r.permissions?.expert===true},control:{desiredState:code(r.control?.desiredState),effectiveState:code(r.control?.effectiveState)}};
}
function createAdminMonitoring(deps){
 let cache=null,inFlight=null;
 async function collect(user){
  const observedAt=Date.now(),components=[],alerts=[];
  const add=(id,label,status,detail)=>{components.push({id,label,status,detail});if(['ERROR','WARNING','UNKNOWN'].includes(status))alerts.push({id,severity:status==='ERROR'?'error':'warning',component:label,message:detail});};
  add('app','Web ZenCore','OK',`Server aktif • uptime ${Math.floor(process.uptime())} saat`);
  add('auth','Login & akses admin',deps.auth.ready?'OK':'ERROR',deps.auth.ready?'Pengesahan akses aktif':'Pengesahan akses belum tersedia');
  const pool=deps.auth.store?.pool;
  const checks=await Promise.allSettled([
   bounded(()=>pool?pool.query({text:'SELECT 1 AS alive',query_timeout:4000}):Promise.reject(new Error('NO_DATABASE'))),
   bounded(()=>deps.fetchMarkets()),
   bounded(()=>deps.trading.ready&&deps.trading.service?listConnectionMonitor(user,deps.auth.service,deps.trading.service):Promise.reject(new Error('NO_TRADING'))),
   bounded(()=>pool&&deps.telegram()?.ready?pool.query({text:`SELECT COUNT(*) FILTER (WHERE d.status='failed')::int AS failed, COUNT(*) FILTER (WHERE d.status IN ('pending','sending'))::int AS pending, COUNT(*) FILTER (WHERE d.status IN ('pending','sending') AND a.created_at < NOW()-INTERVAL '60 seconds')::int AS delayed, MAX(a.created_at) FILTER (WHERE d.status='sent') AS last_sent FROM zencore_telegram_deliveries d JOIN zencore_analysis_alerts a ON a.id=d.event_id WHERE a.created_at > NOW()-INTERVAL '15 minutes' OR d.status IN ('pending','sending')`,query_timeout:4000}):Promise.reject(new Error('NO_TELEGRAM'))),
   bounded(()=>deps.trading.ready&&deps.trading.store?.getHostedWorkerPoolOverview?deps.trading.store.getHostedWorkerPoolOverview():Promise.reject(new Error('NO_WORKER'))),
   bounded(()=>deps.trading.ready&&pool?pool.query({text:`SELECT COUNT(*) FILTER (WHERE status IN ('PENDING','DELIVERED') AND expires_at>NOW() AND created_at<NOW()-INTERVAL '30 seconds')::int AS delayed, COUNT(*) FILTER (WHERE status IN ('FAILED','REJECTED','EXPIRED'))::int AS failed FROM (SELECT status,created_at,expires_at FROM zencore_autotrade_commands WHERE created_at>NOW()-INTERVAL '15 minutes' UNION ALL SELECT status,created_at,expires_at FROM zencore_hosted_autotrade_commands WHERE created_at>NOW()-INTERVAL '15 minutes') q`,query_timeout:4000}):Promise.reject(new Error('NO_QUEUE')))
  ]);
  const value=i=>checks[i].status==='fulfilled'?checks[i].value:null;
  add('database','Database',value(0)?'OK':'ERROR',value(0)?'Query semakan berjaya':'Database tidak dapat disahkan. Semak sambungan / log server.');
  const d=deps.trading;
  const dispatcherAt=stamp(d.dispatchLastSuccessAt);
  add('trading','Auto Trade dispatcher',!d.enabled?'UNCONFIGURED':!d.ready?'ERROR':!dispatcherAt?'UNKNOWN':observedAt-dispatcherAt>30000?'ERROR':d.dispatchError?'WARNING':'OK',!d.enabled?'Auto Trade tidak diaktifkan':!d.ready?'Servis Auto Trade belum tersedia':!dispatcherAt?'Menunggu semakan dispatcher pertama':observedAt-dispatcherAt>30000?'Dispatcher tidak memberi kemas kini dalam 30 saat':d.dispatchError?'Dispatcher melaporkan ralat. Semak log.':'Dispatcher memberi kemas kini');
  const feeds=value(1)?dualAnalysis(value(1),'XAUUSD',observedAt).views:[];
  for(const tf of [2,15]){const f=feeds.find(f=>f.timeframe===tf);add('feed'+tf,`TradingView XAUUSD TF${tf}`,f?.status==='LIVE'?'OK':f?.status==='STALE'?Math.max(f.ageMs||0,f.sourceAgeMs||0)>90000?'ERROR':'WARNING':f?.status==='INVALID_TIME'?'ERROR':'UNKNOWN',f?.status==='LIVE'?`Data segar • lag ${f.transportLagMs??'—'} ms`:f?.status==='STALE'?`Data lama • sumber ${Math.round(f.sourceAgeMs/1000)} saat lalu`:'Data signal belum dapat disahkan');}
  const accounts=(value(2)?.accounts||[]).map(r=>clientView(r,observedAt));
  add('clients','Sambungan client',value(2)?accounts.some(r=>r.transport!=='NOT_LINKED'&&!r.ready)?'WARNING':'OK':'UNKNOWN',value(2)?`${accounts.filter(r=>r.online).length} online / ${accounts.filter(r=>r.transport!=='NOT_LINKED').length} dipautkan`:'Senarai client tidak dapat disahkan');
  for(const r of accounts.filter(r=>r.transport!=='NOT_LINKED'&&!r.ready))alerts.push({id:'client:'+r.userId+':'+r.state,severity:r.online?'warning':'error',component:'Client → MT5',userId:r.userId,message:`${r.client.displayName}: ${r.state}. ${hints[r.state]||(r.online?'Semak izin Algo Trading / versi Connector / akses execution.':'Semak Connector, MT5 dan internet client.')}`});
  const telegram=deps.telegram(),delivery=value(3)?.rows?.[0];
  add('telegram','Telegram',!telegram?.token?'UNCONFIGURED':!telegram.ready?'ERROR':!delivery?'UNKNOWN':Number(delivery.failed)||Number(delivery.delayed)?'WARNING':'OK',!telegram?.token?'Bot belum dikonfigurasi':!telegram.ready?'Servis alert belum tersedia':!delivery?'Status penghantaran tidak dapat disahkan':`${delivery.failed} gagal (15 min) • ${delivery.pending} menunggu • ${delivery.delayed} lewat >60 saat. Status queue; bukan ujian sambungan Telegram.`);
  const queue=value(5)?.rows?.[0];add('orders','Queue arahan MT5',!queue?'UNKNOWN':Number(queue.delayed)||Number(queue.failed)?'WARNING':'OK',queue?`${queue.delayed} arahan aktif >30 saat • ${queue.failed} gagal / ditolak / luput dalam 15 min`:'Queue tidak dapat disahkan');
  const workerPool=value(4),workers=(workerPool?.hosts||[]).map(h=>({id:h.id,name:h.instanceName,enabled:h.enabled===true,lastSeenAt:stamp(h.lastSeenAt),assigned:Number(h.slotsAssigned)||0,active:Number(h.slotsActive)||0,online:!!stamp(h.lastSeenAt)&&stamp(h.lastSeenAt)<=observedAt+5000&&observedAt-stamp(h.lastSeenAt)<=60000}));
  add('workers','Hosted worker',!deps.hostedEnabled?'UNCONFIGURED':!workerPool?'UNKNOWN':workers.some(w=>w.enabled&&w.assigned&&!w.online)?'ERROR':Number(workerPool.totals?.waiting)?'WARNING':!workers.length?'UNKNOWN':'OK',!deps.hostedEnabled?'Client EA tempatan tidak memerlukan hosted worker':!workerPool?'Worker tidak dapat disahkan':`${workers.filter(w=>w.online).length}/${workers.length} host online • ${Number(workerPool.totals?.waiting)||0} menunggu slot`);
  return {ok:true,observedAt,pollIntervalMs:10000,overall:alerts.some(a=>a.severity==='error')?'ERROR':alerts.length?'WARNING':'OK',summary:{total:accounts.length,linked:accounts.filter(r=>r.transport!=='NOT_LINKED').length,online:accounts.filter(r=>r.online).length,ready:accounts.filter(r=>r.ready).length,attention:accounts.filter(r=>r.transport!=='NOT_LINKED'&&!r.ready).length},components,alerts,accounts,workers,clientsAvailable:!!value(2)};
 }
 return {async snapshot(user){if(user?.role!=='admin')throw Object.assign(new Error('FORBIDDEN'),{status:403,code:'FORBIDDEN'});if(cache&&Date.now()-cache.observedAt<8000)return cache;if(!inFlight)inFlight=collect(user).then(result=>(cache=result)).finally(()=>{inFlight=null;});return inFlight;}};
}
module.exports={createAdminMonitoring,clientView};
