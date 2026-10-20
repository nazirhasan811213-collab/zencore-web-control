const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryAuthStore } = require('../auth-store');
const { hashPassword, verifyPassword } = require('../auth-core');
const { provisionErranteAdmin } = require('../errante-admin-bootstrap');
test('Errante creates an active admin and never resets existing credentials on restart', async () => {
  const store = new MemoryAuthStore();
  const hash = await hashPassword('Test-only-admin-123!');
  const env = {DATABASE_URL:'postgres://a:b@errante-db/zencore_errante_free_db',
    ZENCORE_ADMIN_EMAILS:'admin@example.test',ZENCORE_ERRANTE_ADMIN_EMAIL:'admin@example.test',
    ZENCORE_ERRANTE_ADMIN_PASSWORD_HASH:hash};
  assert.equal((await provisionErranteAdmin(store,env)).created,true);
  const admin = await store.findUserForLogin('admin@example.test');
  assert.equal(admin.role,'admin'); assert.equal(admin.status,'active');
  assert.equal(await verifyPassword('Test-only-admin-123!',admin.password_hash),true);
  env.ZENCORE_ERRANTE_ADMIN_PASSWORD_HASH=await hashPassword('Other-password-123!');
  assert.equal((await provisionErranteAdmin(store,env)).created,false);
  assert.equal((await store.findUserForLogin('admin@example.test')).password_hash,hash);
  await assert.rejects(provisionErranteAdmin(store,{...env,DATABASE_URL:'postgres://a:b@db/zencore_performance_db'}),/DEDICATED_DATABASE_REQUIRED/);
  await assert.rejects(provisionErranteAdmin(store,{...env,ZENCORE_ADMIN_EMAILS:'other@example.test'}),/BOOTSTRAP_INVALID/);
});
