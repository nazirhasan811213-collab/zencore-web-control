'use strict';
const { configureErrante } = require('./errante-bootstrap');

async function provisionErranteAdmin(store, env) {
  const passwordHash = String(env.ZENCORE_ERRANTE_ADMIN_PASSWORD_HASH || '');
  if (!passwordHash) return { created: false };
  configureErrante(env);
  const email = String(env.ZENCORE_ERRANTE_ADMIN_EMAIL || '').trim().toLowerCase();
  const admins = String(env.ZENCORE_ADMIN_EMAILS || '').toLowerCase().split(',').map(x => x.trim());
  if (!email || !admins.includes(email) || !/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/.test(passwordHash)) {
    throw new Error('ERRANTE_ADMIN_BOOTSTRAP_INVALID');
  }
  const existing = await store.findUserForLogin(email);
  if (existing) {
    if (existing.role !== 'admin' || existing.status !== 'active') throw new Error('ERRANTE_ADMIN_ACCOUNT_CONFLICT');
    return { created: false };
  }
  try {
    await store.createUser({ displayName: 'Mohd Nazir', email, passwordHash, role: 'admin', status: 'active' });
  } catch (error) {
    if (error.code !== 'EMAIL_EXISTS') throw error;
    const user = await store.findUserForLogin(email);
    if (user?.role !== 'admin' || user?.status !== 'active') throw new Error('ERRANTE_ADMIN_ACCOUNT_CONFLICT');
    return { created: false };
  }
  return { created: true };
}
module.exports = { provisionErranteAdmin };
