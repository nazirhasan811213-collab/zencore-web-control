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
      tbody.innerHTML = '<tr><td colspan="7" class="mg-loading">Belum ada client.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(client => `<tr>
      <td><strong>${esc(client.displayName)}</strong><small>${esc(client.email)}</small></td>
      <td><strong>${esc(client.phone || '—')}</strong><small>${esc(fmtLastLogin(client.lastLoginAt))}</small></td>
      <td><span class="link-code">${esc(client.icMasked || '—')}</span></td>
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
      <td><strong>${esc(client.displayName)}</strong><small>${esc(client.email)}</small></td>
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
        <td><strong>${esc(item.displayName)}</strong><small>${isAdmin ? 'Default owner' : 'IB Partner'}</small></td>
        <td><span class="link-code">${esc(item.code.toUpperCase())}</span><small>${esc(link)}</small></td>
        <td><strong>${esc(item.clientCount)}</strong><small>clients</small></td>
        <td>${statusPill(item.active ? 'active' : 'disabled')}</td>
        <td>${isAdmin ? '<span class="status-pill active">SYSTEM</span>' : `<button class="table-action ${item.active ? 'danger' : 'good'}" type="button" data-ib-status="${esc(item.id)}" data-active="${item.active ? 'false' : 'true'}">${item.active ? 'DISABLE' : 'ACTIVATE'}</button>`}</td>
      </tr>`;
    }).join('');
  }

  async function loadAdmin() {
    const body = await api('/api/admin/overview');
    overview = body;
    clients = body.latestClients || [];
    byId('statIb').textContent = body.stats?.total_ibs ?? 0;
    byId('statIbActive').textContent = `${body.stats?.active_ibs ?? 0} active`;
    byId('statClients').textContent = body.stats?.total_clients ?? 0;
    byId('statActive').textContent = body.stats?.active_clients ?? 0;
    byId('statToday').textContent = body.stats?.today_clients ?? 0;
    renderIbTable(body.ibs || []);
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
    const list = !q ? clients : clients.filter(client => [
      client.displayName, client.email, client.phone, client.ibName, client.ibCode, client.icMasked
    ].some(value => String(value || '').toLowerCase().includes(q)));
    if (role === 'admin') renderAdminClients(list);
    else renderIbClients(list);
  }

  byId('clientSearch')?.addEventListener('input', filterClients);

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