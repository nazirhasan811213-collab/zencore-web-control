const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryAuthStore } = require('../auth-store');
const { createAuthService } = require('../auth-service');

function requestWithCookie(cookie) {
  return { headers: { cookie } };
}

test('register creates a user and authenticated session without storing raw password', async () => {
  const store = new MemoryAuthStore();
  await store.init();
  const auth = createAuthService({ store, secureCookies: false });

  const created = await auth.register({
    displayName: 'Test Trader',
    email: 'trader@example.com',
    icNumber: '900101011234',
    phone: '0123456789',
    password: 'ZenCore2026!'
  });

  assert.equal(created.user.displayName, 'Test Trader');
  assert.equal(created.user.email, 'trader@example.com');
  assert.equal(created.user.role, 'client');
  assert.equal(created.user.ibCode, 'nazir');
  assert.equal(created.user.ibName, 'Nazir (Admin)');
  assert.ok(created.token);
  assert.equal(JSON.stringify([...store.usersByEmail.values()]).includes('ZenCore2026!'), false);

  const cookie = auth.createCookie(created.token).split(';')[0];
  const session = await auth.sessionFromRequest(requestWithCookie(cookie));
  assert.equal(session.user.id, created.user.id);
});

test('duplicate registration is rejected with a field-safe error', async () => {
  const store = new MemoryAuthStore();
  const auth = createAuthService({ store, secureCookies: false });
  const input = {
    displayName: 'Test Trader', email: 'same@example.com',
    icNumber: '900101011235', phone: '0123456788', password: 'ZenCore2026!'
  };
  await auth.register(input);

  await assert.rejects(() => auth.register(input), error => {
    assert.equal(error.code, 'EMAIL_EXISTS');
    assert.equal(error.status, 409);
    assert.ok(error.fields.email);
    return true;
  });
});

test('login uses a generic credential error and logout revokes the session', async () => {
  const store = new MemoryAuthStore();
  const auth = createAuthService({ store, secureCookies: false });
  await auth.register({
    displayName: 'Test Trader', email: 'login@example.com',
    icNumber: '900101011236', phone: '0123456787', password: 'ZenCore2026!'
  });

  await assert.rejects(() => auth.login({ email: 'login@example.com', password: 'WrongPassword1' }), error => {
    assert.equal(error.code, 'INVALID_CREDENTIALS');
    assert.equal(error.status, 401);
    return true;
  });

  const loggedIn = await auth.login({ email: 'LOGIN@EXAMPLE.COM', password: 'ZenCore2026!' });
  const cookie = auth.createCookie(loggedIn.token).split(';')[0];
  assert.ok(await auth.sessionFromRequest(requestWithCookie(cookie)));

  await auth.logoutFromRequest(requestWithCookie(cookie));
  assert.equal(await auth.sessionFromRequest(requestWithCookie(cookie)), null);
});

test('step-up reauthentication verifies the signed-in user password', async () => {
  const store = new MemoryAuthStore();
  const auth = createAuthService({ store, secureCookies: false });
  const created = await auth.register({
    displayName: 'Emergency Trader',
    email: 'step-up@example.com',
    icNumber: '900101011237',
    phone: '0123456786',
    password: 'ZenCore2026!'
  });
  assert.equal(await auth.reauthenticate(created.user.id, 'ZenCore2026!'), true);
  assert.equal(await auth.reauthenticate(created.user.id, 'WrongPassword1'), false);
});


test('IB referral link is resolved and frozen into the new client account', async () => {
  const store = new MemoryAuthStore();
  await store.createIbReferrer({ code: 'ib-azman', displayName: 'Azman IB' });
  const auth = createAuthService({ store, secureCookies: false });

  const referrer = await auth.resolveReferrer('ib-azman');
  assert.equal(referrer.code, 'ib-azman');
  assert.equal(referrer.displayName, 'Azman IB');

  const created = await auth.register({
    displayName: 'Client Referral',
    email: 'referral@example.com',
    icNumber: '900101011238',
    phone: '0123456785',
    ibCode: 'ib-azman',
    password: 'ZenCore2026!'
  });
  assert.equal(created.user.ibCode, 'ib-azman');
  assert.equal(created.user.ibName, 'Azman IB');
});

