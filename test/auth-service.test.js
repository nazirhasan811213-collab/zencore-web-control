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
    password: 'ZenCore2026!'
  });

  assert.equal(created.user.displayName, 'Test Trader');
  assert.equal(created.user.email, 'trader@example.com');
  assert.ok(created.token);
  assert.equal(JSON.stringify([...store.usersByEmail.values()]).includes('ZenCore2026!'), false);

  const cookie = auth.createCookie(created.token).split(';')[0];
  const session = await auth.sessionFromRequest(requestWithCookie(cookie));
  assert.equal(session.user.id, created.user.id);
});

test('duplicate registration is rejected with a field-safe error', async () => {
  const store = new MemoryAuthStore();
  const auth = createAuthService({ store, secureCookies: false });
  const input = { displayName: 'Test Trader', email: 'same@example.com', password: 'ZenCore2026!' };
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
  await auth.register({ displayName: 'Test Trader', email: 'login@example.com', password: 'ZenCore2026!' });

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
    password: 'ZenCore2026!'
  });
  assert.equal(await auth.reauthenticate(created.user.id, 'ZenCore2026!'), true);
  assert.equal(await auth.reauthenticate(created.user.id, 'WrongPassword1'), false);
});
