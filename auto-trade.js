(() => {
  'use strict';

  const Core = window.ZenCoreAutoTrade;
  const byId = id => document.getElementById(id);
  const setText = (id, value) => { const element = byId(id); if (element) element.textContent = value; };
  const escape = value => Core?.escapeHtml(value) || String(value ?? '');
  const money = value => Number.isFinite(Number(value))
    ? `USD ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  const price = (value, symbol = '') => {
    if (!Number.isFinite(Number(value))) return '—';
    const digits = symbol.includes('JPY') ? 3 : symbol === 'US30' || symbol === 'BTCUSD' ? 2 : symbol === 'XAUUSD' ? 3 : 5;
    return Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };
  const timeText = value => Number.isFinite(Number(value))
    ? new Date(Number(value)).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' }) : '—';

  let currentState = null;
  let markets = [];
  let settingsHydrated = false;
  let settingsDirty = false;
  let toastTimer = null;
  let lastPairingCode = '';
  let credentialEncryption = null;
  let currentRecommendation = null;
  let workspaceOptedIn = false;
  try { workspaceOptedIn = sessionStorage.getItem('zencore_auto_trade_open') === '1'; } catch (_) {}

  function goToLogin() { window.location.replace('/login'); }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    if (response.status === 401 && !path.includes('emergency-close') && !path.includes('hosted-account')) return goToLogin();
    let body = {};
    try { body = await response.json(); } catch (_) {}
    if (!response.ok) {
      const error = new Error(body.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = body.code;
      error.fields = body.fields;
      throw error;
    }
    return body;
  }

  function toast(message, isError = false) {
    const element = byId('toast');
    if (!element) return;
    element.textContent = message;
    element.className = `toast show${isError ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { element.className = 'toast'; }, 3800);
  }

  async function loadUser() {
    try {
      const body = await api('/auth/me');
      setText('userPill', body.user?.email || 'Akaun ZenCore');
    } catch (_) {
      setText('userPill', 'Akaun tidak tersedia');
    }
  }

  function stateTone(effective) {
    if (effective === 'ON') return 'on';
    if (['ARMING', 'STOPPING', 'EMERGENCY_CLOSING'].includes(effective)) return 'pending';
    if (effective === 'ERROR') return 'error';
    return 'stopped';
  }

  function stateCopy(effective) {
    const copy = {
      UNPROVISIONED: 'Secure Pod belum disediakan. Entry baharu disekat.',
      STOPPED: 'Tiada entry baharu akan dihantar.',
      ARMING: 'Menunggu Secure Pod mengakui arahan ON.',
      ON: 'Setup READY boleh dihantar ke MT5.',
      STOPPING: 'Entry baharu sudah disekat. Menunggu acknowledgement STOP.',
      EMERGENCY_CLOSING: 'Arahan tutup semua sedang diproses oleh MT5.',
      ERROR: 'Execution memerlukan perhatian. Entry baharu disekat.'
    };
    return copy[effective] || 'Status belum tersedia.';
  }

  function ownershipLabel(mode) {
    if (mode === 'TRADER_OWNED_AZURE') return 'AZURE TRADER';
    if (mode === 'TRADER_OWNED_WINDOWS_PC') return 'WINDOWS PC';
    return mode ? 'INTERNAL DEMO' : 'ZENCORE MANAGED';
  }

  function ownershipDescription(mode) {
    return mode === 'TRADER_OWNED_AZURE'
      ? 'Azure Confidential VM milik trader'
      : 'PC Windows milik trader';
  }

  function renderConnection(state) {
    const connection = state.connection || {};
    const pod = state.pod;
    const hosted = state.hostedAccount;
    const identity = hosted || pod;
    const badge = byId('connectionBadge');
    if (badge) {
      badge.textContent = connection.state || 'OFFLINE';
      badge.className = `mini-status ${connection.ready ? 'ready' : connection.state === 'CONNECTED_LOCKED' ? 'locked' : connection.state === 'BLOCKED_REAL' ? 'blocked' : 'offline'}`;
    }
    setText('summaryPod', connection.ready ? 'READY' : connection.label || 'BELUM CONNECT');
    setText('summaryHeartbeat', identity?.lastSeenAt
      ? `Heartbeat ${timeText(identity.lastSeenAt)}`
      : hosted ? String(hosted.status || 'PENDING').replaceAll('_', ' ') : 'Tiada heartbeat');
    setText('accountMask', identity?.accountMask || 'Belum dipautkan');
    setText('serverMask', identity?.serverMask || '—');
    setText('brokerMask', identity?.brokerMask || '—');
    setText('tradeMode', identity?.tradeMode || 'DEMO');
    setText('podOwner', hosted ? 'ZENCORE MANAGED' : ownershipLabel(pod?.ownershipMode));
    const health = (id, enabled) => {
      const el = byId(id);
      if (!el) return;
      el.textContent = identity ? (enabled ? 'READY' : 'OFF') : 'WAIT';
      el.className = identity ? (enabled ? 'good' : 'bad') : '';
    };
    health('terminalState', !!identity?.terminalTradeAllowed);
    health('accountTradeState', !!identity?.accountTradeAllowed);
    health('expertTradeState', !!identity?.expertTradeAllowed);
    const waitingPair = state.pairing?.status === 'WAITING_FOR_SECURE_POD';
    const pairedHost = ownershipDescription(pod?.ownershipMode);
    const waitingHost = ownershipDescription(state.pairing?.ownershipMode);
    setText('podNotice', hosted
      ? `${state.hostedMt5?.message || 'Encrypted account envelope saved.'} Status: ${String(hosted.status || 'PENDING').replaceAll('_', ' ')}. Execution kekal dikunci sehingga worker Demo mengesahkan akaun.`
      : pod
      ? `${connection.label}. ${pairedHost} • connector ${pod.connectorVersion || '—'} • terminal build ${pod.terminalBuild || '—'}.${pod.demoExecutionUnlocked ? '' : ' Build execution masih dikunci; pairing dan monitoring sahaja.'}`
      : waitingPair
        ? `Kod pairing aktif sehingga ${timeText(state.pairing.expiresAt)}. Jalankan pairing hanya dari ${waitingHost}.`
        : state.hostedMt5?.message || 'Akaun MT5 belum disambungkan.');
    const pairingActions = byId('pairingActions');
    if (pairingActions) pairingActions.classList.toggle('hidden', !!pod && !hosted);
    const connectButton = byId('connectMt5Button');
    if (connectButton) connectButton.textContent = hosted ? 'KEMAS KINI MT5' : 'SAMBUNG MT5';
    const pairButton = byId('pairPodButton');
    if (pairButton) pairButton.textContent = waitingPair ? 'JANA SEMULA' : 'JANA KOD PAIRING';
  }

  function renderVisibility(state) {
    const configured = state.ui?.autoTradeConfigured === true;
    const showWorkspace = configured || workspaceOptedIn;
    byId('autoTradeGate')?.classList.toggle('hidden', showWorkspace);
    byId('autoTradeWorkspace')?.classList.toggle('hidden', !showWorkspace);
  }

  function renderMaster(state) {
    const control = state.control || {};
    const effective = control.effectiveState || 'STOPPED';
    const tone = stateTone(effective);
    const pill = byId('masterStatusPill');
    if (pill) {
      pill.className = `master-pill ${tone}`;
      pill.innerHTML = `<i></i>${escape(effective.replaceAll('_', ' '))}`;
    }
    const card = byId('masterState');
    if (card) card.className = `master-state ${tone}`;
    setText('masterStateText', effective.replaceAll('_', ' '));
    setText('masterStateCopy', control.lastError || (control.executionRolloutUnlocked === false
      ? 'Connection-only rollout. Pairing dan monitoring dibenarkan; execution masih dikunci.'
      : stateCopy(effective)));
    setText('summarySystem', effective.replaceAll('_', ' '));
    setText('summarySystemNote', control.executionRolloutUnlocked === false
      ? 'Connection-only • order locked'
      : control.canEnter ? 'Entry automatik dibenarkan' : 'Entry baharu disekat');
    const pending = byId('pendingBadge');
    if (pending) pending.classList.toggle('hidden', !control.pendingCommandId);

    const onButton = byId('turnOnButton');
    const stopButton = byId('stopButton');
    const emergencyButton = byId('emergencyButton');
    if (onButton) onButton.disabled = !control.canTurnOn || ['ON', 'ARMING'].includes(effective);
    if (stopButton) stopButton.disabled = ['UNPROVISIONED', 'STOPPED', 'STOPPING'].includes(effective);
    if (emergencyButton) emergencyButton.disabled = !(state.pod || state.hostedAccount) ||
      !(state.positions || []).length || effective === 'EMERGENCY_CLOSING';
  }

  function renderSettings(state) {
    const settings = state.settings;
    if (!settings || settingsHydrated || settingsDirty) return;
    byId('capitalUsd').value = settings.capitalUsd ?? 100;
    byId('lotPerLayer').value = settings.lotPerLayer ?? 0.01;
    byId('layers').value = settings.layers ?? 3;
    byId('riskAcknowledged').checked = !!settings.riskAcknowledgedAt;
    settingsHydrated = true;
    updateRiskPreview();
  }

  function renderExecutionScope(state) {
    const allowed = Array.isArray(state.control?.executionSymbols)
      ? state.control.executionSymbols : Core.SUPPORTED_MARKETS;
    const options = byId('symbolOptions');
    if (options) {
      options.innerHTML = allowed.length
        ? allowed.map(symbol => `<span class="symbol-option system"><span>${escape(symbol)}</span></span>`).join('')
        : '<span class="symbol-scope-empty">Menunggu pair yang disahkan.</span>';
    }
    setText(
      'executionSymbolNotice',
      `Skop automatik control plane: ${allowed.join(', ') || 'belum tersedia'}. Semua user aktif menerima skop pair yang sama.`
    );
  }

  function renderSummary(state) {
    setText('summaryPositions', state.summary?.openPositions || 0);
    setText('summaryVolume', `${Number(state.summary?.totalVolume || 0).toFixed(2)} total lot`);
    setText('summaryProfit', money(state.summary?.floatingProfitUsd || 0));
    const profitCard = byId('summaryProfitCard');
    if (profitCard) {
      const pnl = Number(state.summary?.floatingProfitUsd || 0);
      profitCard.className = pnl > 0 ? 'profit' : pnl < 0 ? 'loss' : '';
    }
    const settings = state.settings;
    setText('summaryExposure', settings?.totalLot == null ? '—' : Number(settings.totalLot).toFixed(3));
    setText('summaryLayers', settings ? `${settings.layers} layer × ${settings.lotPerLayer} lot` : 'Belum dikonfigurasi');
  }

  function renderPositions(state) {
    const positions = Array.isArray(state.positions) ? state.positions : [];
    const tbody = byId('positionTableBody');
    setText('positionCountBadge', `${positions.length} OPEN`);
    if (!tbody) return;
    if (!positions.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Belum ada posisi MT5 aktif.</td></tr>';
      return;
    }
    tbody.innerHTML = positions.map(position => {
      const pnl = Number(position.profitUsd || 0);
      return `<tr>
        <td><b>${escape(position.symbol)}</b><small>#${escape(position.ticket)}</small></td>
        <td class="${position.side === 'BUY' ? 'buy' : 'sell'}"><b>${escape(position.side)}</b><small>${escape(position.layers)} layer</small></td>
        <td><b>${escape(position.volume)}</b><small>lot</small></td>
        <td><b>${escape(price(position.entry, position.symbol))} → ${escape(price(position.currentPrice, position.symbol))}</b><small>${escape(timeText(position.openedAt))}</small></td>
        <td><b>${escape(price(position.activeSl, position.symbol))}</b><small>Initial ${escape(price(position.initialSl, position.symbol))}</small></td>
        <td><b>${escape(String(position.slLock || 'INITIAL').replaceAll('_', ' '))}</b><small>${escape(String(position.exitStage || 'HOLD').replaceAll('_', ' '))}</small></td>
        <td class="${pnl >= 0 ? 'positive' : 'negative'}"><b>${escape(money(pnl))}</b><small>live snapshot</small></td>
      </tr>`;
    }).join('');
  }

  function auditDescription(item) {
    const detail = item.detail || {};
    const descriptions = {
      SECURE_POD_PROVISIONED: 'Secure Pod DEMO disediakan.',
      PAIRING_CODE_CREATED: `Kod pairing sekali guna dijana untuk ${ownershipDescription(detail.ownershipMode)}.`,
      SECURE_POD_PAIRED: `Secure Pod ${ownershipDescription(detail.ownershipMode)} berjaya dipautkan.`,
      SETTINGS_SAVED: `Konfigurasi disimpan: ${detail.layers || '—'} layer × ${detail.lotPerLayer || '—'} lot.`,
      SYSTEM_ON_REQUESTED: 'Arahan ON dihantar; menunggu acknowledgement.',
      SYSTEM_STOP_REQUESTED: 'Entry baharu disekat; EXIT management dikekalkan.',
      SYSTEM_STOPPED: 'Sistem dihentikan.',
      EMERGENCY_CLOSE_REQUESTED: 'Emergency Close All dihantar ke MT5.',
      SETUP_QUEUED: `${detail.symbol || 'Pair'} ${detail.side || ''} dihantar • ${detail.totalLot || '—'} lot • risk ${detail.riskLevel || 'PENDING'}.`,
      HOSTED_MT5_ENVELOPE_SAVED: `Credential envelope disimpan untuk ${detail.accountMask || 'akaun MT5'} • plaintext tidak disimpan.`,
      COMMAND_ACKNOWLEDGED: `${detail.commandType || 'Command'}: ${detail.status || 'ACK'}.`
    };
    return descriptions[item.type] || String(item.type || 'Aktiviti').replaceAll('_', ' ');
  }

  function renderAudit(state) {
    const items = Array.isArray(state.audit) ? state.audit : [];
    const list = byId('auditList');
    if (!list) return;
    list.innerHTML = items.length ? items.map(item => `<div class="audit-row">
      <b>${escape(String(item.type || '').replaceAll('_', ' '))}</b>
      <span>${escape(auditDescription(item))}</span>
      <time>${escape(timeText(item.createdAt))}</time>
    </div>`).join('') : '<div class="audit-empty">Belum ada aktiviti Auto Trade.</div>';
  }

  function render(state) {
    currentState = state;
    renderVisibility(state);
    renderConnection(state);
    renderMaster(state);
    renderSettings(state);
    renderExecutionScope(state);
    renderSummary(state);
    renderPositions(state);
    renderAudit(state);
    setText('lastRefresh', new Date(state.generatedAt || Date.now()).toLocaleTimeString());
    updateRiskPreview();
  }

  function syntheticUnavailable(message) {
    return {
      ok: false, mode: 'DEMO',
      control: { desiredState: 'STOPPED', effectiveState: 'ERROR', canEnter: false, canTurnOn: false, lastError: message },
      connection: { state: 'UNAVAILABLE', label: 'CONTROL PLANE OFFLINE', ready: false },
      pod: null, settings: null, positions: [], audit: [],
      hostedAccount: null, hostedMt5: { available: false }, ui: { autoTradeConfigured: false },
      summary: { openPositions: 0, floatingProfitUsd: 0, totalVolume: 0 },
      generatedAt: Date.now()
    };
  }

  async function refreshState(silent = true) {
    try {
      render(await api('/api/auto-trade/state'));
    } catch (error) {
      render(syntheticUnavailable(error.message));
      if (!silent) toast(error.message, true);
    }
  }

  async function refreshMarkets() {
    try {
      const payload = await api('/api/markets');
      markets = Array.isArray(payload.markets) ? payload.markets : [];
      updateRiskPreview();
    } catch (_) {}
  }

  function selectedSettings() {
    const symbols = Array.isArray(currentState?.control?.executionSymbols) && currentState.control.executionSymbols.length
      ? currentState.control.executionSymbols
      : ['XAUUSD'];
    return {
      capitalUsd: byId('capitalUsd').value,
      lotPerLayer: byId('lotPerLayer').value,
      layers: byId('layers').value,
      symbols
    };
  }

  function updateRiskPreview() {
    if (!Core) return;
    const input = selectedSettings();
    const validation = Core.validateSettings(input);
    setText('totalLotPreview', validation.value.totalLot == null ? '—' : validation.value.totalLot.toFixed(3));
    setText('riskTotalLot', validation.value.totalLot == null ? '—' : validation.value.totalLot.toFixed(3));
    const symbol = byId('riskSymbol')?.value || 'XAUUSD';
    const market = markets.find(item => Core.normaliseSymbol(item.symbol) === symbol);
    const plan = market?.strategyNormal?.plan;
    const spec = currentState?.pod?.symbolSpecs?.[symbol];
    const risk = Core.calculateRisk({
      ...input,
      symbols: input.symbols.length ? input.symbols : [symbol],
      entry: plan?.entry,
      sl: plan?.sl,
      tickSize: spec?.tickSize,
      tickValue: spec?.tickValue
    });
    const level = byId('riskLevel');
    if (level) {
      level.textContent = risk.level;
      level.className = `mini-status risk-level ${risk.level.toLowerCase()}`;
    }
    setText('riskPercent', risk.available ? `${risk.riskPercent.toFixed(2)}%` : '—');
    setText('riskUsd', risk.available ? money(risk.riskUsd) : 'Menunggu active plan');
    setText('riskEntry', price(plan?.entry, symbol));
    setText('riskSl', price(plan?.sl, symbol));
    setText('riskMessage', risk.message);
    const recommendation = Core.recommendPositionSizes({
      capitalUsd: input.capitalUsd,
      preferredLayers: input.layers,
      entry: plan?.entry,
      sl: plan?.sl,
      tickSize: spec?.tickSize,
      tickValue: spec?.tickValue,
      volumeMin: spec?.volumeMin,
      volumeMax: spec?.volumeMax,
      volumeStep: spec?.volumeStep,
      targetRiskPercent: 1
    });
    currentRecommendation = recommendation.recommended;
    const apply = byId('applyRecommendationButton');
    if (currentRecommendation) {
      setText('recommendedSize', `${currentRecommendation.layers} LAYER × ${currentRecommendation.lotPerLayer} LOT`);
      setText('recommendationMessage', `${recommendation.message} Anggaran ${currentRecommendation.estimatedRiskPercent.toFixed(2)}% / ${money(currentRecommendation.estimatedRiskUsd)}.`);
      if (apply) apply.disabled = false;
    } else {
      setText('recommendedSize', 'BELUM TERSEDIA');
      setText('recommendationMessage', recommendation.message);
      if (apply) apply.disabled = true;
    }
  }

  function bytesToBase64url(bytes) {
    let binary = '';
    for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || '').replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function encryptMt5Credential(value, config) {
    if (!window.crypto?.subtle) throw new Error('Browser ini tidak menyokong WebCrypto yang diperlukan.');
    const publicKey = await crypto.subtle.importKey(
      'spki',
      base64ToBytes(config.publicKeySpki),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['wrapKey']
    );
    const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext);
    plaintext.fill(0);
    const wrappedKey = await crypto.subtle.wrapKey('raw', aesKey, publicKey, { name: 'RSA-OAEP' });
    return {
      version: 1,
      algorithm: 'RSA-OAEP-256+A256GCM',
      keyId: config.keyId,
      wrappedKey: bytesToBase64url(wrappedKey),
      iv: bytesToBase64url(iv),
      ciphertext: bytesToBase64url(ciphertext)
    };
  }

  function masked(value, tailLength, fallback) {
    const safe = String(value || '').replace(/[^A-Za-z0-9._-]/g, '');
    const tail = safe.slice(-tailLength);
    return tail.length >= 2 ? `****${tail}` : fallback;
  }

  function clearMt5Fields() {
    ['mt5LoginId', 'mt5Password', 'mt5Server', 'mt5ZenCorePassword', 'mt5ConnectConfirmation']
      .forEach(id => { if (byId(id)) byId(id).value = ''; });
  }

  async function openMt5ConnectDialog() {
    clearMt5Fields();
    setText('mt5ConnectError', '');
    setText('mt5EncryptionNotice', 'Memuatkan public encryption key…');
    const button = byId('confirmMt5ConnectButton');
    if (button) button.disabled = true;
    byId('mt5ConnectDialog')?.showModal();
    try {
      const result = await api('/api/auto-trade/credential-key');
      credentialEncryption = result.encryption;
      setText('mt5EncryptionNotice', `Encryption ready • ${credentialEncryption.algorithm} • key ${credentialEncryption.keyId}. Plaintext tidak dihantar ke web server.`);
      if (button) button.disabled = false;
    } catch (error) {
      credentialEncryption = null;
      setText('mt5ConnectError', error.message);
      setText('mt5EncryptionNotice', 'Hosted MT5 belum boleh menerima credential. Execution kekal dikunci.');
    }
  }

  function initialiseSymbols() {
    const riskSelect = byId('riskSymbol');
    if (!Core || !riskSelect) return;
    riskSelect.innerHTML = Core.SUPPORTED_MARKETS.map(symbol => `<option value="${symbol}">${symbol}</option>`).join('');
    document.querySelectorAll('#settingsForm input').forEach(input => input.addEventListener('input', () => {
      settingsDirty = true;
      updateRiskPreview();
    }));
    riskSelect.addEventListener('change', updateRiskPreview);
  }

  byId('startAutoTradeButton')?.addEventListener('click', () => {
    workspaceOptedIn = true;
    try { sessionStorage.setItem('zencore_auto_trade_open', '1'); } catch (_) {}
    renderVisibility(currentState || { ui: {} });
    if (!currentState?.hostedAccount && !currentState?.pod) openMt5ConnectDialog();
  });

  byId('connectMt5Button')?.addEventListener('click', openMt5ConnectDialog);

  byId('mt5ConnectDialog')?.addEventListener('close', () => {
    clearMt5Fields();
    credentialEncryption = null;
  });

  byId('confirmMt5ConnectButton')?.addEventListener('click', async () => {
    const button = byId('confirmMt5ConnectButton');
    button.disabled = true;
    setText('mt5ConnectError', '');
    let loginId = String(byId('mt5LoginId')?.value || '').trim();
    let mt5Password = String(byId('mt5Password')?.value || '');
    let server = String(byId('mt5Server')?.value || '').trim();
    let zencorePassword = String(byId('mt5ZenCorePassword')?.value || '');
    const confirmation = String(byId('mt5ConnectConfirmation')?.value || '').trim();
    try {
      if (!credentialEncryption) throw new Error('Public encryption key belum tersedia.');
      if (!/^[0-9]{2,32}$/.test(loginId)) throw new Error('MT5 Login ID tidak sah.');
      if (!mt5Password || mt5Password.length > 128) throw new Error('Masukkan password MT5 yang sah.');
      if (server.length < 2 || server.length > 120) throw new Error('Masukkan nama server MT5 yang sah.');
      if (!zencorePassword) throw new Error('Masukkan password akaun ZenCore untuk pengesahan.');
      if (confirmation.toUpperCase() !== 'CONNECT MT5 DEMO') throw new Error('Taip CONNECT MT5 DEMO untuk meneruskan.');

      const credentialPayload = {
        login: loginId,
        password: mt5Password,
        server,
        tradeMode: 'DEMO',
        createdAt: Date.now()
      };
      const credentialEnvelope = await encryptMt5Credential(credentialPayload, credentialEncryption);
      const accountMask = masked(loginId, 6, '****MT5');
      const serverMask = masked(server, 12, '****Server');
      const brokerMask = masked(server.split('-')[0], 16, '****Broker');
      credentialPayload.login = '';
      credentialPayload.password = '';
      credentialPayload.server = '';
      loginId = '';
      mt5Password = '';
      server = '';
      clearMt5Fields();

      const state = await api('/api/auto-trade/hosted-account', {
        method: 'POST',
        body: JSON.stringify({
          credentialEnvelope,
          accountMask,
          serverMask,
          brokerMask,
          tradeMode: 'DEMO',
          confirmation,
          zencorePassword
        })
      });
      zencorePassword = '';
      credentialEncryption = null;
      byId('mt5ConnectDialog').close();
      render(state);
      toast('Encrypted MT5 envelope disimpan. Menunggu managed Demo worker.');
    } catch (error) {
      setText('mt5ConnectError', error.message);
    } finally {
      loginId = '';
      mt5Password = '';
      server = '';
      zencorePassword = '';
      if (button && byId('mt5ConnectDialog')?.open) button.disabled = !credentialEncryption;
    }
  });

  byId('applyRecommendationButton')?.addEventListener('click', () => {
    if (!currentRecommendation) return;
    byId('lotPerLayer').value = currentRecommendation.lotPerLayer;
    byId('layers').value = currentRecommendation.layers;
    settingsDirty = true;
    updateRiskPreview();
    toast('Cadangan lot dan layer digunakan. Simpan konfigurasi untuk confirm.');
  });

  byId('settingsForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = byId('saveSettingsButton');
    button.disabled = true;
    setText('settingsError', '');
    try {
      const body = {
        ...selectedSettings(),
        riskAcknowledged: byId('riskAcknowledged').checked
      };
      const validation = Core.validateSettings(body);
      if (!validation.ok) throw new Error(Object.values(validation.errors)[0]);
      const state = await api('/api/auto-trade/settings', { method: 'PUT', body: JSON.stringify(body) });
      settingsDirty = false;
      settingsHydrated = true;
      render(state);
      toast('Konfigurasi Auto Trade disimpan.');
    } catch (error) {
      setText('settingsError', error.message);
    } finally {
      button.disabled = false;
    }
  });

  byId('turnOnButton')?.addEventListener('click', () => {
    setText('onError', '');
    byId('onConfirmation').value = '';
    byId('onDialog').showModal();
  });

  byId('pairPodButton')?.addEventListener('click', () => {
    lastPairingCode = '';
    setText('pairingError', '');
    setText('pairingCode', '—');
    setText('pairingExpiry', '—');
    byId('pairingConfirmation').value = '';
    const pcOption = document.querySelector('[name="ownershipMode"][value="TRADER_OWNED_WINDOWS_PC"]');
    if (pcOption) pcOption.checked = true;
    byId('pairingConfirmationField').classList.remove('hidden');
    byId('pairingResult').classList.add('hidden');
    byId('generatePairingButton').classList.remove('hidden');
    byId('pairingDialog').showModal();
  });

  byId('generatePairingButton')?.addEventListener('click', async () => {
    const button = byId('generatePairingButton');
    button.disabled = true;
    setText('pairingError', '');
    try {
      const result = await api('/api/auto-trade/pairing', {
        method: 'POST',
        body: JSON.stringify({
          confirmation: byId('pairingConfirmation').value,
          ownershipMode: document.querySelector('[name="ownershipMode"]:checked')?.value || 'TRADER_OWNED_WINDOWS_PC'
        })
      });
      lastPairingCode = result.pairing?.code || '';
      setText('pairingCode', lastPairingCode || '—');
      setText('pairingExpiry', `Tamat: ${timeText(result.pairing?.expiresAt)} • dipaparkan sekali sahaja`);
      byId('pairingConfirmationField').classList.add('hidden');
      byId('pairingResult').classList.remove('hidden');
      button.classList.add('hidden');
      await refreshState(true);
    } catch (error) {
      setText('pairingError', error.message);
    } finally {
      button.disabled = false;
    }
  });

  byId('copyPairingCode')?.addEventListener('click', async () => {
    if (!lastPairingCode) return;
    try {
      await navigator.clipboard.writeText(lastPairingCode);
      toast('Kod pairing disalin. Jangan kongsi dengan pihak lain.');
    } catch (_) {
      setText('pairingError', 'Browser tidak membenarkan salin automatik. Pilih dan salin kod secara manual.');
    }
  });

  byId('pairingDialog')?.addEventListener('close', () => {
    lastPairingCode = '';
    setText('pairingCode', '—');
    byId('pairingConfirmation').value = '';
  });

  byId('confirmOnButton')?.addEventListener('click', async () => {
    const button = byId('confirmOnButton');
    button.disabled = true;
    setText('onError', '');
    try {
      const state = await api('/api/auto-trade/on', {
        method: 'POST', body: JSON.stringify({ confirmation: byId('onConfirmation').value })
      });
      byId('onDialog').close();
      render(state);
      toast('Arahan ON dihantar. Menunggu acknowledgement Secure Pod.');
    } catch (error) {
      setText('onError', error.message);
    } finally {
      button.disabled = false;
    }
  });

  byId('stopButton')?.addEventListener('click', async () => {
    if (!window.confirm('STOP entry baharu? Posisi terbuka akan terus diurus oleh EXIT 32.3 StepLock.')) return;
    const button = byId('stopButton');
    button.disabled = true;
    try {
      render(await api('/api/auto-trade/stop', { method: 'POST', body: '{}' }));
      toast('Entry baharu telah disekat. Menunggu acknowledgement STOP.');
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  byId('emergencyButton')?.addEventListener('click', () => {
    setText('emergencyError', '');
    byId('emergencyPassword').value = '';
    byId('emergencyConfirmation').value = '';
    byId('emergencyDialog').showModal();
  });

  byId('confirmEmergencyButton')?.addEventListener('click', async () => {
    const button = byId('confirmEmergencyButton');
    const passwordInput = byId('emergencyPassword');
    button.disabled = true;
    setText('emergencyError', '');
    const password = passwordInput.value;
    passwordInput.value = '';
    try {
      const state = await api('/api/auto-trade/emergency-close', {
        method: 'POST',
        body: JSON.stringify({ password, confirmation: byId('emergencyConfirmation').value })
      });
      byId('emergencyDialog').close();
      render(state);
      toast('Emergency Close All dihantar. Tunggu acknowledgement MT5.');
    } catch (error) {
      setText('emergencyError', error.message);
    } finally {
      passwordInput.value = '';
      button.disabled = false;
    }
  });

  byId('logoutButton')?.addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch (_) {}
    goToLogin();
  });

  if (!Core) {
    render(syntheticUnavailable('Auto Trade core gagal dimuatkan.'));
    return;
  }
  initialiseSymbols();
  loadUser();
  refreshState(false).then(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connect') === '1' && !currentState?.hostedAccount && !currentState?.pod) {
      workspaceOptedIn = true;
      try { sessionStorage.setItem('zencore_auto_trade_open', '1'); } catch (_) {}
      renderVisibility(currentState || { ui: {} });
      openMt5ConnectDialog();
    }
  });
  refreshMarkets();
  window.setInterval(() => refreshState(true), 3000);
  window.setInterval(refreshMarkets, 15000);
})();
