(() => {
  'use strict';

  const Results = window.ZenCoreResults;
  const byId = id => document.getElementById(id);
  const setText = (id, value) => { const element = byId(id); if (element) element.textContent = value; };
  const escape = value => Results?.escapeHtml(value) || String(value ?? '');

  const userPill = byId('userPill');
  const logoutButton = byId('logoutButton');
  const refreshButton = byId('refreshButton');
  const exportButton = byId('exportButton');
  const pairFilter = byId('pairFilter');
  const sideFilter = byId('sideFilter');
  const pairTableBody = byId('pairTableBody');
  const openSignalList = byId('openSignalList');
  const historyTableBody = byId('historyTableBody');
  const resultConnection = byId('resultConnection');

  let aggregate = null;
  let activeCategory = 'all';
  let refreshTimer = null;
  let refreshing = false;

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
      if (userPill) userPill.textContent = body.user?.email || 'Akaun ZenCore';
    } catch (_) {
      if (userPill) userPill.textContent = 'Akaun tidak tersedia';
    }
  }

  function connectionState(state, label) {
    if (!resultConnection) return;
    resultConnection.className = `connection-pill ${state}`;
    resultConnection.innerHTML = `<i></i>${escape(label)}`;
  }

  function populatePairs() {
    if (!pairFilter || !Results) return;
    pairFilter.insertAdjacentHTML('beforeend', Results.SUPPORTED_MARKETS.map(symbol => (
      `<option value="${escape(symbol)}">${escape(symbol)}</option>`
    )).join(''));
  }

  function percent(value) {
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '—';
  }

  function renderSummary() {
    const summary = aggregate?.summary || {};
    setText('summarySample', summary.sample ?? 0);
    setText('summaryResolved', summary.resolved ?? 0);
    setText('summaryWins', summary.wins ?? 0);
    setText('summaryLosses', summary.losses ?? 0);
    setText('summaryWinRate', percent(summary.winRate));
    setText('summaryOpen', summary.open ?? 0);
    setText('pairCoverage', `${summary.available ?? 0}/${summary.expected ?? 11} tersedia`);
  }

  function maturityClass(pair) {
    if (!pair.available) return 'unavailable';
    return pair.maturity.toLowerCase().replace(/[^a-z]+/g, '-');
  }

  function maturityLabel(pair) {
    if (!pair.available) return 'TIADA DATA';
    if (!pair.resolved) return 'EARLY';
    return pair.maturity;
  }

  function renderPairTable() {
    if (!pairTableBody) return;
    const pairs = aggregate?.pairSummaries || [];
    pairTableBody.innerHTML = pairs.length ? pairs.map(pair => {
      const rateClass = pair.winRate !== null && pair.resolved >= 20 ? 'good' : 'early';
      return `<tr>
        <td class="pair-name"><a href="/analysis?pair=${encodeURIComponent(pair.symbol)}">${escape(pair.symbol)}</a></td>
        <td>${pair.resolved}</td>
        <td class="pair-record"><span class="wins">${pair.wins}W</span> • <span class="losses">${pair.losses}L</span></td>
        <td><span class="rate-value ${rateClass}">${percent(pair.winRate)}</span></td>
        <td>${pair.open}</td>
        <td><span class="maturity-badge ${maturityClass(pair)}">${escape(maturityLabel(pair))}</span></td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="table-empty">Scoreboard belum tersedia.</td></tr>';
  }

  function lockText(row) {
    const stage = Number(row.slLockStage) || 0;
    if (stage >= 3) return 'SL → TP2';
    if (stage === 2) return 'SL → TP1';
    if (stage === 1) return 'SL → ENTRY';
    return 'SL ASAL';
  }

  function openCard(row) {
    return `<a class="open-card ${escape(row.side.toLowerCase())}" href="/analysis?pair=${encodeURIComponent(row.symbol)}">
      <div><div class="open-card-head"><b>${escape(row.symbol)}</b><span>${escape(row.side)}</span></div><small>Dibuka ${escape(Results.formatDateTime(row.openedAt))} • SOP ${Math.round(row.score)}/100</small></div>
      <div class="open-entry"><span>ENTRY</span><b>${escape(Results.formatPrice(row.entry, row.symbol))}</b></div>
      <div class="open-lock"><span>${escape(lockText(row))}</span><span>TP1 ${row.hitTp1 ? '✓' : '—'} • TP2 ${row.hitTp2 ? '✓' : '—'} • TP3 ${row.hitTp3 ? '✓' : '—'}</span></div>
    </a>`;
  }

  function renderOpenSignals() {
    if (!openSignalList) return;
    const rows = aggregate?.openRows || [];
    setText('openCount', `${rows.length} signal`);
    openSignalList.innerHTML = rows.length
      ? rows.map(openCard).join('')
      : '<div class="open-empty"><b>Belum ada signal open.</b><span>ZenCore akan paparkan trade validation di sini bila setup aktif.</span></div>';
  }

  function visibleRows() {
    if (!aggregate || !Results) return [];
    return Results.filterRows(aggregate.allRows, {
      category: activeCategory,
      pair: pairFilter?.value || 'ALL',
      side: sideFilter?.value || 'ALL'
    });
  }

  function timeMarkup(row) {
    const value = row.state === 'OPEN' ? row.openedAt : row.resolvedAt;
    const label = row.state === 'OPEN' ? 'DIBUKA' : 'SELESAI';
    return `<div class="time-cell"><b>${escape(Results.formatDateTime(value))}</b><span>${label}</span></div>`;
  }

  function historyRow(row) {
    const locked = row.slLockStage > 0 ? 'locked' : '';
    return `<tr>
      <td>${timeMarkup(row)}</td>
      <td class="pair-name">${escape(row.symbol)}</td>
      <td><span class="side-badge ${escape(row.side.toLowerCase())}">${escape(row.side)}</span></td>
      <td class="price-cell">${escape(Results.formatPrice(row.entry, row.symbol))}</td>
      <td><span class="outcome-badge ${escape(row.tone)}">${escape(row.outcomeLabel)}</span></td>
      <td><span class="lock-badge ${locked}">${escape(lockText(row))}</span></td>
      <td class="score-cell">${Math.round(row.score)}/100</td>
      <td><a class="analysis-link" href="/analysis?pair=${encodeURIComponent(row.symbol)}">BUKA →</a></td>
    </tr>`;
  }

  function historyLabel(count) {
    const labels = {
      all: 'Semua keputusan terkini', win: 'Signal menang', loss: 'Signal terkena SL',
      protected: 'Result dilindungi StepLock', managed: 'Result exit management',
      ambiguous: 'Candle ambiguous', open: 'Signal masih open'
    };
    return `${labels[activeCategory] || labels.all} (${count})`;
  }

  function renderHistory() {
    if (!historyTableBody) return;
    const rows = visibleRows();
    setText('historyTitle', historyLabel(rows.length));
    setText('visibleCount', `${rows.length} rekod dipaparkan`);
    historyTableBody.innerHTML = rows.length
      ? rows.map(historyRow).join('')
      : '<tr><td colspan="8" class="table-empty">Tiada rekod untuk filter ini.</td></tr>';
  }

  function renderAll() {
    renderSummary();
    renderPairTable();
    renderOpenSignals();
    renderHistory();
    const updated = aggregate?.generatedAt;
    setText('lastUpdated', updated ? `Update ${Results.formatDateTime(updated)}` : 'Belum dikemas kini');
  }

  async function fetchPair(symbol) {
    const response = await fetch(`/api/strategy-performance/${encodeURIComponent(symbol)}/NORMAL`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    if (response.status === 401) {
      goToLogin();
      throw new Error('UNAUTHENTICATED');
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload?.ok) throw new Error('Invalid result payload');
    return payload;
  }

  async function refreshResults() {
    if (refreshing || !Results) return;
    refreshing = true;
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = 'MEMUATKAN...';
    }
    connectionState('connecting', 'MEMUATKAN');
    try {
      const settled = await Promise.allSettled(Results.SUPPORTED_MARKETS.map(fetchPair));
      const payloads = settled.filter(item => item.status === 'fulfilled').map(item => item.value);
      aggregate = Results.aggregatePerformance(payloads);
      renderAll();
      if (payloads.length === Results.SUPPORTED_MARKETS.length) connectionState('live', 'DATA TERKINI');
      else if (payloads.length) connectionState('partial', `${payloads.length}/11 PAIR`);
      else connectionState('error', 'DATA GAGAL');
    } catch (_) {
      connectionState('error', 'CUBA SEMULA');
    } finally {
      refreshing = false;
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = 'REFRESH';
      }
    }
  }

  function exportCsv() {
    const rows = visibleRows();
    if (!rows.length || !Results) return;
    const csv = Results.buildCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `zencore-signal-validation-${date}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  document.querySelectorAll('.result-filter').forEach(button => {
    button.addEventListener('click', () => {
      activeCategory = button.dataset.filter || 'all';
      document.querySelectorAll('.result-filter').forEach(item => item.classList.toggle('active', item === button));
      renderHistory();
    });
  });

  pairFilter?.addEventListener('change', renderHistory);
  sideFilter?.addEventListener('change', renderHistory);
  refreshButton?.addEventListener('click', refreshResults);
  exportButton?.addEventListener('click', exportCsv);
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

  if (!Results) {
    connectionState('error', 'RESULT ERROR');
    if (historyTableBody) historyTableBody.innerHTML = '<tr><td colspan="8" class="table-empty">Result Page gagal dimuatkan. Muat semula halaman ini.</td></tr>';
    return;
  }

  populatePairs();
  loadUser();
  refreshResults();
  refreshTimer = window.setInterval(refreshResults, 30000);
  window.addEventListener('beforeunload', () => {
    if (refreshTimer) window.clearInterval(refreshTimer);
  });
})();
