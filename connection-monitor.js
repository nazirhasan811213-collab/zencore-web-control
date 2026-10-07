// Server-side ownership is resolved before querying any trading state.
async function listConnectionMonitor(user, auth, trading) {
  if (!['admin', 'ib'].includes(user.role)) { const error = new Error('Admin or IB access required.'); error.status = 403; error.code = 'FORBIDDEN'; throw error; }
  const clients = [];
  for (let offset = 0; ; offset += 500) {
    const page = user.role === 'admin'
      ? await auth.adminClients(user, { limit: 500, offset })
      : await auth.ibClients(user, { limit: 500, offset });
    clients.push(...page);
    if (page.length < 500) break;
  }
  const accounts = [];
  // Bounded batches avoid overwhelming the database for larger IB directories.
  for (let i = 0; i < clients.length; i += 10) {
    accounts.push(...await Promise.all(clients.slice(i, i + 10).map(async client => ({
      userId: client.id,
      client: { displayName: client.displayName, email: client.email, ibName: client.ibName || null, lastLoginAt: client.lastLoginAt || null },
      ...(await trading.connectionMonitor(client.id))
    }))));
  }
  return { ok: true, ready: true, observedAt: Date.now(), accounts };
}
module.exports = { listConnectionMonitor };
