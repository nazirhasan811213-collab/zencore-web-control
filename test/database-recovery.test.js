const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {guardPool, initializeWithRetry, transient} = require('../database-recovery');

test('idle database disconnect is contained and cannot leak credentials', () => {
  const pool = new EventEmitter();
  const logs = [];
  guardPool(pool, 'Auth', line => logs.push(line));
  pool.emit('error', Object.assign(new Error('postgres://user:secret@host unavailable'), {code:'57P01', client:{password:'secret'}}));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /57P01/);
  assert.doesNotMatch(logs[0], /secret|postgres:\/\//);
});

test('startup waits through maintenance failures then initializes once', async () => {
  let attempts = 0, completed = 0;
  const waits = [], errors = [];
  const result = await initializeWithRetry(async () => {
    attempts++;
    if (attempts <= 3) throw Object.assign(new Error('Connection terminated due to connection timeout'), {code:'ECONNRESET'});
    completed++;
    return 'ready';
  }, {wait:async ms => waits.push(ms), onError:(error, state) => errors.push(state)});
  assert.equal(result, 'ready');
  assert.equal(completed, 1);
  assert.deepEqual(waits, [5000, 10000, 15000]);
  assert.ok(errors.every(x => x.retry));
});

test('configuration and credential errors stop retries and remain unready', async () => {
  for (const code of ['28P01','42P01']) {
    let attempts=0;
    assert.equal(await initializeWithRetry(async () => {
      attempts++; throw Object.assign(new Error('invalid config'),{code});
    }, {wait:async () => assert.fail('must not retry')}), false);
    assert.equal(attempts, 1);
  }
  assert.equal(transient(new Error('ZENCORE_PUBLIC_VIEWER_PASSWORD invalid')), false);
});
