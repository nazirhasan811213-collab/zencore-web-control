'use strict';
const crypto=require('node:crypto'),{hashPassword}=require('./auth-core'),Access=require('./account-access');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const state=u=>u?.handoverState??u?.handover_state??'LIVE';
const canTrade=u=>!!u&&((u.role&&u.role!=='client')||state(u)==='LIVE');
function allowedPath(path,stage){return ['/auth/me','/auth/logout','/onboarding','/api/account/handover'].includes(path)||(stage==='ADMIN_SETUP'&&path==='/api/auto-trade/ea-connect');}
function allowedVpsAutoTrade(path,stage,method){return stage==='LIVE'||(stage==='ADMIN_SETUP'&&method==='POST'&&path==='/api/auto-trade/ea-connect');}
function admin(actor){if(actor?.role!=='admin'||actor.status!=='active')throw fail('Admin aktif sahaja.',403);}
class AccountHandover{
 constructor({pool,tradingState,now=Date.now,requireVps=false}){this.pool=pool;this.tradingState=tradingState;this.now=now;this.aliases=false;this.requireVps=requireVps;}
 async init(){
  await this.pool.query(`CREATE TABLE IF NOT EXISTS zencore_account_resets(id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES zencore_users(id),admin_id UUID NOT NULL REFERENCES zencore_users(id),generation INTEGER NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  if(this.requireVps){
   await this.pool.query("ALTER TABLE zencore_users ALTER COLUMN handover_state SET DEFAULT 'ADMIN_SETUP'");
   await this.pool.query("UPDATE zencore_users SET handover_state=CASE WHEN handover_released_at IS NOT NULL THEN 'LIVE' ELSE 'ADMIN_SETUP' END, handover_completed_at=handover_released_at WHERE role='client' AND handover_state='USER_PROFILE'");
   this.initialized=(await this.pool.query("UPDATE zencore_users SET handover_state='ADMIN_SETUP' WHERE role='client' AND handover_state IS NULL")).rowCount;
  }
  this.aliases=!!(await this.pool.query("SELECT to_regclass('zencore_managed_login_aliases') AS name")).rows[0].name;
  if(this.aliases){const c=await this.pool.connect();try{await c.query('BEGIN');const changed=await c.query("UPDATE zencore_users SET handover_state='ADMIN_SETUP' WHERE role='client' AND handover_state IS NULL AND id IN (SELECT user_id FROM zencore_managed_login_aliases) RETURNING id");this.initialized=(this.initialized||0)+changed.rowCount;const ids=changed.rows.map(u=>u.id);if(ids.length){
    if((await c.query("SELECT to_regclass('zencore_autotrade_profiles') AS name")).rows[0].name)await c.query("UPDATE zencore_autotrade_profiles SET desired_state='STOPPED',effective_state='STOPPED',pending_command_id=NULL,state_version=state_version+1,updated_at=NOW() WHERE user_id=ANY($1::uuid[])",[ids]);
    for(const table of ['zencore_autotrade_commands','zencore_hosted_autotrade_commands'])if((await c.query('SELECT to_regclass($1) AS name',[table])).rows[0].name)await c.query(`UPDATE ${table} SET status='CANCELLED',acknowledged_at=NOW(),result=jsonb_build_object('code','ADMIN_SETUP_REQUIRED') WHERE user_id=ANY($1::uuid[]) AND command_type IN ('PLACE_SETUP','SYSTEM_ON') AND status IN ('PENDING','DELIVERED')`,[ids]);
   }await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}else this.initialized=this.initialized||0;
 }
 async row(userId,c=this.pool,lock=false){const r=(await c.query('SELECT * FROM zencore_users WHERE id=$1'+(lock?' FOR UPDATE':''),[userId])).rows[0];if(!r||r.role!=='client')throw fail('Akaun client tidak dijumpai.',404);return r;}
 async status(userId){const u=await this.row(userId);let alias=null;if(this.aliases)alias=(await this.pool.query('SELECT login_id FROM zencore_managed_login_aliases WHERE user_id=$1',[userId])).rows[0]?.login_id;return {ok:true,state:state(u),autoTradeOnly:this.requireVps,generation:u.handover_generation||0,loginId:alias?'ZCuser '+require('./managed-vps-accounts').number(alias):u.email,profile:{displayName:/^(ZCuser \d+|Client)$/.test(u.display_name)?'':u.display_name,email:u.email.endsWith('@managed.zencore.invalid')?'':u.email,phone:u.phone||''},releasedAt:u.handover_released_at,completedAt:u.handover_completed_at};}
 async release(actor,userId){admin(actor);const c=await this.pool.connect();try{await c.query('BEGIN');const u=await this.row(userId,c,true);if(u.status!=='active'||(this.requireVps&&!Access.allowed(u,this.now())))throw fail('Aktifkan akaun client dahulu.');if(state(u)===(this.requireVps?'LIVE':'USER_PROFILE')){await c.query('COMMIT');return this.status(userId);}if(state(u)!=='ADMIN_SETUP')throw fail('Akaun bukan dalam fasa Admin Setup.');
  await c.query('SELECT user_id FROM zencore_autotrade_profiles WHERE user_id=$1 FOR UPDATE',[userId]);await c.query('SELECT id FROM zencore_mt5_secure_pods WHERE user_id=$1 FOR UPDATE',[userId]);
  const t=await this.tradingState(userId),v=require('./auto-trade-core').validateSettings(t.settings||{});
  if(!(this.requireVps?t.setupConnection?.ready:t.connection?.ready)||!t.pod||!v.ok||!t.settings?.riskAcknowledgedAt)throw fail('Sambungkan Connector dan EA pada MT5 di VPS, hidupkan Algo Trading dan simpan konfigurasi Auto Trade dahulu.');
  if((t.positions||[]).length||!['STOPPED','UNPROVISIONED'].includes(t.control?.effectiveState)||t.control?.desiredState!=='STOPPED')throw fail('STOP Auto Trade dan pastikan tiada posisi sebelum serahan.');
  await c.query(this.requireVps
   ? "UPDATE zencore_users SET handover_state='LIVE',handover_released_at=NOW(),handover_completed_at=NOW() WHERE id=$1"
   : "UPDATE zencore_users SET handover_state='USER_PROFILE',handover_released_at=NOW(),handover_completed_at=NULL WHERE id=$1",[userId]);await c.query('COMMIT');return this.status(userId);
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async complete(userId,input){
  if(this.requireVps)throw fail('Tiada borang profil diperlukan untuk serahan Auto Trade.',405);
  const profile={displayName:String(input.displayName||'').trim().replace(/\s+/g,' '),email:String(input.email||'').trim().toLowerCase(),phone:String(input.phone||'').trim().replace(/[\s()-]/g,'')},password=String(input.newPassword||'');
  if(profile.displayName.length<2||profile.displayName.length>60||!/[\p{L}]/u.test(profile.displayName)||/^(ZCuser\s*\d+|Client)$/i.test(profile.displayName)||!require('./auth-core').validateEmail(profile.email)||profile.email.endsWith('.invalid')||!/^\+?\d{8,15}$/.test(profile.phone))throw fail('Lengkapkan nama penuh, e-mel dan nombor telefon yang sah.',400);
  if(password.length<10||password.length>128||!/[A-Za-z]/.test(password)||!/\d/.test(password)||password!==input.confirmPassword||password==='zc123')throw fail('Password baharu minimum 10 aksara, mempunyai huruf dan nombor, serta pengesahan sepadan.',400);
  const hash=await hashPassword(password),c=await this.pool.connect();try{await c.query('BEGIN');const u=await this.row(userId,c,true);if(u.status!=='active'||state(u)!=='USER_PROFILE'||input.generation!==(u.handover_generation||0))throw fail('Serahan akaun belum dibuka atau borang sudah tidak sah. Muat semula.');
   if((await c.query("SELECT to_regclass('zencore_admin_telegram_jobs') AS name")).rows[0].name){await c.query('DELETE FROM zencore_admin_telegram_targets WHERE user_id=$1',[userId]);await c.query("UPDATE zencore_admin_telegram_jobs SET targets=(SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM jsonb_array_elements(targets)t WHERE t->>'id'<>$1) WHERE targets @> jsonb_build_array(jsonb_build_object('id',$1::text))",[userId]);}
   await c.query("UPDATE zencore_users SET display_name=$2,email=$3,phone=$4,ic_number=NULL,password_hash=$5,handover_state='LIVE',handover_completed_at=NOW(),access_activated_at=NOW(),access_expires_at=NOW()+INTERVAL '14 days' WHERE id=$1",[userId,profile.displayName,profile.email,profile.phone,hash]);await c.query('DELETE FROM zencore_sessions WHERE user_id=$1',[userId]);await c.query('COMMIT');return {ok:true,state:'LIVE',message:'Profil lengkap. Log masuk semula menggunakan password baharu.'};
  }catch(e){await c.query('ROLLBACK');if(e.code==='23505')throw fail('E-mel ini sudah digunakan.',409);throw e;}finally{c.release();}
 }
 async reset(actor,userId,input){admin(actor);if(input.confirmation!=='RESET')throw fail('Taip RESET untuk mengesahkan reset akaun.',400);const hash=await hashPassword('zc123'),c=await this.pool.connect();try{await c.query('BEGIN');const u=await this.row(userId,c,true);
   const profile=(await c.query('SELECT * FROM zencore_autotrade_profiles WHERE user_id=$1 FOR UPDATE',[userId])).rows[0],pod=(await c.query('SELECT * FROM zencore_mt5_secure_pods WHERE user_id=$1 FOR UPDATE',[userId])).rows[0],hosted=(await c.query('SELECT * FROM zencore_mt5_hosted_accounts WHERE user_id=$1 FOR UPDATE',[userId])).rows[0];
   if(profile&&(profile.desired_state!=='STOPPED'||!['STOPPED','UNPROVISIONED'].includes(profile.effective_state)))throw fail('STOP Auto Trade sebelum reset akaun.');
   if((await c.query('SELECT 1 FROM zencore_mt5_positions WHERE user_id=$1 LIMIT 1',[userId])).rowCount)throw fail('Masih ada posisi MT5. Reset tidak dibenarkan.');
   for(const table of ['zencore_autotrade_commands','zencore_hosted_autotrade_commands'])if((await c.query(`SELECT 1 FROM ${table} WHERE user_id=$1 AND status IN ('PENDING','DELIVERED') LIMIT 1`,[userId])).rowCount)throw fail('Masih ada arahan belum selesai. Tunggu pengesahan MT5.');
   if(pod&&!pod.revoked_at&&(!pod.last_seen_at||this.now()-new Date(pod.last_seen_at).getTime()>12000||this.now()-new Date(pod.last_seen_at).getTime() < -5000))throw fail('MT5 offline. Sambung semula untuk sahkan tiada posisi sebelum reset.');
   if(hosted)throw fail('Akaun hosted perlu dilepaskan daripada worker sebelum reset.');
   let alias=null;if(this.aliases)alias=(await c.query('SELECT login_id FROM zencore_managed_login_aliases WHERE user_id=$1',[userId])).rows[0]?.login_id;const n=require('./managed-vps-accounts').number(alias),email=n?require('./managed-vps-accounts').loginEmail(alias):u.email,name=n?'ZCuser '+n:'Client';
   if((await c.query("SELECT to_regclass('zencore_position_notifications') AS name")).rows[0].name)await c.query('DELETE FROM zencore_position_notifications WHERE user_id=$1',[userId]);
   if((await c.query("SELECT to_regclass('zencore_position_watches') AS name")).rows[0].name)await c.query('DELETE FROM zencore_position_watches WHERE user_id=$1',[userId]);
   // Revoke the connector before deleting history. In-flight heartbeats cannot restore it.
   if(pod)await c.query("UPDATE zencore_mt5_secure_pods SET token_hash=$2,label='Unpaired',connector_version=NULL,terminal_build=NULL,manual_exit_version=NULL,revoked_at=NOW(),account_mask=NULL,server_mask=NULL,broker_mask=NULL,account_fingerprint=NULL,trade_mode=NULL,last_seen_at=NULL,symbol_specs='{}'::jsonb,manual_exit_enabled=FALSE,terminal_trade_allowed=FALSE,account_trade_allowed=FALSE,expert_trade_allowed=FALSE,demo_execution_unlocked=FALSE WHERE user_id=$1",[userId,crypto.randomBytes(32).toString('hex')]);
   for(const table of ['zencore_sessions','zencore_telegram_deliveries','zencore_alert_preferences','zencore_autotrade_commands','zencore_hosted_autotrade_commands','zencore_autotrade_audit','zencore_mt5_positions','zencore_mt5_pairing_sessions','zencore_autotrade_profiles'])await c.query(`DELETE FROM ${table} WHERE user_id=$1`,[userId]);
   await c.query("UPDATE zencore_users SET display_name=$2,email=$3,phone=NULL,ic_number=NULL,password_hash=$4,status='active',last_login_at=NULL,registration_reason=NULL,registration_decision='approved',handover_state='ADMIN_SETUP',handover_released_at=NULL,handover_completed_at=NULL,handover_generation=handover_generation+1,access_activated_at=NOW(),access_expires_at=NOW()+INTERVAL '14 days' WHERE id=$1",[userId,name,email,hash]);
   await c.query('INSERT INTO zencore_account_resets(id,user_id,admin_id,generation) VALUES($1,$2,$3,$4)',[crypto.randomUUID(),userId,actor.id,(u.handover_generation||0)+1]);await c.query('COMMIT');return {ok:true,state:'ADMIN_SETUP',defaultPassword:'zc123',message:'Akaun direset. Admin perlu setup dan serah semula.'};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
}
module.exports={AccountHandover,state,canTrade,allowedPath,allowedVpsAutoTrade};
