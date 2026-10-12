const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {Pool}=require('pg');const {PostgresAuthStore}=require('../auth-store');const {createAuthService}=require('../auth-service');
const url=process.env.ZENCORE_ALERT_TEST_DATABASE_URL;
test('PostgreSQL promotion migration persists contact override and empty disables profile fallback',{skip:!url},async()=>{
 const schema='promotion_test_'+crypto.randomBytes(8).toString('hex'); const admin=new Pool({connectionString:url});let store;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);
  store=new PostgresAuthStore(url);await store.pool.end();store.pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
  await store.init();await store.init();
  const ib=await store.createIbAccount({displayName:'Test IB',code:'testib',email:'ib@test.example',passwordHash:'hash-test-only',phone:'0123456789'});
  const service=createAuthService({store});const user={id:ib.user.id,role:'ib'};
  assert.equal((await service.publicPromotion('testib')).phone,'60123456789');
  await service.updatePromotionPhone(user,{phone:'0133456789'});
  assert.equal((await service.publicPromotion('testib')).phone,'60133456789');
  await store.init();assert.equal((await service.publicPromotion('testib')).phone,'60133456789');
  await service.updatePromotionPhone(user,{phone:''});assert.equal((await service.publicPromotion('testib')).whatsappReady,false);
  await store.setIbActive(ib.referrer.id,false);await assert.rejects(()=>service.publicPromotion('testib'),e=>e.status===404);
 }finally{await store?.close();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
