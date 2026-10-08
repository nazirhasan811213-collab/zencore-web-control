const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {PostgresAutoTradeStore}=require('../auto-trade-store');
const url=process.env.ZENCORE_ALERT_TEST_DATABASE_URL;
test('PostgreSQL atomically binds concurrent account identities and rejects rotated tokens',{skip:!url},async()=>{
 const schema='binding_test_'+crypto.randomBytes(8).toString('hex');
 const admin=new Pool({connectionString:url});let store;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);
  store=new PostgresAutoTradeStore(url);await store.pool.end();
  store.pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
  await store.pool.query('CREATE TABLE zencore_users(id UUID PRIMARY KEY)');
  await store.init();
  const user=crypto.randomUUID(),podId=crypto.randomUUID();
  await store.pool.query('INSERT INTO zencore_users VALUES($1)',[user]);
  const oldToken='old-test-token-hash';
  await store.provisionPod({id:podId,userId:user,label:'test',tokenHash:oldToken,ownershipMode:'TRADER_OWNED_EA_LOCAL'});
  const h={accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',tradeMode:'DEMO',
    connectorVersion:'1.4.0-ea-local',symbolSpecs:{},terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true};
  const results=await Promise.all(['a','b'].map(x=>store.updatePodHeartbeat(podId,{...h,accountFingerprint:x.repeat(64)},Date.now(),oldToken)));
  assert.equal(results.filter(Boolean).length,1,'only one full account identity can bind the pod');
  const binding=results.find(Boolean).accountFingerprint;
  assert.equal(await store.updatePodHeartbeat(podId,h,Date.now(),oldToken),null,'legacy downgrade cannot clear binding');
  await store.provisionPod({id:crypto.randomUUID(),userId:user,label:'test-new',tokenHash:'new-test-token-hash',ownershipMode:'TRADER_OWNED_EA_LOCAL'});
  assert.equal(await store.updatePodHeartbeat(podId,{...h,accountFingerprint:binding},Date.now(),oldToken),null,'old in-flight token cannot bind successor');
  assert.ok(await store.updatePodHeartbeat(podId,{...h,tradeMode:'REAL',accountFingerprint:'c'.repeat(64)},Date.now(),'new-test-token-hash'));
  await store.setControl(user,{desiredState:'ON',effectiveState:'ON'});
  assert.equal(await store.resetLocalEaLink(user,Date.now()),'STOP_BEFORE_RESET');
  assert.ok(await store.findPodByTokenHash('new-test-token-hash'));
  await store.setControl(user,{desiredState:'STOPPED',effectiveState:'STOPPED'});
  await store.replacePositions(user,[{ticket:'123',symbol:'XAUUSD',side:'BUY'}],Date.now());
  assert.equal(await store.resetLocalEaLink(user,Date.now()),'POSITIONS_OPEN');
  await store.replacePositions(user,[],Date.now());
  const resetAt=Date.now();assert.equal(await store.resetLocalEaLink(user,resetAt),'RESET');
  assert.equal(await store.findPodByTokenHash('new-test-token-hash'),null);
  assert.equal(await store.getPodForUser(user),null);
  assert.equal(await store.getLinkResetAt(user),resetAt);
  assert.equal(await store.updatePodHeartbeat(podId,{...h,accountFingerprint:'c'.repeat(64)},Date.now(),'new-test-token-hash'),null);
  assert.equal((await store.getProfile(user)).desiredState,'STOPPED');

 }finally{
  await store?.close();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
 }
});
