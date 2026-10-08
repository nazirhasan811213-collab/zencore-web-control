// Recover transient database failures without logging connection credentials.
function safeCode(error) {
  return /^[A-Z0-9_]{2,32}$/.test(String(error?.code || '')) ? error.code : 'DB_UNAVAILABLE';
}
function transient(error) {
  return /^(08|53|57P0)/.test(String(error?.code || '')) ||
    ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','ENOTFOUND','EAI_AGAIN'].includes(error?.code) ||
    /connection (terminated|timeout)|connection.*timed out|timeout exceeded when trying to connect/i.test(String(error?.message || ''));
}
function guardPool(pool, label, log = console.error) {
  pool.on('error', error => log(`${label}: idle database connection lost (${safeCode(error)}); reconnect on next query.`));
  return pool;
}
async function initializeWithRetry(initialize, {onError = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), delayMs = 5000} = {}) {
  let attempt = 0;
  for (;;) {
    try { return await initialize(); }
    catch (error) {
      const retry = transient(error);
      onError(error, {attempt: ++attempt, retry});
      if (!retry) return false;
      await wait(Math.min(delayMs * attempt, 30000));
    }
  }
}
module.exports = {guardPool, initializeWithRetry, safeCode, transient};
