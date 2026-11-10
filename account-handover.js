'use strict';
const crypto=require('node:crypto'),{hashPassword}=require('./auth-core'),Access=require('./account-access');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const RELEASE_UNCONFIRMED=Symbol('admin-unconfirmed-reset'),PRESERVE_PROFILE=Symbol('switch-mt5-profile');
function resetReceipt(row){
 const confirmed=row.broker_close_confirmed===true;
 return {ok:true,completed:true,state:'ADMIN_SETUP',generation:row.generation,brokerCloseConfirmed:confirmed,reconnectAfterSeconds:30,defaultPassword:'zc123',message:confirmed?'Master Reset selesai. Penutupan broker disahkan. ID asal kekal; password awal zc123.':'Reset AKAUN SISTEM selesai. Token dan pautan lama dibatalkan; ID asal kekal, password zc123. POSISI/PENDING ORDER BROKER BELUM DISAHKAN TUTUP. Tunggu 30 saat sebelum pautan baharu.'};
}
const state=u=>u?.handoverState??u?.handover_state??'LIVE';
const canTrade=u=>!!u&&((u.role&&u.role!=='client')||state(u)==='LIVE');
function allowedPath(path,stage){return ['/auth/me','/auth/logout','/onboarding','/api/account/handover'].includes(path)||(stage==='ADMIN_SETUP'&&path==='/api/auto-trade/ea-connect');}
function admin(actor){if(actor?.role!=='admin'||actor.status!=='active')throw fail('Admin aktif sahaja.',403);}
class AccountHandover{
 constructor({pool,tradingState,stopTrading,now=Date.now}){this.pool=pool;this.tradingState=tradingState;this.stopTrading=stopTrading;this.now=now;this.aliases=false;}
 async init(){
  await this.pool.query(`CREATE TABLE IF NOT EXISTS zencore_account_resets(id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES zencore_users(id),admin_id UUID NOT NULL REFERENCES zencore_users(id),generation INTEGER NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await this.pool.query('ALTER TABLE zencore_account_resets ADD COLUMN IF NOT EXISTS command_id UUID');
  await this.pool.query('ALTER TABLE zencore_account_resets ADD COLUMN IF NOT EXISTS broker_close_confirmed BOOLEAN');
  await this.pool.query("ALTER TABLE zencore_account_resets ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT 'MASTER_RESET'");
  this.aliases=!!(await this.pool.query("SELECT to_regclass('zencore_managed_login_aliases') AS name")).rows[0].name;
  if(this.aliases){const c=await this.pool.connect();try{await c.query('BEGIN');const changed=await c.query("UPDATE zencore_users SET handover_state='ADMIN_SETUP' WHERE role='client' AND handover_state IS NULL AND id IN (SELECT user_id FROM zencore_managed_login_aliases) RETURNING id");this.initialized=changed.rowCount;const ids=changed.rows.map(u=>u.id);if(ids.length){
    if((await c.query("SELECT to_regclass('zencore_autotrade_profiles') AS name")).rows[0].name)await c.query("UPDATE zencore_autotrade_profiles SET desired_state='STOPPED',effective_state='STOPPED',pending_command_id=NULL,state_version=state_version+1,updated_at=NOW() WHERE user_id=ANY($1::uuid[])",[ids]);
    for(const table of ['zencore_autotrade_commands','zencore_hosted_autotrade_commands'])if((await c.query('SELECT to_regclass($1) AS name',[table])).rows[0].name)await c.query(`UPDATE ${table} SET status='CANCELLED',acknowledged_at=NOW(),result=jsonb_build_object('code','ADMIN_SETUP_REQUIRED') WHERE user_id=ANY($1::uuid[]) AND command_type IN ('PLACE_SETUP','SYSTEM_ON') AND status IN ('PENDING','DELIVERED')`,[ids]);
   }await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}else this.initialized=0;
 }
 async row(userId,c=this.pool,lock=false){const r=(await c.query('SELECT * FROM zencore_users WHERE id=$1'+(lock?' FOR UPDATE':''),[userId])).rows[0];if(!r||r.role!=='client')throw fail('Akaun client tidak dijumpai.',404);return r;}
 async status(userId){const u=await this.row(userId);let alias=null;if(this.aliases)alias=(await this.pool.query('SELECT login_id FROM zencore_managed_login_aliases WHERE user_id=$1',[userId])).rows[0]?.login_id;return {ok:true,state:state(u),generation:u.handover_generation||0,loginId:alias?'ZCuser '+require('./managed-vps-accounts').number(alias):u.email,profile:{displayName:/^(ZCuser \d+|Client)$/.test(u.display_name)?'':u.display_name,email:u.email.endsWith('@managed.zencore.invalid')?'':u.email,phone:u.phone||''},releasedAt:u.handover_released_at,completedAt:u.handover_completed_at};}
 async release(actor,userId){admin(actor);const c=await this.pool.connect();try{await c.query('BEGIN');const u=await this.row(userId,c,true);if(u.status!=='active')throw fail('Aktifkan akaun client dahulu.');if(state(u)==='USER_PROFILE'){await c.query('COMMIT');return this.status(userId);}if(state(u)!=='ADMIN_SETUP')throw fail('Akaun bukan dalam fasa Admin Setup.');
  await c.query('SELECT user_id FROM zencore_autotrade_profiles WHERE user_id=$1 FOR UPDATE',[userId]);await c.query('SELECT id FROM zencore_mt5_secure_pods WHERE user_id=$1 FOR UPDATE',[userId]);
  const t=await this.tradingState(userId),v=require('./auto-trade-core').validateSettings(t.settings||{});
  if(!t.connection?.ready||!t.pod||!v.ok||!t.settings?.riskAcknowledgedAt)throw fail('Lengkapkan sambungan MT5 dan simpan konfigurasi Auto Trade dahulu.');
  if((t.positions||[]).length||!['STOPPED','UNPROVISIONED'].includes(t.control?.effectiveState)||t.control?.desiredState!=='STOPPED')throw fail('STOP Auto Trade dan pastikan tiada posisi sebelum serahan.');
  await c.query("UPDATE zencore_users SET handover_state='USER_PROFILE',handover_released_at=NOW(),handover_completed_at=NULL WHERE id=$1",[userId]);await c.query('COMMIT');return this.status(userId);
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async complete(userId,input){
  const profile={displayName:String(input.displayName||'').trim().replace(/\s+/g,' '),email:String(input.email||'').trim().toLowerCase(),phone:String(input.phone||'').trim().replace(/[\s()-]/g,'')},password=String(input.newPassword||'');
  if(profile.displayName.length<2||profile.displayName.length>60||!/[\p{L}]/u.test(profile.displayName)||/^(ZCuser\s*\d+|Client)$/i.test(profile.displayName)||!require('./auth-core').validateEmail(profile.email)||profile.email.endsWith('.invalid')||!/^\+?\d{8,15}$/.test(profile.phone))throw fail('Lengkapkan nama penuh, e-mel dan nombor telefon yang sah.',400);
  if(password.length<10||password.length>128||!/[A-Za-z]/.test(password)||!/\d/.test(password)||password!==input.confirmPassword||password==='zc123')throw fail('Password baharu minimum 10 aksara, mempunyai huruf dan nombor, serta pengesahan sepadan.',400);
  const hash=await hashPassword(password),c=await this.pool.connect();try{await c.query('BEGIN');const u=await this.row(userId,c,true);if(u.status!=='active'||state(u)!=='USER_PROFILE'||input.generation!==(u.handover_generation||0))throw fail('Serahan akaun belum dibuka atau borang sudah tidak sah. Muat semula.');
   if((await c.query("SELECT to_regclass('zencore_admin_telegram_jobs') AS name")).rows[0].name){await c.query('DELETE FROM zencore_admin_telegram_targets WHERE user_id=$1',[userId]);await c.query("UPDATE zencore_admin_telegram_jobs SET targets=(SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM jsonb_array_elements(targets)t WHERE t->>'id'<>$1) WHERE targets @> jsonb_build_array(jsonb_build_object('id',$1::text))",[userId]);}
   await c.query("UPDATE zencore_users SET display_name=$2,email=$3,phone=$4,ic_number=NULL,password_hash=$5,handover_state='LIVE',handover_completed_at=NOW(),access_activated_at=NOW(),access_expires_at=NOW()+INTERVAL '14 days' WHERE id=$1",[userId,profile.displayName,profile.email,profile.phone,hash]);await c.query('DELETE FROM zencore_sessions WHERE user_id=$1',[userId]);await c.query('COMMIT');return {ok:true,state:'LIVE',message:'Profil lengkap. Log masuk semula menggunakan password baharu.'};
  }catch(e){await c.query('ROLLBACK');if(e.code==='23505')throw fail('E-mel ini sudah digunakan.',409);throw e;}finally{c.release();}
 }
 async switchMt5(actor,userId,input={}){
  admin(actor);
  const result=await this.masterReset(actor,userId,input,PRESERVE_PROFILE);
  if(!result.completed)return result;
  const {defaultPassword,...receipt}=result;
  return {...receipt,profilePreserved:true,message:result.brokerCloseConfirmed?'Pautan MT5 dilepaskan. Profil dan password dikekalkan. Semak tetapan sebelum serahan semula.':'Pautan MT5 dilepaskan. POSISI BROKER BELUM DISAHKAN TUTUP. Profil dan password dikekalkan.'};
 }
 async masterReset(actor,userId,input={},preserve=null){
  admin(actor);
  const fallback=input.resetPolicy==='MASTER_RESET_RELEASE_V3'&&input.allowUnconfirmedDisconnect===true;
  if(input.confirmation!=='RESET'||input.closeAllAccount!==true||!['MASTER_RESET_FORCE_V2','MASTER_RESET_RELEASE_V3'].includes(input.resetPolicy))throw fail('Admin perlu sahkan tutup SEMUA posisi dan pending order akaun MT5 ini sebelum Master Reset.',400);
  if(input.resetPolicy==='MASTER_RESET_RELEASE_V3'&&(!fallback||!Number.isInteger(input.resetGeneration)||input.resetGeneration<0))throw fail('Muat semula akaun dan sahkan pelepasan pautan walaupun broker belum disahkan tutup.',400);
  if(input.commandId){
   if(!/^[0-9a-f-]{36}$/i.test(input.commandId))throw fail('Rujukan reset tidak sah.',400);
   const done=(await this.pool.query('SELECT generation,broker_close_confirmed,operation FROM zencore_account_resets WHERE user_id=$1 AND command_id=$2',[userId,input.commandId])).rows[0];
   if(done){if((done.operation==='SWITCH_MT5')!==(preserve===PRESERVE_PROFILE))throw fail('Jenis tindakan lama berbeza. Muat semula akaun.');return resetReceipt(done);}
  }
  const u=await this.row(userId),generation=u.handover_generation||0;
  if(fallback&&input.resetGeneration!==generation){
   if(input.resetGeneration===generation-1){
    const done=(await this.pool.query('SELECT generation,broker_close_confirmed,operation FROM zencore_account_resets WHERE user_id=$1 AND generation=$2 ORDER BY created_at DESC LIMIT 1',[userId,generation])).rows[0];
    if(done){if((done.operation==='SWITCH_MT5')!==(preserve===PRESERVE_PROFILE))throw fail('Jenis tindakan lama berbeza. Muat semula akaun.');return resetReceipt(done);}
   }
   throw fail('Akaun sudah berubah. Muat semula; permintaan lama tidak boleh mereset client baharu.');
  }
  const pod=(await this.pool.query('SELECT * FROM zencore_mt5_secure_pods WHERE user_id=$1 AND revoked_at IS NULL',[userId])).rows[0];
  if(input.expectedPodTokenHash&&(!/^[a-f0-9]{64}$/.test(input.expectedPodTokenHash)||pod?.token_hash!==input.expectedPodTokenHash))throw fail('Pautan slot sudah berubah. Muat semula; akaun baharu tidak direset.');
  const abandon=async commandId=>{
   const ref=commandId||crypto.randomUUID();
   return {...await this.reset(actor,userId,{confirmation:'RESET',masterCommandId:ref,expectedPodTokenHash:input.expectedPodTokenHash},{key:RELEASE_UNCONFIRMED,generation,podId:pod?.id||null,preserve}),completed:true};
  };
  const offline=!pod?.last_seen_at||this.now()-new Date(pod.last_seen_at).getTime()>12000||new Date(pod.last_seen_at).getTime()>this.now()+5000;
  if(!pod){
   if(input.commandId)throw fail('Pautan lama sudah dibatalkan. Muat semula akaun; tiada reset tambahan dibuat.');
   if(fallback)return abandon();
   await this.stopTrading(userId);return {...await this.reset(actor,userId,{confirmation:'RESET'},{preserve}),completed:true};
  }
  if(pod.ownership_mode!=='TRADER_OWNED_EA_LOCAL')throw fail('Master Reset ini untuk EA + Connector tempatan.');
  if(input.commandId){
   const command=(await this.pool.query("SELECT * FROM zencore_autotrade_commands WHERE id=$1 AND user_id=$2 AND pod_id=$3 AND command_type='SYSTEM_STOP'",[input.commandId,userId,pod.id])).rows[0];
   if(!command||command.payload?.masterResetVersion!=='MASTER_RESET_FORCE_V2'||command.payload?.masterResetScope!=='ALL_ACCOUNT'||command.payload?.masterResetGeneration!==generation)throw fail('Rujukan reset sudah tidak sah. Muat semula akaun.');
   if(command.status==='EXECUTED'&&command.result?.code==='MASTER_RESET_FORCE_READY'){
    const empty=!(await this.tradingState(userId)).positions?.length;
    if(pod.last_seen_at&&new Date(pod.last_seen_at).getTime()>=new Date(command.acknowledged_at).getTime()&&empty&&!offline)
     return {...await this.reset(actor,userId,{confirmation:'RESET',masterCommandId:command.id,expectedPodTokenHash:input.expectedPodTokenHash},{preserve}),completed:true};
    if(fallback&&(offline||this.now()-new Date(command.acknowledged_at).getTime()>15000))return abandon(command.id);
    return {ok:true,pending:true,commandId:command.id,message:'EA sudah memproses penutupan. Menunggu laporan MT5 terkini mengesahkan kosong.'};
   }
   const terminal=!['PENDING','DELIVERED'].includes(command.status),expired=new Date(command.expires_at).getTime()<=this.now();
   const elapsed=this.now()-new Date(command.created_at).getTime(),unresponsive=elapsed>(command.status==='DELIVERED'?30000:15000);
   if(fallback&&(offline||terminal||expired||unresponsive))return abandon(command.id);
   if(command.status==='EXECUTED'||['TYPE_REJECTED','EA_MASTER_RESET_UPGRADE_REQUIRED'].includes(command.result?.code))throw fail('Kemas kini Connector 2.1.15 / Manager 1.0.7 dan EA 2.19 untuk Master Reset tutup semua.');
   if(terminal||expired)throw fail('Reset belum selesai: '+(command.result?.code||'Arahan luput. Semak Connector/EA dan cuba semula.'));
   return {ok:true,pending:true,commandId:command.id,message:'Menunggu Connector/EA. Jika tidak dapat disahkan, sistem akan batalkan pautan lama dan kosongkan akaun sistem.'};
  }
  const existing=(await this.pool.query("SELECT id FROM zencore_autotrade_commands WHERE user_id=$1 AND pod_id=$2 AND command_type='SYSTEM_STOP' AND payload->>'masterResetVersion'='MASTER_RESET_FORCE_V2' AND payload->>'masterResetGeneration'=$3 "+(fallback?'':"AND ((status IN ('PENDING','DELIVERED') AND expires_at>NOW()) OR (status='EXECUTED' AND result->>'code'='MASTER_RESET_FORCE_READY')) ")+"ORDER BY created_at DESC LIMIT 1",[userId,pod.id,String(generation)])).rows[0];
  if(existing)return this.masterReset(actor,userId,{...input,commandId:existing.id},preserve);
  if(fallback&&offline)return abandon();
  const t=await this.stopTrading(userId,{generation,closeAllAccount:true,expectedPodTokenHash:input.expectedPodTokenHash});
  return {ok:true,pending:true,commandId:t.control.pendingCommandId,message:'Master Reset dimulakan. Menutup posisi jika Connector boleh dicapai; pautan sistem akan dilepaskan jika tidak dapat disahkan.'};
 }
 async reset(actor,userId,input,release=null){admin(actor);const abandon=release?.key===RELEASE_UNCONFIRMED,preserve=release?.preserve===PRESERVE_PROFILE;if(input.confirmation!=='RESET')throw fail('Taip RESET untuk mengesahkan reset akaun.',400);const hash=await hashPassword('zc123'),c=await this.pool.connect();try{await c.query('BEGIN');const u=await this.row(userId,c,true);
   const profile=(await c.query('SELECT * FROM zencore_autotrade_profiles WHERE user_id=$1 FOR UPDATE',[userId])).rows[0],pod=(await c.query('SELECT * FROM zencore_mt5_secure_pods WHERE user_id=$1 FOR UPDATE',[userId])).rows[0],hosted=(await c.query('SELECT * FROM zencore_mt5_hosted_accounts WHERE user_id=$1 FOR UPDATE',[userId])).rows[0];
   if(input.expectedPodTokenHash&&pod?.token_hash!==input.expectedPodTokenHash)throw fail('Pautan slot sudah berubah. Reset lama dibatalkan.');
   if(abandon&&((u.handover_generation||0)!==release.generation||(pod?.revoked_at?null:pod?.id||null)!==release.podId))throw fail('Pautan atau pemilik akaun berubah. Reset lama dibatalkan.');
   if(input.masterCommandId&&!abandon){
    const proof=(await c.query("SELECT * FROM zencore_autotrade_commands WHERE id=$1 AND user_id=$2 AND pod_id=$3 FOR UPDATE",[input.masterCommandId,userId,pod?.id])).rows[0];
    if(!proof||proof.command_type!=='SYSTEM_STOP'||proof.status!=='EXECUTED'||proof.result?.code!=='MASTER_RESET_FORCE_READY'||proof.payload?.masterResetVersion!=='MASTER_RESET_FORCE_V2'||proof.payload?.masterResetScope!=='ALL_ACCOUNT'||proof.payload?.masterResetGeneration!==(u.handover_generation||0))throw fail('Pengesahan Master Reset tidak sepadan.');
   }
   if(!abandon&&profile&&(profile.desired_state!=='STOPPED'||!['STOPPED','UNPROVISIONED'].includes(profile.effective_state)))throw fail('STOP Auto Trade sebelum reset akaun.');
   if(!abandon&&(await c.query('SELECT 1 FROM zencore_mt5_positions WHERE user_id=$1 LIMIT 1',[userId])).rowCount)throw fail('Masih ada posisi MT5. Reset tidak dibenarkan.');
   if(!abandon)for(const table of ['zencore_autotrade_commands','zencore_hosted_autotrade_commands'])if((await c.query(`SELECT 1 FROM ${table} WHERE user_id=$1 AND status IN ('PENDING','DELIVERED') LIMIT 1`,[userId])).rowCount)throw fail('Masih ada arahan belum selesai. Tunggu pengesahan MT5.');
   if(!abandon&&pod&&!pod.revoked_at&&(!pod.last_seen_at||this.now()-new Date(pod.last_seen_at).getTime()>12000||this.now()-new Date(pod.last_seen_at).getTime() < -5000))throw fail('MT5 offline. Sambung semula untuk sahkan tiada posisi sebelum reset.');
   if(hosted)throw fail('Akaun hosted perlu dilepaskan daripada worker sebelum reset.');
   let email=u.email,name=u.display_name;
   if(!preserve){
   let alias=null;if(this.aliases)alias=(await c.query('SELECT login_id FROM zencore_managed_login_aliases WHERE user_id=$1',[userId])).rows[0]?.login_id;const n=require('./managed-vps-accounts').number(alias);email=n?require('./managed-vps-accounts').loginEmail(alias):u.email;name=n?'ZCuser '+n:'Client';
   if((await c.query("SELECT to_regclass('zencore_position_notifications') AS name")).rows[0].name)await c.query('DELETE FROM zencore_position_notifications WHERE user_id=$1',[userId]);
   if((await c.query("SELECT to_regclass('zencore_position_watches') AS name")).rows[0].name)await c.query('DELETE FROM zencore_position_watches WHERE user_id=$1',[userId]);
   if((await c.query("SELECT to_regclass('zencore_admin_telegram_jobs') AS name")).rows[0].name){
    await c.query('DELETE FROM zencore_admin_telegram_targets WHERE user_id=$1',[userId]);
    await c.query("UPDATE zencore_admin_telegram_jobs SET targets=(SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM jsonb_array_elements(targets)t WHERE t->>'id'<>$1) WHERE targets @> jsonb_build_array(jsonb_build_object('id',$1::text))",[userId]);
   }
   }
   // Revoke the connector before deleting history. In-flight heartbeats cannot restore it.
   if(pod)await c.query("UPDATE zencore_mt5_secure_pods SET token_hash=$2,label='Unpaired',connector_version=NULL,terminal_build=NULL,manual_exit_version=NULL,revoked_at=NOW(),account_mask=NULL,server_mask=NULL,broker_mask=NULL,account_fingerprint=NULL,trade_mode=NULL,last_seen_at=NULL,symbol_specs='{}'::jsonb,manual_exit_enabled=FALSE,terminal_trade_allowed=FALSE,account_trade_allowed=FALSE,expert_trade_allowed=FALSE,demo_execution_unlocked=FALSE WHERE user_id=$1",[userId,crypto.randomBytes(32).toString('hex')]);
   for(const table of (preserve?['zencore_sessions','zencore_autotrade_commands','zencore_hosted_autotrade_commands','zencore_mt5_positions','zencore_mt5_pairing_sessions']:['zencore_sessions','zencore_telegram_deliveries','zencore_alert_preferences','zencore_autotrade_commands','zencore_hosted_autotrade_commands','zencore_autotrade_audit','zencore_mt5_positions','zencore_mt5_pairing_sessions','zencore_autotrade_profiles']))await c.query(`DELETE FROM ${table} WHERE user_id=$1`,[userId]);
   if(preserve){
    await c.query("UPDATE zencore_autotrade_profiles SET desired_state='STOPPED',effective_state='STOPPED',pending_command_id=NULL,risk_acknowledged_at=NULL,state_version=state_version+1,updated_at=NOW() WHERE user_id=$1",[userId]);
    await c.query("UPDATE zencore_users SET handover_state='ADMIN_SETUP',handover_released_at=NULL,handover_completed_at=NULL,handover_generation=handover_generation+1 WHERE id=$1",[userId]);
   }else await c.query("UPDATE zencore_users SET display_name=$2,email=$3,phone=NULL,ic_number=NULL,password_hash=$4,status='active',last_login_at=NULL,registration_reason=NULL,registration_decision='approved',handover_state='ADMIN_SETUP',handover_released_at=NULL,handover_completed_at=NULL,handover_generation=handover_generation+1,access_activated_at=NOW(),access_expires_at=NOW()+INTERVAL '14 days' WHERE id=$1",[userId,name,email,hash]);
   await c.query('INSERT INTO zencore_account_resets(id,user_id,admin_id,generation,command_id,broker_close_confirmed,operation) VALUES($1,$2,$3,$4,$5,$6,$7)',[crypto.randomUUID(),userId,actor.id,(u.handover_generation||0)+1,input.masterCommandId||null,!!input.masterCommandId&&!abandon,preserve?'SWITCH_MT5':'MASTER_RESET']);await c.query('COMMIT');return resetReceipt({generation:(u.handover_generation||0)+1,broker_close_confirmed:!!input.masterCommandId&&!abandon});
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
}
module.exports={AccountHandover,state,canTrade,allowedPath};
