(() => {
  'use strict';

  const Radar = window.ZenCoreRadar;
  const byId = id => document.getElementById(id);
  const setText = (id, value) => { const element = byId(id); if (element) element.textContent = value; };
  const escape = value => Radar?.escapeHtml(value) || String(value ?? '');

  const welcomeName = byId('welcomeName');
  const userPill = byId('userPill');
  const logoutButton = byId('logoutButton');
  const marketGrid = byId('marketGrid');
  const marketSearch = byId('marketSearch');
  const feedConnection = byId('feedConnection');

  let payload = { markets: [], generatedAt: null };
  let markets = [];
  let activeFilter = 'all';
  let searchValue = '';
  let stream = null;
  let refreshTimer = null;

  function goToLogin() {
    window.location.replace('/login');
  }

  async function loadUser() {
    try {
      const response = await fetch('/auth/me', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      if (response.status === 401) return goToLogin();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const user = body.user || {};
      if (welcomeName) welcomeName.textContent = user.displayName || 'Trader';
      if (userPill) userPill.textContent = user.email || 'Akaun ZenCore';
    } catch (_) {
      if (userPill) userPill.textContent = 'Akaun tidak tersedia';
    }
  }

  function connectionState(state, label) {
    if (!feedConnection) return;
    feedConnection.className = `connection-pill ${state}`;
    feedConnection.innerHTML = `<i></i>${escape(label)}`;
  }

  function formatUpdated(timestamp) {
    if (!Number.isFinite(Number(timestamp))) return '—';
    return new Date(Number(timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function cardClass(market) {
    const stateClass = market.statusLabel.toLowerCase().replace(/[^a-z]+/g, '-');
    return ['market-card', market.tone, stateClass, market.isLive ? 'live' : ''].filter(Boolean).join(' ');
  }

  function planMarkup(market) {
    if (!market.plan) return '';
    return `<div class="plan-strip">
      <span>ENTRY<b>${escape(market.entryText)}</b></span>
      <span>SL<b>${escape(market.slText)}</b></span>
      <span>TP1<b>${escape(market.tp1Text)}</b></span>
    </div>`;
  }

  function cardMarkup(market) {
    const power = market.marketPower == null ? market.forecast : `${market.forecast} ${Math.round(market.marketPower)}%`;
    const signalCopy = market.side === 'WAIT' ? market.statusCopy : `${market.side} • ${market.statusCopy}`;
    return `<a class="${cardClass(market)}" href="/analysis?pair=${encodeURIComponent(market.symbol)}" data-symbol="${escape(market.symbol)}" aria-label="Buka analysis ${escape(market.symbol)}">
      <div class="card-head">
        <div class="card-symbol"><b>${escape(market.symbol)}</b><small>NORMAL ${escape(market.timeframe)} • ${escape(market.feedMode)}</small></div>
        <span class="state-badge">${escape(market.statusLabel)}</span>
      </div>
      <div class="card-price">${escape(market.priceText)}</div>
      <div class="signal-line">
        <div class="signal-copy"><span>KEADAAN SETUP</span><b>${escape(signalCopy)}</b></div>
        <div class="quality"><span>SOP QUALITY</span><b>${market.score}/100</b><progress class="quality-progress" max="100" value="${market.score}" aria-label="Quality ${market.score} daripada 100"></progress></div>
      </div>
      <div class="card-metrics">
        <div><span>SOP HIJAU</span><b>${market.sopGreen}/${market.sopTotal}</b></div>
        <div><span>FORECAST</span><b>${escape(power || 'WAIT')}</b></div>
        <div><span>ENTRY ZONE</span><b>${escape(market.zone)}</b></div>
      </div>
      <p class="card-reason">${escape(market.reason)}</p>
      ${planMarkup(market)}
      <div class="card-foot"><span><i class="live-mark"></i>${escape(market.freshness)} • ${escape(market.ageLabel)}</span><strong>BUKA ANALYSIS →</strong></div>
    </a>`;
  }

  function renderBest() {
    const best = Radar.selectBest(markets);
    const link = byId('bestSetupLink');
    const tone = byId('bestTone');
    if (!best) {
      link?.classList.add('disabled');
      if (link) link.href = '/analysis?pair=XAUUSD';
      if (tone) tone.className = 'best-dot wait';
      setText('bestPair', 'BELUM ADA SETUP');
      setText('bestSide', 'WAIT');
      setText('bestReason', 'Semua market sedang menunggu syarat Normal 3M lengkap. Jangan kejar entry.');
      setText('bestSop', '—');
      setText('bestScore', '—');
      setText('bestZone', '—');
      setText('bestAction', 'Tunggu confirm dulu.');
      return;
    }

    link?.classList.remove('disabled');
    if (link) link.href = `/analysis?pair=${encodeURIComponent(best.symbol)}`;
    if (tone) tone.className = `best-dot ${best.tone}`;
    setText('bestPair', best.symbol);
    setText('bestSide', `${best.side} • ${best.statusLabel}`);
    setText('bestReason', best.reason);
    setText('bestSop', `${best.sopGreen}/${best.sopTotal}`);
    setText('bestScore', `${best.score}/100`);
    setText('bestZone', best.zone);
    setText('bestAction', best.state === 'READY' ? `Buka ${best.symbol} — setup dah lengkap.` : `Pantau ${best.symbol} — tunggu confirm akhir.`);
  }

  function renderSummary() {
    const summary = Radar.marketSummary(markets);
    setText('summaryTotal', summary.total || Radar.SUPPORTED_MARKETS.length);
    setText('summaryLive', summary.live);
    setText('summaryReady', summary.ready);
    setText('summaryWatch', summary.watch);
    setText('summaryActive', summary.active);
    setText('summaryUpdated', formatUpdated(payload.generatedAt));
  }

  function filterTitle(count) {
    const labels = {
      all: 'Semua market',
      ready: 'Market ENTRY READY',
      watch: 'Market dalam WATCH',
      active: 'Trade sedang aktif',
      buy: 'Setup arah BUY',
      sell: 'Setup arah SELL',
      live: 'Market dengan feed LIVE'
    };
    const suffix = searchValue ? ` • carian ${searchValue.toUpperCase()}` : '';
    return `${labels[activeFilter] || labels.all} (${count})${suffix}`;
  }

  function renderGrid() {
    if (!marketGrid || !Radar) return;
    const visible = Radar.filterMarkets(markets, activeFilter, searchValue);
    marketGrid.setAttribute('aria-busy', 'false');
    setText('gridTitle', filterTitle(visible.length));
    marketGrid.innerHTML = visible.length
      ? visible.map(cardMarkup).join('')
      : '<div class="radar-empty"><b>Tiada pair dalam filter ini.</b><span>Cuba pilih SEMUA atau kosongkan carian.</span></div>';
  }

  function render() {
    if (!Radar) return;
    markets = Radar.sortMarkets(payload.markets, Date.now());
    renderSummary();
    renderBest();
    renderGrid();
  }

  function ingest(nextPayload) {
    if (!nextPayload || !Array.isArray(nextPayload.markets)) return;
    payload = nextPayload;
    render();
  }

  async function refreshMarkets() {
    try {
      const response = await fetch('/api/markets', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      if (response.status === 401) return goToLogin();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      ingest(await response.json());
      if (!stream || stream.readyState !== EventSource.OPEN) connectionState('connecting', 'BAR DATA');
    } catch (_) {
      connectionState('reconnecting', 'CUBA SEMULA');
      if (marketGrid && !markets.length) {
        marketGrid.setAttribute('aria-busy', 'false');
        marketGrid.innerHTML = '<div class="radar-empty"><b>Market Radar belum tersedia.</b><span>ZenCore akan cuba sambung semula secara automatik.</span></div>';
      }
    }
  }

  function connectMarketStream() {
    if (stream) stream.close();
    connectionState('connecting', 'MENYAMBUNG');
    try {
      stream = new EventSource('/market-events');
      stream.addEventListener('open', () => connectionState('live', 'LIVE FEED'));
      stream.addEventListener('markets', event => {
        try {
          ingest(JSON.parse(event.data));
          connectionState('live', 'LIVE FEED');
        } catch (_) {}
      });
      stream.addEventListener('error', () => connectionState('reconnecting', 'RECONNECTING'));
    } catch (_) {
      connectionState('reconnecting', 'RECONNECTING');
    }
  }

  document.querySelectorAll('.radar-filter').forEach(button => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter || 'all';
      document.querySelectorAll('.radar-filter').forEach(item => item.classList.toggle('active', item === button));
      renderGrid();
    });
  });

  marketSearch?.addEventListener('input', () => {
    searchValue = marketSearch.value.trim();
    renderGrid();
  });

  marketGrid?.addEventListener('click', event => {
    const link = event.target.closest('[data-symbol]');
    if (!link) return;
    try { localStorage.setItem('zencorePair', link.dataset.symbol); } catch (_) {}
  });

  logoutButton?.addEventListener('click', async () => {
    logoutButton.disabled = true;
    logoutButton.textContent = 'KELUAR...';
    try {
      await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
    } finally {
      goToLogin();
    }
  });

  if (!Radar) {
    connectionState('reconnecting', 'RADAR ERROR');
    if (marketGrid) marketGrid.innerHTML = '<div class="radar-empty"><b>Radar gagal dimuatkan.</b><span>Muat semula halaman ini.</span></div>';
    return;
  }

  loadUser();
  refreshMarkets();
  connectMarketStream();
  refreshTimer = window.setInterval(() => {
    render();
    refreshMarkets();
  }, 30000);
  window.addEventListener('beforeunload', () => {
    if (stream) stream.close();
    if (refreshTimer) window.clearInterval(refreshTimer);
  });
})();
