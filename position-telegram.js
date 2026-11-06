'use strict';
const crypto=require('node:crypto'),Access=require('./account-access'),Handover=require('./account-handover');
const AGE=120000,WAIT=6000,MODES=['TF2_SCALPING','TF15_INTRA'];
const privateChat=id=>/^[1-9]\d{0,19}$/.test(String(id||''));
const allowed=(u,at)=>Access.allowed(u,at)&&Handover.canTrade(u)&&u.role!=='viewer';
const positionId=p=>String(p.positionId||p.ticket||'');
function groups(positions,at,includeHistorical=false){
 const result=new Map();
 for(const p of positions||[]){
  if(p.symbol!=='XAUUSD'||!MODES.includes(p.strategyMode)||!['BUY','SELL'].includes(p.side)||!Number.isFinite(p.entry)||p.entry<=0||!Number.isFinite(p.volume)||p.volume<=0||!Number.isFinite(p.openedAt)||p.openedAt<=0||p.openedAt>at+5000||!/^\d{1,20}$/.test(positionId(p)))continue;
  const manual=p.origin==='MANUAL';
  if(!manual&&!/^[a-f0-9-]{20}$/.test(p.setupId||''))continue;
  const key=[manual?'MANUAL':'AUTO',p.strategyMode,p.side,manual?positionId(p):p.setupId].join(':');
  if(!result.has(key))result.set(key,{key,manual,setupId:p.setupId||null,mode:p.strategyMode,side:p.side,manualId:manual?positionId(p):null,positions:[]});
  const g=result.get(key);if(!g.positions.some(x=>positionId(x)===positionId(p)))g.positions.push(p);
 }
 return [...result.values()].filter(g=>includeHistorical||at-Math.min(...g.positions.map(p=>p.openedAt))<=AGE);
}
function matching(g,positions){return (positions||[]).filter(p=>Number.isFinite(p.entry)&&p.entry>0&&Number.isFinite(p.volume)&&p.volume>0&&p.symbol==='XAUUSD'&&p.side===g.side&&p.strategyMode===g.mode&&(g.manual?p.origin==='MANUAL'&&positionId(p)===g.manualId:p.origin!=='MANUAL'&&p.setupId===g.setupId));}
function message(g,positions,at,key){
 const volume=positions.reduce((n,p)=>n+p.volume,0),entry=positions.reduce((n,p)=>n+p.entry*p.volume,0)/volume;
 const price=n=>Number.isFinite(n)&&n>0?n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:3}):'Belum dilaporkan';
 const lines=['━━━━━━━━━━━━━━━━━━','🔔 ZENCORE ERRATE | POSISI SUDAH DIBUKA','──────────────────',`XAUUSD • ${g.side} • ${g.mode==='TF15_INTRA'?'TF15':'TF2'}${g.manual?' • MANUAL':''}`,'',`Entry purata: ${price(entry)}`,`Posisi disahkan: ${positions.length} • ${Number(volume.toFixed(3))} lot`];
 if(g.directionMismatch)lines.push('⚠️ Arah posisi berbeza daripada pelan. Semak MT5 segera.');
 if(g.expected>positions.length)lines.push(`Pelan: ${g.expected} layer • setakat pengesahan ini`);
 const values=positions.map(p=>p.activeSl);
 if(values.every(n=>Number.isFinite(n)&&n>0))lines.push(values.every(n=>n===values[0])?`SL: ${price(values[0])}`:`SL setiap posisi: ${price(Math.min(...values))} – ${price(Math.max(...values))}`);
 else lines.push('SL: Semak setiap posisi di MT5');
 for(const k of ['tp1','tp2','tp3']){const a=positions.map(p=>p[k]);if(a.every(n=>Number.isFinite(n)&&n>0))lines.push(`${k.toUpperCase()}: ${a.every(n=>n===a[0])?price(a[0]):price(Math.min(...a))+' – '+price(Math.max(...a))}`);}
 lines.push('','✅ Posisi sebenar disahkan di MT5.','Semak posisi dan pelan SL/TP sekarang.',`🕒 ${new Date(at).toLocaleString('ms-MY',{timeZone:'Asia/Kuala_Lumpur',hour12:false})} MYT • ZP-${key.slice(0,8).toUpperCase()}`,'━━━━━━━━━━━━━━━━━━');return lines.join('\n');
}
function closeMessage(g,at,key){
 const ps=g.positions||[],volume=ps.reduce((n,p)=>n+p.volume,0);
 return ['━━━━━━━━━━━━━━━━━━','🔔 ZENCORE ERRATE | SETUP SUDAH DITUTUP','──────────────────',`XAUUSD • ${g.side} • ${g.mode==='TF15_INTRA'?'TF15':'TF2'}${g.manual?' • MANUAL':''}`,'',`Posisi dipantau: ${ps.length} • ${Number(volume.toFixed(3))} lot`,'✅ Semua posisi setup ini sudah tiada di MT5.','Disemak melalui dua laporan MT5 berturut-turut.','','Harga exit & untung/rugi: semak History MT5.','Sebab penutupan belum dilaporkan.','Tunggu signal baharu yang lulus SOP.',`🕒 ${new Date(at).toLocaleString('ms-MY',{timeZone:'Asia/Kuala_Lumpur',hour12:false})} MYT • ZP-${key.slice(0,8).toUpperCase()}`,'━━━━━━━━━━━━━━━━━━'].join('\n');
}
class PositionTelegram{
 constructor({pool,store,alerts,now=Date.now,log=console}){Object.assign(this,{pool,store,alerts,now,log});this.busy=false;this.flow={};}
 async init(){await this.pool.query(`CREATE TABLE IF NOT EXISTS zencore_position_notifications(
  key CHAR(64) PRIMARY KEY,user_id UUID NOT NULL REFERENCES zencore_users(id) ON DELETE CASCADE,
  pod_id UUID NOT NULL,fingerprint CHAR(64) NOT NULL,generation INTEGER NOT NULL,chat_id TEXT NOT NULL,
  data JSONB NOT NULL,status TEXT NOT NULL DEFAULT 'pending',first_seen BIGINT NOT NULL,send_after BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,result TEXT);
  CREATE TABLE IF NOT EXISTS zencore_position_watches(
  key CHAR(64) PRIMARY KEY,user_id UUID NOT NULL REFERENCES zencore_users(id) ON DELETE CASCADE,
  pod_id UUID NOT NULL,fingerprint CHAR(64) NOT NULL,generation INTEGER NOT NULL,chat_id TEXT NOT NULL,
  data JSONB NOT NULL,last_seen BIGINT NOT NULL,absent_since BIGINT,last_snapshot BIGINT NOT NULL,finished BOOLEAN NOT NULL DEFAULT false);
  CREATE INDEX IF NOT EXISTS zencore_position_watches_active ON zencore_position_watches(user_id,pod_id) WHERE finished=false;
  CREATE INDEX IF NOT EXISTS zencore_position_notifications_pending ON zencore_position_notifications(send_after) WHERE status='pending';`);}
 async user(id,db=this.pool,lock=false){return (await db.query('SELECT status,role,access_expires_at,handover_state,handover_generation FROM zencore_users WHERE id=$1'+(lock?' FOR SHARE':''),[id])).rows[0];}
 count(reason){this.flow[reason]=(this.flow[reason]||0)+1;}
 async observe({userId,podId,accountFingerprint,positions,observedAt}){
  this.count('snapshots');if(!this.alerts.token){this.count('no_bot');return;}if(!/^[a-f0-9]{64}$/.test(accountFingerprint||'')){this.count('bad_binding');return;}
  const at=this.now(),list=groups(positions,at,true);if(Math.abs(at-observedAt)>15000){this.count('stale_snapshot');return;}this.count(positions.length?'positions_present':'positions_empty');if(positions.length&&!list.length)this.count('unrecognised_positions');
  const [u,prefs]=await Promise.all([this.user(userId),this.alerts.get(userId)]);
  if(!allowed(u,at)){this.count('account_unavailable');return;}if(!prefs.telegramEnabled){this.count('telegram_off');return;}if(!prefs.verified){this.count('telegram_unverified');return;}if(!privateChat(prefs.telegramId)){this.count('non_private_chat');return;}this.count('eligible_snapshot');
  for(const g of list){
   if(!g.manual){
    const command=await this.store.setupForPosition(userId,podId,'XAUUSD',g.mode,g.setupId);
    if(!command||command.podId!==podId||command.userId!==userId||command.payload?.accountFingerprint!==accountFingerprint){this.count('setup_not_matched');continue;}
    g.directionMismatch=command.payload?.side!==g.side;
    g.expected=Math.max(1,Math.min(10,Number(command.payload.layers)||g.positions.length));
   }else g.expected=1;
   this.count('setup_matched');const key=crypto.createHash('sha256').update(JSON.stringify([userId,accountFingerprint,u.handover_generation||0,g.key])).digest('hex');
   // Track older open positions for their future close, without announcing historical opens.
   await this.pool.query(`INSERT INTO zencore_position_watches(key,user_id,pod_id,fingerprint,generation,chat_id,data,last_seen,last_snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) ON CONFLICT(key) DO UPDATE SET
    data=jsonb_set(EXCLUDED.data,'{positions}',COALESCE((SELECT jsonb_agg(p) FROM
     (SELECT DISTINCT ON (COALESCE(p->>'positionId',p->>'ticket')) p FROM
      jsonb_array_elements((zencore_position_watches.data->'positions')||(EXCLUDED.data->'positions')) p ORDER BY COALESCE(p->>'positionId',p->>'ticket'),(p->>'volume')::numeric DESC) all_positions),'[]'::jsonb)),
    last_seen=EXCLUDED.last_seen,last_snapshot=EXCLUDED.last_snapshot,absent_since=NULL
    WHERE zencore_position_watches.finished=false AND zencore_position_watches.pod_id=EXCLUDED.pod_id`,
    [key,userId,podId,accountFingerprint,u.handover_generation||0,String(prefs.telegramId),g,at]);
   if(at-Math.min(...g.positions.map(p=>p.openedAt))>AGE){this.count('historical_open');continue;}
   const sendAfter=at+(g.positions.length>=g.expected?0:WAIT);
   await this.pool.query(`INSERT INTO zencore_position_notifications(key,user_id,pod_id,fingerprint,generation,chat_id,data,first_seen,send_after,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$8) ON CONFLICT(key) DO UPDATE SET data=EXCLUDED.data,
    send_after=LEAST(zencore_position_notifications.send_after,EXCLUDED.send_after),updated_at=EXCLUDED.updated_at
    WHERE zencore_position_notifications.status='pending' AND zencore_position_notifications.pod_id=EXCLUDED.pod_id`,
    [key,userId,podId,accountFingerprint,u.handover_generation||0,String(prefs.telegramId),g,at,sendAfter]);
  }
  await this.observeCloses({userId,podId,accountFingerprint,positions,at,u,prefs});
 }
 async observeCloses({userId,podId,accountFingerprint,positions,at,u,prefs}){
  const watches=(await this.pool.query(`SELECT * FROM zencore_position_watches WHERE user_id=$1 AND pod_id=$2 AND fingerprint=$3 AND generation=$4 AND finished=false`,[userId,podId,accountFingerprint,u.handover_generation||0])).rows;
  for(const w of watches){
   if(matching(w.data,positions).length)continue;
   // Two complete connected snapshots, separated by at least two seconds, with no long gap.
   const absent=Number(w.absent_since),last=Number(w.last_snapshot);
   if(!absent||at-last>15000||at<last){await this.pool.query('UPDATE zencore_position_watches SET absent_since=$2,last_snapshot=$2 WHERE key=$1 AND finished=false',[w.key,at]);continue;}
   await this.pool.query('UPDATE zencore_position_watches SET last_snapshot=$2 WHERE key=$1 AND finished=false',[w.key,at]);
   if(at-absent<2000)continue;
   const key=crypto.createHash('sha256').update('CLOSE:'+w.key).digest('hex'),g={...w.data,closed:true,watchKey:w.key,confirmedAt:at};
   await this.pool.query(`INSERT INTO zencore_position_notifications(key,user_id,pod_id,fingerprint,generation,chat_id,data,first_seen,send_after,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$8) ON CONFLICT(key) DO UPDATE SET data=EXCLUDED.data
    WHERE zencore_position_notifications.status='pending'`,[key,userId,podId,accountFingerprint,w.generation,w.chat_id,g,at]);
  }
 }
 async reportFlow(){
  const at=this.now();if(this.lastReport&&at-this.lastReport<60000)return;
  const r=await this.pool.query(`SELECT jsonb_build_object(
   'preferences',(SELECT count(*) FROM zencore_alert_preferences WHERE data->>'verified'='true' AND data->>'telegramEnabled'='true'),
   'positions',(SELECT count(*) FROM zencore_mt5_positions),
   'positionsWithSetup',(SELECT count(*) FROM zencore_mt5_positions WHERE data->>'setupId' IS NOT NULL),
   'activeWatches',(SELECT count(*) FROM zencore_position_watches WHERE finished=false),
   'outbox',COALESCE((SELECT jsonb_object_agg(status,n) FROM (SELECT status,count(*) n FROM zencore_position_notifications GROUP BY status) s),'{}'::jsonb),
   'results',COALESCE((SELECT jsonb_object_agg(result,n) FROM (SELECT COALESCE(result,'QUEUED') result,count(*) n FROM zencore_position_notifications GROUP BY result) s),'{}'::jsonb)) AS metrics`);
  this.log.info?.('Position Telegram flow:',JSON.stringify({botConfigured:!!this.alerts.token,observed:this.flow,...r.rows[0]?.metrics}));this.lastReport=at;this.flow={};
 }
 async drain(){
  if(this.busy||!this.alerts.token)return;this.busy=true;
  try{
   const at=this.now();
   if(this.diagnostics){try{await this.reportFlow();}catch{this.log.warn?.('Position Telegram diagnostic unavailable');this.lastReport=at;}}
   // Uncertain sends are never automatically repeated.
   await this.pool.query("UPDATE zencore_position_notifications SET status='unknown',result='INTERRUPTED_SEND',updated_at=$1 WHERE status='sending' AND updated_at<$2",[at,at-AGE]);
   const jobs=(await this.pool.query(`UPDATE zencore_position_notifications SET status='sending',updated_at=$1 WHERE key IN
    (SELECT key FROM zencore_position_notifications WHERE status='pending' AND send_after<=$1 ORDER BY first_seen LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *`,[at])).rows;
   for(const row of jobs){const checkedAt=this.now();let status='skipped',result='NO_LONGER_ELIGIBLE',attempted=false,rolledBack=false;const c=await this.pool.connect();
    try{
     await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['alert-user:'+row.user_id]);
     const lockedUser=await this.user(row.user_id,c,true);
     const [u,prefs,pod]=await Promise.all([Promise.resolve(lockedUser),this.alerts.get(row.user_id),this.store.getPodForUser(row.user_id)]);
     if(checkedAt-Number(row.first_seen)<=AGE&&allowed(u,checkedAt)&&(u.handover_generation||0)===row.generation&&prefs.telegramEnabled&&prefs.verified&&privateChat(prefs.telegramId)&&String(prefs.telegramId)===row.chat_id&&pod?.id===row.pod_id&&!pod.revokedAt&&pod.accountFingerprint===row.fingerprint){
      if(!pod.lastSeenAt||checkedAt-pod.lastSeenAt>15000||pod.lastSeenAt>checkedAt+5000){status='pending';result='WAIT_FRESH_MT5';}
      else {const positions=matching(row.data,await this.store.listPositions(row.user_id));
      if(row.data.closed){
       if(positions.length)result='POSITION_STILL_OPEN';
       else if(checkedAt-Number(row.data.confirmedAt)>15000){status='pending';result='WAIT_FRESH_CLOSE_CONFIRMATION';}
       else {attempted=true;await this.alerts.telegram(row.chat_id,closeMessage(row.data,checkedAt,row.key));status='sent';result='SETUP_CLOSED';}
      }
      else if(positions.length){attempted=true;await this.alerts.telegram(row.chat_id,message(row.data,positions,checkedAt,row.key));status='sent';result='POSITION_CONFIRMED';}
      else result='POSITION_ALREADY_CLOSED';}
     }
    }catch(error){status=attempted?'unknown':'pending';result=attempted?'SEND_UNCONFIRMED':'CHECK_RETRY';try{await c.query('ROLLBACK');rolledBack=true;}catch{c.release();throw error;}}
    try{await c.query("UPDATE zencore_position_notifications SET status=$2,result=$3,updated_at=$4::bigint,send_after=CASE WHEN $2='pending' THEN $4::bigint+2000 ELSE send_after END WHERE key=$1",[row.key,status,result,this.now()]);if(row.data.closed&&status!=='pending'&&result!=='POSITION_STILL_OPEN')await c.query('UPDATE zencore_position_watches SET finished=true WHERE key=$1',[row.data.watchKey]);if(result==='POSITION_STILL_OPEN')await c.query('DELETE FROM zencore_position_notifications WHERE key=$1',[row.key]);if(!rolledBack)await c.query('COMMIT');
     if(status==='unknown')this.log.warn?.('Position Telegram send unconfirmed:',JSON.stringify({reference:row.key.slice(0,8)}));}
    catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
   }
   if(!this.lastCleanup||at-this.lastCleanup>3600000){await this.pool.query("DELETE FROM zencore_position_notifications WHERE status NOT IN ('pending','sending') AND first_seen<$1",[at-95*86400000]);await this.pool.query('DELETE FROM zencore_position_watches WHERE finished=true AND last_seen<$1',[at-95*86400000]);this.lastCleanup=at;}
  }finally{this.busy=false;}
 }
 start(){if(this.timer)return;this.timer=setInterval(()=>this.drain().catch(()=>this.log.error?.('Position Telegram worker unavailable')),2000);this.timer.unref?.();}
 stop(){clearInterval(this.timer);this.timer=null;}
}
module.exports={PositionTelegram,groups,matching,message,closeMessage,privateChat};
