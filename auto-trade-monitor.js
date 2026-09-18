(() => {
  'use strict';

  const Core = window.ZenCoreAutoTrade;
  const byId = id => document.getElementById(id);
  const setText = (id, value) => { const element = byId(id); if (element) element.textContent = value; };
  const escape = value => Core?.escapeHtml(value) || String(value ?? '');
  let state = null;

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin', cache: 'no-store', ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    if (response.status === 401) {
      window.location.replace('/login');
      return null;
    }
    let body = {};
    try { body = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  function tone(effective) {
    if (effective === 'ON') return 'on';
    if (['ARMING', 'STOPPING', 'EMERGENCY_CLOSING'].includes(effective)) return 'pending';
    if (effective === 'ERROR') return 'error';
    return 'stopped';
  }

  function price(value, symbol) {
    if (!Number.isFinite(Number(value))) return '—';
    const digits = symbol.includes('JPY') ? 3 : ['US30', 'BTCUSD'].includes(symbol) ? 2 : symbol === 'XAUUSD' ? 3 : 5;
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
  }

  function money(value) {
    return `USD ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function activePair() {
    return Core?.normaliseSymbol(byId('pairSelector')?.value) || 'XAUUSD';
  }

  function renderPositions() {
    const host = byId('mt5PairPositions');
    if (!host || !state) return;
    const pair = activePair();
    const positions = (state.positions || []).filter(position => position.symbol === pair);
    if (!positions.length) {
      host.innerHTML = `<div class="mt5-empty">Tiada posisi MT5 aktif untuk ${escape(pair)}.</div>`;
      return;
    }
    host.innerHTML = positions.slice(0, 5).map(position => {
      const pnl = Number(position.profitUsd || 0);
      return `<div class="mt5-position-row">
        <span class="${position.side === 'BUY' ? 'buy' : 'sell'}">${escape(position.side)}</span>
        <div><b>${escape(price(position.entry, pair))} → ${escape(price(position.currentPrice, pair))}</b><small>${escape(position.volume)} lot • #${escape(position.ticket)}</small></div>
        <div><b>SL ${escape(price(position.activeSl, pair))}</b><small>${escape(String(position.slLock || 'INITIAL').replaceAll('_', ' '))}</small></div>
        <strong class="${pnl >= 0 ? 'positive' : 'negative'}">${escape(money(pnl))}</strong>
      </div>`;
    }).join('');
  }

  function render(next) {
    state = next;
    const monitor = byId('mt5LiveMonitor');
    const configured = next.ui?.autoTradeConfigured === true || (next.positions || []).length > 0;
    if (monitor) monitor.hidden = !configured;
    if (!configured) return;
    const control = next.control || {};
    const effective = control.effectiveState || 'STOPPED';
    const badge = byId('mt5MonitorBadge');
    if (badge) {
      badge.className = `mt5-monitor-badge ${tone(effective)}`;
      badge.innerHTML = `<i></i>${escape(effective.replaceAll('_', ' '))}`;
    }
    setText('mt5SystemState', effective.replaceAll('_', ' '));
    setText('mt5SystemCopy', control.lastError || (control.canEnter ? 'Entry automatik dibenarkan.' : 'Entry baharu disekat.'));
    setText('mt5PodState', next.connection?.label || 'BELUM CONNECT');
    const identity = next.hostedAccount || next.pod;
    setText('mt5AccountMask', identity?.accountMask || '—');
    setText('mt5ServerMask', identity?.serverMask || '—');
    setText('mt5FloatingPnl', money(next.summary?.floatingProfitUsd));
    const on = byId('mt5TurnOn');
    const stop = byId('mt5Stop');
    if (on) on.disabled = !control.canTurnOn || ['ON', 'ARMING'].includes(effective);
    if (stop) stop.disabled = ['UNPROVISIONED', 'STOPPED', 'STOPPING'].includes(effective);
    renderPositions();
  }

  async function refresh() {
    try {
      const next = await api('/api/auto-trade/state');
      if (next) render(next);
    } catch (error) {
      render({
        control: { effectiveState: 'ERROR', canTurnOn: false, lastError: error.message },
        connection: { label: 'CONTROL PLANE OFFLINE' }, pod: null,
        summary: { floatingProfitUsd: 0 }, positions: []
      });
    }
  }

  byId('mt5TurnOn')?.addEventListener('click', async () => {
    const confirmation = window.prompt('Taip AKTIFKAN DEMO untuk hidupkan Auto Trade:');
    if (confirmation === null) return;
    try {
      render(await api('/api/auto-trade/on', {
        method: 'POST', body: JSON.stringify({ confirmation })
      }));
    } catch (error) {
      window.alert(error.message);
    }
  });

  byId('mt5Stop')?.addEventListener('click', async () => {
    if (!window.confirm('STOP entry baharu? Posisi aktif akan terus diurus EXIT 32.3 StepLock.')) return;
    try {
      render(await api('/api/auto-trade/stop', { method: 'POST', body: '{}' }));
    } catch (error) {
      window.alert(error.message);
    }
  });

  byId('pairSelector')?.addEventListener('change', renderPositions);
  refresh();
  window.setInterval(refresh, 3000);
})();
