const crypto = require('crypto');
const Core = require('./auto-trade-core');

function serviceError(code, message, status = 400, fields = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.fields = fields;
  return error;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function canonicalCommand(command) {
  return JSON.stringify({
    id: command.id,
    userId: command.userId,
    podId: command.podId,
    type: command.type,
    payload: command.payload || {},
    createdAt: command.createdAt,
    expiresAt: command.expiresAt
  });
}

function createAutoTradeService(options = {}) {
  const store = options.store;
  if (!store) throw new Error('Auto Trade store is required');
  const signingKey = String(options.commandSigningKey || '');
  if (Buffer.byteLength(signingKey) < 32) throw new Error('ZENCORE_COMMAND_SIGNING_KEY must be at least 32 bytes.');
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const commandTtlMs = Math.max(15_000, Number(options.commandTtlMs) || 2 * 60 * 1000);
  const pairingTtlMs = Math.max(2 * 60 * 1000, Math.min(30 * 60 * 1000,
    Number(options.pairingTtlMs) || 10 * 60 * 1000));

  function commandSigningKeyForPod(podId) {
    return crypto.createHmac('sha256', signingKey)
      .update(`zencore-pod-command-v1:${String(podId || '')}`)
      .digest('base64url');
  }

  function signCommand(command) {
    return crypto.createHmac('sha256', commandSigningKeyForPod(command.podId))
      .update(canonicalCommand(command)).digest('hex');
  }

  async function issueCommand({ userId, podId, type, payload = {}, dedupeKey = null, ttlMs = commandTtlMs }) {
    if (!Core.COMMAND_TYPES.includes(type)) throw serviceError('INVALID_COMMAND', 'Jenis arahan tidak sah.');
    if (Core.containsForbiddenCredentialKey(payload)) {
      throw serviceError('CREDENTIAL_REJECTED', 'Credential broker tidak dibenarkan dalam arahan ZenCore.', 400);
    }
    const createdAt = now();
    const unsigned = {
      id: crypto.randomUUID(), userId, podId, type, payload,
      createdAt, expiresAt: createdAt + Math.max(15_000, ttlMs)
    };
    const command = {
      ...unsigned,
      signature: signCommand(unsigned),
      signedEnvelope: Buffer.from(canonicalCommand(unsigned)).toString('base64url'),
      dedupeKey
    };
    return store.createCommand(command);
  }

  async function state(userId) {
    const [profile, pod, positions, audit, pairing] = await Promise.all([
      store.getProfile(userId),
      store.getPodForUser(userId),
      store.listPositions(userId),
      store.listAudit(userId, 30),
      typeof store.getActivePairingForUser === 'function'
        ? store.getActivePairingForUser(userId, now()) : null
    ]);
    const connection = Core.podConnectionState(pod, now());
    const settings = profile ? {
      capitalUsd: profile.capitalUsd,
      lotPerLayer: profile.lotPerLayer,
      layers: profile.layers,
      symbols: profile.symbols,
      totalLot: profile.lotPerLayer != null && profile.layers != null
        ? Math.round(profile.lotPerLayer * profile.layers * 100000) / 100000 : null,
      riskAcknowledgedAt: profile.riskAcknowledgedAt
    } : null;
    const effectiveState = !pod ? 'UNPROVISIONED' : (profile?.effectiveState || 'STOPPED');
    const desiredState = profile?.desiredState || 'STOPPED';
    const settingsReady = !!profile && Core.validateSettings(profile).ok && !!profile.riskAcknowledgedAt;
    return {
      ok: true,
      mode: 'DEMO',
      control: {
        desiredState,
        effectiveState,
        stateVersion: profile?.stateVersion || 0,
        pendingCommandId: profile?.pendingCommandId || null,
        lastError: profile?.lastError || null,
        canEnter: desiredState === 'ON' && effectiveState === 'ON' && connection.ready,
        canTurnOn: settingsReady && connection.ready
      },
      connection,
      pod: pod ? {
        label: pod.label,
        ownershipMode: pod.ownershipMode,
        accountMask: pod.accountMask,
        serverMask: pod.serverMask,
        brokerMask: pod.brokerMask,
        tradeMode: pod.tradeMode,
        terminalTradeAllowed: pod.terminalTradeAllowed,
        accountTradeAllowed: pod.accountTradeAllowed,
        expertTradeAllowed: pod.expertTradeAllowed,
        connectorVersion: pod.connectorVersion,
        terminalBuild: pod.terminalBuild,
        lastSeenAt: pod.lastSeenAt,
        symbolSpecs: pod.symbolSpecs || {}
      } : null,
      pairing: pairing ? {
        status: 'WAITING_FOR_SECURE_POD',
        ownershipMode: pairing.ownershipMode,
        expiresAt: pairing.expiresAt
      } : null,
      settings,
      positions,
      summary: {
        openPositions: positions.length,
        floatingProfitUsd: Math.round(positions.reduce((sum, item) => sum + (Number(item.profitUsd) || 0), 0) * 100) / 100,
        totalVolume: Math.round(positions.reduce((sum, item) => sum + (Number(item.volume) || 0), 0) * 100000) / 100000
      },
      audit,
      safeguards: {
        brokerCredentialsInControlPlane: false,
        traderOwnsCloudAndWindows: true,
        podCommandKeyIsPerPod: true,
        riskWarningOnly: true,
        stopKeepsExitManagement: true,
        emergencyRequiresStepUp: true
      },
      generatedAt: now()
    };
  }

  async function createPairingSession(userId, input = {}) {
    if (Core.containsForbiddenCredentialKey(input)) {
      throw serviceError('CREDENTIAL_REJECTED', 'Pairing tidak menerima ID, password atau server MT5.', 400);
    }
    if (String(input.confirmation || '').trim().toUpperCase() !== 'PAIR SECURE POD') {
      throw serviceError('CONFIRMATION_REQUIRED', 'Taip PAIR SECURE POD untuk menjana kod pairing.', 400);
    }
    const positions = await store.listPositions(userId);
    if (positions.length) {
      throw serviceError(
        'OPEN_POSITIONS',
        'Secure Pod tidak boleh diganti ketika posisi ZenCore masih terbuka.',
        409
      );
    }
    const createdAt = now();
    const pairingCode = `zcpair_${crypto.randomBytes(32).toString('base64url')}`;
    const label = String(input.label || 'Trader-owned Azure Secure Pod')
      .replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 60) || 'Trader-owned Azure Secure Pod';
    const pairing = await store.createPairingSession({
      id: crypto.randomUUID(),
      userId,
      label,
      ownershipMode: 'TRADER_OWNED_AZURE',
      codeHash: tokenHash(pairingCode),
      createdAt,
      expiresAt: createdAt + pairingTtlMs
    });
    await store.appendAudit(userId, 'PAIRING_CODE_CREATED', {
      pairingId: pairing.id,
      ownershipMode: pairing.ownershipMode,
      expiresAt: pairing.expiresAt
    });
    return {
      ok: true,
      pairing: {
        code: pairingCode,
        ownershipMode: pairing.ownershipMode,
        expiresAt: pairing.expiresAt,
        displayedOnce: true
      }
    };
  }

  async function pairTraderOwnedPod(input = {}) {
    if (Core.containsForbiddenCredentialKey(input)) {
      throw serviceError('CREDENTIAL_REJECTED', 'Pairing Secure Pod tidak menerima credential broker.', 400);
    }
    const pairingCode = String(input.pairingCode || '');
    if (!/^zcpair_[A-Za-z0-9_-]{40,}$/.test(pairingCode)) {
      throw serviceError('INVALID_PAIRING_CODE', 'Kod pairing tidak sah atau telah tamat.', 401);
    }
    if (String(input.ownershipMode || '').toUpperCase() !== 'TRADER_OWNED_AZURE') {
      throw serviceError('INVALID_OWNERSHIP_MODE', 'Secure Pod mesti dimiliki oleh Azure trader.', 400);
    }
    const pairing = await store.consumePairingSession(tokenHash(pairingCode), now());
    if (!pairing) throw serviceError('INVALID_PAIRING_CODE', 'Kod pairing tidak sah atau telah tamat.', 401);

    const rawToken = `zcpod_${crypto.randomBytes(32).toString('base64url')}`;
    const podId = crypto.randomUUID();
    const pod = await store.provisionPod({
      id: podId,
      userId: pairing.userId,
      label: pairing.label,
      ownershipMode: pairing.ownershipMode,
      tokenHash: tokenHash(rawToken)
    });
    await store.setControl(pairing.userId, {
      desiredState: 'STOPPED', effectiveState: 'STOPPED', pendingCommandId: null, lastError: null
    });
    await store.appendAudit(pairing.userId, 'SECURE_POD_PAIRED', {
      podId: pod.id,
      ownershipMode: pod.ownershipMode,
      mode: 'DEMO'
    });
    return {
      ok: true,
      ownershipMode: pod.ownershipMode,
      podToken: rawToken,
      commandSigningKey: commandSigningKeyForPod(pod.id),
      tokenNotice: 'Machine credentials are returned once and must remain inside the trader-owned Secure Pod.'
    };
  }

  async function saveSettings(userId, input = {}) {
    if (Core.containsForbiddenCredentialKey(input)) {
      throw serviceError('CREDENTIAL_REJECTED', 'Jangan masukkan ID, password atau server MT5 pada halaman ini.', 400);
    }
    const validation = Core.validateSettings(input);
    if (!validation.ok) throw serviceError('VALIDATION_ERROR', 'Semak konfigurasi Auto Trade.', 400, validation.errors);
    if (input.riskAcknowledged !== true) {
      throw serviceError('RISK_ACK_REQUIRED', 'Pengesahan risiko diperlukan.', 400, {
        riskAcknowledged: 'Tandakan pengesahan risiko untuk menyimpan.'
      });
    }
    const saved = await store.saveSettings(userId, {
      ...validation.value,
      riskAcknowledgedAt: now()
    });
    await store.appendAudit(userId, 'SETTINGS_SAVED', {
      capitalUsd: saved.capitalUsd,
      lotPerLayer: saved.lotPerLayer,
      layers: saved.layers,
      symbols: saved.symbols,
      totalLot: validation.value.totalLot
    });
    return state(userId);
  }

  async function turnOn(userId, input = {}) {
    if (String(input.confirmation || '').trim().toUpperCase() !== 'AKTIFKAN DEMO') {
      throw serviceError('CONFIRMATION_REQUIRED', 'Taip AKTIFKAN DEMO untuk menghidupkan sistem.', 400);
    }
    const [profile, pod] = await Promise.all([store.getProfile(userId), store.getPodForUser(userId)]);
    const settingsValidation = Core.validateSettings(profile || {});
    if (!settingsValidation.ok || !profile?.riskAcknowledgedAt) {
      throw serviceError('SETTINGS_REQUIRED', 'Simpan konfigurasi dan pengesahan risiko dahulu.', 409);
    }
    const connection = Core.podConnectionState(pod, now());
    if (!connection.ready) {
      throw serviceError('POD_NOT_READY', connection.label, 409);
    }
    const issued = await issueCommand({
      userId, podId: pod.id, type: 'SYSTEM_ON',
      payload: {
        mode: 'DEMO',
        strategy: 'NORMAL_3M_SOP_V32',
        exitSchema: '32.3-EXIT-STEPLOCK',
        settings: settingsValidation.value
      }
    });
    await store.setControl(userId, {
      desiredState: 'ON', effectiveState: 'ARMING',
      pendingCommandId: issued.command.id, lastError: null
    });
    await store.appendAudit(userId, 'SYSTEM_ON_REQUESTED', { commandId: issued.command.id });
    return state(userId);
  }

  async function stop(userId) {
    const pod = await store.getPodForUser(userId);
    if (!pod) {
      await store.setControl(userId, {
        desiredState: 'STOPPED', effectiveState: 'STOPPED', pendingCommandId: null, lastError: null
      });
      await store.appendAudit(userId, 'SYSTEM_STOPPED', { reason: 'NO_POD' });
      return state(userId);
    }
    const issued = await issueCommand({
      userId, podId: pod.id, type: 'SYSTEM_STOP',
      payload: { keepExitManagement: true, blockNewEntriesImmediately: true }
    });
    await store.setControl(userId, {
      desiredState: 'STOPPED', effectiveState: 'STOPPING',
      pendingCommandId: issued.command.id, lastError: null
    });
    await store.appendAudit(userId, 'SYSTEM_STOP_REQUESTED', {
      commandId: issued.command.id, keepExitManagement: true
    });
    return state(userId);
  }

  async function emergencyCloseAll(userId, input = {}, stepUpVerified = false) {
    if (!stepUpVerified) throw serviceError('STEP_UP_REQUIRED', 'Pengesahan password ZenCore diperlukan.', 401);
    if (String(input.confirmation || '').trim().toUpperCase() !== 'TUTUP SEMUA') {
      throw serviceError('CONFIRMATION_REQUIRED', 'Taip TUTUP SEMUA untuk mengesahkan tindakan kecemasan.', 400);
    }
    const pod = await store.getPodForUser(userId);
    if (!pod) throw serviceError('POD_NOT_READY', 'Secure Pod belum disediakan.', 409);
    const issued = await issueCommand({
      userId, podId: pod.id, type: 'EMERGENCY_CLOSE_ALL',
      payload: { scope: 'ALL_OPEN_POSITIONS', blockNewEntriesImmediately: true },
      ttlMs: 10 * 60 * 1000
    });
    await store.setControl(userId, {
      desiredState: 'STOPPED', effectiveState: 'EMERGENCY_CLOSING',
      pendingCommandId: issued.command.id, lastError: null
    });
    await store.appendAudit(userId, 'EMERGENCY_CLOSE_REQUESTED', { commandId: issued.command.id });
    return state(userId);
  }

  async function provisionDemoPod(userId, label = 'ZenCore MT5 Secure Pod') {
    const rawToken = `zcpod_${crypto.randomBytes(32).toString('base64url')}`;
    const pod = await store.provisionPod({
      id: crypto.randomUUID(), userId,
      label: String(label || 'ZenCore MT5 Secure Pod').slice(0, 60),
      ownershipMode: 'INTERNAL_DEMO',
      tokenHash: tokenHash(rawToken)
    });
    await store.setControl(userId, {
      desiredState: 'STOPPED', effectiveState: 'STOPPED', pendingCommandId: null, lastError: null
    });
    await store.appendAudit(userId, 'SECURE_POD_PROVISIONED', { podId: pod.id, mode: 'DEMO' });
    return {
      pod: { id: pod.id, label: pod.label, ownershipMode: pod.ownershipMode },
      token: rawToken,
      commandSigningKey: commandSigningKeyForPod(pod.id)
    };
  }

  async function authenticatePod(rawToken) {
    if (!/^zcpod_[A-Za-z0-9_-]{40,}$/.test(String(rawToken || ''))) return null;
    return store.findPodByTokenHash(tokenHash(rawToken));
  }

  async function heartbeat(rawToken, input = {}) {
    const pod = await authenticatePod(rawToken);
    if (!pod) throw serviceError('INVALID_POD_TOKEN', 'Secure Pod tidak dibenarkan.', 401);
    const heartbeatValidation = Core.normaliseHeartbeat(input);
    if (!heartbeatValidation.ok) {
      throw serviceError('INVALID_HEARTBEAT', 'Heartbeat Secure Pod ditolak.', 400, heartbeatValidation.errors);
    }
    const seenAt = now();
    const updated = await store.updatePodHeartbeat(pod.id, heartbeatValidation.value, seenAt);
    await store.replacePositions(pod.userId, heartbeatValidation.value.positions, seenAt);
    return {
      ok: true,
      podState: Core.podConnectionState(updated, seenAt),
      desiredState: (await store.getProfile(pod.userId))?.desiredState || 'STOPPED',
      serverTime: seenAt
    };
  }

  async function nextCommand(rawToken) {
    const pod = await authenticatePod(rawToken);
    if (!pod) throw serviceError('INVALID_POD_TOKEN', 'Secure Pod tidak dibenarkan.', 401);
    const command = await store.nextCommandForPod(pod.id, now());
    if (!command) return { ok: true, command: null, serverTime: now() };
    return {
      ok: true,
      command: {
        id: command.id,
        type: command.type,
        payload: command.payload,
        createdAt: command.createdAt,
        expiresAt: command.expiresAt,
        signature: command.signature,
        signedEnvelope: command.signedEnvelope
      },
      serverTime: now()
    };
  }

  async function acknowledgeCommand(rawToken, commandId, input = {}) {
    const pod = await authenticatePod(rawToken);
    if (!pod) throw serviceError('INVALID_POD_TOKEN', 'Secure Pod tidak dibenarkan.', 401);
    if (Core.containsForbiddenCredentialKey(input)) {
      throw serviceError('CREDENTIAL_REJECTED', 'Credential broker tidak dibenarkan dalam acknowledgement.', 400);
    }
    const status = String(input.status || '').toUpperCase();
    if (!['EXECUTED', 'FAILED', 'REJECTED'].includes(status)) {
      throw serviceError('INVALID_ACK', 'Status acknowledgement tidak sah.', 400);
    }
    const result = {
      code: String(input.code || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40),
      message: String(input.message || '').slice(0, 180),
      brokerOrderId: String(input.brokerOrderId || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 50)
    };
    const command = await store.ackCommand(pod.id, String(commandId || ''), status, result);
    if (!command) throw serviceError('COMMAND_NOT_FOUND', 'Arahan tidak dijumpai atau sudah diproses.', 404);

    if (command.type === 'SYSTEM_ON') {
      await store.setControl(pod.userId, status === 'EXECUTED' ? {
        desiredState: 'ON', effectiveState: 'ON', pendingCommandId: null, lastError: null
      } : {
        desiredState: 'STOPPED', effectiveState: 'ERROR', pendingCommandId: null,
        lastError: result.message || 'Secure Pod menolak arahan ON.'
      });
    } else if (command.type === 'SYSTEM_STOP' || command.type === 'EMERGENCY_CLOSE_ALL') {
      await store.setControl(pod.userId, status === 'EXECUTED' ? {
        desiredState: 'STOPPED', effectiveState: 'STOPPED', pendingCommandId: null, lastError: null
      } : {
        desiredState: 'STOPPED', effectiveState: 'ERROR', pendingCommandId: null,
        lastError: result.message || 'Secure Pod gagal melaksanakan arahan.'
      });
    }
    await store.appendAudit(pod.userId, 'COMMAND_ACKNOWLEDGED', {
      commandId: command.id, commandType: command.type, status, code: result.code
    });
    return { ok: true, commandId: command.id, status };
  }

  async function dispatchMarkets(markets = []) {
    const profiles = await store.listOnProfiles();
    let queued = 0;
    for (const profile of profiles) {
      const pod = await store.getPodForUser(profile.userId);
      if (!Core.podConnectionState(pod, now()).ready) continue;
      for (const market of Array.isArray(markets) ? markets : []) {
        const symbol = Core.normaliseSymbol(market?.symbol);
        const setup = Core.buildSetupCommand(market, profile, pod.symbolSpecs?.[symbol]);
        if (!setup) continue;
        const issued = await issueCommand({
          userId: profile.userId,
          podId: pod.id,
          type: 'PLACE_SETUP',
          payload: setup.payload,
          dedupeKey: `SETUP|${setup.signalKey}`,
          ttlMs: 5 * 60 * 1000
        });
        if (issued.created) {
          queued += 1;
          await store.appendAudit(profile.userId, 'SETUP_QUEUED', {
            commandId: issued.command.id,
            symbol: setup.payload.symbol,
            side: setup.payload.side,
            totalLot: setup.payload.totalLot,
            riskLevel: setup.payload.risk.level,
            riskBlocksOrder: false
          });
        }
      }
    }
    const managedProfiles = typeof store.listManagedProfiles === 'function'
      ? await store.listManagedProfiles() : [];
    for (const profile of managedProfiles) {
      const [pod, positions] = await Promise.all([
        store.getPodForUser(profile.userId),
        store.listPositions(profile.userId)
      ]);
      if (!pod) continue;
      const positionSymbols = new Set(positions.map(position => position.symbol));
      for (const market of Array.isArray(markets) ? markets : []) {
        const symbol = Core.normaliseSymbol(market?.symbol);
        if (!positionSymbols.has(symbol)) continue;
        const management = Core.buildManagementCommand(market);
        if (!management) continue;
        const issued = await issueCommand({
          userId: profile.userId,
          podId: pod.id,
          type: 'MANAGE_POSITION',
          payload: management.payload,
          dedupeKey: `MANAGE|${management.managementKey}`,
          ttlMs: 10 * 60 * 1000
        });
        if (issued.created) {
          queued += 1;
          await store.appendAudit(profile.userId, 'POSITION_MANAGEMENT_QUEUED', {
            commandId: issued.command.id,
            symbol,
            actions: management.payload.actions.map(action => action.type)
          });
        }
      }
    }
    return { queued };
  }

  return {
    state,
    saveSettings,
    turnOn,
    stop,
    emergencyCloseAll,
    createPairingSession,
    pairTraderOwnedPod,
    provisionDemoPod,
    authenticatePod,
    heartbeat,
    nextCommand,
    acknowledgeCommand,
    dispatchMarkets,
    signCommand,
    commandSigningKeyForPod
  };
}

module.exports = {
  createAutoTradeService,
  serviceError,
  tokenHash,
  canonicalCommand
};
