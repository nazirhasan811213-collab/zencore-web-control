const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryAuthStore } = require('../auth-store');
const { createAuthService } = require('./helpers/approved-auth.cjs');

async function makeClient(auth, suffix, ibCode = 'nazir') {
  return auth.register({
    displayName: 'Client ' + suffix,
    email: 'client-' + suffix + '@example.test',
    icNumber: '90010101' + String(suffix).padStart(4, '0'),
    phone: '012340' + String(suffix).padStart(4, '0'),
    ibCode,
    password: 'TestPass2026!'
  });
}

test('management detail respects IB ownership and client self profile scope', async () => {
  const store = new MemoryAuthStore();
  const auth = createAuthService({ store, secureCookies: false });

  const admin = await makeClient(auth, 1);
  await store.setUserRole(admin.user.id, 'admin');
  const adminUser = (await auth.login({ email: 'client-1@example.test', password: 'TestPass2026!' })).user;

  await auth.createIb(adminUser, {
    displayName: 'Alpha Partner', code: 'alpha',
    email: 'alpha@example.test', phone: '0123499991', password: 'TestPass2026!'
  });
  await auth.createIb(adminUser, {
    displayName: 'Beta Partner', code: 'beta',
    email: 'beta@example.test', phone: '0123499992', password: 'TestPass2026!'
  });

  const alphaClient = await makeClient(auth, 2, 'alpha');
  const betaClient = await makeClient(auth, 3, 'beta');
  // Legacy identity already stored before IC was removed from registration.
  (await store.findUserByIdForLogin(betaClient.user.id)).ic_number='900101010003';
  const alphaUser = (await auth.login({ email: 'alpha@example.test', password: 'TestPass2026!' })).user;
  const ownUser = (await auth.login({ email: 'client-2@example.test', password: 'TestPass2026!' })).user;

  assert.equal((await auth.adminIbDetail(adminUser, 'alpha')).clients.length, 1);
  const adminDetail=await auth.adminClientDetail(adminUser,betaClient.user.id);
  assert.equal(adminDetail.ibCode,'beta');
  assert.equal(adminDetail.identityNumber,'900101010003');
  assert.equal((await auth.ibClientDetail(alphaUser,alphaClient.user.id)).identityNumber,undefined);
  await assert.rejects(()=>auth.adminClientDetail(alphaUser,alphaClient.user.id),e=>e.code==='FORBIDDEN');
  assert.equal((await auth.ibClientDetail(alphaUser, alphaClient.user.id)).ibCode, 'alpha');

  await assert.rejects(
    () => auth.ibClientDetail(alphaUser, betaClient.user.id),
    error => error.code === 'CLIENT_NOT_FOUND'
  );

  const updated = await auth.updateOwnClientProfile(ownUser, {
    displayName: 'Client Alpha Updated',
    phone: '0123408888'
  });
  assert.equal(updated.displayName, 'Client Alpha Updated');
  assert.equal(updated.ibCode, 'alpha');
});
