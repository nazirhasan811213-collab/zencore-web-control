const test = require('node:test');
const assert = require('node:assert/strict');
const { configureErrante } = require('../errante-bootstrap');
test('Errante refuses missing, production and staging database identities', () => {
  for (const DATABASE_URL of [undefined, 'postgres://a:b@db/zencore_performance_db',
    'postgres://a:b@db/zencore_staging_db',
    'postgres://a:b@dpg-dagv4g2jnfac73fiev3g-a/zencore_errante']) {
    assert.throws(() => configureErrante({ DATABASE_URL }), /DEDICATED_DATABASE_REQUIRED/);
  }
});
test('Errante preparation cannot be armed through inherited execution flags', () => {
  const env = configureErrante({ DATABASE_URL: 'postgres://a:b@errante-db/zencore_errante_db',
    ZENCORE_LOCAL_EA_EXECUTION_ENABLED: 'true', ZENCORE_LOCAL_EA_EXECUTION_EMAILS: 'someone@example.test',
    ZENCORE_AUTOTRADE_EXECUTION_ENABLED: 'true', ZENCORE_HOSTED_MT5_ENABLED: 'true', ZENCORE_RELAY_TARGET_URL:'https://zencore-errante.onrender.com/relay/webhook' });
  assert.equal(env.ZENCORE_LOCAL_EA_EXECUTION_ENABLED, 'false');
  assert.equal(env.ZENCORE_LOCAL_EA_EXECUTION_EMAILS, '');
  assert.equal(env.ZENCORE_AUTOTRADE_EXECUTION_ENABLED, 'false');
  assert.equal(env.ZENCORE_HOSTED_MT5_ENABLED, 'false');
  assert.equal(env.ZENCORE_ENTRY_SIGNALS_PAUSED, 'true');
  assert.equal(env.ZENCORE_AUTOTRADE_ENABLED, 'false');
  assert.equal(env.ZENCORE_RELAY_TARGET_URL, '');
});
