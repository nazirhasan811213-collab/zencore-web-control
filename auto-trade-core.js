(function (root, factory) {
  const contract = typeof module === 'object' && module.exports
    ? require('./analysis-execution-contract')
    : root.ZenCoreAnalysisExecutionContract;
  const api = factory(contract);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZenCoreAutoTrade = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Contract) {
  'use strict';

  if (!Contract) throw new Error('ZenCore Analysis Execution Contract is required.');

  const SUPPORTED_MARKETS = [...Contract.SUPPORTED_MARKETS];
  const CONTROL_STATES = [
    'UNPROVISIONED', 'STOPPED', 'ARMING', 'ON', 'STOPPING',
    'EMERGENCY_CLOSING', 'ERROR'
  ];
  const COMMAND_TYPES = [
    'MANUAL_EXIT_CONFIG', 'MANUAL_EXIT_ACTION', 'SYSTEM_ON', 'SYSTEM_STOP', 'EMERGENCY_CLOSE_ALL', 'PLACE_SETUP', 'MANAGE_POSITION'
  ];
  const POD_OWNERSHIP_MODES = [
    'TRADER_OWNED_WINDOWS_PC', 'TRADER_OWNED_AZURE', 'TRADER_OWNED_EA_LOCAL'
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

  function decimalPlaces(value) {
    const text = String(value);
    if (text.includes('e-')) return Number(text.split('e-')[1]) || 0;
    return (text.split('.')[1] || '').length;
  }

  function floorToStep(value, step) {
    const digits = Math.min(8, decimalPlaces(step));
    const units = Math.floor((value + Number.EPSILON) / step);
    return round(units * step, digits);
  }

  const STRATEGY_MODES = Object.freeze(['TF2_SCALPING', 'TF15_INTRA', 'BOTH']);

  const TRADE_SYMBOLS=Object.freeze(['XAUUSD']);
  function malaysiaTradingSchedule(enabled = true, skipNews = enabled) {
    return {enabled: enabled === true, skipNews: skipNews === true, timeZone: 'Asia/Kuala_Lumpur',
      start: '07:00', end: '03:00', newsPauseMinutes: 30,
      newsTimes: ['20:30', '21:30', '22:00', '02:00']};
  }

  function tradingWindow(schedule, at = Date.now()) {
    const sessionEnabled = schedule?.enabled === true;
    const skipNews = schedule?.skipNews ?? sessionEnabled;
    if (!sessionEnabled && !skipNews) return {allowed:true, reason:'SCHEDULE_DISABLED', validUntil:null};
    if (!Number.isFinite(at) || !Number.isFinite(new Date(at).getTime())) return {allowed:false, reason:'INVALID_CLOCK', validUntil:null};
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at));
    const part=type=>Number(parts.find(p=>p.type===type).value);
    const minute=part('hour')*60+part('minute');
    if (sessionEnabled && minute>=180 && minute<420) return {allowed:false,reason:'OUTSIDE_SESSION',validUntil:null};
    const newsStarts=skipNews ? [1230,1290,1320,120] : [];
    if (newsStarts.some(start=>minute>=start && minute<start+30))
      return {allowed:false,reason:'NEWS_PAUSE',validUntil:null};
    const untilMinutes=Math.min(...[...(sessionEnabled ? [180] : []),...newsStarts].map(stop=>(stop-minute+1440)%1440));
    const validUntil=at+(untilMinutes*60-part('second'))*1000-new Date(at).getUTCMilliseconds();
    return {allowed:true,reason:'SESSION_OPEN',validUntil};
  }

  function effectiveSettings(input = {}, symbol = 'XAUUSD') {
    const mode = input.strategyMode || 'TF2_SCALPING';
    const group = normaliseSymbol(symbol) === 'XAUUSD' ? 'gold' : 'fx';
    const asset = input.modeSettings?.[mode]?.[group] || {};
    const enabled = asset.enabled !== false;
    const lotPerLayer = enabled ? number(asset.lotPerLayer ?? input.lotPerLayer) : null;
    const layers = enabled ? Number(asset.layers ?? (mode === 'TF15_INTRA' ? 2 : input.layers)) : 0;
    return { ...input, enabled, lotPerLayer, layers,
      totalLot: lotPerLayer === null ? null : round(lotPerLayer * layers, 5),
      assetGroup: group, strategyMode: mode,
      exitPolicy: input.strategyExitPolicies?.[mode] || null };
  }

  function validateSettings(input = {}) {
    const capitalUsd = number(input.capitalUsd);
    const lotPerLayer = number(input.lotPerLayer);
    const layers = Number(input.layers);
    const symbols = [...new Set((Array.isArray(input.symbols) ? input.symbols : ['XAUUSD'])
      .map(normaliseSymbol).filter(symbol => TRADE_SYMBOLS.includes(symbol)))];
    const errors = {};
    if (input.tradingSchedule != null && (typeof input.tradingSchedule !== 'object' || typeof input.tradingSchedule.enabled !== 'boolean')) errors.tradingSchedule = 'Status jadual trade mesti ON atau OFF.';
    if (input.tradingSchedule?.skipNews != null && typeof input.tradingSchedule.skipNews !== 'boolean') errors.tradingSchedule = 'Pilihan news mesti trade atau skip.';
    const tradingSchedule=malaysiaTradingSchedule(input.tradingSchedule?.enabled === true, input.tradingSchedule?.skipNews ?? (input.tradingSchedule?.enabled === true));
    const strategyMode = input.strategyMode || 'TF2_SCALPING';
    if (!STRATEGY_MODES.includes(strategyMode)) errors.strategyMode = 'Pilih TF2 Scalping, TF15 Intra atau Both.';
    const manualExit={version:'MANUAL_TF2_EXIT_V1',enabled:input.manualExit?.enabled===true,timeframeMinutes:2};
    for(const key of ['tp1','tp2','tp3','sl'])manualExit[key]=number(input.manualExit?.[key]);
    if(manualExit.enabled && (['tp1','tp2','tp3','sl'].some(k=>manualExit[k]===null||manualExit[k]<=0||manualExit[k]>1000) || !(manualExit.tp1<manualExit.tp2&&manualExit.tp2<manualExit.tp3)))errors.manualExit='Isi jarak harga TP1 < TP2 < TP3 dan SL, lebih 0 hingga 1000.';
    const strategyExitPolicies = {
      ...(input.strategyExitPolicies || {}),
      TF2_SCALPING: { version: 'TF2_TIGHT_SL_3C_V1', timeframeMinutes: 2,
        slDistanceFactor: .8, maxCompletedCandlesWithoutTp1: 3,
        tp1Rule: 'EVER_TOUCHED', closeScope: 'SETUP_ONLY',
        executionStatus: 'REQUIRES_EA_1_1' }
    };
    const modeSettings = {};
    for (const mode of ['TF2_SCALPING','TF15_INTRA']) {
      modeSettings[mode] = {};
      for (const group of ['gold', 'fx']) {
        const raw = input.modeSettings?.[mode]?.[group] || {};
        if (raw.enabled === false || ['lotPerLayer','layers'].some(key=>Object.hasOwn(raw,key)&&(raw[key]===null||raw[key]===''))) { modeSettings[mode][group] = {enabled:false,lotPerLayer:null,layers:null}; continue; }
        const lot = number(Object.hasOwn(raw,'lotPerLayer') ? raw.lotPerLayer : input.lotPerLayer);
        const count = Number(Object.hasOwn(raw,'layers') ? raw.layers : mode === 'TF15_INTRA' ? 2 : input.layers);
        if (lot === null || lot <= 0 || lot > 100) errors[mode + '.' + group + '.lotPerLayer'] = 'Lot Gold dan currency mesti lebih 0 hingga 100.';
        if (!Number.isInteger(count) || count < 1 || count > 10) errors[mode + '.' + group + '.layers'] = 'Layer mesti antara 1 hingga 10.';
        modeSettings[mode][group] = {...(Object.hasOwn(raw,'enabled')?{enabled:true}:{}),lotPerLayer: lot === null ? null : round(lot, 5), layers: count};
      }
    }

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
        strategyMode, modeSettings, tradingSchedule, strategyExitPolicies, manualExit,
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

  function recommendPositionSizes(input = {}) {
    const capitalUsd = number(input.capitalUsd);
    const entry = number(input.entry);
    const sl = number(input.sl);
    const tickSize = number(input.tickSize);
    const tickValue = number(input.tickValue);
    const volumeMin = number(input.volumeMin);
    const volumeMax = number(input.volumeMax);
    const volumeStep = number(input.volumeStep);
    const targetRiskPercent = clamp(number(input.targetRiskPercent) ?? 1, 0.1, 5);
    const costBufferPct = clamp(number(input.costBufferPct) ?? 10, 0, 100);
    const pending = {
      available: false,
      targetRiskPercent,
      options: [],
      recommended: null,
      message: 'Menunggu active plan dan spesifikasi volume broker.'
    };
    if ([capitalUsd, entry, sl, tickSize, tickValue, volumeMin, volumeMax, volumeStep]
      .some(value => value === null || value <= 0) || entry === sl) return pending;

    const riskPerLot = (Math.abs(entry - sl) / tickSize) * tickValue * (1 + costBufferPct / 100);
    if (!Number.isFinite(riskPerLot) || riskPerLot <= 0) return pending;
    const targetRiskUsd = capitalUsd * targetRiskPercent / 100;
    const maxTotalLot = Math.min(volumeMax * 10, targetRiskUsd / riskPerLot);
    const requestedLayers = clamp(Math.trunc(number(input.preferredLayers) || 3), 1, 10);
    const layerCandidates = [...new Set([requestedLayers, 3, 2, 1])]
      .filter(layers => layers >= 1 && layers <= 10);
    const options = layerCandidates.map(layers => {
      const lotPerLayer = floorToStep(Math.min(volumeMax, maxTotalLot / layers), volumeStep);
      if (lotPerLayer < volumeMin) return null;
      const totalLot = round(lotPerLayer * layers, 5);
      const riskUsd = riskPerLot * totalLot;
      return {
        layers,
        lotPerLayer,
        totalLot,
        estimatedRiskUsd: round(riskUsd),
        estimatedRiskPercent: round(riskUsd / capitalUsd * 100),
        targetRiskPercent
      };
    }).filter(Boolean);
    return {
      available: options.length > 0,
      targetRiskPercent,
      options,
      recommended: options[0] || null,
      message: options.length
        ? `Cadangan dikira pada sasaran risiko ${targetRiskPercent}% termasuk buffer kos ${costBufferPct}%.`
        : `Lot minimum broker melebihi sasaran risiko ${targetRiskPercent}% untuk modal dan SL ini.`
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
      origin:raw.origin==='MANUAL'?'MANUAL':'ZENCORE',
      positionId:String(raw.positionId||ticket).replace(/[^0-9]/g,'').slice(0,20),
      strategyMode: raw.strategyMode==='TF15_INTRA'?'TF15_INTRA':'TF2_SCALPING',
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
    if (!['DEMO', 'REAL'].includes(tradeMode)) errors.tradeMode = 'Jenis akaun MT5 mesti DEMO atau REAL.';
    const accountFingerprint = input.accountFingerprint == null ? null : String(input.accountFingerprint);
    if (accountFingerprint !== null && !/^[a-f0-9]{64}$/.test(accountFingerprint)) errors.accountFingerprint = 'Account binding tidak sah.';
    if (input.connectorVersion === '1.4.0-ea-local' && !accountFingerprint) errors.accountFingerprint = 'Account binding diperlukan.';
    const positions = (Array.isArray(input.positions) ? input.positions : [])
      .map(sanitisePosition).filter(Boolean).slice(0, 50);
    return {
      ok: Object.keys(errors).length === 0,
      errors,
      value: {
        ...identity.value,
        accountFingerprint,
        manualExitVersion:input.manualExitVersion==='MANUAL_TF2_EXIT_V1'?'MANUAL_TF2_EXIT_V1':null,
        manualExitEnabled:input.manualExitVersion==='MANUAL_TF2_EXIT_V1'&&input.manualExitEnabled===true,
        tradeMode,
        terminalTradeAllowed: input.terminalTradeAllowed === true,
        accountTradeAllowed: input.accountTradeAllowed === true,
        expertTradeAllowed: input.expertTradeAllowed === true,
        demoExecutionUnlocked: input.demoExecutionUnlocked === true,
        symbolSpecs: sanitiseSymbolSpecs(input.symbolSpecs),
        positions,
        connectorVersion: String(input.connectorVersion || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32),
        terminalBuild: String(input.terminalBuild || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 24)
      }
    };
  }

  function podConnectionState(pod, now = Date.now(), requirements = {}) {
    if (!pod) return { state: 'UNPROVISIONED', label: 'SECURE POD BELUM DISEDIAKAN', online: false, connected: false, ready: false };
    const lastSeen = number(pod.lastSeenAt);
    const online = lastSeen !== null && now - lastSeen <= 30_000;
    if (!online) return { state: 'OFFLINE', label: 'SECURE POD OFFLINE', online: false, connected: false, ready: false };
    const tradeMode = String(pod.tradeMode).toUpperCase();
    if (!['DEMO', 'REAL'].includes(tradeMode) || (tradeMode === 'REAL' && requirements.realAccountAllowed !== true)) return { state: 'BLOCKED_REAL', label: 'REAL memerlukan EA/Connector terbaru', online: true, connected: true, ready: false };
    if (!pod.terminalTradeAllowed || !pod.accountTradeAllowed || !pod.expertTradeAllowed) {
      return { state: 'CHECK_MT5', label: 'SEMAK ALGO TRADING', online: true, connected: true, ready: false };
    }
    if (pod.demoExecutionUnlocked !== true) {
      return {
        state: 'CONNECTED_LOCKED',
        label: 'CONNECTED • EXECUTION LOCKED',
        online: true,
        connected: true,
        ready: false
      };
    }
    const requiredConnectorVersion = String(requirements.connectorVersion || '');
    if (requiredConnectorVersion && String(pod.connectorVersion || '') !== requiredConnectorVersion) {
      return {
        state: 'UPDATE_REQUIRED',
        label: 'SECURE POD PERLU DIKEMAS KINI',
        online: true,
        connected: true,
        ready: false
      };
    }
    const allowedOwnershipModes = Array.isArray(requirements.ownershipModes)
      ? requirements.ownershipModes : [];
    if (allowedOwnershipModes.length && !allowedOwnershipModes.includes(String(pod.ownershipMode || ''))) {
      return {
        state: 'HOST_BLOCKED',
        label: 'HOST EXECUTION TIDAK DIBENARKAN',
        online: true,
        connected: true,
        ready: false
      };
    }
    return { state: 'READY', label: 'MT5 SECURE POD READY', online: true, connected: true, ready: true };
  }

  function makeSignalKey(market = {}) {
    return Contract.createEntryDecision(market)?.signalKey || null;
  }

  function permitsPositionEntry(market = {}, positions = []) {
    const symbol=normaliseSymbol(market.symbol);
    const tf=String(market.timeframe||market.strategyNormal?.tf||'').replace(/m$/, '');
    const mode=tf==='15'?'TF15_INTRA':'TF2_SCALPING';
    const open=positions.filter(position=>normaliseSymbol(position.symbol)===symbol &&
      (position.strategyMode||'TF2_SCALPING')===mode);
    if (!open.length) return true;
    const normal=market.strategyNormal||{};
    return /^(NORMAL|HIGH)_REENTRY$/.test(String(normal.entryType||'')) &&
      ['BUY','SELL'].includes(normal.side) &&
      open.every(position=>String(position.side||'').toUpperCase()===normal.side);
  }

  function buildSetupCommand(market = {}, settings = {}, symbolSpec = null, at = Date.now()) {
    if (!tradingWindow(settings.tradingSchedule,at).allowed) return null;
    const observed=number(market.signalObservedAt);
    if(observed!==null&&(at-observed>30000||observed>at+5000))return null;
    const validation = validateSettings(settings);
    const selected = validation.value.strategyMode;
    const mode=String(market.timeframe||market.strategyNormal?.tf||'').replace(/m$/, '')==='15'?'TF15_INTRA':'TF2_SCALPING';
    const tf = String(market.timeframe || market.strategyNormal?.tf || '').replace(/m$/, '');
    // Never reuse a TF2/legacy signal for a TF10 account.
    if(!['2','15'].includes(tf)||(selected!=='BOTH'&&selected!==mode))return null;
    const decision = Contract.createEntryDecision(market);
    if (!validation.ok || !decision) return null;
    const { snapshot } = decision;
    const symbol = snapshot.symbol;
    if (!validation.value.symbols.includes(symbol)) return null;
    const execution = effectiveSettings({...validation.value,strategyMode:mode}, symbol);
    if (!execution.enabled || !execution.lotPerLayer || !execution.layers) return null;
    const risk = calculateRisk({
      ...execution,
      entry: snapshot.entry,
      sl: snapshot.sl,
      tickSize: symbolSpec?.tickSize,
      tickValue: symbolSpec?.tickValue
    });
    return {
      signalKey: decision.signalKey,
      notAfterMs: observed!==null?observed+30000:Infinity,
      payload: {
        analysisContractVersion: Contract.CONTRACT_VERSION,
        analysisSnapshot: snapshot,
        schemaVersion: snapshot.schemaVersion,
        strategy: snapshot.strategy,
        symbol,
        side: snapshot.side,
        entry: snapshot.entry,
        sl: snapshot.sl,
        tp1: snapshot.tp1,
        tp2: snapshot.tp2,
        tp3: snapshot.tp3,
        lotPerLayer: execution.lotPerLayer,
        layers: execution.layers,
        totalLot: execution.totalLot,
        strategyMode: execution.strategyMode,
        // Restored October 1 SOP uses Pine StepLock/partial/yellow exits, without later overrides.
        exitPolicy: String(snapshot.analysisSopVersion||'').startsWith('NORMAL_20261001_')?null:mode==='TF2_SCALPING'?(settings.strategyExitPolicies?.TF2_SCALPING || null):null,
        assetGroup: execution.assetGroup,
        risk,
        signalReceivedAt: snapshot.sourceReceivedAt
      }
    };
  }

  function buildManagementCommand(market = {}) {
    const decision = Contract.createManagementDecision(market);
    if (!decision) return null;
    const { snapshot } = decision;
    return {
      managementKey: decision.managementKey,
      payload: {
        analysisContractVersion: Contract.CONTRACT_VERSION,
        analysisSnapshot: snapshot,
        schemaVersion: snapshot.schemaVersion,
        strategy: snapshot.strategy,
        symbol: snapshot.symbol,
        strategyMode: String(market.timeframe||market.strategyNormal?.tf||'2').replace(/m$/, '')==='15'?'TF15_INTRA':'TF2_SCALPING',
        actions: snapshot.actions,
        reason: snapshot.reason,
        signalReceivedAt: snapshot.sourceReceivedAt
      }
    };
  }

  return {
    SUPPORTED_MARKETS,
    STRATEGY_MODES,
    TRADE_SYMBOLS,
    malaysiaTradingSchedule,
    tradingWindow,
    effectiveSettings,
    CONTROL_STATES,
    COMMAND_TYPES,
    POD_OWNERSHIP_MODES,
    FORBIDDEN_CREDENTIAL_KEYS,
    number,
    normaliseSymbol,
    escapeHtml,
    validateSettings,
    calculateRisk,
    recommendPositionSizes,
    containsForbiddenCredentialKey,
    validateMaskedIdentity,
    sanitisePosition,
    normaliseHeartbeat,
    podConnectionState,
    makeSignalKey,
    permitsPositionEntry,
    buildSetupCommand,
    buildManagementCommand
  };
});
