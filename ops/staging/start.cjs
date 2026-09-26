'use strict';
// This entrypoint is used only by the isolated staging service.
const {URL}=require('node:url');
const db=new URL(process.env.DATABASE_URL||'postgres://invalid/invalid');
if(process.env.RENDER_SERVICE_NAME!=='zencore-staging' ||
   !db.pathname.toLowerCase().includes('staging') ||
   db.hostname.includes('dpg-dagv4g2jnfac73fiev3g') ||
   process.env.RENDER_GIT_BRANCH!=='staging'){
  throw new Error('STAGING_ISOLATION_REQUIRED: staging service, branch and separate staging database required');
}
for(const key of Object.keys(process.env)){
  if(/^ZENCORE_(TELEGRAM_|GCP_|MT5_CREDENTIAL_|POD_|COMMAND_SIGNING_)/.test(key))delete process.env[key];
}
Object.assign(process.env,{
  NODE_ENV:'production', SITE_MODE:'precision-entry', ZENCORE_AUTH_ENABLED:'true',
  ZENCORE_AUTOTRADE_ENABLED:'false', ZENCORE_AUTOTRADE_EXECUTION_ENABLED:'false',
  ZENCORE_HOSTED_MT5_ENABLED:'false', ZENCORE_GCP_HOSTED_WORKER_ENABLED:'false',
  ZENCORE_PUBLIC_VIEWER_ENABLED:'false', ZENCORE_REGISTRATION_ENABLED:'false'
});
console.log('STAGING ONLY: independent database; Telegram and MT5 disabled.');
require('../../compat-v17.js');
require('../../server-analysis.js');
