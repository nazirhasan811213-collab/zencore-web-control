'use strict';
function createReadiness({auth,trading,autotradeEnabled=true,allowMemoryDatabase=false,webhook,now=Date.now,deadlineMs=2500,cacheMs=1000}){
 let cached=null,inFlight=null;
 async function collect(){
  let database=false,timer;
  const pool=auth.store?.pool;
  if(pool){
   try{await Promise.race([pool.query({text:'SELECT 1 AS alive',query_timeout:2000}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('TIMEOUT')),deadlineMs);})]);database=true;}
   catch(_){}finally{clearTimeout(timer);}
  }else database=allowMemoryDatabase;
  const age=now()-(trading.dispatchLastSuccessAt||0);
  const dispatcher=!autotradeEnabled||trading.ready&&age>=0&&age<30000;
  const result={ok:!!(auth.ready&&database&&dispatcher),database:database?'READY':'UNAVAILABLE',dispatcher:dispatcher?'READY':'UNAVAILABLE',webhook:webhook.enforced?'AUTHENTICATED':'LEGACY_UNVERIFIED'};
  cached={at:now(),result};return result;
 }
 return {async snapshot(){if(cached&&now()-cached.at<cacheMs)return cached.result;if(!inFlight)inFlight=collect().finally(()=>{inFlight=null;});return inFlight;}};
}
module.exports={createReadiness};
