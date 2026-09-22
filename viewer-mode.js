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
      document.querySelectorAll('a[href^="/auto-trade"], a[href^="/account"]')
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
        note.textContent = 'Akaun promosi ini adalah view-only. Tetapan akaun, MT5 dan Auto Trade tidak boleh diakses atau diubah.';
        hero.appendChild(note);
      }
    } catch (_) {}
  }

  applyViewerMode();
})();
