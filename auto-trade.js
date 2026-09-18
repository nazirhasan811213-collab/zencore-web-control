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
    if (response.status === 401 && !path.includes('emergency-close')) return goToLogin();
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

  function renderConnection(state) {
    const connection = state.connection || {};
    const pod = state.pod;
    const badge = byId('connectionBadge');
    if (badge) {
      badge.textContent = connection.state || 'OFFLINE';
      badge.className = `mini-status ${connection.ready ? 'ready' : connection.state === 'BLOCKED_REAL' ? 'blocked' : 'offline'}`;
    }
    setText('summaryPod', connection.ready ? 'READY' : connection.label || 'BELUM CONNECT');
    setText('summaryHeartbeat', pod?.lastSeenAt ? `Heartbeat ${timeText(pod.lastSeenAt)}` : 'Tiada heartbeat');
    setText('accountMask', pod?.accountMask || 'Belum dipautkan');
    setText('serverMask', pod?.serverMask || '—');
    setText('brokerMask', pod?.brokerMask || '—');
    setText('tradeMode', pod?.tradeMode || 'DEMO');
    const health = (id, enabled) => {
      const el = byId(id);
      if (!el) return;
      el.textContent = pod ? (enabled ? 'READY' : 'OFF') : 'WAIT';
      el.className = pod ? (enabled ? 'good' : 'bad') : '';
    };
    health('terminalState', !!pod?.terminalTradeAllowed);
    health('accountTradeState', !!pod?.accountTradeAllowed);
    health('expertTradeState', !!pod?.expertTradeAllowed);
    setText('podNotice', pod
      ? `${connection.label}. Connector ${pod.connectorVersion || '—'} • terminal build ${pod.terminalBuild || '—'}. Identiti penuh kekal di Secure Pod.`
      : 'Secure Pod belum disediakan. Provisioning dibuat dalam execution environment terasing—bukan melalui password form web.');
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
    setText('masterStateCopy', control.lastError || stateCopy(effective));
    setText('summarySystem', effective.replaceAll('_', ' '));
    setText('summarySystemNote', control.canEnter ? 'Entry automatik dibenarkan' : 'Entry baharu disekat');
    const pending = byId('pendingBadge');
    if (pending) pending.classList.toggle('hidden', !control.pendingCommandId);

    const onButton = byId('turnOnButton');
    const stopButton = byId('stopButton');
    const emergencyButton = byId('emergencyButton');
    if (onButton) onButton.disabled = !control.canTurnOn || ['ON', 'ARMING'].includes(effective);
    if (stopButton) stopButton.disabled = ['UNPROVISIONED', 'STOPPED', 'STOPPING'].includes(effective);
    if (emergencyButton) emergencyButton.disabled = !state.pod || !(state.positions || []).length || effective === 'EMERGENCY_CLOSING';
  }

  function renderSettings(state) {
    const settings = state.settings;
    if (!settings || settingsHydrated || settingsDirty) return;
    byId('capitalUsd').value = settings.capitalUsd ?? 100;
    byId('lotPerLayer').value = settings.lotPerLayer ?? 0.01;
    byId('layers').value = settings.layers ?? 3;
    byId('riskAcknowledged').checked = !!settings.riskAcknowledgedAt;
    document.querySelectorAll('[name="symbols"]').forEach(input => {
      input.checked = (settings.symbols || []).includes(input.value);
    });
    settingsHydrated = true;
    updateRiskPreview();
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
      SETTINGS_SAVED: `Konfigurasi disimpan: ${detail.layers || '—'} layer × ${detail.lotPerLayer || '—'} lot.`,
      SYSTEM_ON_REQUESTED: 'Arahan ON dihantar; menunggu acknowledgement.',
      SYSTEM_STOP_REQUESTED: 'Entry baharu disekat; EXIT management dikekalkan.',
      SYSTEM_STOPPED: 'Sistem dihentikan.',
      EMERGENCY_CLOSE_REQUESTED: 'Emergency Close All dihantar ke MT5.',
      SETUP_QUEUED: `${detail.symbol || 'Pair'} ${detail.side || ''} dihantar • ${detail.totalLot || '—'} lot • risk ${detail.riskLevel || 'PENDING'}.`,
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
    renderConnection(state);
    renderMaster(state);
    renderSettings(state);
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
    return {
      capitalUsd: byId('capitalUsd').value,
      lotPerLayer: byId('lotPerLayer').value,
      layers: byId('layers').value,
      symbols: [...document.querySelectorAll('[name="symbols"]:checked')].map(input => input.value)
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
  }

  function initialiseSymbols() {
    const options = byId('symbolOptions');
    const riskSelect = byId('riskSymbol');
    if (!Core || !options || !riskSelect) return;
    options.innerHTML = Core.SUPPORTED_MARKETS.map(symbol => `<label class="symbol-option"><input name="symbols" type="checkbox" value="${symbol}"${symbol === 'XAUUSD' ? ' checked' : ''}><span>${symbol}</span></label>`).join('');
    riskSelect.innerHTML = Core.SUPPORTED_MARKETS.map(symbol => `<option value="${symbol}">${symbol}</option>`).join('');
    document.querySelectorAll('#settingsForm input').forEach(input => input.addEventListener('input', () => {
      settingsDirty = true;
      updateRiskPreview();
    }));
    riskSelect.addEventListener('change', updateRiskPreview);
  }

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
  refreshState(false);
  refreshMarkets();
  window.setInterval(() => refreshState(true), 3000);
  window.setInterval(refreshMarkets, 15000);
})();
