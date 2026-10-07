'use strict';
const crypto=require('node:crypto');
const error=(status,code)=>Object.assign(new Error(code),{status,code});
function createWebhookIngress({secret='',now=Date.now,maxBytes=160000,maxPerMinute=120}={}){
 if(secret&&!/^[A-Za-z0-9_-]{32,128}$/.test(secret))throw error(500,'WEBHOOK_SECRET_INVALID');
 let windowAt=now(),accepted=0;
 function validate(body){
  if(typeof body!=='string'||Buffer.byteLength(body)>maxBytes)throw error(413,'WEBHOOK_TOO_LARGE');
  let parsed;try{parsed=JSON.parse(body);}catch{if(secret)throw error(400,'WEBHOOK_JSON_REQUIRED');}
  if(secret){
   const supplied=typeof parsed?.authToken==='string'?parsed.authToken:'';
   const hash=s=>crypto.createHash('sha256').update(s).digest();
   if(supplied.length>128||!crypto.timingSafeEqual(hash(supplied),hash(secret)))throw error(401,'WEBHOOK_UNAUTHORIZED');
   if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw error(400,'WEBHOOK_INVALID');
   const emitted=Number(parsed.emittedAt);
   if(!Number.isFinite(emitted)||now()-emitted>30000||emitted>now()+5000)throw error(409,'WEBHOOK_STALE_OR_FUTURE');
  }
  if(now()-windowAt>=60000){windowAt=now();accepted=0;}
  if(accepted>=maxPerMinute)throw error(429,'WEBHOOK_RATE_LIMITED');
  accepted++;
  // Never forward secrets to chart state, persistence, legacy logs or SSE.
  if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){delete parsed.authToken;return JSON.stringify(parsed);}
  return body;
 }
 return {validate,enforced:!!secret,maxBytes};
}
function readWebhook(req,maxBytes){
 return new Promise((resolve,reject)=>{
  let size=0,overflow=false;const chunks=[];
  req.setTimeout(5000,()=>req.destroy());
  req.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>maxBytes){overflow=true;return;}if(!overflow)chunks.push(Buffer.from(chunk));});
  req.on('end',()=>{req.setTimeout(0);if(overflow)reject(error(413,'WEBHOOK_TOO_LARGE'));else resolve(Buffer.concat(chunks).toString('utf8'));});
  req.on('error',reject);req.on('aborted',()=>reject(error(400,'WEBHOOK_ABORTED')));
 });
}
module.exports={createWebhookIngress,readWebhook};
