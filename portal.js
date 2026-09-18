(() => {
  'use strict';

  const welcomeName = document.getElementById('welcomeName');
  const userPill = document.getElementById('userPill');
  const logoutButton = document.getElementById('logoutButton');

  async function loadUser() {
    try {
      const response = await fetch('/auth/me', {
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) {
        window.location.replace('/login');
        return;
      }
      const body = await response.json();
      const user = body.user || {};
      if (welcomeName) welcomeName.textContent = user.displayName || 'Trader';
      if (userPill) userPill.textContent = user.email || 'Akaun ZenCore';
    } catch (_) {
      window.location.replace('/login');
    }
  }

  logoutButton?.addEventListener('click', async () => {
    logoutButton.disabled = true;
    logoutButton.textContent = 'KELUAR...';
    try {
      await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      });
    } finally {
      window.location.replace('/login');
    }
  });

  loadUser();
})();
