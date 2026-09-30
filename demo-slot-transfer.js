'use strict';

// Explicit, reversible DEMO slot transfer; never reads credential envelopes.
async function transferDemoSlot(pool, request) {
  if (!request) return { skipped: true };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(request.accountId || '') || !uuid.test(request.displacedAccountId || '') ||
      request.accountId === request.displacedAccountId ||
      !/^[^@\s]+@[^@\s]+$/.test(request.ownerEmail || '') ||
      !/^zencore-mt5-demo-01-s\d{2}$/.test(request.sourceSlot || '') ||
      !/^zencore-mt5-demo-01-s\d{2}$/.test(request.targetSlot || '') ||
      request.sourceSlot === request.targetSlot) throw new Error('DEMO_TRANSFER_REQUEST_INVALID');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    const accounts = await client.query(
      'SELECT a.id, a.user_id, a.trade_mode, u.email FROM zencore_mt5_hosted_accounts a JOIN zencore_users u ON u.id=a.user_id WHERE a.id=ANY($1::uuid[]) ORDER BY a.id FOR UPDATE OF a',
      [[request.accountId, request.displacedAccountId]]);
    const own = accounts.rows.find(a => a.id === request.accountId);
    if (accounts.rows.length !== 2 || !own || own.email.toLowerCase() !== request.ownerEmail.toLowerCase() ||
        accounts.rows.some(a => a.trade_mode !== 'DEMO')) throw new Error('DEMO_TRANSFER_IDENTITY_MISMATCH');
    const slots = await client.query(
      'SELECT id, host_id, slot_code, account_id FROM zencore_mt5_worker_slots WHERE slot_code=ANY($1::text[]) ORDER BY slot_code FOR UPDATE',
      [[request.sourceSlot, request.targetSlot]]);
    const source = slots.rows.find(s => s.slot_code === request.sourceSlot);
    const target = slots.rows.find(s => s.slot_code === request.targetSlot);
    if (!source || !target || source.host_id !== target.host_id) throw new Error('DEMO_TRANSFER_SLOT_MISMATCH');
    if (target.account_id === request.accountId && source.account_id === request.displacedAccountId) {
      await client.query('COMMIT');
      return { alreadyApplied: true };
    }
    if (source.account_id !== request.accountId || target.account_id !== request.displacedAccountId)
      throw new Error('DEMO_TRANSFER_ASSIGNMENT_CHANGED');
    const userIds = accounts.rows.map(a => a.user_id);
    const profiles = await client.query(
      'SELECT desired_state, effective_state FROM zencore_autotrade_profiles WHERE user_id=ANY($1::uuid[]) FOR UPDATE', [userIds]);
    if (profiles.rows.some(p => p.desired_state !== 'STOPPED' || p.effective_state !== 'STOPPED'))
      throw new Error('DEMO_TRANSFER_SYSTEM_NOT_STOPPED');
    const positions = await client.query(
      'SELECT ticket FROM zencore_mt5_positions WHERE user_id=ANY($1::uuid[]) LIMIT 1', [userIds]);
    if (positions.rows.length) throw new Error('DEMO_TRANSFER_OPEN_POSITIONS');
    await client.query(
      "UPDATE zencore_mt5_worker_slots SET account_id=NULL, status='AVAILABLE', last_seen_at=NULL, last_error=NULL, updated_at=NOW() WHERE id=ANY($1::uuid[])",
      [[source.id, target.id]]);
    await client.query(
      "UPDATE zencore_mt5_worker_slots SET account_id=$2, status='RESERVED', assigned_at=NOW(), updated_at=NOW() WHERE id=$1", [target.id, request.accountId]);
    await client.query(
      "UPDATE zencore_mt5_worker_slots SET account_id=$2, status='RESERVED', assigned_at=NOW(), updated_at=NOW() WHERE id=$1", [source.id, request.displacedAccountId]);
    await client.query(
      "UPDATE zencore_mt5_hosted_accounts SET lease_id=NULL, lease_expires_at=NULL, status='PENDING_VERIFICATION', terminal_trade_allowed=FALSE, account_trade_allowed=FALSE, expert_trade_allowed=FALSE, worker_last_seen_at=NULL, verified_at=NULL, last_error=NULL, updated_at=NOW() WHERE id=ANY($1::uuid[])",
      [[request.accountId, request.displacedAccountId]]);
    await client.query(
      "UPDATE zencore_hosted_autotrade_commands SET status='EXPIRED' WHERE account_id=ANY($1::uuid[]) AND status IN ('PENDING','DELIVERED')",
      [[request.accountId, request.displacedAccountId]]);
    await client.query('COMMIT');
    return { transferred: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
module.exports = { transferDemoSlot };
