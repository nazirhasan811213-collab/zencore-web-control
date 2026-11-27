'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { PostgresAuthStore } = require('../auth-store');
const { createAuthService } = require('../auth-service');
const { PostgresAutoTradeStore } = require('../auto-trade-store');
const { createAutoTradeService, tokenHash } = require('../auto-trade-service');
const { canTrade } = require('../account-handover');
const { hashPassword } = require('../auth-core');
const { OWNER_EMAIL } = require('../system-owner');
const url = process.env.ZENCORE_ALERT_TEST_DATABASE_URL;

test('Postgres preserves admin revocation and audit across store initialization', { skip: !url }, async () => {
  const schema = 'system_owner_test_' + randomBytes(8).toString('hex');
  const db = new Pool({ connectionString: url });
  const store = new PostgresAuthStore(url);
  await store.pool.end();
  store.pool = new Pool({ connectionString: url, options: '-c search_path=' + schema });
  const tradeStore = new PostgresAutoTradeStore(url);
  await tradeStore.close();
  tradeStore.pool = store.pool;
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
    const fulfilled = requests.filter(result => result.status === 'fulfilled');
    assert.equal(fulfilled.length, 1, requests.map(result => result.reason?.stack).filter(Boolean).join('\n'));
    const granted = fulfilled[0].value;
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

    const member = await store.createUser({ displayName: 'Client', email: 'member@owner.test', passwordHash: await hashPassword(password) });
    const previous = await auth.login({ email: member.email, password });
    await tradeStore.init();
    const token = 'zcpod_' + randomBytes(32).toString('base64url');
    const pod = await tradeStore.provisionPod({ id: randomUUID(), userId: member.id,
      label: 'Test MT5', tokenHash: tokenHash(token) });
    await tradeStore.setControl(member.id, { desiredState: 'ON', effectiveState: 'ON' });
    const trading = createAutoTradeService({ store: tradeStore, commandSigningKey: randomBytes(32).toString('hex'),
      allowDemoExecution: true, entryAccessAllowed: async userId => canTrade(await store.findUserByIdForLogin(userId)) });
    const heartbeat = {
      accountMask: '****1234', serverMask: '****Demo', brokerMask: '****Test', tradeMode: 'DEMO',
      terminalTradeAllowed: true, accountTradeAllowed: true, expertTradeAllowed: true, demoExecutionUnlocked: true,
      positions: [{ ticket: '1001', symbol: 'XAUUSD', side: 'BUY', volume: 0.02,
        entry: 2500, currentPrice: 2510, initialSl: 2495, activeSl: 2500 }]
    };
    await trading.heartbeat(token, heartbeat);
    const change = (role, expectedRole, fields = {}) => auth.changeAccountRole(owner, member.id, {
      role, expectedRole, ownerPassword, ...fields
    });
    await change('viewer', 'client');
    assert.equal((await tradeStore.listPositions(member.id))[0].ticket, '1001');
    assert.equal((await trading.authenticatePod(token)).id, pod.id);
    assert.equal((await tradeStore.getProfile(member.id)).desiredState, 'ON');
    assert.equal((await trading.heartbeat(token, heartbeat)).desiredState, 'STOPPED');
    assert.equal((await tradeStore.listPositions(member.id))[0].ticket, '1001');
    assert.equal(await auth.sessionFromRequest({ headers: { cookie: auth.createCookie(previous.token) } }), null);
    const listed = await auth.listRoleAccounts(owner, { search: 'member' });
    assert.equal(listed.accounts[0].role, 'viewer');
    await change('ib', 'viewer', { ibCode: 'role-test' });
    const promotion = await store.ibOverview(member.id);
    assert.equal(promotion.referrer.code, 'role-test');
    await change('client', 'ib');
    assert.equal(await store.setIbActive(promotion.referrer.id, true), null);
    await change('ib', 'client');
    assert.equal((await store.ibOverview(member.id)).referrer.active, true);
    await change('admin', 'ib');
    assert.equal((await auth.login({ email: member.email, password })).user.systemRole, 'system_admin');
    const promoted = await auth.login({ email: member.email, password });
    const current = { headers: { cookie: auth.createCookie(promoted.token) } };
    assert.equal((await auth.sessionFromRequest(current)).user.ibPartnerAccess, false);
    await auth.setAdminIbAccess(owner, member.id, { access: 'on', ownerPassword });
    assert.equal((await auth.sessionFromRequest(current)).user.ibPartnerAccess, true);
    assert.equal(await store.setIbActive(promotion.referrer.id, false), null);
    await auth.setAdminIbAccess(owner, member.id, { access: 'off', ownerPassword });
    assert.equal((await auth.sessionFromRequest(current)).user.ibPartnerAccess, false);
    assert.equal((await auth.sessionFromRequest(current)).user.role, 'admin');
  } finally {
    await store.close();
    await db.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await db.end();
  }
});
