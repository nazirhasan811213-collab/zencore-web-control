(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZenCoreAutoTrade = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SUPPORTED_MARKETS = [
    'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'US30', 'USDCAD',
    'USDCHF', 'EURJPY', 'GBPJPY', 'EURGBP', 'BTCUSD'
  ];
  const CONTROL_STATES = [
    'UNPROVISIONED', 'STOPPED', 'ARMING', 'ON', 'STOPPING',
    'EMERGENCY_CLOSING', 'ERROR'
  ];
  const COMMAND_TYPES = [
    'SYSTEM_ON', 'SYSTEM_STOP', 'EMERGENCY_CLOSE_ALL', 'PLACE_SETUP', 'MANAGE_POSITION'
  ];
  const FORBIDDEN_CREDENTIAL_KEYS = new Set([
    'password', 'pass', 'passwd', 'login', 'accountid', 'account_id',
    'server', 'servername', 'server_name', 'fullserver', 'full_server',
    'credential', 'credentials', 'credentialciphertext', 'secret',
    'brokerpassword', 'broker_password'
  ]);

  const number = value => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normaliseSymbol(value) {
    return String(value || '').toUpperCase().replace(/^.*:/, '').replace(/[^A-Z0-9._-]/g, '');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function validateSettings(input = {}) {
    const capitalUsd = number(input.capitalUsd);
    const lotPerLayer = number(input.lotPerLayer);
    const layers = Number(input.layers);
    const symbols = [...new Set((Array.isArray(input.symbols) ? input.symbols : ['XAUUSD'])
      .map(normaliseSymbol).filter(symbol => SUPPORTED_MARKETS.includes(symbol)))];
    const errors = {};

    if (capitalUsd === null || capitalUsd < 10 || capitalUsd > 100_000_000) {
      errors.capitalUsd = 'Modal mesti antara USD10 hingga USD100,000,000.';
    }
    if (lotPerLayer === null || lotPerLayer <= 0 || lotPerLayer > 100) {
      errors.lotPerLayer = 'Lot setiap layer mesti lebih 0 dan tidak melebihi 100.';
    }
    if (!Number.isInteger(layers) || layers < 1 || layers > 10) {
      errors.layers = 'Pilih antara 1 hingga 10 layer.';
    }
    if (!symbols.length) errors.symbols = 'Pilih sekurang-kurangnya satu pair.';

    return {
      ok: Object.keys(errors).length === 0,
      errors,
      value: {
        capitalUsd: capitalUsd === null ? null : round(capitalUsd),
        lotPerLayer: lotPerLayer === null ? null : round(lotPerLayer, 5),
        layers,
        symbols,
        totalLot: lotPerLayer === null || !Number.isInteger(layers)
          ? null : round(lotPerLayer * layers, 5)
      }
    };
  }

  function calculateRisk(input = {}) {
    const settings = validateSettings(input);
    const entry = number(input.entry);
    const sl = number(input.sl);
    const tickSize = number(input.tickSize);
    const tickValue = number(input.tickValue);
    const costBufferPct = clamp(number(input.costBufferPct) ?? 10, 0, 100);
    const pending = {
      available: false,
      level: 'PENDING',
      riskUsd: null,
      riskPercent: null,
      totalLot: settings.value.totalLot,
      blocksOrder: false,
      message: 'Menunggu Entry, SL dan spesifikasi broker untuk kira risiko sebenar.'
    };
    if (!settings.ok || [entry, sl, tickSize, tickValue].some(value => value === null) ||
        tickSize <= 0 || tickValue <= 0 || entry === sl) return pending;

    const ticksToSl = Math.abs(entry - sl) / tickSize;
    const rawRisk = ticksToSl * tickValue * settings.value.totalLot;
    const riskUsd = rawRisk * (1 + costBufferPct / 100);
    const riskPercent = riskUsd / settings.value.capitalUsd * 100;
    let level = 'NORMAL';
    let message = 'Risiko dalam zon biasa.';
    if (riskPercent > 2) {
      level = 'HIGH';
      message = 'Risiko tinggi. Semak semula lot dan layer sebelum confirm.';
    } else if (riskPercent > 1) {
      level = 'CAUTION';
      message = 'Risiko melebihi 1%. Pastikan saiz ini memang disengajakan.';
    }
    return {
      available: true,
      level,
      riskUsd: round(riskUsd),
      riskPercent: round(riskPercent),
      totalLot: settings.value.totalLot,
      ticksToSl: round(ticksToSl),
      costBufferPct,
      blocksOrder: false,
      message
    };
  }

  function containsForbiddenCredentialKey(value) {
    if (!value || typeof value !== 'object') return false;
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_CREDENTIAL_KEYS.has(String(key).toLowerCase())) return true;
      if (child && typeof child === 'object' && containsForbiddenCredentialKey(child)) return true;
    }
    return false;
  }

  function validateMaskedIdentity(input = {}) {
    const accountMask = String(input.accountMask || '');
    const serverMask = String(input.serverMask || '');
    const brokerMask = String(input.brokerMask || '');
    const errors = {};
    if (!/^\*{4}[A-Za-z0-9]{2,6}$/.test(accountMask)) errors.accountMask = 'Account mask tidak sah.';
    if (!/^\*{4}[A-Za-z0-9._-]{2,12}$/.test(serverMask)) errors.serverMask = 'Server mesti dihantar dalam bentuk masked.';
    if (brokerMask && !/^\*{4}[A-Za-z0-9 ._-]{2,16}$/.test(brokerMask)) errors.brokerMask = 'Broker mesti dihantar dalam bentuk masked.';
    return {
      ok: Object.keys(errors).length === 0,
      errors,
      value: { accountMask, serverMask, brokerMask: brokerMask || '****MT5' }
    };
  }

  function sanitiseSymbolSpecs(input) {
    const specs = {};
    for (const raw of Array.isArray(input) ? input : []) {
      const symbol = normaliseSymbol(raw?.symbol);
      if (!SUPPORTED_MARKETS.includes(symbol)) continue;
      const tickSize = number(raw.tickSize);
      const tickValue = number(raw.tickValue);
      const volumeMin = number(raw.volumeMin);
      const volumeMax = number(raw.volumeMax);
      const volumeStep = number(raw.volumeStep);
      if ([tickSize, tickValue, volumeMin, volumeMax, volumeStep]
        .some(value => value === null || value <= 0)) continue;
      specs[symbol] = { tickSize, tickValue, volumeMin, volumeMax, volumeStep };
    }
    return specs;
  }

  function sanitisePosition(raw = {}) {
    const ticket = String(raw.ticket || '').replace(/[^0-9]/g, '').slice(0, 32);
    const symbol = normaliseSymbol(raw.symbol);
    const side = String(raw.side || '').toUpperCase();
    if (!ticket || !SUPPORTED_MARKETS.includes(symbol) || !['BUY', 'SELL'].includes(side)) return null;
    const numeric = key => {
      const value = number(raw[key]);
      return value === null ? null : value;
    };
    const volume = numeric('volume');
    if (volume === null || volume <= 0 || volume > 1000) return null;
    const stage = String(raw.exitStage || 'HOLD').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
    const lock = String(raw.slLock || 'INITIAL').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
    return {
      ticket,
      symbol,
      side,
      volume,
      layers: clamp(Math.trunc(number(raw.layers) || 1), 1, 10),
      entry: numeric('entry'),
      currentPrice: numeric('currentPrice'),
      initialSl: numeric('initialSl'),
      activeSl: numeric('activeSl'),
      tp1: numeric('tp1'),
      tp2: numeric('tp2'),
      tp3: numeric('tp3'),
      profitUsd: numeric('profitUsd'),
      openedAt: Math.max(0, Math.trunc(number(raw.openedAt) || 0)),
      exitStage: stage || 'HOLD',
      slLock: lock || 'INITIAL'
    };
  }

  function normaliseHeartbeat(input = {}) {
    if (containsForbiddenCredentialKey(input)) {
      return { ok: false, errors: { credential: 'Credential broker tidak dibenarkan masuk ke ZenCore Control Plane.' } };
    }
    const identity = validateMaskedIdentity(input);
    const tradeMode = String(input.tradeMode || '').toUpperCase();
    const errors = { ...identity.errors };
    if (tradeMode !== 'DEMO') errors.tradeMode = 'Versi pertama hanya menerima akaun DEMO.';
    const positions = (Array.isArray(input.positions) ? input.positions : [])
      .map(sanitisePosition).filter(Boolean).slice(0, 50);
    return {
      ok: Object.keys(errors).length === 0,
      errors,
      value: {
        ...identity.value,
        tradeMode,
        terminalTradeAllowed: input.terminalTradeAllowed === true,
        accountTradeAllowed: input.accountTradeAllowed === true,
        expertTradeAllowed: input.expertTradeAllowed === true,
        symbolSpecs: sanitiseSymbolSpecs(input.symbolSpecs),
        positions,
        connectorVersion: String(input.connectorVersion || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32),
        terminalBuild: String(input.terminalBuild || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 24)
      }
    };
  }

  function podConnectionState(pod, now = Date.now()) {
    if (!pod) return { state: 'UNPROVISIONED', label: 'SECURE POD BELUM DISEDIAKAN', online: false, ready: false };
    const lastSeen = number(pod.lastSeenAt);
    const online = lastSeen !== null && now - lastSeen <= 30_000;
    if (!online) return { state: 'OFFLINE', label: 'SECURE POD OFFLINE', online: false, ready: false };
    if (String(pod.tradeMode).toUpperCase() !== 'DEMO') return { state: 'BLOCKED_REAL', label: 'REAL ACCOUNT DIKUNCI', online: true, ready: false };
    if (!pod.terminalTradeAllowed || !pod.accountTradeAllowed || !pod.expertTradeAllowed) {
      return { state: 'CHECK_MT5', label: 'SEMAK ALGO TRADING', online: true, ready: false };
    }
    return { state: 'READY', label: 'MT5 SECURE POD READY', online: true, ready: true };
  }

  function makeSignalKey(market = {}) {
    const normal = market.strategyNormal || {};
    const plan = normal.plan || {};
    const symbol = normaliseSymbol(market.symbol);
    const side = String(normal.side || plan.side || '').toUpperCase();
    const entry = number(plan.entry);
    const receivedAt = Math.trunc(number(market.receivedAt) || 0);
    if (!SUPPORTED_MARKETS.includes(symbol) || !['BUY', 'SELL'].includes(side) || entry === null) return null;
    return [symbol, side, entry, receivedAt].join('|');
  }

  function buildSetupCommand(market = {}, settings = {}, symbolSpec = null) {
    const validation = validateSettings(settings);
    const normal = market.strategyNormal || {};
    const plan = normal.plan || {};
    const signalKey = makeSignalKey(market);
    if (!validation.ok || !signalKey || String(normal.state || '').toUpperCase() !== 'READY') return null;
    const symbol = normaliseSymbol(market.symbol);
    if (!validation.value.symbols.includes(symbol)) return null;
    const risk = calculateRisk({
      ...validation.value,
      entry: plan.entry,
      sl: plan.sl,
      tickSize: symbolSpec?.tickSize,
      tickValue: symbolSpec?.tickValue
    });
    return {
      signalKey,
      payload: {
        schemaVersion: '32.3-EXIT-STEPLOCK',
        strategy: 'NORMAL_3M_SOP_V32',
        symbol,
        side: String(normal.side || plan.side).toUpperCase(),
        entry: number(plan.entry),
        sl: number(plan.sl),
        tp1: number(plan.tp1),
        tp2: number(plan.tp2),
        tp3: number(plan.tp3),
        lotPerLayer: validation.value.lotPerLayer,
        layers: validation.value.layers,
        totalLot: validation.value.totalLot,
        risk,
        signalReceivedAt: Math.trunc(number(market.receivedAt) || Date.now())
      }
    };
  }

  function buildManagementCommand(market = {}) {
    const symbol = normaliseSymbol(market.symbol);
    const management = market.positionManagement || {};
    if (!SUPPORTED_MARKETS.includes(symbol)) return null;
    const actions = [];
    const slMoveAction = String(management.slMoveAction || 'NONE').toUpperCase();
    if (management.slMoveTriggered === true && ['MOVE_SL_ENTRY', 'MOVE_SL_TP1', 'MOVE_SL_TP2'].includes(slMoveAction)) {
      const activeSl = number(management.activeSl);
      if (activeSl !== null) actions.push({ type: slMoveAction, activeSl, lockLabel: String(management.slLockLabel || 'PROTECTED').slice(0, 32) });
    }
    const exitAction = String(management.action || 'IDLE').toUpperCase();
    if (exitAction === 'CLOSE_50_NOW') actions.push({ type: 'CLOSE_PERCENT', percent: 50, reason: 'CLOSE_SEPARUH' });
    if (['EXIT_REMAINING', 'EXIT_ALL', 'EXIT_SL'].includes(exitAction)) {
      actions.push({ type: 'CLOSE_PERCENT', percent: 100, reason: exitAction });
    }
    if (!actions.length) return null;
    const receivedAt = Math.trunc(number(market.receivedAt) || 0);
    const actionKey = actions.map(action => `${action.type}:${action.activeSl ?? action.percent ?? ''}:${action.reason || ''}`).join(',');
    return {
      managementKey: [symbol, receivedAt, actionKey].join('|'),
      payload: {
        schemaVersion: '32.3-EXIT-STEPLOCK',
        strategy: 'NORMAL_3M_SOP_V32',
        symbol,
        actions,
        reason: String(management.reason || '').slice(0, 180),
        signalReceivedAt: receivedAt || Date.now()
      }
    };
  }

  return {
    SUPPORTED_MARKETS,
    CONTROL_STATES,
    COMMAND_TYPES,
    FORBIDDEN_CREDENTIAL_KEYS,
    number,
    normaliseSymbol,
    escapeHtml,
    validateSettings,
    calculateRisk,
    containsForbiddenCredentialKey,
    validateMaskedIdentity,
    sanitisePosition,
    normaliseHeartbeat,
    podConnectionState,
    makeSignalKey,
    buildSetupCommand,
    buildManagementCommand
  };
});
