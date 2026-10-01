(() => {
  'use strict';
  const panel = document.getElementById('connectionMonitor');
  if (!panel) return;
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let rows = [], busy = false, observedAt = 0, timer;
  function render() {
    const query = byId('connectionSearch').value.toLowerCase();
    const filter = byId('connectionFilter').value;
    const stale = !observedAt || Date.now() - observedAt > 30000;
    const visible = rows.filter(r => {
      if (![r.client.displayName, r.client.email, r.accountMask, r.serverMask].join(' ').toLowerCase().includes(query)) return false;
      if (filter === 'ready') return !stale && r.connection.ready;
      if (filter === 'offline') return r.transport !== 'NOT_LINKED' && (stale || !r.connection.online);
      if (filter === 'attention') return r.transport !== 'NOT_LINKED' && (stale || !r.connection.ready);
      if (filter === 'unlinked') return r.transport === 'NOT_LINKED';
      return true;
    });
    byId('connectionRows').innerHTML = visible.map(r => `<tr>
      <td><a href="/${panel.dataset.connectionScope}/client/${encodeURIComponent(r.userId)}">${esc(r.client.displayName)}</a><small>${esc(r.client.email)}</small></td>
      <td>${esc(r.accountMask || '—')}<small>${esc(r.serverMask || '—')}</small></td>
      <td>${esc(r.transport)}<small>${stale ? 'UNKNOWN • data luput' : r.connection.online ? 'ONLINE' : 'OFFLINE'}</small></td>
      <td>${stale ? 'UNKNOWN' : esc(r.connection.state)}<small>${stale ? 'Refresh diperlukan' : esc(r.connection.label)}</small></td>
      <td>${['terminal','account','expert'].map(k => r.permissions[k] ? 'YES' : 'NO').join(' / ')}</td>
      <td>${stale ? 'UNKNOWN' : esc(r.control.effectiveState)}<small>Diminta: ${esc(r.control.desiredState)}</small></td>
      <td>${r.lastSeenAt ? esc(new Date(r.lastSeenAt).toLocaleString('ms-MY')) : 'Belum ada heartbeat'}${(r.activity || []).map(event => `<small>${esc(event.type)} • ${esc(new Date(event.createdAt).toLocaleString('ms-MY'))}</small>`).join('')}</td>
    </tr>`).join('') || '<tr><td colspan="7">Tiada client mengikut pilihan.</td></tr>';
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch(`/api/${panel.dataset.connectionScope}/connections`, { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) { location.assign('/login'); return; }
      if (!response.ok) throw new Error('Status tidak dapat disahkan');
      const body = await response.json();
      rows = body.accounts || []; observedAt = Date.now();
      byId('connectionMessage').textContent = `${rows.length} client • Dikemas kini ${new Date().toLocaleTimeString('ms-MY')} • Paparan sahaja`;
    } catch (_) {
      observedAt = 0;
      byId('connectionMessage').textContent = 'Sambungan pemantauan gagal. Status UNKNOWN sehingga refresh berjaya.';
    } finally { busy = false; render(); }
  }
  byId('connectionSearch').addEventListener('input', render);
  byId('connectionFilter').addEventListener('change', render);
  byId('connectionRefresh').addEventListener('click', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  timer = setInterval(() => { render(); if (!document.hidden) refresh(); }, 10000);
  window.addEventListener('pagehide', () => clearInterval(timer));
  refresh();
})();
