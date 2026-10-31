'use strict';
const crypto=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error=(message,status=400)=>Object.assign(new Error(message),{status});
function admin(actor){if(actor?.role!=='admin'||actor.status!=='active')throw error('Admin aktif sahaja.',403);}
function selection(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw error('Pilihan penerima tidak sah.');
 const mode=input.mode;if(!['IB','SINGLE','MULTI','ALL'].includes(mode))throw error('Pilihan penerima tidak sah.');
 if(mode==='IB'){if(!UUID.test(input.ibId||'')||!['IB_ONLY','CLIENTS','IB_AND_CLIENTS'].includes(input.ibScope))throw error('Pilih IB dan skop penerima.');return {mode,ibId:input.ibId,ibScope:input.ibScope};}
 if(mode==='SINGLE'||mode==='MULTI'){if(!Array.isArray(input.userIds))throw error('Pilih user yang sah.');const userIds=[...new Set(input.userIds||[])];if(!Array.isArray(input.userIds)||!userIds.length||userIds.length>1000||userIds.some(x=>typeof x!=='string'||!UUID.test(x))||(mode==='SINGLE'&&userIds.length!==1))throw error('Pilih user yang sah.');return {mode,userIds};}
 return {mode};
}
function selected(u,s,ibs){
 if(u.role==='viewer')return false;
 if(s.mode==='ALL')return true;
 if(['SINGLE','MULTI'].includes(s.mode))return s.userIds.includes(u.id);
 const ib=ibs.find(x=>x.id===s.ibId);if(!ib)return false;
 return (s.ibScope!=='CLIENTS'&&u.id===ib.user_id)||(s.ibScope!=='IB_ONLY'&&u.role==='client'&&u.ib_referrer_id===ib.id);
}
function eligible(u){return u?.role!=='viewer'&&u?.prefs?.verified===true&&u.prefs.telegramEnabled===true&&/^[1-9][0-9]{4,15}$/.test(String(u.prefs.telegramId||''));}
function resolve(users,ibs,s){
 if(s.mode==='IB'&&!ibs.some(x=>x.id===s.ibId))throw error('IB tidak dijumpai.');
 if(s.userIds?.some(id=>!users.some(u=>u.id===id)))throw error('Sebahagian user tidak dijumpai. Refresh senarai.');
 const chosen=users.filter(u=>selected(u,s,ibs)),seen=new Set(),targets=[],skipped=[];
 for(const u of chosen){const chat=String(u.prefs?.telegramId||'');if(!eligible(u)){skipped.push({id:u.id,reason:'TELEGRAM_OFF_OR_UNVERIFIED'});continue;}if(seen.has(chat)){skipped.push({id:u.id,reason:'DUPLICATE_TELEGRAM'});continue;}seen.add(chat);targets.push({id:u.id,chatId:chat,name:u.display_name||u.email});}
 if(targets.length>10000)throw error('Terlalu ramai penerima. Pecahkan mengikut IB.');
 return {selected:chosen.length,targets,skipped};
}
function content(input,at,id){
 const title=typeof input.title==='string'?input.title.trim():'',body=typeof input.message==='string'?input.message.trim():'';
 if(title.length>100||!body||body.length>3000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(title+body))throw error('Mesej wajib diisi, maksimum 3000 aksara; tajuk maksimum 100.');
 const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'short',timeStyle:'short'}).format(new Date(at));
 return ['━━━━━━━━━━━━━━━━━━','📩 ZENCORE | MESEJ ADMIN','──────────────────',...(title?[title,'']:[]),body,'',`🕒 ${time} MYT • ADM-${id.slice(0,8)}`,'━━━━━━━━━━━━━━━━━━'].join('\n');
}
class AdminTelegram {
 constructor({pool,alerts,now=Date.now}){this.pool=pool;this.alerts=alerts;this.now=now;this.busy=false;}
 async init({start=true}={}){
  await this.pool.query(`CREATE TABLE IF NOT EXISTS zencore_admin_telegram_jobs(id UUID PRIMARY KEY, admin_id UUID NOT NULL, selection JSONB NOT NULL, message TEXT NOT NULL, targets JSONB NOT NULL, skipped JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS zencore_admin_telegram_targets(id BIGSERIAL PRIMARY KEY,job_id UUID NOT NULL REFERENCES zencore_admin_telegram_jobs(id) ON DELETE CASCADE,user_id UUID NOT NULL,chat_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',result TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(job_id,chat_id));
CREATE INDEX IF NOT EXISTS zencore_admin_telegram_pending_idx ON zencore_admin_telegram_targets(status,id);`);
  if(start&&!this.timer){this.timer=setInterval(()=>this.drain().catch(()=>console.error('Admin Telegram queue unavailable')),1500);this.timer.unref?.();}
 }
 async data(){
  const [u,i]=await Promise.all([this.pool.query("SELECT u.id,u.display_name,u.email,u.role,u.status,u.access_expires_at,u.ib_referrer_id,COALESCE(p.data,'{}'::jsonb) AS prefs FROM zencore_users u LEFT JOIN zencore_alert_preferences p ON p.user_id=u.id WHERE u.role<>'viewer' ORDER BY u.display_name,u.id"),this.pool.query('SELECT id,code,display_name,user_id FROM zencore_ib_referrers ORDER BY display_name')]);return {users:u.rows,ibs:i.rows};
 }
 async catalog(actor){admin(actor);const d=await this.data();return {ok:true,available:!!this.alerts.token,users:d.users.map(u=>({id:u.id,name:u.display_name,email:u.email,role:u.role,status:u.status,expired:u.role==='client'&&u.access_expires_at!=null&&new Date(u.access_expires_at).getTime()<=this.now(),ibId:u.ib_referrer_id,telegramReady:eligible(u)})),ibs:d.ibs.map(i=>({id:i.id,name:i.display_name,code:i.code}))};}
 async preview(actor,input){
  admin(actor);const s=selection(input),d=await this.data(),r=resolve(d.users,d.ibs,s),id=crypto.randomUUID(),at=this.now(),text=content(input,at,id);
  if(!r.targets.length)throw error('Tiada penerima dengan Telegram disahkan dan notifikasi ON.');
  await this.pool.query('INSERT INTO zencore_admin_telegram_jobs(id,admin_id,selection,message,targets,skipped,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,actor.id,s,text,JSON.stringify(r.targets),JSON.stringify(r.skipped),new Date(at+10*60000)]);
  return {ok:true,draftId:id,message:text,selected:r.selected,ready:r.targets.length,skipped:r.skipped.length,recipients:r.targets.map(t=>({id:t.id,name:t.name})),expiresAt:at+10*60000};
 }
 async send(actor,id){
  admin(actor);if(!UUID.test(id||''))throw error('Preview tidak sah.');if(!this.alerts.token)throw error('Bot Telegram belum dikonfigurasi.',503);
  const c=await this.pool.connect();try{await c.query('BEGIN');
   const row=(await c.query('SELECT * FROM zencore_admin_telegram_jobs WHERE id=$1 AND admin_id=$2 FOR UPDATE',[id,actor.id])).rows[0];if(!row)throw error('Preview tidak dijumpai.',404);
   if(row.status!=='DRAFT'){await c.query('COMMIT');return {ok:true,jobId:id,alreadyQueued:true};}
   if(new Date(row.expires_at).getTime()<=this.now())throw error('Preview tamat tempoh. Jana preview baharu.',409);
   await c.query("INSERT INTO zencore_admin_telegram_targets(job_id,user_id,chat_id) SELECT $1,t.id,t.\"chatId\" FROM jsonb_to_recordset($2::jsonb) AS t(id uuid,\"chatId\" text) ON CONFLICT DO NOTHING",[id,JSON.stringify(row.targets)]);
   await c.query("UPDATE zencore_admin_telegram_jobs SET status='QUEUED' WHERE id=$1",[id]);await c.query('COMMIT');return {ok:true,jobId:id,alreadyQueued:false};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async history(actor){admin(actor);const r=await this.pool.query(`SELECT j.id,j.admin_id,j.message,j.status,j.created_at,jsonb_array_length(j.targets) AS total,jsonb_array_length(j.skipped) AS excluded,
 COUNT(t.id) FILTER(WHERE t.status='sent')::int AS sent,COUNT(t.id) FILTER(WHERE t.status='failed')::int AS failed,COUNT(t.id) FILTER(WHERE t.status='unknown')::int AS unknown,COUNT(t.id) FILTER(WHERE t.status='skipped')::int AS skipped,COUNT(t.id) FILTER(WHERE t.status IN ('pending','sending'))::int AS pending
 FROM zencore_admin_telegram_jobs j LEFT JOIN zencore_admin_telegram_targets t ON t.job_id=j.id WHERE j.status<>'DRAFT' GROUP BY j.id ORDER BY j.created_at DESC LIMIT 30`);return {ok:true,jobs:r.rows};}
 async details(actor,id){admin(actor);if(!UUID.test(id||''))throw error('Rekod tidak sah.');const r=await this.pool.query("SELECT t.user_id,u.display_name,u.email,t.status,t.result FROM zencore_admin_telegram_targets t LEFT JOIN zencore_users u ON u.id=t.user_id WHERE t.job_id=$1 ORDER BY t.id",[id]);return {ok:true,recipients:r.rows};}
 async drain(){
  if(this.busy||!this.alerts.token)return;this.busy=true;try{
   // An interrupted send is ambiguous. Do not resend it automatically.
   await this.pool.query("UPDATE zencore_admin_telegram_targets SET status='unknown',result='INTERRUPTED_SEND',updated_at=NOW() WHERE status='sending' AND updated_at<NOW()-INTERVAL '2 minutes'");
   for(let i=0;i<3;i++){
    const t=(await this.pool.query("UPDATE zencore_admin_telegram_targets SET status='sending',updated_at=NOW() WHERE id=(SELECT t.id FROM zencore_admin_telegram_targets t JOIN zencore_admin_telegram_jobs j ON j.id=t.job_id WHERE t.status='pending' AND j.status='QUEUED' ORDER BY t.id FOR UPDATE OF t SKIP LOCKED LIMIT 1) RETURNING *")).rows[0];if(!t)break;
    let status='skipped',reason='RECIPIENT_CHANGED';
    try{const job=(await this.pool.query('SELECT * FROM zencore_admin_telegram_jobs WHERE id=$1',[t.job_id])).rows[0],sender=(await this.pool.query('SELECT role,status FROM zencore_users WHERE id=$1',[job.admin_id])).rows[0];
     if(sender?.role!=='admin'||sender.status!=='active')reason='ADMIN_DISABLED';
     else{const data=await this.data(),u=data.users.find(u=>u.id===t.user_id);
      if(u&&eligible(u)&&String(u.prefs.telegramId)===t.chat_id&&selected(u,job.selection,data.ibs)){await this.alerts.telegram(t.chat_id,job.message);status='sent';reason='TELEGRAM_ACCEPTED';}
     }
    }catch(_){status='failed';reason='FAILED_OR_UNCONFIRMED';}
    await this.pool.query('UPDATE zencore_admin_telegram_targets SET status=$2,result=$3,updated_at=NOW() WHERE id=$1',[t.id,status,reason]);
    await new Promise(r=>setTimeout(r,250));
   }
  }finally{this.busy=false;}
 }
}
module.exports={AdminTelegram,selection,selected,eligible,resolve,content};
