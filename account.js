(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  let profile = null;

  function money(value) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials:'same-origin',
      headers:{Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {})},
      ...options
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.replace('/login');
      throw new Error('SESSION_EXPIRED');
    }
    if (!response.ok) {
      const error = new Error(body.error || `HTTP ${response.status}`);
      error.fields = body.fields || {};
      throw error;
    }
    return body;
  }

  function renderTrading(trading) {
    const available = trading?.available === true;
    const control = trading?.control || {};
    const conn = trading?.connection || {};
    const mt5 = trading?.mt5 || {};

    byId('accountTradeState').textContent = available ? (control.effectiveState || 'STOPPED') : 'UNAVAILABLE';
    byId('accountConnection').textContent = available ? (conn.label || conn.state || 'NOT CONNECTED') : 'Status unavailable';
    byId('accountMt5Status').textContent = mt5.status || 'NOT CONNECTED';
    byId('accountMt5Mask').textContent = mt5.accountMask || '—';
    byId('accountServerMask').textContent = mt5.serverMask || '—';
    byId('accountConnState').textContent = conn.connected ? 'CONNECTED' : (conn.state || 'NOT CONNECTED');
    byId('accountWorkerSlot').textContent = mt5.workerSlotCode || 'WAITING FOR ASSIGNMENT';
    byId('accountWorkerHost').textContent = mt5.workerHostName || '—';

    const action = byId('accountMt5Action');
    const hasHostedMt5 = !!(mt5.accountMask || mt5.workerSlotCode || (mt5.status && mt5.status !== 'NOT_CONNECTED'));
    if (action) {
      action.href = hasHostedMt5 ? '/auto-trade' : '/auto-trade?connect=1';
      action.textContent = hasHostedMt5 ? 'OPEN AUTO TRADE' : 'CONNECT MT5';
    }
  }

  function renderProfile(body) {
    profile = body.profile || {};
    byId('accountName').textContent = profile.displayName || 'Client';
    byId('accountEmail').textContent = profile.email || '';
    byId('profileName').textContent = profile.displayName || 'Client';
    byId('profileStatus').textContent = String(profile.status || 'active').toUpperCase();
    byId('profileIb').textContent = `IB ${String(profile.ibCode || 'nazir').toUpperCase()}`;
    byId('profileDisplayName').value = profile.displayName || '';
    byId('profilePhone').value = profile.phone || '';
    byId('profileEmail').value = profile.email || '';
    byId('profileIc').value = profile.icMasked || '';
    byId('profileIbName').value = profile.ibName || 'Nazir (Admin)';
    renderTrading(body.trading);
  }

  async function load() {
    const me = await api('/auth/me');
    if (me.user?.role !== 'client') {
      window.location.replace(me.user?.role === 'admin' ? '/admin' : '/ib');
      return;
    }
    renderProfile(await api('/api/account/profile'));
  }

  byId('profileForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = byId('saveProfile');
    const status = byId('profileStatusMessage');
    button.disabled = true;
    status.className = 'mg-form-status';
    status.textContent = 'Saving...';
    try {
      const body = await api('/api/account/profile', {
        method:'PATCH',
        body:JSON.stringify({
          displayName: byId('profileDisplayName').value,
          phone: byId('profilePhone').value
        })
      });
      profile = body.profile;
      byId('accountName').textContent = profile.displayName;
      byId('profileName').textContent = profile.displayName;
      status.className = 'mg-form-status success';
      status.textContent = 'Profile updated.';
    } catch (error) {
      status.className = 'mg-form-status error';
      status.textContent = error.message;
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

  load().catch(error => {
    if (error.message !== 'SESSION_EXPIRED') {
      const status = byId('profileStatusMessage');
      if (status) {
        status.className = 'mg-form-status error';
        status.textContent = error.message;
      }
    }
  });
})();