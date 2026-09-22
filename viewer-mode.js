(() => {
  'use strict';

  async function applyViewerMode() {
    try {
      const response = await fetch('/auth/me', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return;
      const body = await response.json();
      if (body.user?.role !== 'viewer') return;

      document.body.classList.add('viewer-mode');
      if (window.location.pathname === '/auto-trade') {
        document.body.classList.add('autotrade-viewer');
      }
      document.querySelectorAll('a[href^="/account"]')
        .forEach(link => {
          link.setAttribute('aria-hidden', 'true');
          link.setAttribute('tabindex', '-1');
        });

      const header = document.querySelector('.portal-top, .pro-topbar, .topbar, header');
      if (header && !header.querySelector('.viewer-badge')) {
        const badge = document.createElement('span');
        badge.className = 'viewer-badge';
        badge.innerHTML = '<i></i>PUBLIC DEMO • VIEW ONLY';
        const actions = header.querySelector('.user-actions, .header-right, .statuses');
        if (actions) actions.prepend(badge);
        else header.appendChild(badge);
      }

      const userPill = document.getElementById('userPill');
      if (userPill) userPill.textContent = 'Public Demo • View Only';

      const hero = document.querySelector('.radar-intro, .results-hero > div:first-child, .hero-copy');
      if (hero && !hero.querySelector('.viewer-readonly-note')) {
        const note = document.createElement('div');
        note.className = 'viewer-readonly-note';
        note.textContent = window.location.pathname === '/auto-trade'
          ? 'Public Demo: paparan Auto Trade sahaja. Tiada sambungan MT5 dan semua kawalan execution dikunci.'
          : 'Akaun promosi ini adalah view-only. Tetapan akaun dan execution tidak boleh diubah.';
        hero.appendChild(note);
      }
    } catch (_) {}
  }

  applyViewerMode();
})();
