'use strict';
const {serverName}=require('./broker-monitor-metadata');
const DAY=86400000;
const defaults=()=>({inactiveDays:7,referenceServers:['InterStellarFinancial-Server','InterStellarFinancial-Demo']});
const stamp=v=>{const n=typeof v==='number'?v:typeof v==='string'?Date.parse(v):NaN;return Number.isFinite(n)&&n>0?n:null;};
function settings(input={}){
 const inactiveDays=Number(input.inactiveDays),referenceServers=input.referenceServers;
 if(!Number.isInteger(inactiveDays)||inactiveDays<1||inactiveDays>365||!Array.isArray(referenceServers)||referenceServers.length>100||referenceServers.some(n=>!serverName(n)))throw Object.assign(new Error('Semak tempoh 1-365 hari dan nama server penuh.'),{status:400,code:'INVALID_MONITOR_SETTINGS'});
 return {inactiveDays,referenceServers:[...new Set(referenceServers)]};
}
function row(client,connection,detail,config,now){
 const seenAt=stamp(connection.lastSeenAt);
 const fresh=seenAt!==null&&seenAt<=now+5000&&now-seenAt<=30000;
 const record=detail.brokerRecord,identityMatches=record&&detail.podId&&record.podId===detail.podId&&record.accountFingerprint===detail.accountFingerprint;
 const fullName=identityMatches?serverName(record.mt5ServerName):null;
 const lastLoginAt=stamp(client.lastLoginAt),lastTradeAt=stamp(connection.tradingActivity?.lastTradeAt),lastActivationAt=stamp(detail.lastActivationAt);
 const age=t=>t!==null&&t<=now?now-t:null;
 const brokerStatus=!fullName?'MISSING':!config.referenceServers.length?'UNCONFIGURED':config.referenceServers.includes(fullName)?'REFERENCE':'OTHER';
 return {userId:client.id,displayName:client.displayName||'',email:client.email||'',ibName:client.ibName||null,clientStatus:client.status||'unknown',
  accountMask:connection.accountMask||null,tradeMode:['REAL','DEMO'].includes(connection.tradeMode)?connection.tradeMode:'UNKNOWN',
  mt5ServerName:fullName,serverMask:connection.serverMask||null,brokerLabel:fullName?fullName.split('-')[0]:null,brokerLabelSource:fullName?'SERVER_NAME_PREFIX':null,
  brokerStatus,brokerReportedAt:identityMatches?stamp(record.reportedAt):null,brokerSource:fullName?'CONNECTOR_REPORTED':'NOT_REPORTED',ibBrokerRelationship:'NOT_VERIFIED_BY_BROKER',
  connectorVersion:connection.connectorVersion||null,transport:connection.transport||'NOT_LINKED',online:fresh&&connection.connection?.online===true,
  lastSeenAt:stamp(connection.lastSeenAt),control:{desiredState:connection.control?.desiredState||'STOPPED',effectiveState:connection.control?.effectiveState||'UNKNOWN'},
  lastLoginAt,lastTradeAt,lastActivationAt,lastActivationRequestedAt:stamp(detail.lastActivationRequestedAt),lastStopAt:stamp(detail.lastStopAt),
  openPositions:connection.tradingActivity?.openPositions??null,positionsFresh:fresh,executedSetups7d:connection.tradingActivity?.executedSetups7d??null,executedSetups30d:connection.tradingActivity?.executedSetups30d??null,
  flags:{neverLogin:lastLoginAt===null,loginInactive:age(lastLoginAt)!==null&&age(lastLoginAt)>=config.inactiveDays*DAY,
   neverTrade:lastTradeAt===null,tradeInactive:age(lastTradeAt)!==null&&age(lastTradeAt)>=config.inactiveDays*DAY,
   neverActivated:lastActivationAt===null,activationInactive:connection.control?.desiredState!=='ON'&&age(lastActivationAt)!==null&&age(lastActivationAt)>=config.inactiveDays*DAY},dataAvailable:true};
}
function createUserTradeMonitoring(deps){
 let cache=null,inFlight=null;
 const authorize=user=>{if(user?.role!=='admin')throw Object.assign(new Error('Admin sahaja.'),{status:403,code:'FORBIDDEN'});};
 async function config(){return settings(await deps.auth.store.getTradeMonitorSettings());}
 async function collect(user){
  const observedAt=Date.now(),cfg=await config(),clients=[];
  for(let offset=0;offset<10000;offset+=500){const page=await deps.auth.service.adminClients(user,{limit:500,offset});clients.push(...page);if(page.length<500)break;}
  const rows=[];
  for(let i=0;i<clients.length;i+=2){
   const batch=await Promise.allSettled(clients.slice(i,i+2).map(async c=>{
    const detail=await deps.trading.service.userTradeMonitoring(c.id);
    return row(c,detail.connection,detail,cfg,Date.now());
   }));
   for(let j=0;j<batch.length;j++)rows.push(batch[j].status==='fulfilled'?batch[j].value:{userId:clients[i+j].id,displayName:clients[i+j].displayName||'',email:clients[i+j].email||'',ibName:clients[i+j].ibName||null,dataAvailable:false,flags:{}});
  }
  const groups=new Map();
  for(const r of rows.filter(r=>r.dataAvailable&&r.mt5ServerName)){const k=r.mt5ServerName;let g=groups.get(k);if(!g)groups.set(k,g={mt5ServerName:k,status:r.brokerStatus,users:0,real:0,demo:0,online:0});g.users++;g.real+=r.tradeMode==='REAL';g.demo+=r.tradeMode==='DEMO';g.online+=r.online;}
  return {ok:true,observedAt,pollIntervalMs:30000,settings:cfg,rows,servers:[...groups.values()].sort((a,b)=>b.users-a.users||a.mt5ServerName.localeCompare(b.mt5ServerName)),
   summary:{total:rows.length,otherServer:rows.filter(r=>r.brokerStatus==='OTHER').length,missingServer:rows.filter(r=>r.dataAvailable&&r.brokerStatus==='MISSING').length,loginInactive:rows.filter(r=>r.flags.loginInactive).length,neverTrade:rows.filter(r=>r.flags.neverTrade).length,tradeInactive:rows.filter(r=>r.flags.tradeInactive).length,neverActivated:rows.filter(r=>r.flags.neverActivated).length,activationInactive:rows.filter(r=>r.flags.activationInactive).length,unknown:rows.filter(r=>!r.dataAvailable).length}};
 }
 return {
  async snapshot(user){authorize(user);if(!deps.trading.ready)throw Object.assign(new Error('Monitoring trade belum tersedia.'),{status:503});if(cache&&Date.now()-cache.observedAt<10000)return {...cache,servedAt:Date.now()};if(!inFlight)inFlight=collect(user).then(r=>(cache=r)).finally(()=>{inFlight=null;});return {...await inFlight,servedAt:Date.now()};},
  async save(user,input){authorize(user);const value=settings(input);await deps.auth.store.setTradeMonitorSettings(value);cache=null;return {ok:true,settings:value};}
 };
}
module.exports={defaults,settings,row,createUserTradeMonitoring};
