const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryAuthStore } = require('../auth-store');
const { MemoryAutoTradeStore } = require('../auto-trade-store');

test('admin system registration setting persists in memory store', async () => {
  const store = new MemoryAuthStore();
  assert.equal((await store.getSystemSettings()).registrationEnabled, true);

  let next = await store.setRegistrationEnabled(false);
  assert.equal(next.registrationEnabled, false);
  assert.equal((await store.getSystemSettings()).registrationEnabled, false);

  next = await store.setRegistrationEnabled(true);
  assert.equal(next.registrationEnabled, true);
});

test('admin MT5 overview never includes credential envelope data', async () => {
  const store = new MemoryAutoTradeStore();
  const userId = '11111111-1111-4111-8111-111111111111';
  store.profiles.set(userId, {
    userId,
    capitalUsd: 1000,
    lotPerLayer: 0.01,
    layers: 2,
    symbols: ['XAUUSD'],
    desiredState: 'STOPPED',
    effectiveState: 'STOPPED'
  });
  store.hostedAccounts.set(userId, {
    id: '22222222-2222-4222-8222-222222222222',
    userId,
    status: 'CONNECTED_LOCKED',
    accountMask: '***6110',
    serverMask: 'Inter***Demo',
    brokerMask: 'Inter***',
    tradeMode: 'DEMO',
    keyId: 'test-key',
    credentialEnvelope: { ciphertext: 'must-not-leak' },
    lastSeenAt: Date.now()
  });

  const rows = await store.listAdminMt5Overview();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hosted.accountMask, '***6110');
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0].hosted, 'credentialEnvelope'), false);
  assert.equal(JSON.stringify(rows).includes('must-not-leak'), false);
});

test('admin audit listing returns newest events first', async () => {
  const store = new MemoryAutoTradeStore();
  await store.appendAudit('u1', 'FIRST', { ok: true });
  await new Promise(resolve => setTimeout(resolve, 2));
  await store.appendAudit('u1', 'SECOND', { ok: true });

  const rows = await store.listAdminAudit(10);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'SECOND');
  assert.equal(rows[1].type, 'FIRST');
});
