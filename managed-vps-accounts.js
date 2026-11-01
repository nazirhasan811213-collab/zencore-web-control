'use strict';
const crypto=require('node:crypto');
const BATCH='VPS10_20261101';
function number(value){const m=String(value||'').trim().match(/^zcuser\s*(10|[1-9])$/i);return m?Number(m[1]):null;}
function loginEmail(value){const n=number(value);return n?`zcuser${n}@managed.zencore.invalid`:String(value||'').trim().toLowerCase();}
function loginId(email){const m=String(email||'').match(/^zcuser(10|[1-9])@managed\.zencore\.invalid$/i);return m?`ZCuser ${Number(m[1])}`:null;}
async function bootstrap(pool,{batch,defaultIbCode='nazir'}={}){
 if(batch!==BATCH)return {enabled:false,count:0,created:0};if(!pool)throw Error('MANAGED_ACCOUNTS_REQUIRE_POSTGRES');
 const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[BATCH]);
 await c.query('CREATE TABLE IF NOT EXISTS zencore_managed_user_batches(batch TEXT PRIMARY KEY,user_ids JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
 await c.query('CREATE TABLE IF NOT EXISTS zencore_managed_login_aliases(login_id TEXT PRIMARY KEY,user_id UUID NOT NULL UNIQUE REFERENCES zencore_users(id) ON DELETE CASCADE,batch TEXT NOT NULL)');
 const done=(await c.query('SELECT user_ids FROM zencore_managed_user_batches WHERE batch=$1',[BATCH])).rows[0];
 if(done){const rows=await c.query("SELECT u.id FROM zencore_users u JOIN zencore_managed_login_aliases a ON a.user_id=u.id WHERE u.id=ANY($1::uuid[])",[done.user_ids]);await c.query('COMMIT');return {enabled:true,count:rows.rowCount,created:0};}
 const ref=(await c.query('SELECT id,user_id FROM zencore_ib_referrers WHERE code=$1 AND active=true',[defaultIbCode])).rows[0];if(!ref)throw Error('MANAGED_IB_NOT_FOUND');
 const {hashPassword}=require('./auth-core'),ids=[];
 for(let i=1;i<=10;i++){const id=crypto.randomUUID(),email=loginEmail('ZCuser '+i);await c.query("INSERT INTO zencore_users(id,display_name,email,password_hash,role,status,ib_referrer_id,registration_decision,registration_reviewed_at,registration_reviewed_by) VALUES($1,$2,$3,$4,'client','active',$5,'approved',NOW(),$6)",[id,'ZCuser '+i,email,await hashPassword('zc123'),ref.id,ref.user_id]);await c.query('INSERT INTO zencore_managed_login_aliases(login_id,user_id,batch) VALUES($1,$2,$3)',['zcuser'+i,id,BATCH]);ids.push(id);}
 await c.query('INSERT INTO zencore_managed_user_batches(batch,user_ids) VALUES($1,$2)',[BATCH,JSON.stringify(ids)]);await c.query('COMMIT');return {enabled:true,count:10,created:10};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function findUser(store,input){const n=number(input);if(!n)return store.findUserForLogin(loginEmail(input));if(!store.pool)return store.findUserForLogin(loginEmail(input));try{return (await store.pool.query('SELECT u.*,a.login_id,ref.code AS ib_code,ref.display_name AS ib_name FROM zencore_managed_login_aliases a JOIN zencore_users u ON u.id=a.user_id LEFT JOIN zencore_ib_referrers ref ON ref.id=u.ib_referrer_id WHERE a.login_id=$1',['zcuser'+n])).rows[0]||null;}catch(e){if(e.code==='42P01')return null;throw e;}}
module.exports={BATCH,number,loginEmail,loginId,bootstrap,findUser};
