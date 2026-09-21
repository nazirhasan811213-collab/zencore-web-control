(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  const page = document.body.dataset.detailPage;
  let currentUser = null;
  let detail = null;
  let allClients = [];

  function fmtDate(value, withTime = false) {
    if (!value) return '—';
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '—';
    return withTime
      ? d.toLocaleString('en-MY', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
      : d.toLocaleDateString('en-MY', { day:'2-digit', month:'short', year:'numeric' });
  }

  function money(value) {
    const n = Number(value || 0);
    return `$${n.toFixed(2)}`;
  }

  function statusPill(active) {
    return `<span class="status-pill ${active ? 'active' : 'disabled'}">${active ? 'ACTIVE' : 'DISABLED'}</span>`;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials:'same-origin',
      headers:{ Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) },
      ...options
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.replace('/login');
      throw new Error('SESSION_EXPIRED');
    }
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  async function loadUser() {
    const body = await api('/auth/me');
    currentUser = body.user;
  }

  function currentId() {
    return window.location.pathname.split('/').filter(Boolean).pop() || '';
  }

  function renderIbClients(list) {
    const tbody = byId('detailClientTable');
    if (!tbody) return;
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="mg-loading">Belum ada client di bawah IB ini.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(client => `<tr>
      <td><a class="table-link" href="/admin/client/${encodeURIComponent(client.id)}"><strong>${esc(client.displayName)}</strong><small>${esc(client.email)}</small></a></td>
      <td><strong>${esc(client.phone || '—')}</strong><small>${esc(fmtDate(client.lastLoginAt, true))}</small></td>
      <td><span class="link-code">${esc(client.icMasked || '—')}</span></td>
      <td>${esc(fmtDate(client.createdAt))}</td>
      <td>${statusPill(client.status === 'active')}</td>
      <td><a class="table-action mg-link-btn" href="/admin/client/${encodeURIComponent(client.id)}">OPEN</a></td>
    </tr>`).join('');
  }

  async function loadIbDetail() {
    if (currentUser?.role !== 'admin') {
      window.location.replace(currentUser?.role === 'ib' ? '/ib' : '/app');
      return;
    }
    const code = currentId().toLowerCase();
    const body = await api(`/api/admin/ibs/${encodeURIComponent(code)}`);
    detail = body;
    allClients = body.clients || [];
    const ref = body.referrer || {};
    byId('detailTitle').textContent = `${ref.displayName || 'IB'} — Detail`;
    byId('ibName').textContent = ref.displayName || 'IB';
    byId('ibDescription').textContent = `Partner code ${String(ref.code || '').toUpperCase()} • ${allClients.length} client assigned`;
    byId('ibCodeTag').textContent = `CODE ${String(ref.code || '').toUpperCase()}`;
    byId('ibStatusTag').textContent = ref.active ? 'STATUS ACTIVE' : 'STATUS DISABLED';
    byId('ibClientCount').textContent = `${allClients.length} CLIENT`;
    const link = `${window.location.origin}/u/${encodeURIComponent(ref.code || '')}`;
    byId('ibReferralLink').textContent = link;
    byId('ibAccessText').textContent = ref.active ? 'IB Login Active' : 'IB Login Disabled';
    const button = byId('toggleIbStatus');
    button.textContent = ref.active ? 'DISABLE IB' : 'ACTIVATE IB';
    button.className = `table-action ${ref.active ? 'danger' : 'good'}`;
    button.dataset.referrerId = ref.id || '';
    button.dataset.active = ref.active ? 'false' : 'true';
    renderIbClients(allClients);
  }

  function renderTrading(trading) {
    const available = trading?.available === true;
    const control = trading?.control || {};
    const conn = trading?.connection || {};
    const mt5 = trading?.mt5 || {};
    const settings = trading?.settings || null;
    const summary = trading?.summary || {};

    byId('tradeState').textContent = available ? (control.effectiveState || 'STOPPED') : 'UNAVAILABLE';
    byId('tradeConnection').textContent = available
      ? (conn.label || conn.state || 'NOT CONNECTED')
      : 'Auto Trade status unavailable';
    byId('mt5Status').textContent = mt5.status || 'NOT CONNECTED';
    byId('mt5Account').textContent = mt5.accountMask || '—';
    byId('mt5Server').textContent = mt5.serverMask || '—';
    byId('mt5Connection').textContent = conn.connected ? 'CONNECTED' : (conn.state || 'NOT CONNECTED');

    byId('tradeSettingsState').textContent = settings ? 'Configured' : 'Not configured';
    byId('tradeCapital').textContent = settings?.capitalUsd != null ? money(settings.capitalUsd) : '—';
    byId('tradeLot').textContent = settings?.lotPerLayer != null ? String(settings.lotPerLayer) : '—';
    byId('tradeLayers').textContent = settings?.layers != null ? String(settings.layers) : '—';
    byId('openPositions').textContent = `${Number(summary.openPositions || 0)} Open`;
    byId('totalVolume').textContent = String(Number(summary.totalVolume || 0));
    byId('floatingProfit').textContent = money(summary.floatingProfitUsd || 0);
    byId('tradeMode').textContent = trading?.mode || 'DEMO';
  }

  async function loadClientDetail() {
    const id = currentId();
    const adminView = window.location.pathname.startsWith('/admin/client/');
    const ibView = window.location.pathname.startsWith('/ib/client/');
    if (adminView && currentUser?.role !== 'admin') {
      window.location.replace(currentUser?.role === 'ib' ? '/ib' : '/app');
      return;
    }
    if (ibView && currentUser?.role !== 'ib') {
      window.location.replace(currentUser?.role === 'admin' ? '/admin' : '/app');
      return;
    }

    const scope = adminView ? 'admin' : 'ib';
    const body = await api(`/api/${scope}/clients/${encodeURIComponent(id)}`);
    detail = body;
    const client = body.client || {};

    if (ibView) {
      byId('sideHome').href = '/ib';
      byId('sideRole').textContent = 'IB PARTNER';
      byId('navDashboard').href = '/ib';
      byId('navClients').href = '/ib#clients';
      byId('backButton').href = '/ib';
      byId('scopeLabel').textContent = 'OWN CLIENT ONLY';
    } else {
      byId('backButton').href = '/admin#clients';
      byId('scopeLabel').textContent = 'GLOBAL ADMIN VIEW';
    }

    byId('detailTitle').textContent = `${client.displayName || 'Client'} — Detail`;
    byId('clientName').textContent = client.displayName || 'Client';
    byId('clientEmail').textContent = client.email || '—';
    byId('clientStatusTag').textContent = `STATUS ${String(client.status || '').toUpperCase()}`;
    byId('clientIbTag').textContent = `IB ${String(client.ibCode || 'nazir').toUpperCase()}`;
    byId('clientPhone').textContent = client.phone || '—';
    byId('clientIc').textContent = client.icMasked || '—';
    byId('clientCreated').textContent = fmtDate(client.createdAt, true);
    byId('clientLastLogin').textContent = fmtDate(client.lastLoginAt, true);
    byId('clientIbName').textContent = client.ibName || 'Nazir (Admin)';
    byId('clientIbCode').textContent = `Code: ${String(client.ibCode || 'nazir').toUpperCase()} • assignment locked`;
    byId('clientAccessText').textContent = client.status === 'active' ? 'Login Active' : 'Login Disabled';

    const button = byId('toggleClientStatus');
    button.textContent = client.status === 'active' ? 'DISABLE CLIENT' : 'ACTIVATE CLIENT';
    button.className = `table-action ${client.status === 'active' ? 'danger' : 'good'}`;
    button.dataset.active = client.status === 'active' ? 'false' : 'true';
    button.dataset.clientId = client.id || '';
    button.dataset.scope = scope;

    renderTrading(body.trading);
  }

  byId('detailSearch')?.addEventListener('input', () => {
    const q = String(byId('detailSearch').value || '').trim().toLowerCase();
    const filtered = !q ? allClients : allClients.filter(client =>
      [client.displayName, client.email, client.phone, client.icMasked]
        .some(value => String(value || '').toLowerCase().includes(q))
    );
    renderIbClients(filtered);
  });

  byId('copyIbLink')?.addEventListener('click', async () => {
    const value = byId('ibReferralLink')?.textContent || '';
    if (!value || value === '—') return;
    try {
      await navigator.clipboard.writeText(value);
      byId('copyIbLink').textContent = 'COPIED';
      setTimeout(() => { byId('copyIbLink').textContent = 'COPY LINK'; }, 1200);
    } catch (_) {
      window.prompt('Copy registration link:', value);
    }
  });

  byId('toggleIbStatus')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const id = button.dataset.referrerId;
    if (!id) return;
    button.disabled = true;
    try {
      await api(`/api/admin/ibs/${encodeURIComponent(id)}/status`, {
        method:'PATCH',
        body:JSON.stringify({ active: button.dataset.active === 'true' })
      });
      await loadIbDetail();
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
    }
  });

  byId('toggleClientStatus')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const id = button.dataset.clientId;
    const scope = button.dataset.scope;
    if (!id || !scope) return;
    button.disabled = true;
    try {
      await api(`/api/${scope}/clients/${encodeURIComponent(id)}/status`, {
        method:'PATCH',
        body:JSON.stringify({ active: button.dataset.active === 'true' })
      });
      await loadClientDetail();
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
    }
  });

  byId('logoutButton')?.addEventListener('click', async () => {
    try {
      await fetch('/auth/logout', { method:'POST', credentials:'same-origin', headers:{Accept:'application/json'} });
    } finally {
      window.location.replace('/login');
    }
  });

  (async () => {
    try {
      await loadUser();
      if (page === 'ib') await loadIbDetail();
      else await loadClientDetail();
    } catch (error) {
      if (error.message !== 'SESSION_EXPIRED') {
        window.alert(error.message);
      }
    }
  })();
})();