test('missing or invalid IB link defaults to Nazir admin and duplicate IC is blocked', async () => {
  const store = new MemoryAuthStore();
  const auth = createAuthService({ store, secureCookies: false });

  const invalid = await auth.resolveReferrer('does-not-exist');
  assert.equal(invalid.code, 'nazir');
  assert.equal(invalid.fallback, true);

  await auth.register({
    displayName: 'Client One',
    email: 'client1@example.com',
    icNumber: '900101011239',
    phone: '0123456784',
    password: 'ZenCore2026!'
  });

  await assert.rejects(() => auth.register({
    displayName: 'Client Two',
    email: 'client2@example.com',
    icNumber: '900101011239',
    phone: '0123456783',
    password: 'ZenCore2026!'
  }), error => {
    assert.equal(error.code, 'IC_EXISTS');
    assert.ok(error.fields.icNumber);
    return true;
  });
});


test('Admin controls all IBs while each IB only controls its own clients', async () => {
  const store = new MemoryAuthStore();
  const auth = createAuthService({ store, secureCookies: false });

  const adminCreated = await auth.register({
    displayName: 'Nazir Admin',
    email: 'admin@example.com',
    icNumber: '900101011241',
    phone: '0123456781',
    password: 'ZenCore2026!'
  });
  await store.setUserRole(adminCreated.user.id, 'admin');
  const adminLogin = await auth.login({ email: 'admin@example.com', password: 'ZenCore2026!' });
  assert.equal(adminLogin.user.role, 'admin');

  const ibOne = await auth.createIb(adminLogin.user, {
    displayName: 'Azman IB',
    code: 'azman',
    email: 'azman@example.com',
    phone: '0123000001',
    password: 'ZenCore2026!'
  });
  const ibTwo = await auth.createIb(adminLogin.user, {
    displayName: 'Siti IB',
    code: 'siti',
    email: 'siti@example.com',
    phone: '0123000002',
    password: 'ZenCore2026!'
  });
  assert.equal(ibOne.user.role, 'ib');
  assert.equal(ibTwo.user.role, 'ib');

  await auth.register({
    displayName: 'Client Azman',
    email: 'client-azman@example.com',
    icNumber: '900101011242',
    phone: '0123000011',
    ibCode: 'azman',
    password: 'ZenCore2026!'
  });
  await auth.register({
    displayName: 'Client Siti',
    email: 'client-siti@example.com',
    icNumber: '900101011243',
    phone: '0123000012',
    ibCode: 'siti',
    password: 'ZenCore2026!'
  });

  const azmanLogin = await auth.login({ email: 'azman@example.com', password: 'ZenCore2026!' });
  const sitiLogin = await auth.login({ email: 'siti@example.com', password: 'ZenCore2026!' });

  const azmanOverview = await auth.ibOverview(azmanLogin.user);
  const sitiOverview = await auth.ibOverview(sitiLogin.user);
  assert.equal(azmanOverview.clients.length, 1);
  assert.equal(azmanOverview.clients[0].email, 'client-azman@example.com');
  assert.equal(sitiOverview.clients.length, 1);
  assert.equal(sitiOverview.clients[0].email, 'client-siti@example.com');

  const adminOverview = await auth.adminOverview(adminLogin.user);
  assert.equal(adminOverview.stats.total_ibs, 2);
  assert.equal(adminOverview.stats.total_clients, 2);
  assert.ok(adminOverview.ibs.some(item => item.code === 'azman'));
  assert.ok(adminOverview.ibs.some(item => item.code === 'siti'));

  await assert.rejects(() => auth.adminOverview(azmanLogin.user), error => {
    assert.equal(error.code, 'FORBIDDEN');
    return true;
  });

  const sitiClientId = sitiOverview.clients[0].id;
  await assert.rejects(() => auth.setIbClientActive(azmanLogin.user, sitiClientId, false), error => {
    assert.equal(error.code, 'CLIENT_NOT_FOUND');
    return true;
  });

  const ownClientId = azmanOverview.clients[0].id;
  const disabled = await auth.setIbClientActive(azmanLogin.user, ownClientId, false);
  assert.equal(disabled.status, 'disabled');

  const reenabled = await auth.setAdminClientActive(adminLogin.user, ownClientId, true);
  assert.equal(reenabled.status, 'active');
});

