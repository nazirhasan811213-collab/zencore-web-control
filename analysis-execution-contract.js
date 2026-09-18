(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZenCoreAnalysisExecutionContract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONTRACT_VERSION = 'ZENCORE_ANALYSIS_EXECUTION_V1';
  const SCHEMA_VERSION = '32.3-EXIT-STEPLOCK';
  const STRATEGY = 'NORMAL_3M_SOP_V32';
  const SUPPORTED_MARKETS = Object.freeze([
    'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'US30', 'USDCAD',
    'USDCHF', 'EURJPY', 'GBPJPY', 'EURGBP', 'BTCUSD'
  ]);

  const number = value => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  function normaliseSymbol(value) {
    return String(value || '').toUpperCase().replace(/^.*:/, '').replace(/[^A-Z0-9._-]/g, '');
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
  }

  function sourceTime(market) {
    const receivedAt = Math.trunc(number(market?.receivedAt) || 0);
    return receivedAt > 0 ? receivedAt : null;
  }

  // This boundary does not calculate indicators, scores, candle gates, Entry Line
  // touch, TP or SL. READY is an authorization already made by ZenCore Analysis.
  function createEntryDecision(market = {}) {
    const normal = market.strategyNormal || {};
    const plan = normal.plan || {};
    const symbol = normaliseSymbol(market.symbol);
    const side = String(normal.side || plan.side || '').toUpperCase();
    const receivedAt = sourceTime(market);
    const prices = {
      entry: number(plan.entry),
      sl: number(plan.sl),
      tp1: number(plan.tp1),
      tp2: number(plan.tp2),
      tp3: number(plan.tp3)
    };
    if (!SUPPORTED_MARKETS.includes(symbol) || String(normal.state || '').toUpperCase() !== 'READY' ||
        !['BUY', 'SELL'].includes(side) || !receivedAt || Object.values(prices).some(value => value === null)) {
      return null;
    }
    const snapshot = {
      contractVersion: CONTRACT_VERSION,
      decision: 'ENTRY_AUTHORIZED',
      decisionOwner: 'ZENCORE_ANALYSIS',
      strategy: STRATEGY,
      schemaVersion: SCHEMA_VERSION,
      symbol,
      side,
      ...prices,
      sourceReceivedAt: receivedAt
    };
    return deepFreeze({
      signalKey: [CONTRACT_VERSION, symbol, side, prices.entry, receivedAt].join('|'),
      snapshot
    });
  }

  // Position actions are copied from Analysis' positionManagement result. The
  // execution layer is deliberately unable to infer a TP hit or reversal itself.
  function createManagementDecision(market = {}) {
    const symbol = normaliseSymbol(market.symbol);
    const management = market.positionManagement || {};
    const receivedAt = sourceTime(market);
    if (!SUPPORTED_MARKETS.includes(symbol) || !receivedAt) return null;

    const actions = [];
    const slMoveAction = String(management.slMoveAction || 'NONE').toUpperCase();
    if (management.slMoveTriggered === true &&
        ['MOVE_SL_ENTRY', 'MOVE_SL_TP1', 'MOVE_SL_TP2'].includes(slMoveAction)) {
      const activeSl = number(management.activeSl);
      if (activeSl !== null) {
        actions.push({
          type: slMoveAction,
          activeSl,
          lockLabel: String(management.slLockLabel || 'PROTECTED').slice(0, 32)
        });
      }
    }

    const exitAction = String(management.action || 'IDLE').toUpperCase();
    if (exitAction === 'CLOSE_50_NOW') {
      actions.push({ type: 'CLOSE_PERCENT', percent: 50, reason: 'CLOSE_SEPARUH' });
    }
    if (['EXIT_REMAINING', 'EXIT_ALL', 'EXIT_SL'].includes(exitAction)) {
      actions.push({ type: 'CLOSE_PERCENT', percent: 100, reason: exitAction });
    }
    if (!actions.length) return null;

    const actionKey = actions
      .map(action => `${action.type}:${action.activeSl ?? action.percent ?? ''}:${action.reason || ''}`)
      .join(',');
    return deepFreeze({
      managementKey: [CONTRACT_VERSION, symbol, receivedAt, actionKey].join('|'),
      snapshot: {
        contractVersion: CONTRACT_VERSION,
        decision: 'POSITION_ACTION_AUTHORIZED',
        decisionOwner: 'ZENCORE_ANALYSIS',
        strategy: STRATEGY,
        schemaVersion: SCHEMA_VERSION,
        symbol,
        actions,
        reason: String(management.reason || '').slice(0, 180),
        sourceReceivedAt: receivedAt
      }
    });
  }

  return {
    CONTRACT_VERSION,
    SCHEMA_VERSION,
    STRATEGY,
    SUPPORTED_MARKETS,
    number,
    normaliseSymbol,
    createEntryDecision,
    createManagementDecision
  };
});
