'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),crypto=require('node:crypto'),{Pool}=require('pg'),{PostgresAuthStore}=require('../auth-store'),M=require('../managed-vps-accounts'),{createAuthService}=require('../auth-service'),{hashPassword,verifyPassword}=require('../auth-core'),{DURATION_MS}=require('../account-access');
const url=process.env.ZENCORE_ALERT_TEST_DATABASE_URL;
test('managed batch creates exactly ten scoped clients once; restarts preserve passwords, status and expiry',{skip:!url},async()=>{
 const schema='vps10_'+crypto.randomBytes(8).toString('hex'),db=new Pool({connectionString:url});let store;
 try{
  await db.query(`CREATE SCHEMA ${schema}`);store=new PostgresAuthStore(url);await store.pool.end();store.pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});await store.init();
  const unrelated=await store.createUser({displayName:'Existing',email:'existing@example.invalid',passwordHash:'unchanged'});
  const result=await Promise.all([M.bootstrap(store.pool,{batch:M.BATCH}),M.bootstrap(store.pool,{batch:M.BATCH})]);a.equal(result.reduce((s,x)=>s+x.created,0),10);
  const rows=(await store.pool.query("SELECT * FROM zencore_users WHERE email LIKE '%@managed.zencore.invalid' ORDER BY display_name")).rows;a.equal(rows.length,10);
  for(const row of rows){a.equal(row.role,'client');a.equal(row.status,'active');a.ok(await verifyPassword('zc123',row.password_hash));a.equal(+new Date(row.access_expires_at)-(+new Date(row.access_activated_at)),DURATION_MS);}
  a.equal((await store.pool.query('SELECT password_hash FROM zencore_users WHERE id=$1',[unrelated.id])).rows[0].password_hash,'unchanged');
  const auth=createAuthService({store});const login=await auth.login({email:'ZCuser 1',password:'zc123'});a.equal(login.user.role,'client');a.equal(login.user.loginId,'ZCuser 1');
  await store.pool.query("UPDATE zencore_users SET display_name='Nama Profil Baharu',email='new-contact@example.invalid',password_hash=$2,status='disabled' WHERE id=$1",[login.user.id,await hashPassword('changed-password-123')]);
  const after=await M.bootstrap(store.pool,{batch:M.BATCH});a.equal(after.created,0);const existing=await M.findUser(store,'ZCuser 1');a.equal(existing.email,'new-contact@example.invalid');a.equal(existing.status,'disabled');a.ok(await verifyPassword('changed-password-123',existing.password_hash));
  const originalBefore=(await store.pool.query('SELECT * FROM zencore_users WHERE id=$1',[login.user.id])).rows[0];
  const extension=await Promise.all([M.bootstrap(store.pool,{batch:M.EXTENSION_BATCH}),M.bootstrap(store.pool,{batch:M.EXTENSION_BATCH})]);a.equal(extension.reduce((n,x)=>n+x.created,0),30);
  const all=(await store.pool.query('SELECT u.*,a.login_id FROM zencore_managed_login_aliases a JOIN zencore_users u ON u.id=a.user_id')).rows;a.equal(all.length,40);
  const added=all.filter(u=>M.number(u.login_id)>10);a.equal(added.length,30);
  for(const row of added){a.equal(row.role,'client');a.equal(row.handover_state,'ADMIN_SETUP');a.ok(await verifyPassword('zc123',row.password_hash));}
  a.deepEqual((await store.pool.query('SELECT * FROM zencore_users WHERE id=$1',[login.user.id])).rows[0],originalBefore);
  a.equal((await M.bootstrap(store.pool,{batch:M.EXTENSION_BATCH})).created,0);
  a.equal((await auth.login({email:'ZCuser 40',password:'zc123'})).user.loginId,'ZCuser 40');
  const clients=await store.listClientsForAdmin();const managed=clients.find(c=>c.id===login.user.id);a.equal(managed.loginId,'ZCuser 1');a.equal(managed.displayName,'Nama Profil Baharu');a.equal(managed.email,'new-contact@example.invalid');a.equal(clients.find(c=>c.id===unrelated.id).loginId,undefined);
  await a.rejects(auth.login({email:'ZCuser 1',password:'zc123'}),{code:'INVALID_CREDENTIALS'});
  await store.pool.query("UPDATE zencore_users SET status='active' WHERE id=$1",[login.user.id]);a.equal((await auth.login({email:'ZCuser 1',password:'changed-password-123'})).user.id,login.user.id);
 }finally{await store?.close();await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.end();}
});