test('configured admin promotion changes only matching existing accounts', async () => {
  const store = new MemoryAuthStore();
  const auth = createAuthService({ store, secureCookies: false });
  const a = await auth.register({
    displayName: 'First',
    email: 'first@example.com',
    icNumber: '900101011244',
    phone: '0123000021',
    password: 'ZenCore2026!'
  });
  const b = await auth.register({
    displayName: 'Second',
    email: 'second@example.com',
    icNumber: '900101011245',
    phone: '0123000022',
    password: 'ZenCore2026!'
  });
  assert.equal(await store.promoteAdminsByEmail(['first@example.com']), 1);
  assert.equal((await store.findUserByIdForLogin(a.user.id)).role, 'admin');
  assert.equal((await store.findUserByIdForLogin(b.user.id)).role, 'client');
});


test('Admin can reassign clients between IBs and promote a client into a new IB', async () => {
  const store = new MemoryAuthStore();
  const auth = createAuthService({ store, secureCookies: false });

  const adminCreated = await auth.register({
    displayName: 'Admin Owner',
    email: 'owner@example.com',
    icNumber: 'ADMIN-9001',
    phone: '0123000101',
    password: 'ZenCore2026!'
  });
  await store.setUserRole(adminCreated.user.id, 'admin');
  const adminLogin = await auth.login({
    email: 'owner@example.com',
    password: 'ZenCore2026!'
  });

  await auth.createIb(adminLogin.user, {
    displayName: 'North IB',
    code: 'north',
    email: 'north@example.com',
    phone: '0123000102',
    password: 'ZenCore2026!'
  });
  await auth.createIb(adminLogin.user, {
    displayName: 'South IB',
    code: 'south',
    email: 'south@example.com',
    phone: '0123000103',
    password: 'ZenCore2026!'
  });

  const movable = await auth.register({
    displayName: 'Movable Client',
    email: 'movable@example.com',
    icNumber: 'PASS-A10001',
    phone: '+60123000104',
    ibCode: 'north',
    password: 'ZenCore2026!'
  });
  const promotable = await auth.register({
    displayName: 'Future Partner',
    email: 'future@example.com',
    icNumber: 'PASS-A10002',
    phone: '+60123000105',
    ibCode: 'north',
    password: 'ZenCore2026!'
  });

  const moved = await auth.reassignAdminClientIb(adminLogin.user, movable.user.id, 'south');
  assert.equal(moved.client.ibCode, 'south');
  assert.equal(moved.referrer.code, 'south');

  const northLogin = await auth.login({ email: 'north@example.com', password: 'ZenCore2026!' });
  const southLogin = await auth.login({ email: 'south@example.com', password: 'ZenCore2026!' });
  assert.equal((await auth.ibOverview(northLogin.user)).clients.length, 1);
  assert.equal((await auth.ibOverview(southLogin.user)).clients.length, 1);
  assert.equal((await auth.ibOverview(southLogin.user)).clients[0].email, 'movable@example.com');

  await assert.rejects(
    () => auth.reassignAdminClientIb(northLogin.user, movable.user.id, 'north'),
    error => {
      assert.equal(error.code, 'FORBIDDEN');
      return true;
    }
  );

  const promoted = await auth.promoteAdminClientToIb(adminLogin.user, promotable.user.id, {
    code: 'future-partner',
    displayName: 'Future Partner IB'
  });
  assert.equal(promoted.user.role, 'ib');
  assert.equal(promoted.referrer.code, 'future-partner');

  const promotedLogin = await auth.login({
    email: 'future@example.com',
    password: 'ZenCore2026!'
  });
  assert.equal(promotedLogin.user.role, 'ib');
  const promotedOverview = await auth.ibOverview(promotedLogin.user);
  assert.equal(promotedOverview.referrer.code, 'future-partner');
  assert.equal(promotedOverview.clients.length, 0);

  const adminOverview = await auth.adminOverview(adminLogin.user);
  assert.equal(adminOverview.stats.total_ibs, 3);
  assert.equal(adminOverview.stats.total_clients, 1);
  assert.ok(adminOverview.ibs.some(item => item.code === 'future-partner'));

  await assert.rejects(
    () => auth.promoteAdminClientToIb(adminLogin.user, movable.user.id, {
      code: 'south',
      displayName: 'Duplicate Code'
    }),
    error => {
      assert.equal(error.code, 'IB_CODE_EXISTS');
      return true;
    }
  );
});
