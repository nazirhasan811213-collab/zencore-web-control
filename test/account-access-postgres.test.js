'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),crypto=require('node:crypto'),{Pool}=require('pg');
const {PostgresAuthStore}=require('../auth-store'),{createAuthService}=require('../auth-service'),{DURATION_MS}=require('../account-access');
const url=process.env.ZENCORE_ALERT_TEST_DATABASE_URL;
test('Postgres access migration, admin renewal, role exemption, session and IB guards',{skip:!url},async()=>{
 const schema='access_test_'+crypto.randomBytes(8).toString('hex'),db=new Pool({connectionString:url});let store;
 try{
  await db.query(`CREATE SCHEMA ${schema}`);store=new PostgresAuthStore(url);await store.pool.end();store.pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});await store.init();
  const admin=await store.createUser({displayName:'Admin',email:'a@pgaccess.test',role:'admin',passwordHash:'test'}),ib=await store.createIbAccount({displayName:'IB',email:'i@pgaccess.test',code:'pgaccess',passwordHash:'test'});
  const user=await store.createUser({displayName:'User',email:'u@pgaccess.test',passwordHash:'test',ibReferrerId:ib.referrer.id});
  a.equal(+new Date(user.accessExpiresAt)-(+new Date(user.accessActivatedAt)),DURATION_MS);a.equal(admin.accessExpiresAt,null);
  // Simulate a pre-policy user for the initial backfill, then verify restarts preserve it.
  await store.pool.query('DROP TRIGGER zencore_users_access_period ON zencore_users');await store.pool.query('UPDATE zencore_users SET access_activated_at=NULL,access_expires_at=NULL WHERE id=$1',[user.id]);
  await store.init();const first=await store.findUserForLogin(user.email);a.ok(first.access_expires_at);await store.init();a.equal(+new Date((await store.findUserForLogin(user.email)).access_expires_at),+new Date(first.access_expires_at));
  await store.createSession({userId:user.id,tokenHash:'a'.repeat(64),expiresAt:new Date(Date.now()+60000)});a.ok(await store.findSession('a'.repeat(64)));
  await store.pool.query("UPDATE zencore_users SET access_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[user.id]);a.equal(await store.findSession('a'.repeat(64)),null);await store.init();a.ok(+new Date((await store.findUserForLogin(user.email)).access_expires_at)<Date.now());
  a.equal((await store.listClientsForAdmin()).find(u=>u.id===user.id).status,'expired');a.equal(await store.setClientActiveForIb(ib.user.id,user.id,true),null);
  const service=createAuthService({store});await a.rejects(service.setAdminClientActive(ib.user,user.id,true),{code:'FORBIDDEN'});
  const renewed=await service.setAdminClientActive(admin,user.id,true);a.equal(renewed.status,'active');a.equal(+new Date(renewed.accessExpiresAt)-(+new Date(renewed.accessActivatedAt)),DURATION_MS);
  const audit=(await store.pool.query('SELECT * FROM zencore_access_renewals WHERE user_id=$1',[user.id])).rows;a.equal(audit.length,1);a.equal(audit[0].admin_id,admin.id);a.equal(await store.findSession('a'.repeat(64)),null);
  await store.setUserRole(user.id,'ib');let row=await store.findUserForLogin(user.email);a.equal(row.access_expires_at,null);await store.setUserRole(user.id,'client');row=await store.findUserForLogin(user.email);a.ok(+new Date(row.access_expires_at)>Date.now());
 }finally{await store?.close();await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.end();}
});
