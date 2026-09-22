const test = require('node:test');
const assert = require('node:assert/strict');

const { PostgresAutoTradeStore } = require('../auto-trade-store');

test('hosted heartbeat casts reused status parameter consistently for PostgreSQL', async () => {
  const store = new PostgresAutoTradeStore('postgres://user:pass@localhost/test');
  const queries = [];
  let heartbeatArgs = null;
  store.pool = {
    query: async (sql, args = []) => {
      queries.push({ sql, args });
      if (/UPDATE zencore_mt5_hosted_accounts SET/.test(sql)) {
        heartbeatArgs = args;
        return {
          rows: [{
            id: args[0],
            user_id: '00000000-0000-4000-8000-000000000001',
            status: args[3],
            account_mask: args[4],
            server_mask: args[5],
            broker_mask: args[6],
            trade_mode: 'DEMO',
            key_id: 'zencore-gcp-hsm-demo-v1',
            worker_last_seen_at: args[13],
            verified_at: args[13],
            created_at: args[13],
            updated_at: args[13]
          }]
        };
      }
      if (/FROM zencore_mt5_hosted_accounts a/.test(sql)) {
        return {
          rows: [{
            id: '5fef90e2-2687-457b-bc14-7ff5231935b0',
            user_id: '00000000-0000-4000-8000-000000000001',
            status: 'CONNECTED_LOCKED',
            account_mask: '****026110',
            server_mask: '****nancial-Demo',
            broker_mask: '****StellarFinancial',
            trade_mode: 'DEMO',
            key_id: 'zencore-gcp-hsm-demo-v1',
            worker_last_seen_at: new Date(),
            verified_at: new Date(),
            created_at: new Date(),
            updated_at: new Date()
          }]
        };
      }
      return { rows: [], rowCount: 0 };
    }
  };

  const now = Date.now();
  const result = await store.updateHostedHeartbeat(
    '5fef90e2-2687-457b-bc14-7ff5231935b0',
    { instanceId: '1234567890', projectId: 'zencore-total-trade-system' },
    '11111111-1111-4111-8111-111111111111',
    {
      accountMask: '****026110',
      serverMask: '****nancial-Demo',
      brokerMask: '****StellarFinancial',
      terminalTradeAllowed: false,
      accountTradeAllowed: false,
      expertTradeAllowed: false,
      symbolSpecs: {},
      connectorVersion: '2.0.0-gcp-connect',
      terminalBuild: '5000'
    },
    'CONNECTED_LOCKED',
    null,
    now
  );

  const heartbeatSql = queries.find(item => /UPDATE zencore_mt5_hosted_accounts SET/.test(item.sql))?.sql || '';
  assert.match(heartbeatSql, /status = \$4::varchar\(32\)/);
  assert.match(heartbeatSql, /\$4::varchar\(32\) IN \('CONNECTED_LOCKED'::varchar\(32\), 'HOSTED_READY'::varchar\(32\)\)/);
  assert.equal(heartbeatArgs[3], 'CONNECTED_LOCKED');
  assert.equal(result.status, 'CONNECTED_LOCKED');
});
