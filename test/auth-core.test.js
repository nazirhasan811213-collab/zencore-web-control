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
    icNumber: '900101-01-1234',
    phone: '012-345 6789',
    password: 'ZenCore2026!'
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.displayName, 'Nazir Hasan');
  assert.equal(result.value.email, 'nazir@example.com');
  assert.equal(result.value.icNumber, '900101011234');
  assert.equal(result.value.phone, '0123456789');
  assert.equal(normalizeEmail(' A@B.COM '), 'a@b.com');
});

test('registration validation accepts international passport and national ID formats', () => {
  const passport = validateRegistration({
    displayName: 'Amina Yusuf',
    email: 'amina@example.com',
    icNumber: 'A 1234-5678',
    phone: '+60123456789',
    password: 'ZenCore2026!'
  });
  assert.equal(passport.ok, true);
  assert.equal(passport.value.icNumber, 'A12345678');

  const nationalId = validateRegistration({
    displayName: 'Global Client',
    email: 'global@example.com',
    icNumber: 'ID/TH.7788_99',
    phone: '+66812345678',
    password: 'ZenCore2026!'
  });
  assert.equal(nationalId.ok, true);
  assert.equal(nationalId.value.icNumber, 'ID/TH.7788_99');
});

test('registration validation rejects weak or malformed fields', () => {
  const result = validateRegistration({
    displayName: 'N',
    email: 'not-an-email',
    icNumber: '123',
    phone: 'abc',
    password: 'password'
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.displayName);
  assert.ok(result.errors.email);
  assert.ok(result.errors.icNumber);
  assert.ok(result.errors.phone);
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
