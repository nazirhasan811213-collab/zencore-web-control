'use strict';
const crypto=require('node:crypto'),https=require('node:https');
const MAX_AGE=30000,MAX_BYTES=160000,MAX_IN_FLIGHT=4,TIMEOUT=2500;
const DESTINATION='https://zencore-errante.onrender.com/relay/webhook';
const fail=(status,code)=>Object.assign(new Error(code),{status,code});
const signature=(key,at,id,body)=>crypto.createHmac('sha256',key).update(`${at}.${id}.${body}`).digest('hex');
function createFeedRelay({target='',secret='',receive=false,now=Date.now,log=console,transport=https,allowTestTarget=false}={}){
 if((target||receive)&&!/^[A-Za-z0-9_-]{32,128}$/.test(secret))throw fail(500,'RELAY_SECRET_INVALID');
 if(target&&target!==DESTINATION&&!allowTestTarget)throw fail(500,'RELAY_TARGET_INVALID');
 const agent=target?new transport.Agent({keepAlive:true,maxSockets:MAX_IN_FLIGHT,maxFreeSockets:2}):null;
 const stats={sent:0,delivered:0,failed:0,dropped:0,received:0,applied:0,replayed:0,inFlight:0,
  lastSentAt:null,lastDeliveredAt:null,lastReceivedAt:null,lastAppliedAt:null,lastRoundTripMs:null,
  maxRoundTripMs:0,lastSourceAgeMs:null,lastReceiveAgeMs:null,lastAppliedSourceAgeMs:null,lastError:null};
 const recent=new Map(),requests=new Set();let lastLog=0;
 function payload(body){
  if(typeof body!=='string'||Buffer.byteLength(body)>MAX_BYTES)throw fail(413,'RELAY_PAYLOAD_TOO_LARGE');
  let p;try{p=JSON.parse(body);}catch{throw fail(400,'RELAY_JSON_REQUIRED');}
  if(!p||Array.isArray(p)||typeof p!=='object'||!['2','15'].includes(String(p.timeframe))||!Array.isArray(p.markets))throw fail(400,'RELAY_FEED_REQUIRED');
  const at=Number(p.emittedAt);
  if(!Number.isFinite(at)||at<=0||now()-at>MAX_AGE||at>now()+5000)throw fail(409,'RELAY_SOURCE_STALE');
  if(Object.hasOwn(p,'authToken'))throw fail(400,'RELAY_UNSANITIZED_PAYLOAD');
  return p;
 }
 function send(body){
  if(!target)return false;
  let p;try{p=payload(body);}catch{stats.dropped++;return false;}
  if(stats.inFlight>=MAX_IN_FLIGHT){stats.dropped++;stats.lastError='RELAY_BUSY';return false;}
  const at=now(),id=crypto.randomUUID();stats.sent++;stats.inFlight++;stats.lastSentAt=at;
  let completed=false,request,timer;
  function done(ok,code){
   if(completed)return;completed=true;clearTimeout(timer);requests.delete(request);stats.inFlight--;
   const elapsed=Math.max(0,now()-at);
   if(ok){stats.delivered++;stats.lastDeliveredAt=now();stats.lastRoundTripMs=elapsed;stats.maxRoundTripMs=Math.max(stats.maxRoundTripMs,elapsed);stats.lastSourceAgeMs=Math.max(0,now()-Number(p.emittedAt));stats.lastError=null;}
   else{stats.failed++;stats.lastError=code;}
   if(!ok||now()-lastLog>=60000){lastLog=now();log.log?.('ZenCore feed relay:',JSON.stringify({ok,code:ok?'DELIVERED':code,timeframe:String(p.timeframe),roundTripMs:elapsed,sourceAgeMs:Math.max(0,now()-Number(p.emittedAt))}));}
  }
  try{
   request=transport.request(target,{method:'POST',agent,headers:{'content-type':'application/json','content-length':Buffer.byteLength(body),
    'x-zencore-relay-at':String(at),'x-zencore-relay-id':id,'x-zencore-relay-signature':signature(secret,at,id,body)}},res=>{
    res.on('error',()=>done(false,'RELAY_RESPONSE_ERROR'));
    res.resume();res.on('end',()=>done(res.statusCode===200,res.statusCode===200?'DELIVERED':'RELAY_HTTP_'+res.statusCode));
   });
   requests.add(request);request.on('error',()=>done(false,'RELAY_CONNECTION_FAILED'));
   timer=setTimeout(()=>{done(false,'RELAY_TIMEOUT');request.destroy();},TIMEOUT);timer.unref?.();request.end(body);
  }catch{done(false,'RELAY_REQUEST_FAILED');}
  // Never await delivery in the original webhook request. No delayed replay queue.
  return true;
 }
 function accept(body,headers){
  if(!receive)throw fail(404,'RELAY_DISABLED');
  const at=headers['x-zencore-relay-at'],id=headers['x-zencore-relay-id'],sig=headers['x-zencore-relay-signature'];
  if(typeof at!=='string'||!/^\d{13}$/.test(at)||Math.abs(now()-Number(at))>MAX_AGE||typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)||typeof sig!=='string'||!/^[a-f0-9]{64}$/.test(sig))throw fail(401,'RELAY_UNAUTHORIZED');
  if(typeof body!=='string'||Buffer.byteLength(body)>MAX_BYTES)throw fail(413,'RELAY_PAYLOAD_TOO_LARGE');
  if(!crypto.timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(signature(secret,at,id,body),'hex')))throw fail(401,'RELAY_UNAUTHORIZED');
  const p=payload(body);
  for(const [key,expiry] of recent)if(expiry<now())recent.delete(key);
  if(recent.has(id)){stats.replayed++;throw fail(409,'RELAY_REPLAY');}
  if(recent.size>=1000)throw fail(429,'RELAY_RATE_LIMITED');
  recent.set(id,now()+MAX_AGE+5000);stats.received++;stats.lastReceivedAt=now();stats.lastReceiveAgeMs=Math.max(0,now()-Number(p.emittedAt));
  return {body,sourceAt:Number(p.emittedAt),receivedAt:now()};
 }
 function applied(sourceAt,status){if(status>=200&&status<300){stats.applied++;stats.lastAppliedAt=now();stats.lastAppliedSourceAgeMs=Math.max(0,now()-sourceAt);}}
 function status(){return {sending:!!target,receiving:!!receive,...stats};}
 function close(){for(const request of requests)request.destroy();agent?.destroy();}
 return {send,accept,applied,status,close,maxBytes:MAX_BYTES};
}
module.exports={createFeedRelay,DESTINATION,MAX_AGE,TIMEOUT,signature};
