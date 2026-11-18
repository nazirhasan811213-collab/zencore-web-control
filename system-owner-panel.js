(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const endpoint = '/api/admin/owner';
  const dateFormat = new Intl.DateTimeFormat('ms-MY', {
    dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur'
  });
  const formatDate = value => value ? dateFormat.format(new Date(value)) : '—';
  const actionLabels = {
    'auth/login': 'Log masuk', 'admin/grant': 'Beri akses admin', 'admin/revoke': 'Buang akses admin',
    'system/registration': 'Ubah tetapan pendaftaran', 'clients/password': 'Reset kata laluan client',
    'clients/master-reset': 'Master Reset client', 'clients/status': 'Ubah status client',
    'registrations/review': 'Semak pendaftaran'
  };
  const dialog = byId('revoke-dialog');
  let revokeId = null;
  let nextBefore = null;
  const roleDialog = byId('role-dialog');
  const roleForm = byId('change-role');
  const roleLabels = { admin: 'System Admin', ib: 'IB', client: 'Client', viewer: 'View Public' };
  let selectedAccount = null;
  let accountSearch = '';
  let accountOffset = 0;
  let accountNext = null;
  let accountRequest = 0;

  async function request(path, data) {
    const response = await fetch(endpoint + path, data ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    } : {});
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Akses System Owner tidak tersedia.');
    return result;
  }

  function detail(parent, text) {
    const value = document.createElement('span');
    value.className = 'owner-detail';
    value.textContent = text;
    parent.append(value);
  }

  async function loadAdmins() {
    const { admins } = await request('/admins');
    byId('admin-status').textContent = admins.length ? '' : 'Belum ada System Admin.';
    const rows = admins.map(admin => {
      const row = document.createElement('li');
      row.className = 'owner-row';
      const name = document.createElement('div');
      name.textContent = admin.displayName;
      detail(name, admin.email);
      detail(name, (admin.status === 'active' ? 'Aktif' : 'Akses dibuang') + ' · Log masuk terakhir ' + formatDate(admin.lastLoginAt));
      row.append(name);
      if (admin.status === 'active') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'registration-reject';
        button.textContent = 'Buang akses';
        button.addEventListener('click', () => {
          revokeId = admin.id;
          byId('revoke-target').textContent = admin.email;
          byId('revoke-status').textContent = '';
          byId('revoke').reset();
          dialog.showModal();
        });
        row.append(button);
      }
      return row;
    });
    byId('admins').replaceChildren(...rows);
  }

  function updateRoleFields() {
    const role = roleForm.elements.role.value;
    const needsIbCode = role === 'ib' && !selectedAccount.ibCode;
    byId('owner-ib-code').hidden = !needsIbCode;
    roleForm.elements.ibCode.disabled = !needsIbCode;
    roleForm.elements.ibCode.required = needsIbCode;
    byId('role-description').textContent = role === 'viewer'
      ? 'Akses paparan sahaja. Selesaikan posisi dan nyahpaut MT5 sebelum menukar peranan.'
      : role === 'ib' && selectedAccount.ibCode ? 'Kod IB sedia ada: ' + selectedAccount.ibCode : '';
    roleForm.querySelector('[type=submit]').disabled = role === selectedAccount.role;
  }

  function openRoleDialog(account) {
    roleForm.reset();
    selectedAccount = account;
    roleForm.elements.role.value = account.role;
    byId('role-target').textContent = account.displayName + ' · ' + account.email;
    byId('change-role-status').textContent = '';
    updateRoleFields();
    roleDialog.showModal();
  }

  async function loadRoleAccounts(notice = '') {
    const sequence = ++accountRequest;
    const status = byId('role-list-status');
    status.textContent = 'Memuatkan senarai…';
    const params = new URLSearchParams({ search: accountSearch, offset: String(accountOffset) });
    try {
      const { accounts, nextOffset } = await request('/accounts?' + params);
      if (sequence !== accountRequest) return;
      accountNext = nextOffset;
      const rows = accounts.map(account => {
        const row = document.createElement('li');
        row.className = 'owner-row';
        const label = document.createElement('div');
        label.textContent = account.displayName;
        detail(label, account.email);
        detail(label, roleLabels[account.role] + ' · ' + ({ active: 'Aktif', disabled: 'Dinyahaktifkan', expired: 'Akses tamat' }[account.status] || account.status));
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Tukar peranan';
        button.addEventListener('click', () => openRoleDialog(account));
        row.append(label, button);
        return row;
      });
      byId('role-accounts').replaceChildren(...rows);
      byId('role-prev').hidden = accountOffset === 0;
      byId('role-next').hidden = accountNext === null;
      status.textContent = notice || (rows.length ? '' : 'Tiada akaun dijumpai.');
    } catch (error) {
      if (sequence === accountRequest) status.textContent = error.message;
    }
  }

  async function loadActivity(older = false) {
    const before = older ? nextBefore : null;
    const { events, nextBefore: cursor } = await request('/activity' + (before ? '?before=' + encodeURIComponent(before) : ''));
    const list = byId('activity');
    if (!older) list.replaceChildren();
    for (const event of events) {
      const row = document.createElement('li');
      const transition = event.action.split('/');
      const action = transition[0] === 'roles'
        ? 'Peranan ditukar daripada ' + roleLabels[transition[1]] + ' kepada ' + roleLabels[transition[2]]
        : actionLabels[event.action] || event.action;
      row.textContent = action + ' · ' + event.actorEmail;
      const status = event.status == null ? 'Keputusan belum direkod' : event.status < 400 ? 'Berjaya' : 'Gagal';
      detail(row, formatDate(event.createdAt) + ' Waktu Malaysia · ' + status + (event.target ? ' · ' + event.target : ''));
      list.append(row);
    }
    nextBefore = cursor;
    byId('older').hidden = !cursor;
    byId('audit-status').textContent = list.children.length ? '' : 'Belum ada rekod aktiviti admin.';
  }

  function submit(id, statusId, path, complete) {
    const form = byId(id);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('[type=submit]');
      if (button.disabled) return;
      const status = byId(statusId);
      button.disabled = true;
      status.textContent = 'Menyimpan…';
      try {
        await request(path(), Object.fromEntries(new FormData(form)));
        form.reset();
        complete();
        if (id !== 'change-role') loadRoleAccounts();
        loadAdmins().catch(error => { byId('admin-status').textContent = error.message; });
        refreshActivity();
      } catch (error) {
        form.elements.ownerPassword.value = '';
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  async function refreshActivity(older = false) {
    const refresh = byId('refresh');
    const more = byId('older');
    refresh.disabled = more.disabled = true;
    try {
      await loadActivity(older);
    } catch (error) {
      byId('audit-status').textContent = error.message;
    } finally {
      refresh.disabled = more.disabled = false;
    }
  }

  submit('grant', 'grant-status', () => '/admins', () => { byId('grant-status').textContent = 'Akses admin diberikan.'; });
  submit('revoke', 'revoke-status', () => '/admins/' + encodeURIComponent(revokeId) + '/revoke', () => {
    dialog.close();
    byId('grant-status').textContent = 'Akses admin dibuang.';
  });
  submit('change-role', 'change-role-status', () => '/accounts/' + encodeURIComponent(selectedAccount.id) + '/role', () => {
    roleDialog.close();
    loadRoleAccounts('Peranan akaun dikemas kini.');
  });
  roleForm.elements.role.addEventListener('change', updateRoleFields);
  roleForm.addEventListener('formdata', event => event.formData.set('expectedRole', selectedAccount.role));
  roleDialog.addEventListener('close', () => roleForm.reset());
  byId('cancel-role').addEventListener('click', () => roleDialog.close());
  byId('account-search').addEventListener('submit', event => {
    event.preventDefault();
    accountSearch = event.currentTarget.elements.search.value.trim();
    accountOffset = 0;
    loadRoleAccounts();
  });
  byId('role-prev').addEventListener('click', () => {
    accountOffset = Math.max(0, accountOffset - 50);
    loadRoleAccounts();
  });
  byId('role-next').addEventListener('click', () => {
    if (accountNext === null) return;
    accountOffset = accountNext;
    loadRoleAccounts();
  });
  loadRoleAccounts();
  byId('cancel-revoke').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => byId('revoke').reset());
  byId('refresh').addEventListener('click', () => refreshActivity());
  byId('older').addEventListener('click', () => refreshActivity(true));
  loadAdmins().catch(error => { byId('admin-status').textContent = error.message; });
  refreshActivity();
})();
