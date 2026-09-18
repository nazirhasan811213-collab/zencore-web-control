const test = require('node:test');
const assert = require('node:assert/strict');
const Radar = require('../market-radar-core');

const NOW = 1_800_000_000_000;

function market(symbol, state, side, score, extra = {}) {
  return {
    symbol,
    freshness: 'LIVE',
    price: symbol === 'XAUUSD' ? 2500.1234 : 1.123456,
    receivedAt: NOW - 30000,
    timeframe: '3',
    zone: 'NEAR ENTRY',
    strategyNormal: {
      state,
      side,
      score,
      reason: `${symbol} reason`,
      sop: { sopGreen: state === 'READY' ? 5 : 3, total: 5, forecast: 'BULLISH', marketPower: 65 },
      plan: state === 'READY' ? { entry: 1, sl: .9, tp1: 1.1 } : null
    },
    ...extra
  };
}

test('radar has the exact 11 supported ZenCore markets', () => {
  assert.deepEqual(Radar.SUPPORTED_MARKETS, [
    'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'US30', 'USDCAD',
    'USDCHF', 'EURJPY', 'GBPJPY', 'EURGBP', 'BTCUSD'
  ]);
});

test('radar text and price helpers are safe and pair-aware', () => {
  assert.equal(Radar.escapeHtml('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  assert.equal(Radar.formatPrice(150.12345, 'USDJPY'), '150.123');
  assert.equal(Radar.formatPrice(65000.5, 'BTCUSD'), '65,000.50');
  assert.equal(Radar.normaliseSymbol('OANDA:XAUUSD'), 'XAUUSD');
});

test('market view follows Normal 3M state instead of prediction direction', () => {
  const view = Radar.marketView({
    ...market('XAUUSD', 'WAIT', 'WAIT', 20),
    prediction: 'BUY',
    predictionConfidence: 99
  }, NOW);
  assert.equal(view.state, 'WAIT');
  assert.equal(view.side, 'WAIT');
  assert.equal(view.statusCopy, 'Belum ada setup');
  assert.equal(view.priceText, '2,500.123');
  assert.equal(view.ageLabel, '30s lalu');
});

test('market sorting prioritizes active, ready, watch, wait and offline', () => {
  const sorted = Radar.sortMarkets([
    market('EURUSD', 'WAIT', 'WAIT', 20),
    market('GBPUSD', 'WATCH', 'BUY', 60),
    market('USDJPY', 'READY', 'SELL', 100),
    market('US30', 'WAIT', 'BUY', 50, { tradeActive: true }),
    market('BTCUSD', 'READY', 'BUY', 100, { freshness: 'OFFLINE' })
  ], NOW);
  assert.deepEqual(sorted.map(row => row.symbol), ['US30', 'USDJPY', 'GBPUSD', 'EURUSD', 'BTCUSD']);
});

test('filters and search use Normal state and symbol', () => {
  const sorted = Radar.sortMarkets([
    market('XAUUSD', 'READY', 'BUY', 100),
    market('EURUSD', 'WATCH', 'SELL', 60),
    market('GBPUSD', 'WAIT', 'WAIT', 20)
  ], NOW);
  assert.deepEqual(Radar.filterMarkets(sorted, 'ready').map(row => row.symbol), ['XAUUSD']);
  assert.deepEqual(Radar.filterMarkets(sorted, 'sell').map(row => row.symbol), ['EURUSD']);
  assert.deepEqual(Radar.filterMarkets(sorted, 'all', 'gbp').map(row => row.symbol), ['GBPUSD']);
});

test('best setup prefers live READY then live WATCH', () => {
  const ready = Radar.marketView(market('XAUUSD', 'READY', 'BUY', 100), NOW);
  const watch = Radar.marketView(market('EURUSD', 'WATCH', 'SELL', 60), NOW);
  assert.equal(Radar.selectBest([ready, watch]).symbol, 'XAUUSD');
  assert.equal(Radar.selectBest([watch]).symbol, 'EURUSD');
  assert.equal(Radar.selectBest([Radar.marketView(market('GBPUSD', 'WAIT', 'WAIT', 20), NOW)]), null);
});

test('summary counts live, ready, watch and active markets', () => {
  const views = Radar.sortMarkets([
    market('XAUUSD', 'READY', 'BUY', 100),
    market('EURUSD', 'WATCH', 'SELL', 60),
    market('GBPUSD', 'WAIT', 'BUY', 50, { tradeActive: true }),
    market('BTCUSD', 'WAIT', 'WAIT', 0, { freshness: 'OFFLINE' })
  ], NOW);
  assert.deepEqual(Radar.marketSummary(views), {
    total: 4,
    live: 3,
    ready: 1,
    watch: 1,
    active: 1,
    buy: 2,
    sell: 1
  });
});
