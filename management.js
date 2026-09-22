(() => {
  'use strict';

  const role = document.body.dataset.managementRole;
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));

  let currentUser = null;
  let overview = null;
  let clients = [];

  function landing(roleValue) {
    if (roleValue === 'admin') return '/admin';
    if (roleValue === 'ib') return '/ib';
    return '/app';
  }

  function fmtDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleDateString('en-MY', { day:'2-digit', month:'short', year:'numeric' });
  }

  function fmtLastLogin(value) {
    if (!value) return 'Never login';
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? date.toLocaleString('en-MY', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
      : '—';
  }

  function statusPill(status) {
    const active = status === 'active';
    return `<span class="status-pill ${active ? 'active' : 'disabled'}">${active ? 'ACTIVE' : 'DISABLED'}</span>`;
  }

  function clientAction(client, scope) {
    const active = client.status === 'active';
    return `<button class="table-action ${active ? 'danger' : 'good'}" type="button"
      data-client-status="${esc(client.id)}" data-active="${active ? 'false' : 'true'}" data-scope="${scope}">
      ${active ? 'DISABLE' : 'ACTIVATE'}
    </button>`;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) },
      ...options
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.replace('/login');
      throw new Error('SESSION_EXPIRED');
    }
    if (response.status === 403 && body.code === 'FORBIDDEN') {
      if (currentUser) window.location.replace(landing(currentUser.role));
      throw new Error('FORBIDDEN');
    }
    if (!response.ok) {
      const error = new Error(body.error || `HTTP ${response.status}`);
      error.fields = body.fields || {};
      throw error;
    }
    return body;
  }

  async function loadUser() {
    const body = await api('/auth/me');
    currentUser = body.user;
    if (currentUser.role !== role) {
      window.location.replace(landing(currentUser.role));
      throw new Error('ROLE_REDIRECT');
    }
    if (byId('accountName')) byId('accountName').textContent = currentUser.displayName || role.toUpperCase();
    if (byId('accountEmail')) byId('accountEmail').textContent = currentUser.email || '';
  }

  function renderAdminClients(list) {
    const tbody = byId('clientTable');
    if (!tbody) return;
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="mg-loading">Belum ada client. Client akan dipaparkan selepas pendaftaran.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(client => `<tr>
      <td><a class="table-link" href="/admin/client/${encodeURIComponent(client.id)}"><strong>${esc(client.displayName)}</strong><small>${esc(client.email)}</small></a></td>
      <td><strong>${esc(client.phone || '—')}</strong><small>IC ${esc(client.icMasked || '—')}</small></td>
      <td><strong>${esc(client.ibName || 'Nazir (Admin)')}</strong><small>${esc((client.ibCode || 'nazir').toUpperCase())}</small></td>
      <td>${esc(fmtDate(client.createdAt))}</td>
      <td>${statusPill(client.status)}</td>
      <td>${clientAction(client, 'admin')}</td>
    </tr>`).join('');
  }

  function renderIbClients(list) {
    const tbody = byId('clientTable');
    if (!tbody) return;
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="mg-loading">Belum ada client di bawah IB ini.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(client => `<tr>
      <td><a class="table-link" href="/ib/client/${encodeURIComponent(client.id)}"><strong>${esc(client.displayName)}</strong><small>${esc(client.email)}</small></a></td>
      <td><strong>${esc(client.phone || '—')}</strong><small>${esc(fmtLastLogin(client.lastLoginAt))}</small></td>
      <td><span class="link-code">${esc(client.icMasked || '—')}</span></td>
      <td>${esc(fmtDate(client.createdAt))}</td>
      <td>${statusPill(client.status)}</td>
      <td>${clientAction(client, 'ib')}</td>
    </tr>`).join('');
  }

  function renderIbTable(ibs) {
    const tbody = byId('ibTable');
    if (!tbody) return;
    tbody.innerHTML = ibs.map(item => {
      const isAdmin = item.code === 'nazir';
      const link = `${window.location.origin}/u/${encodeURIComponent(item.code)}`;
      return `<tr>
        <td><a class="table-link" href="/admin/ib/${encodeURIComponent(item.code)}"><strong>${esc(item.displayName)}</strong><small>${isAdmin ? 'Default owner' : 'IB Partner'}</small></a></td>
        <td><span class="link-code">${esc(item.code.toUpperCase())}</span><small>${esc(link)} <button class="copy-inline" type="button" data-copy-link="${esc(link)}" title="Copy registration link">⧉</button></small></td>
        <td><strong>${esc(item.clientCount)}</strong><small>clients</small></td>
        <td>${statusPill(item.active ? 'active' : 'disabled')}</td>
        <td>${isAdmin ? '<span class="status-pill active">SYSTEM</span>' : `<button class="table-action ${item.active ? 'danger' : 'good'}" type="button" data-ib-status="${esc(item.id)}" data-active="${item.active ? 'false' : 'true'}">${item.active ? 'DISABLE' : 'ACTIVATE'}</button>`}</td>
      </tr>`;
    }).join('');
  }

  async function loadAdmin() {
    const [body, systemBody, mt5Body] = await Promise.all([
      api('/api/admin/overview'),
      api('/api/admin/system').catch(() => ({ settings: {} })),
      api('/api/admin/mt5').catch(() => ({ ready: false, accounts: [] }))
    ]);
    overview = body;
    clients = body.latestClients || [];
    const newClientLink = `${window.location.origin}/u/nazir`;
    const newClientLinkButton = byId('newClientLinkButton');
    if (newClientLinkButton) {
      newClientLinkButton.dataset.copyLink = newClientLink;
      newClientLinkButton.title = `Copy: ${newClientLink}`;
    }
    const totalClients = Number(body.stats?.total_clients || 0);
    const activeClients = Number(body.stats?.active_clients || 0);
    const activePct = totalClients > 0 ? Math.round((activeClients / totalClients) * 100) : 0;

    byId('statIb').textContent = body.stats?.total_ibs ?? 0;
    byId('statIbActive').textContent = `${body.stats?.active_ibs ?? 0} active IB`;
    byId('statClients').textContent = totalClients;
    byId('statActive').textContent = activeClients;
    byId('statToday').textContent = body.stats?.today_clients ?? 0;
    if (byId('activeRate')) byId('activeRate').textContent = totalClients ? `${activePct}% of total` : 'Can login';
    if (byId('activeRing')) byId('activeRing').style.setProperty('--ring', `${activePct}%`);

    const accounts = Array.isArray(mt5Body.accounts) ? mt5Body.accounts : [];
    const pendingMt5 = accounts.filter(row => {
      const status = String(row.hosted?.status || '').toUpperCase();
      return status.includes('PENDING') || status.includes('VERIFY');
    }).length;
    if (byId('statPendingMt5')) byId('statPendingMt5').textContent = pendingMt5;

    const now = Date.now();
    const connectedMt5 = accounts.filter(row => {
      const lastSeen = Number(row.hosted?.lastSeenAt || row.pod?.lastSeenAt || 0);
      return lastSeen > 0 && (now - lastSeen) <= 45000;
    }).length;
    const systemsOn = accounts.filter(row =>
      row.control?.desiredState === 'ON' || row.control?.effectiveState === 'ON'
    ).length;
    const sys = systemBody.settings || {};
    const registrationOpen = sys.registration?.effective === true;

    if (byId('systemPlatformState')) {
      byId('systemPlatformState').textContent = 'OPERATIONAL';
      byId('systemPlatformText').textContent = 'Admin, IB and client services online';
    }
    if (byId('systemMt5State')) {
      byId('systemMt5State').textContent = connectedMt5 ? `${connectedMt5} LIVE` : 'IDLE';
      byId('systemMt5Text').textContent = `${connectedMt5} of ${totalClients} client terminal(s) connected`;
    }
    if (byId('systemExecutionState')) {
      byId('systemExecutionState').textContent = sys.executionUnlocked ? 'UNLOCKED' : 'LOCKED';
      byId('systemExecutionState').className = sys.executionUnlocked ? 'warn' : '';
      byId('systemExecutionText').textContent = sys.executionUnlocked ? 'Execution rollout enabled' : 'Protected by controlled rollout';
    }
    if (byId('autoConnectedMt5')) byId('autoConnectedMt5').textContent = String(connectedMt5);
    if (byId('autoTradeEngine')) byId('autoTradeEngine').textContent = sys.autoTrade ? 'READY' : 'OFF';
    if (byId('autoTradeOn')) byId('autoTradeOn').textContent = String(systemsOn);
    if (byId('registrationState')) {
      byId('registrationState').textContent = registrationOpen ? 'OPEN' : 'CLOSED';
      byId('registrationState').className = registrationOpen ? '' : 'warn';
    }

    renderIbTable(body.ibs || []);
    const ibFilter = byId('clientIbFilter');
    if (ibFilter) {
      const items = (body.ibs || []).map(item =>
        `<option value="${esc(item.code)}">${esc(item.displayName)} (${esc(String(item.code).toUpperCase())})</option>`
      ).join('');
      ibFilter.innerHTML = '<option value="">All IB</option>' + items;
    }
    const all = await api('/api/admin/clients?limit=500');
    clients = all.clients || [];
    renderAdminClients(clients);
  }

  async function loadIb() {
    const body = await api('/api/ib/overview');
    overview = body;
    clients = body.clients || [];
    byId('statClients').textContent = body.stats?.total_clients ?? 0;
    byId('statActive').textContent = body.stats?.active_clients ?? 0;
    byId('statToday').textContent = body.stats?.today_clients ?? 0;
    const code = body.referrer?.code || '';
    if (byId('ibCodeHero')) byId('ibCodeHero').textContent = code ? `IB CODE: ${code.toUpperCase()}` : 'IB PROFILE';
    const link = code ? `${window.location.origin}/u/${encodeURIComponent(code)}` : '';
    if (byId('referralLink')) byId('referralLink').textContent = link || 'Link unavailable';
    renderIbClients(clients);
  }

  function filterClients() {
    const q = String(byId('clientSearch')?.value || '').trim().toLowerCase();
    const ib = String(byId('clientIbFilter')?.value || '').trim().toLowerCase();
    const status = String(byId('clientStatusFilter')?.value || '').trim().toLowerCase();
    const list = clients.filter(client => {
      if (ib && String(client.ibCode || 'nazir').toLowerCase() !== ib) return false;
      if (status && String(client.status || '').toLowerCase() !== status) return false;
      if (!q) return true;
      return [
        client.displayName, client.email, client.phone, client.ibName, client.ibCode, client.icMasked
      ].some(value => String(value || '').toLowerCase().includes(q));
    });
    if (role === 'admin') renderAdminClients(list);
    else renderIbClients(list);
  }


  function runGlobalSearch() {
    const global = byId('globalSearch');
    const local = byId('clientSearch');
    if (!global || !local) return;
    local.value = global.value;
    filterClients();
    const target = document.getElementById('clients');
    if (global.value.trim() && target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  byId('globalSearch')?.addEventListener('change', runGlobalSearch);
  byId('globalSearch')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runGlobalSearch();
    }
  });

  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'k') {
      const input = byId('globalSearch');
      if (input) {
        event.preventDefault();
        input.focus();
        input.select();
      }
    }
  });

  byId('clientSearch')?.addEventListener('input', filterClients);
  byId('clientIbFilter')?.addEventListener('change', filterClients);
  byId('clientStatusFilter')?.addEventListener('change', filterClients);

  byId('toggleCreateIb')?.addEventListener('click', () => {
    byId('createIbForm')?.classList.toggle('hidden');
  });

  byId('createIbForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = byId('createIbStatus');
    const submit = form.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(form).entries());
    submit.disabled = true;
    if (status) { status.className = 'mg-form-status'; status.textContent = 'Creating IB...'; }
    try {
      const body = await api('/api/admin/ibs', { method:'POST', body:JSON.stringify(data) });
      form.reset();
      if (status) {
        status.className = 'mg-form-status success';
        status.textContent = `IB ${body.referrer.displayName} created • /u/${body.referrer.code}`;
      }
      await loadAdmin();
    } catch (error) {
      if (status) {
        status.className = 'mg-form-status error';
        status.textContent = error.message;
      }
    } finally {
      submit.disabled = false;
    }
  });

  document.addEventListener('click', async event => {
    const copyButton = event.target.closest('[data-copy-link]');
    if (copyButton) {
      const value = copyButton.dataset.copyLink || '';
      if (value) {
        try {
          await navigator.clipboard.writeText(value);
          const original = copyButton.textContent;
          copyButton.textContent = '✓';
          window.setTimeout(() => { copyButton.textContent = original; }, 1000);
        } catch (_) {
          window.prompt('Copy registration link:', value);
        }
      }
      return;
    }

    const ibButton = event.target.closest('[data-ib-status]');
    if (ibButton && role === 'admin') {
      ibButton.disabled = true;
      try {
        await api(`/api/admin/ibs/${encodeURIComponent(ibButton.dataset.ibStatus)}/status`, {
          method:'PATCH', body:JSON.stringify({ active: ibButton.dataset.active === 'true' })
        });
        await loadAdmin();
      } catch (error) {
        window.alert(error.message);
      } finally {
        ibButton.disabled = false;
      }
      return;
    }

    const clientButton = event.target.closest('[data-client-status]');
    if (clientButton) {
      clientButton.disabled = true;
      try {
        const scope = clientButton.dataset.scope === 'admin' ? 'admin' : 'ib';
        await api(`/api/${scope}/clients/${encodeURIComponent(clientButton.dataset.clientStatus)}/status`, {
          method:'PATCH', body:JSON.stringify({ active: clientButton.dataset.active === 'true' })
        });
        if (role === 'admin') await loadAdmin(); else await loadIb();
      } catch (error) {
        window.alert(error.message);
      } finally {
        clientButton.disabled = false;
      }
    }
  });

  byId('copyReferral')?.addEventListener('click', async () => {
    const value = byId('referralLink')?.textContent || '';
    if (!value || value === 'Link unavailable') return;
    try {
      await navigator.clipboard.writeText(value);
      const button = byId('copyReferral');
      button.textContent = 'COPIED';
      window.setTimeout(() => { button.textContent = 'COPY LINK'; }, 1300);
    } catch (_) {
      window.prompt('Copy registration link:', value);
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
      if (role === 'admin') await loadAdmin();
      else if (role === 'ib') await loadIb();
    } catch (error) {
      if (!['SESSION_EXPIRED','ROLE_REDIRECT','FORBIDDEN'].includes(error.message)) {
        const target = byId('clientTable');
        if (target) target.innerHTML = `<tr><td colspan="7" class="mg-loading">Dashboard error: ${esc(error.message)}</td></tr>`;
      }
    }
  })();
})();