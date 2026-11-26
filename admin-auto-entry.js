(() => {
  'use strict';

  const button = document.getElementById('globalAutoEntryButton');
  if (!button) return;
  const status = document.getElementById('globalAutoEntryStatus');
  const result = document.getElementById('globalAutoEntryResult');
  const endpoint = '/api/admin/system/auto-entry';
  let current;
  button.classList.add(document.body.dataset.adminOpsPage ? 'mg-primary' : 'registration-approve');

  async function request(options) {
    const response = await fetch(endpoint, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options
    });
    const state = await response.json();
    if (!response.ok || state.ok !== true) {
      throw new Error(state.error || 'Status Auto Trade gagal dimuatkan.');
    }
    return state;
  }

  function render(state) {
    current = state;
    status.textContent = state.paused ? 'STOP GLOBAL aktif' :
      state.environmentPaused ? 'Entry Auto Trade dikunci oleh server' : 'Sekatan global dilepaskan';
    button.textContent = state.paused ? 'Lepaskan STOP global' : 'STOP semua Auto Trade';
    button.disabled = false;
  }

  button.addEventListener('click', async () => {
    if (!current || button.disabled) return;
    const paused = !current.paused;
    const prompt = paused ? 'Hentikan entry automatik untuk semua pengguna ZenCore?' :
      'Lepaskan STOP global? Akaun yang masih memilih Auto Trade ON boleh menerima signal baharu.';
    if (!window.confirm(prompt)) return;
    button.disabled = true;
    result.textContent = 'Menyimpan tetapan…';
    try {
      render(await request({
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({paused})
      }));
      result.textContent = paused ? 'STOP global telah disimpan.' : 'Sekatan global telah dilepaskan.';
    } catch (error) {
      result.textContent = error.message;
      try { render(await request()); } catch (_) { button.disabled = true; }
    }
  });

  request().then(render).catch(error => { status.textContent = error.message; });
})();
