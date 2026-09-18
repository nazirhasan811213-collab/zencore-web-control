(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZenCoreResults = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SUPPORTED_MARKETS = [
    'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'US30', 'USDCAD',
    'USDCHF', 'EURJPY', 'GBPJPY', 'EURGBP', 'BTCUSD'
  ];

  const WIN_OUTCOMES = new Set([
    'TP20', 'TP30', 'TP1', 'TP2', 'TP3', 'PROTECTED_WIN',
    'TP2_PROTECTED', 'TP3_PROTECTED', 'TP1_MANAGED', 'TP2_MANAGED', 'TP3_MANAGED'
  ]);

  const number = value => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const upper = value => String(value || '').trim().toUpperCase();

  function normaliseSymbol(value) {
    return upper(value).replace(/^.*:/, '').replace(/[^A-Z0-9._-]/g, '');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function priceDigits(symbol) {
    const pair = normaliseSymbol(symbol);
    if (pair === 'US30' || pair.endsWith('JPY')) return pair === 'US30' ? 1 : 3;
    if (pair === 'XAUUSD') return 3;
    if (pair === 'BTCUSD') return 2;
    return 5;
  }

  function formatPrice(value, symbol) {
    const parsed = number(value);
    if (parsed === null) return '—';
    return parsed.toLocaleString('en-US', {
      minimumFractionDigits: priceDigits(symbol),
      maximumFractionDigits: priceDigits(symbol)
    });
  }

  function timestamp(row, prefix) {
    const direct = number(row?.[`${prefix}At`]);
    if (direct !== null) return direct;
    const marketTime = number(row?.[`${prefix}Time`]);
    if (marketTime === null) return null;
    return marketTime < 10_000_000_000 ? marketTime * 1000 : marketTime;
  }

  function formatDateTime(value) {
    const parsed = number(value);
    if (parsed === null) return '—';
    const date = new Date(parsed);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('ms-MY', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  function outcomeMeta(value, state = 'CLOSED') {
    const outcome = upper(value);
    if (upper(state) === 'OPEN' || outcome === 'OPEN') {
      return { key: 'open', label: 'MASIH OPEN', tone: 'open', isWin: false, isLoss: false };
    }
    if (outcome === 'SL') return { key: 'loss', label: 'STOP LOSS', tone: 'loss', isWin: false, isLoss: true };
    if (outcome === 'AMBIGUOUS') return { key: 'ambiguous', label: 'AMBIGUOUS', tone: 'ambiguous', isWin: false, isLoss: false };
    if (outcome.includes('PROTECTED')) {
      const stage = outcome.replace('_PROTECTED', '').replace('PROTECTED_WIN', 'TP1');
      return { key: 'protected', label: `${stage} PROTECTED`, tone: 'protected', isWin: WIN_OUTCOMES.has(outcome), isLoss: false };
    }
    if (outcome.includes('MANAGED')) {
      const stage = outcome.replace('_MANAGED', '').replace('MANAGED_EXIT', 'EXIT');
      return { key: 'managed', label: `${stage} MANAGED`, tone: 'managed', isWin: WIN_OUTCOMES.has(outcome), isLoss: false };
    }
    if (WIN_OUTCOMES.has(outcome)) return { key: 'win', label: outcome, tone: 'win', isWin: true, isLoss: false };
    if (outcome === 'TIMEOUT') return { key: 'timeout', label: 'TIMEOUT', tone: 'timeout', isWin: false, isLoss: false };
    return { key: 'other', label: outcome || 'BELUM DINILAI', tone: 'other', isWin: false, isLoss: false };
  }

  function normaliseRow(row = {}, fallbackSymbol = '', state = 'CLOSED') {
    const symbol = normaliseSymbol(row.symbol || fallbackSymbol) || 'UNKNOWN';
    const rowState = upper(row.state || state) === 'OPEN' ? 'OPEN' : 'CLOSED';
    const outcome = rowState === 'OPEN' ? 'OPEN' : upper(row.outcome);
    const meta = outcomeMeta(outcome, rowState);
    const openedAt = timestamp(row, 'opened');
    const resolvedAt = rowState === 'OPEN' ? null : timestamp(row, 'resolved');
    return {
      id: String(row.id || `${symbol}-${row.mode || 'NORMAL'}-${row.openedKey || openedAt || 'unknown'}-${outcome || rowState}`),
      symbol,
      mode: upper(row.mode || 'NORMAL'),
      side: ['BUY', 'SELL'].includes(upper(row.side)) ? upper(row.side) : 'WAIT',
      state: rowState,
      outcome,
      category: meta.key,
      outcomeLabel: meta.label,
      tone: meta.tone,
      isWin: meta.isWin,
      isLoss: meta.isLoss,
      openedAt,
      resolvedAt,
      sortAt: resolvedAt ?? openedAt ?? 0,
      entry: number(row.entry),
      sl: number(row.sl),
      activeSl: number(row.activeSl),
      tp1: number(row.tp1),
      tp2: number(row.tp2),
      tp3: number(row.tp3),
      score: number(row.score) ?? 0,
      hitTp1: row.hitTp1 === true,
      hitTp2: row.hitTp2 === true,
      hitTp3: row.hitTp3 === true,
      slLockStage: number(row.slLockStage) ?? 0,
      reason: String(row.reason || '')
    };
  }

  function sumOutcome(summary, matcher) {
    return Object.entries(summary?.byOutcome || {}).reduce((total, [outcome, count]) => {
      return total + (matcher(upper(outcome)) ? (number(count) ?? 0) : 0);
    }, 0);
  }

  function aggregatePerformance(payloads = [], expectedSymbols = SUPPORTED_MARKETS) {
    const bySymbol = new Map();
    for (const payload of Array.isArray(payloads) ? payloads : []) {
      const symbol = normaliseSymbol(payload?.symbol);
      if (symbol) bySymbol.set(symbol, payload);
    }

    const pairSummaries = expectedSymbols.map(rawSymbol => {
      const symbol = normaliseSymbol(rawSymbol);
      const payload = bySymbol.get(symbol);
      const summary = payload?.summary || {};
      return {
        symbol,
        available: Boolean(payload?.ok),
        sample: number(summary.sample) ?? 0,
        resolved: number(summary.resolved) ?? 0,
        wins: number(summary.wins) ?? 0,
        losses: number(summary.losses) ?? 0,
        ambiguous: number(summary.ambiguous) ?? 0,
        winRate: number(summary.winRate),
        maturity: upper(summary.maturity || 'EARLY'),
        open: Array.isArray(summary.open) ? summary.open.length : 0,
        protected: sumOutcome(summary, outcome => outcome.includes('PROTECTED')),
        managed: sumOutcome(summary, outcome => outcome.includes('MANAGED')),
        generatedAt: number(payload?.generatedAt)
      };
    });

    const seenClosed = new Set();
    const seenOpen = new Set();
    const resolvedRows = [];
    const openRows = [];
    for (const [symbol, payload] of bySymbol) {
      const summary = payload?.summary || {};
      for (const raw of Array.isArray(summary.recent) ? summary.recent : []) {
        const row = normaliseRow(raw, symbol, 'CLOSED');
        if (seenClosed.has(row.id)) continue;
        seenClosed.add(row.id);
        resolvedRows.push(row);
      }
      for (const raw of Array.isArray(summary.open) ? summary.open : []) {
        const row = normaliseRow(raw, symbol, 'OPEN');
        if (seenOpen.has(row.id)) continue;
        seenOpen.add(row.id);
        openRows.push(row);
      }
    }

    resolvedRows.sort((a, b) => b.sortAt - a.sortAt || a.symbol.localeCompare(b.symbol));
    openRows.sort((a, b) => b.sortAt - a.sortAt || a.symbol.localeCompare(b.symbol));

    const totals = pairSummaries.reduce((acc, pair) => {
      for (const key of ['sample', 'resolved', 'wins', 'losses', 'ambiguous', 'open', 'protected', 'managed']) acc[key] += pair[key];
      if (pair.available) acc.available += 1;
      return acc;
    }, { sample: 0, resolved: 0, wins: 0, losses: 0, ambiguous: 0, open: 0, protected: 0, managed: 0, available: 0 });

    totals.winRate = totals.resolved ? Math.round((totals.wins / totals.resolved) * 1000) / 10 : null;
    totals.visibleResolved = resolvedRows.length;
    totals.expected = expectedSymbols.length;

    return {
      summary: totals,
      pairSummaries,
      resolvedRows,
      openRows,
      allRows: [...openRows, ...resolvedRows].sort((a, b) => b.sortAt - a.sortAt),
      generatedAt: Math.max(0, ...pairSummaries.map(pair => pair.generatedAt || 0)) || null
    };
  }

  function filterRows(rows, filters = {}) {
    const pair = normaliseSymbol(filters.pair || 'ALL');
    const category = String(filters.category || 'all').toLowerCase();
    const side = upper(filters.side || 'ALL');
    const search = String(filters.search || '').trim().toLowerCase();
    return (Array.isArray(rows) ? rows : []).filter(row => {
      if (pair !== 'ALL' && row.symbol !== pair) return false;
      if (side !== 'ALL' && row.side !== side) return false;
      if (category === 'open' && row.state !== 'OPEN') return false;
      if (category === 'win' && !row.isWin) return false;
      if (category === 'loss' && !row.isLoss) return false;
      if (['protected', 'managed', 'ambiguous', 'timeout'].includes(category) && row.category !== category) return false;
      if (category !== 'all' && !['open', 'win', 'loss', 'protected', 'managed', 'ambiguous', 'timeout'].includes(category)) return false;
      if (search) {
        const haystack = `${row.symbol} ${row.side} ${row.outcomeLabel} ${row.reason}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function buildCsv(rows) {
    const headers = [
      'State', 'Pair', 'Mode', 'Side', 'Opened', 'Resolved', 'Outcome', 'Entry',
      'Initial SL', 'Active SL', 'TP1', 'TP2', 'TP3', 'TP1 Hit', 'TP2 Hit',
      'TP3 Hit', 'SL Lock Stage', 'SOP Score', 'Reason'
    ];
    const lines = [headers.map(csvCell).join(',')];
    for (const row of Array.isArray(rows) ? rows : []) {
      const values = [
        row.state, row.symbol, row.mode, row.side, row.openedAt ? new Date(row.openedAt).toISOString() : '',
        row.resolvedAt ? new Date(row.resolvedAt).toISOString() : '', row.outcome, row.entry, row.sl,
        row.activeSl, row.tp1, row.tp2, row.tp3, row.hitTp1, row.hitTp2, row.hitTp3,
        row.slLockStage, row.score, row.reason
      ];
      lines.push(values.map(csvCell).join(','));
    }
    return `\uFEFF${lines.join('\r\n')}`;
  }

  return {
    SUPPORTED_MARKETS,
    WIN_OUTCOMES,
    number,
    normaliseSymbol,
    escapeHtml,
    priceDigits,
    formatPrice,
    formatDateTime,
    outcomeMeta,
    normaliseRow,
    aggregatePerformance,
    filterRows,
    buildCsv
  };
});
