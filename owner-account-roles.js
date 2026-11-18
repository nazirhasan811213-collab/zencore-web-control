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

function assertIbCode({ role, ibCode, defaultIbCode }, existing) {
  if (existing === defaultIbCode || (!existing && role === 'ib' && ibCode === defaultIbCode)) {
    throw authError('RESERVED_IB', 'Kod IB sistem dilindungi.', 409);
  }
  if (role === 'ib' && !existing && !ibCode) throw authError('IB_CODE_REQUIRED', 'Masukkan kod IB untuk akaun ini.');
}

module.exports = { ROLES, assertEditableAccount, assertIbCode };
