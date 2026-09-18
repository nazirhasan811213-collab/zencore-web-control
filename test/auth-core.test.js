const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEmail,
  validateRegistration,
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  parseCookies,
  sessionCookie
} = require('../auth-core');

test('registration validation normalizes safe account input', () => {
  const result = validateRegistration({
    displayName: '  Nazir   Hasan ',
    email: '  NAZIR@EXAMPLE.COM ',
    password: 'ZenCore2026!'
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.displayName, 'Nazir Hasan');
  assert.equal(result.value.email, 'nazir@example.com');
  assert.equal(normalizeEmail(' A@B.COM '), 'a@b.com');
});

test('registration validation rejects weak or malformed fields', () => {
  const result = validateRegistration({
    displayName: 'N',
    email: 'not-an-email',
    password: 'password'
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.displayName);
  assert.ok(result.errors.email);
  assert.ok(result.errors.password);
});

test('password hashes are salted and verified with timing-safe comparison', async () => {
  const first = await hashPassword('ZenCore2026!');
  const second = await hashPassword('ZenCore2026!');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('ZenCore2026!', first), true);
  assert.equal(await verifyPassword('WrongPassword1', first), false);
  assert.equal(await verifyPassword('ZenCore2026!', 'invalid'), false);
});

test('session helpers generate opaque tokens and secure cookies', () => {
  const token = generateSessionToken();
  assert.ok(token.length >= 40);
  assert.equal(hashSessionToken(token).length, 64);

  const cookie = sessionCookie('zencore_session', token, { secure: true, maxAgeSeconds: 3600 });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(parseCookies(cookie).zencore_session, token);

  const cleared = sessionCookie('zencore_session', '', { secure: true, maxAgeSeconds: 0 });
  assert.match(cleared, /Max-Age=0/);
});
