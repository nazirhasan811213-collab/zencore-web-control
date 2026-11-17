'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { PostgresAuthStore } = require('../auth-store');
const { createAuthService } = require('../auth-service');
const { hashPassword } = require('../auth-core');
const { OWNER_EMAIL } = require('../system-owner');
const url = process.env.ZENCORE_ALERT_TEST_DATABASE_URL;

test('Postgres preserves admin revocation and audit across store initialization', { skip: !url }, async () => {
  const schema = 'system_owner_test_' + randomBytes(8).toString('hex');
  const db = new Pool({ connectionString: url });
  const store = new PostgresAuthStore(url);
  await store.pool.end();
  store.pool = new Pool({ connectionString: url, options: '-c search_path=' + schema });
  try {
    await db.query('CREATE SCHEMA ' + schema);
    await store.init();
    const ownerPassword = 'TestOwner2026!';
    const password = 'TestOperator2026!';
    const email = 'operator@owner.test';
    const owner = await store.createUser({
      displayName: 'Owner', email: OWNER_EMAIL, passwordHash: await hashPassword(ownerPassword), role: 'admin'
    });
    const auth = createAuthService({ store, secureCookies: false });
    const input = { displayName: 'Operator', email, password, ownerPassword };
    const requests = await Promise.allSettled([
      auth.changeSystemAdmin(owner, input), auth.changeSystemAdmin(owner, input)
    ]);
    const granted = requests.find(result => result.status === 'fulfilled').value;
    assert.equal(requests.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(requests.find(result => result.status === 'rejected').reason.code, 'ADMIN_EMAIL_IN_USE');
    const login = await auth.login({ email, password });
    const session = { headers: { cookie: auth.createCookie(login.token) } };
    await auth.changeSystemAdmin(owner, { ownerPassword }, granted.id);
    assert.equal(await auth.sessionFromRequest(session), null);
    await store.init();
    assert.equal((await auth.systemAdmins(owner))[0].status, 'disabled');
    const { events } = await auth.systemAdminActivity(owner, null);
    assert.deepEqual(events.map(event => event.action), ['admin/revoke', 'auth/login', 'admin/grant']);
    assert.deepEqual(events.map(event => event.status), [200, 200, 200]);
    await assert.rejects(() => auth.changeSystemAdmin(owner, { ownerPassword }, owner.id), { code: 'ADMIN_NOT_FOUND' });
  } finally {
    await store.close();
    await db.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await db.end();
  }
});
