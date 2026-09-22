(() => {
  'use strict';

  const page = document.body.dataset.adminOpsPage;
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));

  let currentUser = null;
  let mt5Rows = [];
  let activityRows = [];

  function fmtDateTime(value) {
    if (!value) return '—';
    const d = new Date(Number(value) || value);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toLocaleString('en-MY', {
      day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit'
    });
  }

  function relativeSeen(value) {
    if (!value) return 'Never';
    const ms = Date.now() - Number(value);
    if (!Number.isFinite(ms)) return '—';
    if (ms < 60000) return `${Math.max(0, Math.round(ms / 1000))}s ago`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
    if (ms < 86400000) return `${Math.round(ms / 3600000)}h ago`;
    return fmtDateTime(value);
  }

  function pill(label, state = 'neutral') {
    return `<span class="status-pill ${state}">${esc(label)}</span>`;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials:'same-origin',
      headers:{
        Accept:'application/json',
        ...(options.body ? {'Content-Type':'application/json'} : {}),
        ...(options.headers || {})
      },
      ...options
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.replace('/login');
      throw new Error('SESSION_EXPIRED');
    }
    if (response.status === 403) {
      window.location.replace('/app');
      throw new Error('FORBIDDEN');
    }
    if (!response.ok) {
      const error = new Error(body.error || `HTTP ${response.status}`);
      error.code = body.code;
      throw error;
    }
    return body;
  }

  async function loadUser() {
    const body = await api('/auth/me');
    currentUser = body.user;
    if (currentUser?.role !== 'admin') {
      window.location.replace(currentUser?.role === 'ib' ? '/ib' : '/app');
      throw new Error('ROLE_REDIRECT');
    }
    if (byId('accountName')) byId('accountName').textContent = currentUser.displayName || 'Admin';
    if (byId('accountEmail')) byId('accountEmail').textContent = currentUser.email || '';
  }

  function mt5Derived(row) {
    const endpoint = row.hosted || row.pod || null;
    const lastSeenAt = endpoint?.lastSeenAt || null;
    const recent = !!lastSeenAt && (Date.now() - Number(lastSeenAt)) <= 45000;
    const hasConnection = !!endpoint;
    const connected = hasConnection && recent;
    const desiredOn = row.control?.desiredState === 'ON';
    const effectiveOn = row.control?.effectiveState === 'ON';
    const systemOn = desiredOn || effectiveOn;
    const hasError = !!(row.hosted?.lastError || row.control?.lastError);
    const attention = hasError || (hasConnection && !recent);
    return { endpoint, lastSeenAt, connected, hasConnection, systemOn, attention };
  }

  function renderMt5() {
    const tbody = byId('mt5Table');
    if (!tbody) return;
    const q = String(byId('mt5Search')?.value || '').trim().toLowerCase();
    const filter = String(byId('mt5Filter')?.value || 'all');
    const rows = mt5Rows.filter(row => {
      const d = mt5Derived(row);
      const text = [
        row.client?.displayName, row.client?.email, row.client?.ibName, row.client?.ibCode,
        row.hosted?.accountMask, row.hosted?.serverMask, row.hosted?.brokerMask,
        row.hosted?.workerSlot?.code, row.hosted?.workerSlot?.hostName,
        row.pod?.accountMask, row.pod?.serverMask, row.pod?.brokerMask
      ].join(' ').toLowerCase();
      if (q && !text.includes(q)) return false;
      if (filter === 'connected' && !d.connected) return false;
      if (filter === 'not-connected' && d.connected) return false;
      if (filter === 'on' && !d.systemOn) return false;
      if (filter === 'attention' && !d.attention) return false;
      return true;
    });

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="mg-loading">Tiada account mengikut filter ini.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(row => {
      const d = mt5Derived(row);
      const endpoint = d.endpoint || {};
      const connection = d.connected
        ? pill('CONNECTED','active')
        : d.attention ? pill('ATTENTION','disabled') : pill('NOT CONNECTED','neutral');
      const control = d.systemOn
        ? pill(row.control?.effectiveState === 'ON' ? 'ON' : 'ON / PENDING','warning')
        : pill(row.control?.effectiveState || 'STOPPED','neutral');
      return `<tr>
        <td><a class="table-link" href="/admin/client/${encodeURIComponent(row.userId)}"><strong>${esc(row.client?.displayName || 'Client')}</strong><small>${esc(row.client?.email || '')}</small></a></td>
        <td><strong>${esc(row.client?.ibName || 'Nazir (Admin)')}</strong><small>${esc(String(row.client?.ibCode || 'nazir').toUpperCase())}</small></td>
        <td><strong class="mono-inline">${esc(endpoint.accountMask || '—')}</strong><small>${esc(endpoint.serverMask || endpoint.brokerMask || 'No MT5 linked')}</small></td>
        <td>${connection}<small>${esc(endpoint.workerSlot?.code || endpoint.status || endpoint.tradeMode || '')}</small></td>
        <td>${control}<small>${esc(row.control?.lastError || '')}</small></td>
        <td><strong>${esc(row.openPositions || 0)}</strong><small>open</small></td>
        <td><strong>${esc(relativeSeen(d.lastSeenAt))}</strong><small>${esc(fmtDateTime(d.lastSeenAt))}</small></td>
        <td><a class="table-action mg-link-btn" href="/admin/client/${encodeURIComponent(row.userId)}">OPEN</a></td>
      </tr>`;
    }).join('');
  }

  async function loadMt5() {
    const body = await api('/api/admin/mt5');
    mt5Rows = body.accounts || [];
    byId('executionGate').textContent = body.executionUnlocked ? 'UNLOCKED' : 'LOCKED';
    byId('executionGate').classList.toggle('danger-text', body.executionUnlocked === true);
    byId('requiredConnector').textContent = body.executionUnlocked
      ? `Connector: ${body.requiredConnectorVersion || 'required'}`
      : 'Controlled rollout required';

    const derived = mt5Rows.map(mt5Derived);
    byId('mt5Total').textContent = mt5Rows.length;
    byId('mt5Connected').textContent = derived.filter(x => x.connected).length;
    byId('mt5On').textContent = derived.filter(x => x.systemOn).length;
    byId('mt5Attention').textContent = derived.filter(x => x.attention).length;
    renderMt5();
  }

  function detailSummary(detail) {
    const keys = Object.keys(detail || {});
    if (!keys.length) return 'No additional detail';
    return keys.slice(0, 6).map(key => {
      const value = detail[key];
      if (value && typeof value === 'object') return `${key}: ${JSON.stringify(value).slice(0, 100)}`;
      return `${key}: ${String(value).slice(0, 100)}`;
    }).join(' • ');
  }

  function renderActivity() {
    const target = byId('activityList');
    if (!target) return;
    const q = String(byId('activitySearch')?.value || '').trim().toLowerCase();
    const type = String(byId('activityType')?.value || '');
    const rows = activityRows.filter(item => {
      if (type && item.type !== type) return false;
      if (!q) return true;
      return [item.clientName,item.clientEmail,item.ibName,item.ibCode,item.type,detailSummary(item.detail)]
        .join(' ').toLowerCase().includes(q);
    });
    if (!rows.length) {
      target.innerHTML = '<div class="mg-loading">Tiada activity mengikut filter ini.</div>';
      return;
    }
    target.innerHTML = rows.map(item => `<article class="activity-item">
      <div class="activity-dot"></div>
      <div class="activity-main">
        <div class="activity-head"><strong>${esc(item.type || 'EVENT')}</strong><span>${esc(fmtDateTime(item.createdAt))}</span></div>
        <div class="activity-owner"><a href="/admin/client/${encodeURIComponent(item.userId)}">${esc(item.clientName || item.clientEmail || 'Client')}</a><span>IB ${esc(String(item.ibCode || 'nazir').toUpperCase())}</span></div>
        <p>${esc(detailSummary(item.detail))}</p>
      </div>
    </article>`).join('');
  }

  async function loadActivity() {
    const body = await api('/api/admin/activity?limit=200');
    activityRows = body.events || [];
    const typeSelect = byId('activityType');
    if (typeSelect) {
      const types = [...new Set(activityRows.map(item => item.type).filter(Boolean))].sort();
      typeSelect.innerHTML = '<option value="">All events</option>' +
        types.map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join('');
    }
    renderActivity();
  }

  function setBoolBadge(id, enabled, onLabel = 'ENABLED', offLabel = 'DISABLED') {
    const node = byId(id);
    if (!node) return;
    node.textContent = enabled ? onLabel : offLabel;
    node.className = `status-pill ${enabled ? 'active' : 'disabled'}`;
  }

  async function loadSystem() {
    const body = await api('/api/admin/system');
    const s = body.settings || {};
    const r = s.registration || {};
    byId('systemSafety').textContent = s.executionUnlocked ? 'EXECUTION UNLOCKED' : 'EXECUTION LOCKED';
    byId('systemSafety').classList.toggle('danger-text', s.executionUnlocked === true);

    setBoolBadge('registrationBadge', r.effective, 'OPEN', 'CLOSED');
    setBoolBadge('authBadge', s.authentication);
    setBoolBadge('autoTradeBadge', s.autoTrade);
    setBoolBadge('executionBadge', s.executionUnlocked, 'UNLOCKED', 'LOCKED');

    const toggle = byId('registrationToggle');
    toggle.checked = r.databaseEnabled !== false;
    toggle.disabled = !r.envEnabled;
    byId('registrationNote').textContent = !r.envEnabled
      ? 'Environment master lock is OFF. Dashboard cannot reopen registration.'
      : (r.effective ? 'Client baharu boleh register.' : 'Pendaftaran client ditutup oleh Admin.');

    byId('defaultIb').textContent = String(s.defaultIbCode || 'nazir').toUpperCase();
    byId('hostedMt5').textContent = s.hostedMt5 ? 'ENABLED' : 'LOCKED';
    byId('gcpWorker').textContent = s.gcpWorkerIdentity ? 'ENABLED' : 'LOCKED';
    byId('demoSymbols').textContent = Array.isArray(s.demoSymbols) ? s.demoSymbols.join(', ') : '—';
    byId('connectorVersion').textContent = s.requiredConnectorVersion || '—';
  }

  byId('mt5Search')?.addEventListener('input', renderMt5);
  byId('mt5Filter')?.addEventListener('change', renderMt5);
  byId('activitySearch')?.addEventListener('input', renderActivity);
  byId('activityType')?.addEventListener('change', renderActivity);

  byId('registrationToggle')?.addEventListener('change', async event => {
    const toggle = event.currentTarget;
    const status = byId('systemMessage');
    toggle.disabled = true;
    status.className = 'mg-form-status';
    status.textContent = 'Saving...';
    try {
      const body = await api('/api/admin/system/registration', {
        method:'PATCH',
        body:JSON.stringify({ enabled: toggle.checked })
      });
      const r = body.registration || {};
      toggle.checked = r.databaseEnabled !== false;
      setBoolBadge('registrationBadge', r.effective, 'OPEN', 'CLOSED');
      byId('registrationNote').textContent = r.effective
        ? 'Client baharu boleh register.'
        : 'Pendaftaran client ditutup oleh Admin.';
      status.className = 'mg-form-status success';
      status.textContent = r.effective ? 'Client registration dibuka.' : 'Client registration ditutup.';
    } catch (error) {
      toggle.checked = !toggle.checked;
      status.className = 'mg-form-status error';
      status.textContent = error.message;
    } finally {
      toggle.disabled = false;
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
      if (page === 'mt5') await loadMt5();
      else if (page === 'activity') await loadActivity();
      else if (page === 'system') await loadSystem();
    } catch (error) {
      if (!['SESSION_EXPIRED','FORBIDDEN','ROLE_REDIRECT'].includes(error.message)) {
        const status = byId('systemMessage');
        if (status) {
          status.className = 'mg-form-status error';
          status.textContent = error.message;
        }
      }
    }
  })();
})();