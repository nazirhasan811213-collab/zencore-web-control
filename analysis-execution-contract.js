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
    'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY',  'USDCAD',
    'USDCHF', 'EURJPY', 'GBPJPY', 'EURGBP'
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

  // The same quality points shown on Analysis and Telegram. Only C+ and above may open a signal.
  function entryQuality(market = {}) {
    const n = market.strategyNormal || {}, s = n.sop || {}, p = n.plan || {};
    const side = String(n.side || 'WAIT').toUpperCase();
    const forecast = String(s.forecast || 'WAIT').toUpperCase();
    const qualityNumber = v => Number.isFinite(+v) ? +v : null;
    const power = qualityNumber(s.marketPower), green = qualityNumber(s.sopGreen) || 0;
    const confidence = qualityNumber(market.predictionConfidence) || 0;
    const stability = qualityNumber(market.stability) || 0;
    const stars = qualityNumber(market.confluence) || 0;
    const probability = qualityNumber(market.setupProbability) || 0;
    const gates = Array.isArray(s.gates) ? s.gates : [];
    const passed = gates.filter(g => g.pass).length;
    const entry = number(p.entry), sl = number(p.sl), tp3 = number(p.tp3);
    const risk = entry !== null && sl !== null ? Math.abs(entry - sl) : 0;
    const rr = entry !== null && tp3 !== null && risk > 0 ? Math.abs(tp3 - entry) / risk : number(market.rr);
    const directional = ((side === 'BUY' && forecast === 'BULLISH') ||
      (side === 'SELL' && forecast === 'BEARISH')) && power !== null && power >= 65;
    const neutral = forecast === 'NEUTRAL' && power !== null &&
      ((side === 'BUY' && power > 50) || (side === 'SELL' && power < 50));
    const score = (gates.length >= 2 && passed === gates.length ? 25 : 0) +
      (green >= 5 ? 15 : green >= 4 ? 10 : 0) + (directional ? 15 : neutral ? 6 : 0) +
      (market.sidewaysGuard ? 0 : 10) + (confidence >= 80 ? 10 : confidence >= 70 ? 6 : 0) +
      (stability >= 75 ? 10 : stability >= 65 ? 5 : 0) +
      (stars >= 4 ? 5 : stars >= 3 ? 3 : 0) +
      (probability >= 70 ? 5 : probability >= 60 ? 3 : 0) + (rr !== null && rr >= 2 ? 5 : 0);
    const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B+' :
      score >= 60 ? 'B' : score >= 50 ? 'C+' : 'C';
    return { score, grade, high: String(n.state || '').toUpperCase() === 'READY' && score >= 80 && !market.sidewaysGuard };
  }

  // Entry-only guard: management decisions deliberately do not use this filter.
  function tf2MarketRegime(input = {}, requireChop = false) {
    const chop = number(input.chopIndex ?? input.sidewaysChop ?? input.chop ??
      input.strategyNormal?.sop?.indicatorContext?.chop ?? input.dashboard?.chop);
    const structure = String(input.marketStructure ?? input.dashboard?.marketStructure ?? '').toUpperCase();
    const forecast = String(input.normal3Forecast ?? input.strategyNormal?.sop?.forecast ?? '').toUpperCase();
    let reason = null;
    if (input.sidewaysGuard === true || /SIDEWAY|CHOP|RANGE|FLAT/.test(structure) || forecast === 'CHOPPY')
      reason = 'CHOPPY_OR_SIDEWAYS';
    else if (chop !== null && (chop < 0 || chop > 100)) reason = 'INVALID_CHOP_DATA';
    else if (chop !== null && chop >= 61.8) reason = 'CHOP_TOO_HIGH';
    else if (requireChop && chop === null) reason = 'WAIT_CHOP_DATA';
    else if (input.strategyNormal?.sop?.marketRegime?.pass === false)
      reason = input.strategyNormal.sop.marketRegime.reason || 'DIRECTION_UNCLEAR';
    return { pass: reason === null, reason: reason || 'MARKET_CLEAR', chop, threshold: 61.8 };
  }

  // READY remains the Pine SOP decision; entry quality is an additional filter.
  function createEntryDecision(market = {}) {
    const normal = market.strategyNormal || {};
    const plan = normal.plan || {};
    const restoredTf2=['NORMAL_20261001_TF2_V2','NORMAL_20261001_TF2_SEQ_V3','NORMAL_20261001_TF2_SEQ_ATR40_V4'].includes(normal.entrySopVersion);
    const restoredTf15=['NORMAL_20261001_TF15_V2','NORMAL_20261001_TF15_SEQ_ATR40_V4'].includes(normal.entrySopVersion);
    const restored=restoredTf2||restoredTf15;
    if(String(normal.entrySopVersion||'').includes('_SEQ_ATR40_')&&
      (normal.sop?.gates?.length!==7||normal.sop?.pullback?.pass!==true||
       !normal.sop.gates.some(g=>g.key==='pullback'&&g.pass===true)))return null;
    if(String(normal.entrySopVersion||'').startsWith('NORMAL_20261001_')&&!restored)return null;
    // A fresh receipt/heartbeat cannot authorize an old latched setup.
    if(restored && market.entryEvent===false)return null;
    if(market.feedUpdateVersion==='SPLIT_CHANNEL_BOOTSTRAP_V2'){
      const authorized=number(market.entryAuthorizedAt),observed=number(market.signalObservedAt),received=sourceTime(market);
      if(market.feedChannel!=='EXECUTION'||market.entryEvent!==true||!authorized||authorized!==observed||
        !received||received-authorized>30000||authorized>received+5000)return null;
    }
    if(restored){
      const expected=restoredTf15?'15':'2';
      if(normal.tf!==expected+'m'||String(market.timeframe)!==expected||normal.solid!==true||
        !Array.isArray(normal.sop?.gates)||![6,7].includes(normal.sop.gates.length)||!normal.sop.gates.every(g=>g.pass===true))return null;
      const side=String(normal.side||'').toUpperCase(),higher=expected==='15'?'30':'3';
      if(normal.sop?.['hema'+expected]?.mode!==side||normal.sop?.['hema'+higher]?.mode!==side)return null;
    }
    const solidTf2=normal.entrySopVersion==='SOLID_TF2_3GREEN_HEMA23_V2';
    const solidTf15=normal.entrySopVersion==='SOLID_TF15_3GREEN_HEMA1545_2L_V1';
    if(String(normal.entrySopVersion||'').startsWith('SOLID_TF15_')&&!solidTf15)return null;
    const solidSop=solidTf2||solidTf15;
    if((solidTf2 || restoredTf2) && !tf2MarketRegime(market).pass)return null;
    const expectedTf=solidTf15?'15m':'2m';
    if(solidSop && (normal.tf!==expectedTf || (market.timeframe!=null && String(market.timeframe).replace(/m$/, '')!==expectedTf.replace(/m$/, '')) || normal.solid!==true || !Array.isArray(normal.sop?.gates) || normal.sop.gates.length!==6 || !normal.sop.gates.every(g=>g.pass===true)))return null;
    const symbol = normaliseSymbol(market.symbol);
    if(!['XAUUSD'].includes(symbol))return null;
    const side = String(normal.side || plan.side || '').toUpperCase();
    const receivedAt = sourceTime(market);
    const prices = {
      entry: number(plan.entry),
      sl: number(plan.sl),
      tp1: number(plan.tp1),
      tp2: number(plan.tp2),
      tp3: number(plan.tp3)
    };
    const livePrice = number(market.price);
    if (livePrice !== null && (side === 'BUY'
        ? livePrice >= prices.tp1 || livePrice <= prices.sl
        : side === 'SELL' && (livePrice <= prices.tp1 || livePrice >= prices.sl))) return null;
    if (!SUPPORTED_MARKETS.includes(symbol) || String(normal.state || '').toUpperCase() !== 'READY' ||
        (!solidSop && !['C+', 'B', 'B+', 'A', 'A+'].includes(entryQuality(market).grade)) ||
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
      executionTimeframe: String(market.timeframe || normal.tf || '3'),
      ...prices,
      ...(market.setupKey?{setupKey:market.setupKey}:{}),
      ...(market.signalObservedAt?{signalObservedAt:market.signalObservedAt}:{}),
      sourceReceivedAt: receivedAt,
      ...((solidSop||restored)?{analysisSopVersion:normal.entrySopVersion}:{})
    };
    return deepFreeze({
      signalKey: [CONTRACT_VERSION,market.timeframe||normal.tf||'2', symbol, side, prices.entry, market.setupKey||receivedAt].join('|'),
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
        executionTimeframe:String(market.timeframe||market.strategyNormal?.tf||'2'),
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
    entryQuality,
    tf2MarketRegime,
    createEntryDecision,
    createManagementDecision
  };
});
