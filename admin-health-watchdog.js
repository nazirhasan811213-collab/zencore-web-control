'use strict';
// Runs independently of the admin browser. Telegram recipients are resolved from
// current active admin accounts with an explicitly enabled, verified destination.
function createHealthWatchdog({monitor,alerts,ready}) {
 let busy=false,timer=null,checks=0;
 const stable=new Map(),pending=new Map();
 return {
  async tick(){
   const service=alerts();if(busy||!ready()||!service?.ready||!service.pool||!service.token)return;
   busy=true;
   try{
    const result=await service.pool.query({text:`SELECT u.id FROM zencore_users u JOIN zencore_alert_preferences p ON p.user_id=u.id WHERE u.role='admin' AND u.status='active' AND p.data->>'healthNotificationsEnabled'='true' AND p.data->>'verified'='true'`,query_timeout:4000});
    if(!result.rows.length)return;
    const snapshot=await monitor.snapshot({role:'admin'});
    // Require two consecutive checks for incident/recovery transitions. A single
    // late heartbeat should not cause Telegram incident/recovery flapping.
    const current=new Map((snapshot.alerts||[]).map(a=>[a.id,a]));
    for(const id of new Set([...current.keys(),...stable.keys(),...pending.keys()])){
     const value=current.get(id),signature=value?String(value.severity):'resolved';
     const prior=pending.get(id);
     const count=prior?.signature===signature?prior.count+1:1;
     pending.set(id,{signature,count});
     if(count>=2){if(value)stable.set(id,value);else{stable.delete(id);pending.delete(id);}}
    }
    if(++checks<2)return;
    const notificationSnapshot={...snapshot,alerts:[...stable.values()]};
    for(const user of result.rows){
     try{await service.withUserLock(user.id,'deliverHealthSnapshot',notificationSnapshot);}
     catch(_){console.error('Admin health delivery unavailable');}
    }
   }catch(_){console.error('Admin health monitoring/delivery unavailable');}
   finally{busy=false;}
  },
  start(){if(!timer){timer=setInterval(()=>this.tick(),10000);timer.unref?.();}},
  stop(){if(timer)clearInterval(timer);timer=null;}
 };
}
module.exports={createHealthWatchdog};
