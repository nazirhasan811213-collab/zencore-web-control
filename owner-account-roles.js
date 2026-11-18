'use strict';

const { OWNER_EMAIL } = require('./system-owner');
const authError = (...args) => require('./auth-service').authError(...args);

const ROLES = ['admin', 'ib', 'client', 'viewer'];

function assertEditableAccount(row, expectedRole) {
  if (!row) throw authError('ACCOUNT_NOT_FOUND', 'Akaun tidak dijumpai.', 404);
  if (row.email.toLowerCase() === OWNER_EMAIL) throw authError('FORBIDDEN', 'Peranan System Owner dilindungi.', 403);
  if (row.role !== expectedRole) throw authError('ROLE_CHANGED', 'Peranan sudah berubah. Muat semula senarai.', 409);
  if (!['active', 'disabled'].includes(row.status)) {
    throw authError('ACCOUNT_NOT_REVIEWED', 'Selesaikan semakan pendaftaran dahulu.', 409);
  }
  if (row.role === 'client' && row.handover_state && row.handover_state !== 'LIVE') {
    throw authError('HANDOVER_PENDING', 'Selesaikan proses serahan akaun dahulu.', 409);
  }
}

async function assertTradingStopped(client, userId, role) {
  const checks = {
    zencore_autotrade_profiles: "(desired_state <> 'STOPPED' OR effective_state NOT IN ('STOPPED','UNPROVISIONED') OR pending_command_id IS NOT NULL)",
    zencore_mt5_positions: 'TRUE',
    zencore_autotrade_commands: "status IN ('PENDING','DELIVERED') AND expires_at > NOW()",
    zencore_hosted_autotrade_commands: "status IN ('PENDING','DELIVERED') AND expires_at > NOW()"
  };
  if (role === 'viewer') Object.assign(checks, {
    zencore_mt5_secure_pods: 'revoked_at IS NULL',
    zencore_mt5_hosted_accounts: 'TRUE',
    zencore_mt5_pairing_sessions: 'consumed_at IS NULL AND expires_at > NOW()'
  });
  const { rows } = await client.query('SELECT name FROM unnest($1::text[]) AS t(name) WHERE to_regclass(name) IS NOT NULL', [Object.keys(checks)]);
  for (const { name } of rows) {
    const active = await client.query(`SELECT 1 FROM ${name} WHERE user_id=$1 AND ${checks[name]} LIMIT 1`, [userId]);
    if (active.rowCount) {
      throw authError('TRADING_ACTIVE', role === 'viewer'
        ? 'Hentikan Auto Trade, selesaikan posisi dan nyahpaut MT5 sebelum memilih View Public.'
        : 'Hentikan Auto Trade dan pastikan semua posisi serta arahan MT5 selesai.', 409);
    }
  }
}

function assertIbCode({ role, ibCode, defaultIbCode }, existing) {
  if (existing === defaultIbCode || (!existing && role === 'ib' && ibCode === defaultIbCode)) {
    throw authError('RESERVED_IB', 'Kod IB sistem dilindungi.', 409);
  }
  if (role === 'ib' && !existing && !ibCode) throw authError('IB_CODE_REQUIRED', 'Masukkan kod IB untuk akaun ini.');
}

module.exports = { ROLES, assertEditableAccount, assertTradingStopped, assertIbCode };
