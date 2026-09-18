(function attachZenCoreRadar(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZenCoreRadar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildZenCoreRadar() {
  'use strict';

  const SUPPORTED_MARKETS = [
    'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'US30', 'USDCAD',
    'USDCHF', 'EURJPY', 'GBPJPY', 'EURGBP', 'BTCUSD'
  ];

  const upper = value => String(value || '').trim().toUpperCase();
  const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, number(value) || 0));

  function normaliseSymbol(value) {
    return upper(value).replace(/^.*:/, '').replace(/[^A-Z0-9._-]/g, '');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function priceDigits(symbol) {
    const value = normaliseSymbol(symbol);
    if (value === 'US30' || value === 'BTCUSD') return 2;
    if (value.includes('JPY') || value.startsWith('XAU') || value.startsWith('XAG')) return 3;
    return 5;
  }

  function formatPrice(value, symbol) {
    const parsed = number(value);
    if (parsed === null) return '—';
    return parsed.toLocaleString(undefined, {
      minimumFractionDigits: priceDigits(symbol),
      maximumFractionDigits: priceDigits(symbol)
    });
  }

  function formatAge(receivedAt, now = Date.now()) {
    const timestamp = number(receivedAt);
    if (!timestamp) return 'Belum ada data';
    const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    if (seconds < 60) return `${seconds}s lalu`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m lalu`;
    return `${Math.floor(seconds / 3600)}j lalu`;
  }

  function displayState(state, side, tradeActive, freshness) {
    if (freshness === 'OFFLINE') return { label: 'OFFLINE', copy: 'Tiada data live', tone: 'offline' };
    if (tradeActive) return { label: 'ACTIVE TRADE', copy: 'Trade sedang aktif', tone: side === 'SELL' ? 'sell' : 'buy' };
    if (state === 'READY') return {
      label: 'ENTRY READY',
      copy: side === 'SELL' ? 'SELL dah cun' : side === 'BUY' ? 'BUY dah cun' : 'Setup dah ready',
      tone: side === 'SELL' ? 'sell' : side === 'BUY' ? 'buy' : 'ready'
    };
    if (state === 'WATCH') return { label: 'WATCH', copy: 'Tunggu confirm dulu', tone: 'watch' };
    if (state === 'WARMING') return { label: 'WARMING', copy: 'Data tengah warm-up', tone: 'warming' };
    if (state === 'COOLDOWN') return { label: 'COOLDOWN', copy: 'Tunggu setup baru', tone: 'cooldown' };
    return { label: 'WAIT', copy: 'Belum ada setup', tone: 'wait' };
  }

  function priority(view) {
    if (view.freshness === 'OFFLINE') return 0;
    if (view.tradeActive) return 1000 + view.score;
    if (view.state === 'READY') return 900 + view.score;
    if (view.state === 'WATCH') return 700 + view.score;
    if (view.state === 'COOLDOWN') return 600;
    if (view.state === 'WARMING') return 500;
    if (view.freshness === 'LIVE') return 400 + view.score;
    return 200 + view.score;
  }

  function marketView(market = {}, now = Date.now()) {
    const symbol = normaliseSymbol(market.symbol) || 'UNKNOWN';
    const normal = market.strategyNormal || {};
    const sop = normal.sop || {};
    const plan = normal.plan || null;
    const freshness = upper(market.freshness || (market.online === false ? 'OFFLINE' : 'STALE'));
    const state = upper(normal.state || 'WAIT');
    const rawSide = upper(normal.side || market.signal || 'WAIT');
    const side = rawSide === 'BUY' || rawSide === 'SELL' ? rawSide : 'WAIT';
    const score = Math.round(clamp(normal.score));
    const tradeActive = market.tradeActive === true;
    const display = displayState(state, side, tradeActive, freshness);
    const view = {
      symbol,
      timeframe: String(normal.tf || market.timeframe || '3m').replace(/^3$/, '3m'),
      freshness,
      isLive: freshness === 'LIVE',
      state,
      side,
      score,
      tradeActive,
      statusLabel: display.label,
      statusCopy: display.copy,
      tone: display.tone,
      reason: String(normal.reason || (freshness === 'OFFLINE' ? 'Menunggu feed Pine 3M.' : 'Tunggu setup Normal 3M.')),
      price: number(market.price),
      priceText: formatPrice(market.price, symbol),
      receivedAt: number(market.receivedAt),
      ageLabel: formatAge(market.receivedAt, now),
      zone: String(market.zone || 'NO DATA'),
      confluence: number(market.confluence),
      setupProbability: number(market.setupProbability),
      sopGreen: number(sop.sopGreen) ?? number(sop.passed) ?? 0,
      sopTotal: number(sop.total) ?? 5,
      forecast: upper(sop.forecast || 'WAIT'),
      marketPower: number(sop.marketPower),
      plan,
      entryText: formatPrice(plan?.entry, symbol),
      slText: formatPrice(plan?.sl, symbol),
      tp1Text: formatPrice(plan?.tp1, symbol),
      feedMode: String(market.feedMode || 'BAR-CLOSE'),
      lockLabel: upper(market.positionManagement?.slLockLabel || 'INITIAL')
    };
    view.priority = priority(view);
    return view;
  }

  function sortMarkets(markets, now = Date.now()) {
    return (Array.isArray(markets) ? markets : [])
      .map(market => marketView(market, now))
      .sort((a, b) => b.priority - a.priority || a.symbol.localeCompare(b.symbol));
  }

  function filterMarkets(markets, filter = 'all', search = '') {
    const selected = String(filter || 'all').toLowerCase();
    const query = normaliseSymbol(search);
    return (Array.isArray(markets) ? markets : []).filter(market => {
      if (query && !market.symbol.includes(query)) return false;
      if (selected === 'ready') return market.state === 'READY' && !market.tradeActive;
      if (selected === 'watch') return market.state === 'WATCH';
      if (selected === 'active') return market.tradeActive;
      if (selected === 'buy') return market.side === 'BUY';
      if (selected === 'sell') return market.side === 'SELL';
      if (selected === 'live') return market.isLive;
      return true;
    });
  }

  function selectBest(markets) {
    const list = Array.isArray(markets) ? markets : [];
    return list.find(market => market.isLive && market.state === 'READY' && !market.tradeActive) ||
      list.find(market => market.isLive && market.state === 'WATCH') || null;
  }

  function marketSummary(markets) {
    const list = Array.isArray(markets) ? markets : [];
    return {
      total: list.length,
      live: list.filter(market => market.isLive).length,
      ready: list.filter(market => market.state === 'READY' && !market.tradeActive).length,
      watch: list.filter(market => market.state === 'WATCH').length,
      active: list.filter(market => market.tradeActive).length,
      buy: list.filter(market => market.side === 'BUY').length,
      sell: list.filter(market => market.side === 'SELL').length
    };
  }

  return {
    SUPPORTED_MARKETS,
    normaliseSymbol,
    escapeHtml,
    priceDigits,
    formatPrice,
    formatAge,
    marketView,
    sortMarkets,
    filterMarkets,
    selectBest,
    marketSummary
  };
});
