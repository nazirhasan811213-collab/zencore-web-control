'use strict';

// This branch is a separate installation, not a tenant of the live database.
function configureErrante(env) {
  let db;
  try { db = new URL(env.DATABASE_URL); } catch { throw new Error('ERRANTE_DEDICATED_DATABASE_REQUIRED'); }
  if (!/^postgres(?:ql)?:$/.test(db.protocol) ||
      !/^zencore_errante(?:_[a-z0-9]+)*$/.test(decodeURIComponent(db.pathname.slice(1))) ||
      db.hostname.includes('dagv4g2jnfac73fiev3g') || db.hostname.includes('daru2o8jo6nc739ei4j0')) {
    throw new Error('ERRANTE_DEDICATED_DATABASE_REQUIRED');
  }
  // Preparation mode is intentionally enforced in source until broker validation.
  for (const key of ['ZENCORE_AUTOTRADE_EXECUTION_ENABLED', 'ZENCORE_LOCAL_EA_EXECUTION_ENABLED',
    'ZENCORE_LOCAL_EA_DEMO_EXECUTION_ENABLED', 'ZENCORE_HOSTED_MT5_ENABLED',
    'ZENCORE_GCP_HOSTED_WORKER_ENABLED']) env[key] = 'false';
  for (const key of ['ZENCORE_LOCAL_EA_EXECUTION_EMAILS', 'ZENCORE_LOCAL_EA_DEMO_EXECUTION_EMAILS']) env[key] = '';
  env.ZENCORE_ENTRY_SIGNALS_PAUSED = 'true';
  env.ZENCORE_AUTH_ENABLED = 'true';
  env.ZENCORE_AUTOTRADE_ENABLED = 'true';
  env.ZENCORE_PRODUCT_NAME = 'ZenCore Errante';
  return env;
}

module.exports = { configureErrante };
if (require.main === module) {
  configureErrante(process.env);
  require('./compat-v17.js');
  require('./server-analysis.js');
}
