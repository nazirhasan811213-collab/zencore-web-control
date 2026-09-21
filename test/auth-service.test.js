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
