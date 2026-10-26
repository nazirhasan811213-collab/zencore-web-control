const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryAuthStore}=require('../auth-store');
const {hashPassword,verifyPassword}=require('../auth-core');
const {provisionErranteClients}=require('../errante-client-bootstrap');
const database='postgres://a:b@errante-db/zencore_errante_free_db';
test('Errante provisions only the two dummy clients with 14-day access; restarts never reset password or expiry',async()=>{
 const store=new MemoryAuthStore(),hash=await hashPassword('test-only-123');
 const rows=['rezalie@example.invalid','aron@example.invalid'].map(email=>({email,passwordHash:hash}));
 const env={DATABASE_URL:database,ZENCORE_ERRANTE_CLIENT_BOOTSTRAP:JSON.stringify(rows)};
 assert.deepEqual(await provisionErranteClients(store,env),{created:2,existing:0});
 for(const {email} of rows){const user=await store.findUserForLogin(email);assert.equal(user.status,'active');assert.equal(user.role,'client');assert.equal(await verifyPassword('test-only-123',user.password_hash),true);assert.equal(user.access_expires_at-user.access_activated_at,14*86400000);}
 const user=await store.findUserForLogin(rows[0].email),expiry=user.access_expires_at;
 user.status='disabled';rows[0].passwordHash=await hashPassword('different-test-only-123');env.ZENCORE_ERRANTE_CLIENT_BOOTSTRAP=JSON.stringify(rows);
 assert.deepEqual(await provisionErranteClients(store,env),{created:0,existing:2});
 assert.equal(user.password_hash,hash);assert.equal(user.access_expires_at,expiry);assert.equal(user.status,'disabled');
});
test('bootstrap is inert when empty; rejects original database, malformed hashes and other addresses before writing',async()=>{
 const store=new MemoryAuthStore();assert.deepEqual(await provisionErranteClients(store,{}),{created:0,existing:0});
 await assert.rejects(provisionErranteClients(store,{DATABASE_URL:'postgres://a:b@db/zencore_performance_db',ZENCORE_ERRANTE_CLIENT_BOOTSTRAP:'[]'}),/DEDICATED_DATABASE/);
 const hash=await hashPassword('test-only-123');
 for(const rows of [[{email:'rezalie@example.invalid',passwordHash:hash},{email:'other@example.invalid',passwordHash:hash}],[{email:'rezalie@example.invalid',passwordHash:'plaintext'},{email:'aron@example.invalid',passwordHash:hash}]]){
  await assert.rejects(provisionErranteClients(store,{DATABASE_URL:database,ZENCORE_ERRANTE_CLIENT_BOOTSTRAP:JSON.stringify(rows)}),/BOOTSTRAP_INVALID/);
 }
 assert.equal(await store.findUserForLogin('rezalie@example.invalid'),null);
});
