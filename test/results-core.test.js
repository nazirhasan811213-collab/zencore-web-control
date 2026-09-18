const test = require('node:test');
const assert = require('node:assert/strict');
const Results = require('../results-core');

const XAU_PAYLOAD = {
  ok: true,
  symbol: 'XAUUSD',
  mode: 'NORMAL',
  generatedAt: 1_800_000_010_000,
  summary: {
    sample: 5,
    resolved: 4,
    wins: 3,
    losses: 1,
    ambiguous: 1,
    winRate: 75,
    maturity: 'EARLY',
    byOutcome: { TP1: 1, PROTECTED_WIN: 1, TP1_MANAGED: 1, SL: 1, AMBIGUOUS: 1 },
    recent: [
      { id: 'x5', symbol: 'XAUUSD', mode: 'NORMAL', side: 'BUY', outcome: 'AMBIGUOUS', state: 'CLOSED', entry: 2500, openedAt: 5000, resolvedAt: 6000 },
      { id: 'x4', symbol: 'XAUUSD', mode: 'NORMAL', side: 'SELL', outcome: 'SL', state: 'CLOSED', entry: 2501, openedAt: 4000, resolvedAt: 5000 },
      { id: 'x3', symbol: 'XAUUSD', mode: 'NORMAL', side: 'BUY', outcome: 'TP1_MANAGED', state: 'CLOSED', entry: 2499, openedAt: 3000, resolvedAt: 4000, hitTp1: true, slLockStage: 1 },
      { id: 'x2', symbol: 'XAUUSD', mode: 'NORMAL', side: 'BUY', outcome: 'PROTECTED_WIN', state: 'CLOSED', entry: 2498, openedAt: 2000, resolvedAt: 3000, hitTp1: true, slLockStage: 1 },
      { id: 'x1', symbol: 'XAUUSD', mode: 'NORMAL', side: 'BUY', outcome: 'TP1', state: 'CLOSED', entry: 2497, openedAt: 1000, resolvedAt: 2000 }
    ],
    open: [
      { id: 'xo', symbol: 'XAUUSD', mode: 'NORMAL', side: 'SELL', state: 'OPEN', entry: 2502, openedAt: 7000, score: 88 }
    ]
  }
};

const EUR_PAYLOAD = {
  ok: true,
  symbol: 'EURUSD',
  mode: 'NORMAL',
  generatedAt: 1_800_000_020_000,
  summary: {
    sample: 2,
    resolved: 2,
    wins: 1,
    losses: 0,
    ambiguous: 0,
    winRate: 50,
    maturity: 'EARLY',
    byOutcome: { TP2: 1, TIMEOUT: 1 },
    recent: [
      { id: 'e2', symbol: 'EURUSD', mode: 'NORMAL', side: 'SELL', outcome: 'TIMEOUT', state: 'CLOSED', entry: 1.1, openedAt: 8000, resolvedAt: 9000 },
      { id: 'e1', symbol: 'EURUSD', mode: 'NORMAL', side: 'BUY', outcome: 'TP2', state: 'CLOSED', entry: 1.09, openedAt: 7000, resolvedAt: 8000, hitTp1: true, hitTp2: true, slLockStage: 2 }
    ],
    open: []
  }
};

test('result core uses the exact 11 ZenCore markets', () => {
  assert.deepEqual(Results.SUPPORTED_MARKETS, [
    'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'US30', 'USDCAD',
    'USDCHF', 'EURJPY', 'GBPJPY', 'EURGBP', 'BTCUSD'
  ]);
});

test('outcome classification follows backend validation semantics', () => {
  assert.deepEqual(Results.outcomeMeta('SL').key, 'loss');
  assert.equal(Results.outcomeMeta('TP2').isWin, true);
  assert.deepEqual(Results.outcomeMeta('TP2_PROTECTED'), {
    key: 'protected', label: 'TP2 PROTECTED', tone: 'protected', isWin: true, isLoss: false
  });
  assert.equal(Results.outcomeMeta('TP1_MANAGED').isWin, true);
  assert.equal(Results.outcomeMeta('MANAGED_EXIT').isWin, false);
  assert.deepEqual(Results.outcomeMeta('anything', 'OPEN').key, 'open');
});

test('aggregation preserves server totals and separates visible history', () => {
  const data = Results.aggregatePerformance([XAU_PAYLOAD, EUR_PAYLOAD]);
  assert.deepEqual(data.summary, {
    sample: 7,
    resolved: 6,
    wins: 4,
    losses: 1,
    ambiguous: 1,
    open: 1,
    protected: 1,
    managed: 1,
    available: 2,
    winRate: 66.7,
    visibleResolved: 7,
    expected: 11
  });
  assert.equal(data.generatedAt, EUR_PAYLOAD.generatedAt);
  assert.equal(data.pairSummaries.length, 11);
  assert.equal(data.pairSummaries.find(row => row.symbol === 'GBPUSD').available, false);
  assert.deepEqual(data.resolvedRows.map(row => row.id), ['e2', 'e1', 'x5', 'x4', 'x3', 'x2', 'x1']);
  assert.deepEqual(data.openRows.map(row => row.id), ['xo']);
});

test('filters combine pair, side and result category', () => {
  const data = Results.aggregatePerformance([XAU_PAYLOAD, EUR_PAYLOAD]);
  assert.deepEqual(Results.filterRows(data.allRows, { category: 'open' }).map(row => row.id), ['xo']);
  assert.deepEqual(Results.filterRows(data.allRows, { category: 'loss' }).map(row => row.id), ['x4']);
  assert.deepEqual(Results.filterRows(data.allRows, { category: 'protected' }).map(row => row.id), ['x2']);
  assert.deepEqual(Results.filterRows(data.allRows, { category: 'managed' }).map(row => row.id), ['x3']);
  assert.deepEqual(
    Results.filterRows(data.allRows, { category: 'win', pair: 'EURUSD', side: 'BUY' }).map(row => row.id),
    ['e1']
  );
});

test('price helpers are pair-aware and CSV export is spreadsheet-safe', () => {
  assert.equal(Results.formatPrice(150.12345, 'USDJPY'), '150.123');
  assert.equal(Results.formatPrice(65000.5, 'BTCUSD'), '65,000.50');
  const row = Results.normaliseRow({
    id: 'csv', symbol: 'EURUSD', mode: 'NORMAL', side: 'BUY', state: 'CLOSED', outcome: 'TP1',
    entry: 1.1, openedAt: 1000, resolvedAt: 2000, reason: '=HYPERLINK("bad")'
  });
  const csv = Results.buildCsv([row]);
  assert.ok(csv.startsWith('\uFEFF"State"'));
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
});
