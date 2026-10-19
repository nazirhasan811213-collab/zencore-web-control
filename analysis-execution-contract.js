(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZenCoreAnalysisExecutionContract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TF2_REVISED_VERSIONS=['NORMAL_20261001_TF2_TP1_HEMAGAP_V5','NORMAL_20261001_TF2_SEQ_TP1_HEMAGAP_V5','NORMAL_20261001_TF2_SEQ_ATR40_TP1_HEMAGAP_V5'];
  const septTf2=n=>n?.entrySopVersion==='NORMAL_20261001_TF2_SEP24_HEMA5_V8';
  const solid80Tf2=n=>['NORMAL_20261001_TF2_SOLID_80PCT_LIVE_V13','NORMAL_20261001_TF2_SOLID80_SCALP_CAP_V14','NORMAL_20261001_TF2_SOLID_HOLD_V15','NORMAL_20261001_TF2_SOLID_HOLD_V16'].includes(n?.entrySopVersion);
  const currentTf2=n=>solid80Tf2(n)||septTf2(n)||n?.entrySopVersion==='NORMAL_20261001_TF2_CURRENT_SOLID_HEMAPRICE_V7';
  const revisedTf2=n=>TF2_REVISED_VERSIONS.includes(n?.entrySopVersion);
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
      (green >= 5 ? 15 : green >= 4 || (revisedTf2(n)||currentTf2(n)) && green >= 3 ? 10 : 0) + (directional ? 15 : neutral ? 6 : 0) +
      (market.sidewaysGuard && !currentTf2(n) ? 0 : 10) + (confidence >= 80 ? 10 : confidence >= 70 ? 6 : 0) +
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

  // Recheck actual confirmation values, not just a cached READY/pass flag.
  // Dashboard receipts may confirm an existing event but never create one.
  function entryConfirmationsPass(market = {}) {
    const n = market.strategyNormal || {}, s = n.sop || {};
    if (n.state !== 'READY') return false;
    if(n.entrySopVersion==='NORMAL_20261001_TF15_RIBBON_V1'){
      const adapter=typeof module==='object'&&module.exports?require('./tf15-intraday'):globalThis.ZenCoreTf15;
      return String(market.timeframe)==='15'&&n.tf==='15m'&&n.solid===true&&s.solidHoldActive===true&&s.solidClosedAt==null&&adapter?.confirmations(n.side,s).pass&&adapter.planPass(n.side,n.plan,s);
    }
    if(n.entrySopVersion==='NORMAL_20261001_TF2_RIBBON_V1'){
      const adapter=typeof module==='object'&&module.exports?require('./tf2-scalping'):globalThis.ZenCoreTf2;
      return String(market.timeframe)==='2'&&n.tf==='2m'&&n.solid===true&&s.solidHoldActive===true&&s.solidClosedAt==null&&adapter?.confirmations(n.side,s).pass&&adapter.planPass(n.side,n.plan,s);
    }
    if(n.entrySopVersion==='NORMAL_20261001_TF3_RIBBON_V1'){
      const adapter=typeof module==='object'&&module.exports?require('./tf3-scalping'):globalThis.ZenCoreTf3;
      return String(market.timeframe)==='3'&&n.tf==='3m'&&n.solid===true&&s.solidHoldActive===true&&s.solidClosedAt==null&&adapter?.confirmations(n.side,s).pass&&adapter.planPass(n.side,n.plan,s);
    }
    if(solid80Tf2(n))return solid80Tf2Confirmations(n.side,s,['NORMAL_20261001_TF2_SOLID_HOLD_V15','NORMAL_20261001_TF2_SOLID_HOLD_V16'].includes(n.entrySopVersion),n.entrySopVersion==='NORMAL_20261001_TF2_SOLID_HOLD_V16'?5:6)&&String(market.timeframe)==='2'&&n.tf==='2m';
    if (!String(n.entrySopVersion || '').startsWith('NORMAL_20261001_')) return true;
    if(currentTf2(n))return currentSolidTf2Confirmations({side:n.side,solid:n.solid,green:s.sopGreen,forecast:s.forecast,power:s.marketPower,minimumGreen:septTf2(n)?4:3,price:septTf2(n)?s.hema2?.price:market.price,fast:s.hema2?.fast,slow:s.hema2?.slow,gates:s.gates})&&String(market.timeframe)==='2'&&n.tf==='2m';
    const tf = String(market.timeframe), higher = tf === '15' ? '30' : '3';
    const side = String(n.side || '').toUpperCase(), power = number(s.marketPower);
    const forecast = String(s.forecast || '').toUpperCase();
    const forecastPass = power !== null && power >= 0 && power <= 100 && (side === 'BUY'
      ? (forecast === 'NEUTRAL' && power > 50 || forecast === 'BULLISH' && power > (revisedTf2(n)?40:50))
      : side === 'SELL' && (forecast === 'NEUTRAL' && power < 50 || forecast === 'BEARISH' && power > (revisedTf2(n)?40:50)));
    if(revisedTf2(n)){
      const atr=number(s.atrReference??s.hema2?.atrReference);
      if(atr===null||atr<=0)return false;
      for(const key of ['hema2']){
        const r=s[key]||{},fast=number(r.fast),slow=number(r.slow);
        if(fast===null||slow===null||Math.abs(fast-slow)<=atr*.10||
          (side==='BUY'?fast<=slow:side==='SELL'?fast>=slow:true))return false;
      }
    }
    return ['2','15'].includes(tf) && n.tf === tf + 'm' && n.solid === true &&
      number(s.sopGreen) >= (revisedTf2(n)?3:4) && forecastPass &&
      s['hema'+tf]?.mode === side && (tf==='2'||s['hema'+higher]?.mode === side) &&
      Array.isArray(s.gates) && (tf==='2'?[5,6,7]:[6,7]).includes(s.gates.length) && s.gates.every(g => g.pass === true) &&
      (!String(n.entrySopVersion).includes('_SEQ_ATR40_') || s.pullback?.pass === true);
  }

  function currentSolidTf2Confirmations(x={}) {
    const side=String(x.side||'').toUpperCase(),price=number(x.price),fast=number(x.fast),slow=number(x.slow),power=number(x.power),green=number(x.green);
    const forecast=String(x.forecast||'').toUpperCase();
    const keys=['solid','entry','sop','forecast','hema2'];
    return x.solid===true&&green!==null&&green>=(x.minimumGreen??3)&&green<=5&&price!==null&&fast!==null&&slow!==null&&power!==null&&power>=0&&power<=100&&
      (side==='BUY'?price>Math.max(fast,slow)&&(forecast==='NEUTRAL'||forecast==='BULLISH')&&power>50:
       side==='SELL'&&price<Math.min(fast,slow)&&(forecast==='NEUTRAL'&&power<50||forecast==='BEARISH'&&power>50))&&
      Array.isArray(x.gates)&&x.gates.length===5&&keys.every(k=>x.gates.filter(g=>g.key===k&&g.pass===true).length===1);
  }

  function solid80Tf2Confirmations(side,s={},held=false,minimumHeld=6){
    const sign=side==='BUY'?1:side==='SELL'?-1:0,h=s.hema2||{},a=number(s.atrReference),f=number(h.fast),sl=number(h.slow),f2=number(h.fastPreviousBar),s2=number(h.slowPreviousBar),w1=number(h.waveTrend1),w2=number(h.waveTrend2),p=number(s.marketPower),m=number(s.mtfScore),e=number(s.sourceEntry),q=number(s.price),g=number(s.sopGreen),t=number(s.triggerAt);
    if(!sign||s.solid!==true||t===null||!(held?s.solidHoldActive===true&&s.solidClosedAt==null&&number(s.qualifiedAt)>=t&&number(s.qualifiedAt)>0&&number(s.signalObservedAt)>=s.qualifiedAt&&Date.now()-s.signalObservedAt<=30000&&Date.now()-s.signalObservedAt>=-5000:s.qualifiedAt===t&&Date.now()-t<=30000&&Date.now()-t>=-5000)||a===null||a<=0||[f,sl,f2,s2,w1,w2,p,m,e,q,g].some(v=>v===null)||!Number.isInteger(m)||!Number.isInteger(g)||g<0||g>5||p<0||p>100)return false;
    const h40=sign*(sl-s2)>=.05*a;
    const values={entry:sign*(q-e)>0,wt:sign*(w1-w2)>0,slope:h40&&sign*(f-f2)>=.05*a,sop:g>=3,forecast:sign===1?(s.forecast==='NEUTRAL'||s.forecast==='BULLISH')&&p>45:(s.forecast==='NEUTRAL'&&p<45||s.forecast==='BEARISH'&&p>45),mtf:sign*m>=1&&sign*m<=5};
    return h40&&Object.values(values).filter(Boolean).length>=(held?minimumHeld:5)&&Array.isArray(s.gates)&&s.gates.length===6&&Object.entries(values).every(([k,v])=>s.gates.filter(g=>g.key===k&&g.pass===v).length===1);
  }

  function tf2ScalpPlanPass(side,p={},atr){
    const sign=side==='BUY'?1:side==='SELL'?-1:0;
    if(!p||!sign||typeof atr!=='number'||!Number.isFinite(atr)||atr<=0||!Number.isFinite(p.entry)||p.entry<=0)return false;
    const expected={sl:p.entry-sign*.75*atr,tp1:p.entry+sign*Math.min(.5*atr,2),tp2:p.entry+sign*atr,tp3:p.entry+sign*1.5*atr};
    return Object.entries(expected).every(([k,v])=>Number.isFinite(p[k])&&Math.abs(v-p[k])<=1e-6);
  }

  // READY remains the Pine SOP decision; entry quality is an additional filter.
  function createEntryDecision(market = {}) {
    if(typeof process!=='undefined'&&/^(1|true|yes|on)$/i.test(process.env.ZENCORE_ENTRY_SIGNALS_PAUSED||''))return null;
    const normal = market.strategyNormal || {};
    if(normal.entrySopVersion==='NORMAL_20261001_TF15_RIBBON_V1'){
      const adapter=typeof module==='object'&&module.exports?require('./tf15-intraday'):globalThis.ZenCoreTf15;
      const decision=adapter?.entryDecision(market);return decision?deepFreeze(decision):null;
    }
    if(normal.entrySopVersion==='NORMAL_20261001_TF2_RIBBON_V1'){
      const adapter=typeof module==='object'&&module.exports?require('./tf2-scalping'):globalThis.ZenCoreTf2;
      const decision=adapter?.entryDecision(market);return decision?deepFreeze(decision):null;
    }
    if(normal.entrySopVersion==='NORMAL_20261001_TF3_RIBBON_V1'){
      const adapter=typeof module==='object'&&module.exports?require('./tf3-scalping'):globalThis.ZenCoreTf3;
      const decision=adapter?.entryDecision(market);return decision?deepFreeze(decision):null;
    }
    if(['NORMAL_20261001_TF2_SOLID80_SCALP_CAP_V14','NORMAL_20261001_TF2_SOLID_HOLD_V15','NORMAL_20261001_TF2_SOLID_HOLD_V16'].includes(normal.entrySopVersion)&&
      (normal.sop?.riskPlanVersion!=='TF2_SCALP_ATR_CAP_V1'||!tf2ScalpPlanPass(normal.side,normal.plan,['NORMAL_20261001_TF2_SOLID_HOLD_V15','NORMAL_20261001_TF2_SOLID_HOLD_V16'].includes(normal.entrySopVersion)?normal.sop?.riskAtrReference:normal.sop?.atrReference)))return null;
    if(['NORMAL_20261001_TF2_SOLID_HOLD_V15','NORMAL_20261001_TF2_SOLID_HOLD_V16'].includes(normal.entrySopVersion)){
      const observed=number(market.signalObservedAt),received=sourceTime(market),authorized=number(market.entryAuthorizedAt),complete=number(normal.sop?.qualifiedAt);
      if(market.feedUpdateVersion!=='SPLIT_CHANNEL_BOOTSTRAP_V2'||market.feedChannel!=='EXECUTION'||market.entryEvent!==true||
        !observed||!received||!authorized||!complete||authorized!==observed||complete>authorized||authorized-complete>30000||
        [observed,received].some(t=>Date.now()-t>30000||Date.now()-t< -5000))return null;
    }
    const plan = normal.plan || {};
    const restoredTf2=currentTf2(normal)||revisedTf2(normal)||['NORMAL_20261001_TF2_V2','NORMAL_20261001_TF2_SEQ_V3','NORMAL_20261001_TF2_SEQ_ATR40_V4'].includes(normal.entrySopVersion);
    const restoredTf15=['NORMAL_20261001_TF15_V2','NORMAL_20261001_TF15_SEQ_ATR40_V4'].includes(normal.entrySopVersion);
    const restored=restoredTf2||restoredTf15;
    if(String(normal.entrySopVersion||'').includes('_SEQ_ATR40_')&&
      (!(normal.tf==='2m'?[6,7]:[7]).includes(normal.sop?.gates?.length)||normal.sop?.pullback?.pass!==true||
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
      if (!entryConfirmationsPass(market)) return null;
      const expected=restoredTf15?'15':'2';
      if(normal.tf!==expected+'m'||String(market.timeframe)!==expected||normal.solid!==true||
        !Array.isArray(normal.sop?.gates)||!(expected==='2'?[5,6,7]:[6,7]).includes(normal.sop.gates.length)||!solid80Tf2(normal)&&!normal.sop.gates.every(g=>g.pass===true))return null;
      const side=String(normal.side||'').toUpperCase(),higher=expected==='15'?'30':'3';
      if(!solid80Tf2(normal)&&normal.sop?.['hema'+expected]?.mode!==side||expected==='15'&&normal.sop?.['hema'+higher]?.mode!==side)return null;
    }
    const solidTf2=normal.entrySopVersion==='SOLID_TF2_3GREEN_HEMA23_V2';
    const solidTf15=normal.entrySopVersion==='SOLID_TF15_3GREEN_HEMA1545_2L_V1';
    if(String(normal.entrySopVersion||'').startsWith('SOLID_TF15_')&&!solidTf15)return null;
    const solidSop=solidTf2||solidTf15;
    if((solidTf2 || restoredTf2) && !currentTf2(normal) && !tf2MarketRegime(market).pass)return null;
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
    if(plan.entryAnchor==='LIVE_SIGNAL_PRICE_V1'){
      const original=plan.sourceChartPlan||{},sign=side==='BUY'?1:side==='SELL'?-1:0;
      if(!(revisedTf2(normal)||currentTf2(normal))||!sign||livePrice===null||original.side!==side||['entry','sl','tp1','tp2','tp3'].some(k=>number(original[k])===null)||
        sign*(livePrice-original.entry)<=0||sign*(original.tp1-livePrice)<=0||
        sign*(original.entry-original.sl)<=0||sign*(original.tp2-original.tp1)<=0||sign*(original.tp3-original.tp2)<=0||
        prices.entry!==livePrice||['sl','tp1','tp2','tp3'].some(k=>Math.abs((prices[k]-prices.entry)-(original[k]-original.entry))>1e-8))return null;
    }
    if (livePrice !== null && (side === 'BUY'
        ? livePrice >= prices.tp1 || livePrice <= prices.sl
        : side === 'SELL' && (livePrice <= prices.tp1 || livePrice >= prices.sl))) return null;
    if (!SUPPORTED_MARKETS.includes(symbol) || String(normal.state || '').toUpperCase() !== 'READY' ||
        (!solidSop && !solid80Tf2(normal) && !['C+', 'B', 'B+', 'A', 'A+'].includes(entryQuality(market).grade)) ||
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
      ...(plan.entryAnchor==='LIVE_SIGNAL_PRICE_V1'?{entryAnchor:plan.entryAnchor,sourceChartPlan:plan.sourceChartPlan}:{}),
      ...(market.setupKey?{setupKey:market.setupKey}:{}),
      ...(market.signalObservedAt?{signalObservedAt:market.signalObservedAt}:{}),
      sourceReceivedAt: receivedAt,
      ...(restored ? {confirmationEvidence: {
        feedChannel: market.feedChannel || null,
        ...(['NORMAL_20261001_TF2_SOLID_HOLD_V15','NORMAL_20261001_TF2_SOLID_HOLD_V16'].includes(normal.entrySopVersion)?{solidHoldActive:normal.sop.solidHoldActive,triggerAt:normal.sop.triggerAt,qualifiedAt:normal.sop.qualifiedAt}:{}),
        signalObservedAt: number(market.signalObservedAt),
        sopGreen: normal.sop.sopGreen,
        forecast: normal.sop.forecast,
        marketPower: normal.sop.marketPower,
        hemaOwn: normal.sop['hema'+String(market.timeframe)].mode,
        hemaHigher: restoredTf15?normal.sop.hema30.mode:null,
        hemaRequiredTimeframes: restoredTf15?['15','30']:septTf2(normal)?['5']:['2'],
        gates: normal.sop.gates.map(g => ({key:g.key || null,passed:g.pass === true,detail:g.detail ?? null}))
      }} : {}),
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
    const requestedAction = String(management.slMoveAction || 'NONE').toUpperCase();
    // Existing EA uses absolute activeSl for MOVE_SL_TP1; MOVE_SL_ENTRY ignores it.
    if(['MOVE_SL_ENTRY_PLUS_050','MOVE_SL_ENTRY_PLUS_150','MOVE_SL_TP3'].includes(requestedAction)&&!['NORMAL_20261001_TF2_RIBBON_V1','NORMAL_20261001_TF3_RIBBON_V1','NORMAL_20261001_TF15_RIBBON_V1'].includes(market.strategyNormal?.entrySopVersion))return null;
    const slMoveAction=['MOVE_SL_ENTRY_PLUS_050','MOVE_SL_ENTRY_PLUS_150'].includes(requestedAction)?'MOVE_SL_TP1':requestedAction==='MOVE_SL_TP3'?'MOVE_SL_TP2':requestedAction;
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
      actions.push({ type: 'CLOSE_PERCENT', percent: ['NORMAL_20261001_TF2_RIBBON_V1','NORMAL_20261001_TF3_RIBBON_V1','NORMAL_20261001_TF15_RIBBON_V1'].includes(market.strategyNormal?.entrySopVersion)?100:50, reason: ['NORMAL_20261001_TF2_RIBBON_V1','NORMAL_20261001_TF3_RIBBON_V1','NORMAL_20261001_TF15_RIBBON_V1'].includes(market.strategyNormal?.entrySopVersion)?'EXIT_ALL':'CLOSE_SEPARUH' });
    }
    if (['EXIT_REMAINING', 'EXIT_ALL', 'EXIT_SL'].includes(exitAction)) {
      actions.push({ type: 'CLOSE_PERCENT', percent: 100, reason: exitAction });
    }
    if (!actions.length) return null;

    const actionKey = actions
      .map(action => `${action.type}:${action.activeSl ?? action.percent ?? ''}:${action.reason || ''}`)
      .join(',');
    return deepFreeze({
      managementKey: (market.setupKey&&['NORMAL_20261001_TF2_RIBBON_V1','NORMAL_20261001_TF3_RIBBON_V1','NORMAL_20261001_TF15_RIBBON_V1','NORMAL_20261001_TF2_SOLID80_SCALP_CAP_V14','NORMAL_20261001_TF2_SOLID_HOLD_V15','NORMAL_20261001_TF2_SOLID_HOLD_V16'].includes(market.strategyNormal?.entrySopVersion)
        ?[CONTRACT_VERSION,symbol,String(market.timeframe),market.setupKey,actionKey]:[CONTRACT_VERSION,symbol,receivedAt,actionKey]).join('|'),
      snapshot: {
        contractVersion: CONTRACT_VERSION,
        decision: 'POSITION_ACTION_AUTHORIZED',
        decisionOwner: 'ZENCORE_ANALYSIS',
        strategy: STRATEGY,
        schemaVersion: SCHEMA_VERSION,
        symbol,
        executionTimeframe:String(market.timeframe||market.strategyNormal?.tf||'2'),
        ...(['NORMAL_20261001_TF2_RIBBON_V1','NORMAL_20261001_TF3_RIBBON_V1','NORMAL_20261001_TF15_RIBBON_V1'].includes(market.strategyNormal?.entrySopVersion)?{setupKey:market.setupKey,analysisSopVersion:market.strategyNormal.entrySopVersion}:{}),
        ...(['LIVE_SIGNAL_PRICE_V1','FILL_PRICE_ATR_V1','PINE_SETUP_PLAN_V1'].includes(management.entryAnchor)?{entryAnchor:management.entryAnchor,entryCommandId:management.entryCommandId}:{}),
        actions,
        reason: String(management.reason || '').slice(0, 180),
        sourceReceivedAt: receivedAt
      }
    });
  }

  return {
    tf2ScalpPlanPass,
    currentSolidTf2Confirmations,
    solid80Tf2Confirmations,
    CONTRACT_VERSION,
    SCHEMA_VERSION,
    STRATEGY,
    SUPPORTED_MARKETS,
    number,
    normaliseSymbol,
    entryQuality,
    tf2MarketRegime,
    entryConfirmationsPass,
    createEntryDecision,
    createManagementDecision
  };
});

