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

function ownershipMode(input, fallback = 'TRADER_OWNED_WINDOWS_PC') {
  const value = String(input || fallback).trim().toUpperCase();
  if (!Core.POD_OWNERSHIP_MODES.includes(value) || value === 'TRADER_OWNED_EA_LOCAL') {
    throw serviceError(
      'INVALID_OWNERSHIP_MODE',
      'Pilih Secure Pod PC Windows sendiri atau Azure milik trader.',
      400
    );
  }
  return value;
}

function defaultPodLabel(mode) {
  return mode === 'TRADER_OWNED_AZURE'
    ? 'Trader-owned Azure Secure Pod'
    : 'Trader-owned Windows PC Secure Pod';
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

function base64urlBytes(value) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return -1;
  try { return Buffer.from(text, 'base64url').length; } catch (_) { return -1; }
}

function validateCredentialEnvelope(input, expectedKeyId) {
  const envelope = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const allowed = new Set(['version', 'algorithm', 'keyId', 'wrappedKey', 'iv', 'ciphertext']);
  const errors = {};
  if (Object.keys(envelope).some(key => !allowed.has(key))) errors.envelope = 'Credential envelope mengandungi field yang tidak dibenarkan.';
  if (envelope.version !== 1) errors.version = 'Versi credential envelope tidak disokong.';
  if (envelope.algorithm !== 'RSA-OAEP-256+A256GCM') errors.algorithm = 'Algoritma credential envelope tidak disokong.';
  if (String(envelope.keyId || '') !== expectedKeyId) errors.keyId = 'Encryption key telah berubah. Buka semula popup MT5.';
  const wrappedBytes = base64urlBytes(envelope.wrappedKey);
  const ivBytes = base64urlBytes(envelope.iv);
  const cipherBytes = base64urlBytes(envelope.ciphertext);
  if (wrappedBytes < 128 || wrappedBytes > 1024) errors.wrappedKey = 'Wrapped key tidak sah.';
  if (ivBytes !== 12) errors.iv = 'Encryption IV tidak sah.';
  if (cipherBytes < 32 || cipherBytes > 8192) errors.ciphertext = 'Encrypted credential tidak sah.';
  return { ok: Object.keys(errors).length === 0, errors };
}

function buildCredentialEncryptionConfig(enabled, keyId, publicKeyPem) {
  if (!enabled) return { enabled: false, algorithm: 'RSA-OAEP-256+A256GCM' };
  if (!keyId || !/^[A-Za-z0-9._:-]{3,80}$/.test(keyId)) {
    throw new Error('ZENCORE_MT5_CREDENTIAL_KEY_ID is required for hosted MT5.');
  }
  let key;
  try { key = crypto.createPublicKey(publicKeyPem); } catch (_) {
    throw new Error('ZENCORE_MT5_CREDENTIAL_PUBLIC_KEY must be a valid RSA public key.');
  }
  if (key.asymmetricKeyType !== 'rsa' || Number(key.asymmetricKeyDetails?.modulusLength || 0) < 2048) {
    throw new Error('Hosted MT5 credential key must be RSA.');
  }
  return {
    enabled: true,
    version: 1,
    algorithm: 'RSA-OAEP-256+A256GCM',
    keyId,
    publicKeySpki: key.export({ type: 'spki', format: 'der' }).toString('base64')
  };
}

function createAutoTradeService(options = {}) {
  const store = options.store;
  if (!store) throw new Error('Auto Trade store is required');
  const signingKey = String(options.commandSigningKey || '');
  if (Buffer.byteLength(signingKey) < 32) throw new Error('ZENCORE_COMMAND_SIGNING_KEY must be at least 32 bytes.');
  const allowDemoExecution = options.allowDemoExecution === true;
  const localEaExecutionUserIds = new Set(Array.isArray(options.localEaExecutionUserIds) ? options.localEaExecutionUserIds : []);
  function executionAllowed(userId, pod) {
    return allowDemoExecution || (localEaExecutionUserIds.has(userId) && isLocalEa(pod));
  }
  const hostedMt5Enabled = options.hostedMt5Enabled === true;
  const hostedWorkerEnabled = hostedMt5Enabled && options.hostedWorkerEnabled === true;
  const hostedWorkerAccountId = String(options.hostedWorkerAccountId || '');
  if (hostedWorkerAccountId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hostedWorkerAccountId)) {
    throw new Error('ZENCORE_GCP_WORKER_HOSTED_ACCOUNT_ID must be a UUIDv4 when configured.');
  }
  const credentialEncryption = buildCredentialEncryptionConfig(
    hostedMt5Enabled,
    String(options.credentialKeyId || ''),
    String(options.credentialPublicKey || '')
  );
  const requiredDemoConnectorVersion = String(
    options.requiredDemoConnectorVersion || '2.2.2-gcp-multiuser-multipair'
  );
  const allowedDemoSymbols = [...new Set(
    (Array.isArray(options.allowedDemoSymbols) ? options.allowedDemoSymbols : ['XAUUSD'])
      .map(Core.normaliseSymbol)
      .filter(symbol => Core.TRADE_SYMBOLS.includes(symbol))
  )];
  if (!allowedDemoSymbols.length) throw new Error('At least one DEMO execution symbol is required.');
  const allowedDemoOwnershipModes = [...new Set(
    (Array.isArray(options.allowedDemoOwnershipModes)
      ? options.allowedDemoOwnershipModes : ['TRADER_OWNED_WINDOWS_PC'])
      .map(value => String(value || '').toUpperCase())
      .filter(value => Core.POD_OWNERSHIP_MODES.includes(value) || value === 'INTERNAL_DEMO')
  )];
  if (!allowedDemoOwnershipModes.length) throw new Error('At least one DEMO execution host mode is required.');
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const dispatchDiagnosticAt = new Map();
  const commandTtlMs = Math.max(15_000, Number(options.commandTtlMs) || 2 * 60 * 1000);
  const hostedLeaseTtlMs = Math.max(30_000, Math.min(5 * 60 * 1000,
    Number(options.hostedLeaseTtlMs) || 2 * 60 * 1000));
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

  const LOCAL_EA_VERSION = '1.0.0-ea-local';
  function isLocalEa(pod) { return pod?.ownershipMode === 'TRADER_OWNED_EA_LOCAL'; }
  async function activeHostedAccount(userId) {
    if (isLocalEa(await store.getPodForUser(userId))) return null;
    return typeof store.getHostedAccount === 'function' ? store.getHostedAccount(userId) : null;
  }
  async function requireHostedTransport(userId) {
    if (isLocalEa(await store.getPodForUser(userId))) {
      throw serviceError('TRANSPORT_REPLACED', 'Akaun ini menggunakan EA tempatan.', 409);
    }
  }
  async function connectLocalEa(userId) {
    const [profile, positions, oldPod, hosted] = await Promise.all([
      store.getProfile(userId), store.listPositions(userId), store.getPodForUser(userId),
      typeof store.getHostedAccount === 'function' ? store.getHostedAccount(userId) : null
    ]);
    // A lost local Connector cannot acknowledge STOP. Recover only after its
    // lease has long expired, with no recorded positions and STOP still requested.
    const recoverOfflineStop = isLocalEa(oldPod) && profile?.desiredState === 'STOPPED' &&
      profile.effectiveState === 'STOPPING' && oldPod.lastSeenAt &&
      now() - oldPod.lastSeenAt >= 120000 &&
      (!hosted?.lastSeenAt || now() - hosted.lastSeenAt >= 120000);
    if (positions.length || (profile && (profile.desiredState !== 'STOPPED' ||
        (!['STOPPED', 'ERROR', 'UNPROVISIONED'].includes(profile.effectiveState) && !recoverOfflineStop)))) {
      throw serviceError('STOP_BEFORE_PAIRING', 'Tekan OFF dan selesaikan posisi ZenCore sebelum pautkan EA.', 409);
    }
    // Never rotate credentials or switch execution engines while an old engine can still trade.
    if ((oldPod?.lastSeenAt && now() - oldPod.lastSeenAt < 120000) ||
        (hosted?.lastSeenAt && now() - hosted.lastSeenAt < 120000)) {
      throw serviceError('OLD_CONNECTOR_ACTIVE', 'Tutup Connector/worker lama dan tunggu 2 minit sebelum pautkan EA.', 409);
    }
    await store.retireExecutionCommands(userId);
    const token = `zcpod_${crypto.randomBytes(32).toString('base64url')}`;
    const pod = await store.provisionPod({ id: crypto.randomUUID(), userId,
      label: 'ZenCore EA + Local Connector', ownershipMode: 'TRADER_OWNED_EA_LOCAL', tokenHash: tokenHash(token) });
    await store.setControl(userId, { desiredState: 'STOPPED', effectiveState: 'STOPPED', pendingCommandId: null, lastError: null });
    await store.appendAudit(userId, 'EA_LOCAL_CONNECTED', { podId: pod.id, mode: 'UNPAIRED' });
    return { ok: true, podToken: token, commandSigningKey: commandSigningKeyForPod(pod.id),
      podId: pod.id, connectorVersion: LOCAL_EA_VERSION, executionEnabled: executionAllowed(userId, pod) };
  }

  function connectionState(pod) {
    if (pod && !executionAllowed(pod.userId, pod)) pod = { ...pod, demoExecutionUnlocked: false };
    return Core.podConnectionState(pod, now(), executionAllowed(pod?.userId, pod) ? {
      connectorVersion: isLocalEa(pod) ? (['1.1.0-ea-local','1.2.0-ea-local','1.3.0-ea-local'].includes(pod.connectorVersion)?pod.connectorVersion:LOCAL_EA_VERSION) : requiredDemoConnectorVersion,
      realAccountAllowed: isLocalEa(pod) && pod.connectorVersion === '1.3.0-ea-local',
      ownershipModes: isLocalEa(pod) ? ['TRADER_OWNED_EA_LOCAL'] : allowedDemoOwnershipModes
    } : {});
  }

  function hostedConnectionState(hostedAccount) {
    if (!hostedAccount) return null;
    const online = !!hostedAccount.lastSeenAt && now() - hostedAccount.lastSeenAt <= 30_000;
    if (hostedAccount.status === 'ERROR') {
      return { state: 'HOSTED_ERROR', label: 'MT5 HOSTED PERLU PERHATIAN', online, connected: false, ready: false };
    }
    if (!online || hostedAccount.status !== 'CONNECTED_LOCKED') {
      return {
        state: hostedAccount.status === 'LEASED' ? 'HOSTED_CONNECTING' : 'HOSTED_PENDING',
        label: hostedAccount.status === 'LEASED' ? 'MT5 HOSTED SEDANG DISAHKAN' : 'MT5 HOSTED MENUNGGU WORKER',
        online: false, connected: false, ready: false
      };
    }
    const executionReady = allowDemoExecution &&
      String(hostedAccount.connectorVersion || '') === requiredDemoConnectorVersion &&
      hostedAccount.terminalTradeAllowed === true &&
      hostedAccount.accountTradeAllowed === true &&
      hostedAccount.expertTradeAllowed === true;
    return {
      state: executionReady ? 'HOSTED_READY' : 'HOSTED_CONNECTED_LOCKED',
      label: executionReady ? 'MT5 HOSTED READY • DEMO' : 'CONNECTED • EXECUTION LOCKED',
      online: true, connected: true, ready: executionReady
    };
  }

  async function issueCommand({ userId, podId, type, payload = {}, dedupeKey = null, ttlMs = commandTtlMs, notAfterMs = Infinity }) {
    if (!Core.COMMAND_TYPES.includes(type)) throw serviceError('INVALID_COMMAND', 'Jenis arahan tidak sah.');
    if (Core.containsForbiddenCredentialKey(payload)) {
      throw serviceError('CREDENTIAL_REJECTED', 'Credential broker tidak dibenarkan dalam arahan ZenCore.', 400);
    }
    const createdAt = now();
    const unsigned = {
      id: crypto.randomUUID(), userId, podId, type, payload,
      createdAt, expiresAt: Math.min(createdAt + Math.max(15_000, ttlMs), notAfterMs)
    };
    const command = {
      ...unsigned,
      signature: signCommand(unsigned),
      signedEnvelope: Buffer.from(canonicalCommand(unsigned)).toString('base64url'),
      dedupeKey
    };
    return store.createCommand(command);
  }

  async function issueHostedCommand({ userId, accountId, type, payload = {}, dedupeKey = null, ttlMs = commandTtlMs, notAfterMs = Infinity }) {
    if (!Core.COMMAND_TYPES.includes(type)) throw serviceError('INVALID_COMMAND', 'Jenis arahan tidak sah.');
    if (Core.containsForbiddenCredentialKey(payload)) {
      throw serviceError('CREDENTIAL_REJECTED', 'Credential broker tidak dibenarkan dalam arahan ZenCore.', 400);
    }
    const createdAt = now();
    return store.createHostedCommand({
      id: crypto.randomUUID(), userId, accountId, type, payload,
      createdAt, expiresAt: Math.min(createdAt + Math.max(15_000, ttlMs), notAfterMs), dedupeKey
    });
  }


  async function executionDiagnostics(userId) {
    const commands = await store.listRecentCommands(userId, 10);
    return { ok: true, commands: commands.map(command => {
      const checks = [];
      let signed;
      try {
        const raw = Buffer.from(command.signedEnvelope || '', 'base64url');
        signed = JSON.parse(raw.toString('utf8'));
        const expected = crypto.createHmac('sha256', commandSigningKeyForPod(command.podId)).update(raw).digest('hex');
        if (expected !== command.signature) checks.push('SIGNATURE_REJECTED');
        const { isDeepStrictEqual } = require('node:util');
        for (const key of ['id','type','payload','createdAt','expiresAt']) {
          if (!isDeepStrictEqual(command[key], signed[key])) checks.push('ENVELOPE_MISMATCH_' + key.toUpperCase());
        }
        if (signed.podId !== command.podId) checks.push('WRONG_POD');
        const p = signed.payload || {}, snap = p.analysisSnapshot || {};
        if (['PLACE_SETUP','MANAGE_POSITION'].includes(signed.type)) {
          if (p.analysisContractVersion !== 'ZENCORE_ANALYSIS_EXECUTION_V1' || snap.contractVersion !== 'ZENCORE_ANALYSIS_EXECUTION_V1' ||
              p.strategy !== 'NORMAL_3M_SOP_V32' || p.schemaVersion !== '32.3-EXIT-STEPLOCK' || snap.decisionOwner !== 'ZENCORE_ANALYSIS' ||
              snap.decision !== (signed.type === 'PLACE_SETUP' ? 'ENTRY_AUTHORIZED' : 'POSITION_ACTION_AUTHORIZED')) checks.push('ANALYSIS_CONTRACT_REJECTED');
          if (p.strategyMode === 'TF15_INTRA' && String(snap.executionTimeframe).replace('m','') !== '15') checks.push('TF15_SNAPSHOT_REQUIRED');
          if (p.symbol !== snap.symbol) checks.push('SYMBOL_REJECTED');
          if (signed.type === 'PLACE_SETUP') {
            for (const key of ['side','entry','sl','tp1','tp2','tp3']) if (p[key] !== snap[key]) checks.push('ANALYSIS_PRICE_MISMATCH_' + key.toUpperCase());
            if (p.exitPolicy != null && (p.strategyMode !== 'TF2_SCALPING' || p.exitPolicy.version !== 'TF2_TIGHT_SL_3C_V1' || p.exitPolicy.slDistanceFactor !== .8 || p.exitPolicy.maxCompletedCandlesWithoutTp1 !== 3 || p.exitPolicy.timeframeMinutes !== 2)) checks.push('EXIT_POLICY_REJECTED');
          }
        }
      } catch (_) { checks.push('ENVELOPE_INVALID'); }
      // Whitelist metadata only: never return keys, tokens, signatures, envelopes, credentials or raw payloads.
      return { type: command.type, symbol: command.payload?.symbol || null,
        timeframe: command.payload?.strategyMode === 'TF15_INTRA' ? '15' : '2', status: command.status,
        createdAt: command.createdAt, deliveredAt: command.deliveredAt, acknowledgedAt: command.acknowledgedAt,
        resultCode: String(command.result?.code || '').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,40), checks };
    }) };
  }

  async function connectionMonitor(userId) {
    const [profile, pod, hosted, events, usage, positions] = await Promise.all([
      store.getProfile(userId), store.getPodForUser(userId), activeHostedAccount(userId), store.listAudit(userId, 30),
      store.traderActivitySummary(userId, now()), store.listPositions(userId)
    ]);
    const endpoint = hosted || pod;
    const connection = hosted ? hostedConnectionState(hosted) : connectionState(pod);
    return {
      tradingActivity: require('./trader-activity').activityView(usage, positions, now()),
      activity: events.filter(event => ['EA_LOCAL_CONNECTED', 'SECURE_POD_PAIRED', 'HOSTED_WORKER_ERROR', 'SYSTEM_ON_REQUESTED', 'SYSTEM_STOP_REQUESTED', 'HOSTED_SYSTEM_ON_REQUESTED', 'HOSTED_SYSTEM_STOP_REQUESTED', 'SYSTEM_STOPPED'].includes(event.type)).slice(0, 5).map(event => ({ type: event.type, createdAt: event.createdAt })),
      transport: hosted ? 'HOSTED' : isLocalEa(pod) ? 'EA_LOCAL' : pod ? 'SECURE_POD' : 'NOT_LINKED',
      tradeMode: endpoint?.tradeMode || null,
      connectorVersion: endpoint?.connectorVersion || null,
      accountMask: endpoint?.accountMask || null,
      serverMask: endpoint?.serverMask || null,
      lastSeenAt: endpoint?.lastSeenAt || null,
      connection,
      permissions: {
        terminal: endpoint?.terminalTradeAllowed === true,
        account: endpoint?.accountTradeAllowed === true,
        expert: endpoint?.expertTradeAllowed === true
      },
      control: {
        desiredState: profile?.desiredState || 'STOPPED',
        effectiveState: profile?.effectiveState || 'STOPPED'
      }
    };
  }

  async function state(userId) {
    const [profile, pod, positions, audit, pairing, hostedAccount] = await Promise.all([
      store.getProfile(userId),
      store.getPodForUser(userId),
      store.listPositions(userId),
      store.listAudit(userId, 30),
      typeof store.getActivePairingForUser === 'function'
        ? store.getActivePairingForUser(userId, now()) : null,
      activeHostedAccount(userId)
    ]);
    const allowDemoExecution = executionAllowed(userId, pod);
    const podConnection = connectionState(pod);
    const connection = hostedAccount ? hostedConnectionState(hostedAccount) : podConnection;
    const settings = profile ? {
      strategyMode: profile.strategyMode,
      modeSettings: profile.modeSettings,
      tradingSchedule: profile.tradingSchedule,
      strategyExitPolicies: profile.strategyExitPolicies,
      capitalUsd: profile.capitalUsd,
      lotPerLayer: profile.lotPerLayer,
      layers: profile.layers,
      symbols: profile.symbols.filter(symbol => Core.TRADE_SYMBOLS.includes(symbol)),
      totalLot: profile.lotPerLayer != null && profile.layers != null
        ? Math.round(profile.lotPerLayer * profile.layers * 100000) / 100000 : null,
      riskAcknowledgedAt: profile.riskAcknowledgedAt
    } : null;
    const effectiveState = !pod && !hostedAccount ? 'UNPROVISIONED' : (profile?.effectiveState || 'STOPPED');
    const desiredState = profile?.desiredState || 'STOPPED';
    const entryWindow=Core.tradingWindow(profile?.tradingSchedule,now());
    const strategyReady=profile?.strategyMode==='TF2_SCALPING'||!profile?.strategyMode||(!hostedAccount&&isLocalEa(pod)&&['1.2.0-ea-local','1.3.0-ea-local'].includes(pod?.connectorVersion));
    const exitPolicyReady = !(profile?.strategyMode!=='TF15_INTRA' && profile?.strategyExitPolicies?.TF2_SCALPING) || (!hostedAccount && isLocalEa(pod) && ['1.1.0-ea-local','1.2.0-ea-local','1.3.0-ea-local'].includes(pod?.connectorVersion));
    const settingsReady = !!profile && Core.validateSettings(profile).ok && !!profile.riskAcknowledgedAt;
    return {
      ok: true,
      mode: hostedAccount?.tradeMode || pod?.tradeMode || 'UNPAIRED',
      supportedAccountModes: ['DEMO', 'REAL'],
      realAccountTransport: 'TRADER_OWNED_EA_LOCAL',
      control: {
        desiredState,
        effectiveState,
        executionRolloutUnlocked: allowDemoExecution,
        executionSymbols: allowedDemoSymbols,
        requiredConnectorVersion: allowDemoExecution ? (isLocalEa(pod) ? (pod.tradeMode === 'REAL' ? '1.3.0-ea-local' : LOCAL_EA_VERSION) : requiredDemoConnectorVersion) : null,
        stateVersion: profile?.stateVersion || 0,
        pendingCommandId: profile?.pendingCommandId || null,
        lastError: profile?.lastError || null,
        tradingWindow: entryWindow,
        strategyReady,
        strategyReason: strategyReady?null:'TF15/Both memerlukan EA/Connector 1.2.',
        exitPolicyReady,
        exitPolicyReason: exitPolicyReady ? null : 'Rule TF2 memerlukan EA/Connector 1.1; entry menunggu kemas kini.',
        canEnter: exitPolicyReady && entryWindow.allowed && strategyReady && executionAllowed(userId,pod) && desiredState === 'ON' && effectiveState === 'ON' && connection.ready,
        canTurnOn: exitPolicyReady && strategyReady && executionAllowed(userId,pod) && settingsReady && connection.ready
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
        demoExecutionUnlocked: pod.demoExecutionUnlocked === true,
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
      hostedAccount,
      hostedMt5: {
        available: hostedMt5Enabled,
        workerIdentityEnabled: hostedWorkerEnabled,
        provider: 'GOOGLE_CLOUD',
        executionReady: !!(hostedAccount && connection.ready),
        status: hostedAccount?.status || 'NOT_CONNECTED',
        encryptionAlgorithm: credentialEncryption.algorithm,
        keyId: credentialEncryption.keyId || null,
        message: hostedMt5Enabled
          ? 'Credential plaintext dienkripsi dalam browser dan hanya envelope disimpan. Worker hosted masih perlu lulus Demo.'
          : 'Hosted MT5 masih dikunci sehingga external vault dan managed Windows worker tersedia.'
      },
      ui: {
        autoTradeConfigured: !!profile || !!pod || !!hostedAccount || positions.length > 0
      },
      settings,
      positions,
      summary: {
        openPositions: positions.length,
        floatingProfitUsd: Math.round(positions.reduce((sum, item) => sum + (Number(item.profitUsd) || 0), 0) * 100) / 100,
        totalVolume: Math.round(positions.reduce((sum, item) => sum + (Number(item.volume) || 0), 0) * 100000) / 100000
      },
      audit,
      safeguards: {
        brokerCredentialsInControlPlane: hostedAccount ? 'ENCRYPTED_ENVELOPE_ONLY' : false,
        plaintextBrokerCredentialsInControlPlane: false,
        hostedCredentialEnvelopeOnly: true,
        hostedCredentialPrivateKeyInWebApp: false,
        hostedWorkerIdentity: hostedWorkerEnabled ? 'GOOGLE_SIGNED_INSTANCE_JWT' : 'LOCKED',
        traderOwnsExecutionHost: !hostedAccount,
        brokerCredentialsStayOnExecutionHost: !hostedAccount,
        controlPlaneExecutionUnlocked: allowDemoExecution,
        demoOnly: !isLocalEa(pod),
        allowedDemoSymbols,
        requiredConnectorVersion: allowDemoExecution ? (isLocalEa(pod) ? (pod.tradeMode === 'REAL' ? '1.3.0-ea-local' : LOCAL_EA_VERSION) : requiredDemoConnectorVersion) : null,
        podCommandKeyIsPerPod: true,
        riskWarningOnly: true,
        stopKeepsExitManagement: true,
        emergencyRequiresStepUp: true
      },
      generatedAt: now()
    };
  }

  function credentialEncryptionConfig() {
    if (!credentialEncryption.enabled) {
      throw serviceError(
        'HOSTED_MT5_LOCKED',
        'Hosted MT5 masih dikunci sehingga external vault dan managed Windows worker tersedia.',
        409
      );
    }
    return { ok: true, encryption: { ...credentialEncryption } };
  }

  async function connectHostedAccount(userId, input = {}, stepUpVerified = false) {
    if (!hostedMt5Enabled) {
      throw serviceError(
        'HOSTED_MT5_LOCKED',
        'Hosted MT5 masih dikunci sehingga external vault dan managed Windows worker tersedia.',
        409
      );
    }
    if (!stepUpVerified) throw serviceError('STEP_UP_REQUIRED', 'Pengesahan password ZenCore diperlukan.', 401);
    if (String(input.confirmation || '').trim().toUpperCase() !== 'CONNECT MT5 DEMO') {
      throw serviceError('CONFIRMATION_REQUIRED', 'Taip CONNECT MT5 DEMO untuk menyimpan sambungan terenkripsi.', 400);
    }
    if (Core.containsForbiddenCredentialKey(input)) {
      throw serviceError('PLAINTEXT_CREDENTIAL_REJECTED', 'Plaintext ID, password atau server MT5 tidak dibenarkan ke web server.', 400);
    }
    const identity = Core.validateMaskedIdentity(input);
    if (!identity.ok) throw serviceError('INVALID_MASKED_IDENTITY', 'Identiti bertopeng tidak sah.', 400, identity.errors);
    const tradeMode = String(input.tradeMode || '').toUpperCase();
    if (tradeMode !== 'DEMO') {
      throw serviceError('DEMO_ONLY', 'Fasa hosted MT5 ini hanya menerima akaun DEMO.', 409);
    }
    const envelopeValidation = validateCredentialEnvelope(
      input.credentialEnvelope,
      credentialEncryption.keyId
    );
    if (!envelopeValidation.ok) {
      throw serviceError('INVALID_CREDENTIAL_ENVELOPE', 'Credential envelope ditolak.', 400, envelopeValidation.errors);
    }
    if (typeof store.saveHostedAccountEnvelope !== 'function') {
      throw serviceError('HOSTED_MT5_STORE_UNAVAILABLE', 'Encrypted account vault belum tersedia.', 503);
    }
    const positions = await store.listPositions(userId);
    if (positions.length) {
      throw serviceError(
        'OPEN_POSITIONS',
        'Akaun execution tidak boleh ditukar ketika posisi ZenCore masih terbuka.',
        409
      );
    }
    if (typeof store.cancelPendingEntryCommands === 'function') {
      await store.cancelPendingEntryCommands(userId, 'HOSTED_MT5_MIGRATION');
    }
    await store.setControl(userId, {
      desiredState: 'STOPPED', effectiveState: 'STOPPED', pendingCommandId: null, lastError: null
    });
    const saved = await store.saveHostedAccountEnvelope({
      id: crypto.randomUUID(),
      userId,
      ...identity.value,
      tradeMode,
      keyId: credentialEncryption.keyId,
      credentialEnvelope: input.credentialEnvelope,
      now: now()
    });
    let assignedSlot = null;
    if (typeof store.assignHostedAccountSlot === 'function') {
      assignedSlot = await store.assignHostedAccountSlot(saved.id);
    }
    await store.appendAudit(userId, 'HOSTED_MT5_ENVELOPE_SAVED', {
      accountMask: saved.accountMask,
      serverMask: saved.serverMask,
      tradeMode: saved.tradeMode,
      keyId: saved.keyId,
      plaintextStored: false,
      status: saved.status,
      workerSlot: assignedSlot?.slot_code || assignedSlot?.slotCode || null,
      waitingForCapacity: !assignedSlot
    });
    return state(userId);
  }

  async function listHostedAssignments(workerIdentity) {
    if (!hostedWorkerEnabled) {
      throw serviceError('HOSTED_WORKER_LOCKED', 'Google hosted worker masih dikunci.', 409);
    }
    if (workerIdentity?.provider !== 'GOOGLE_CLOUD') {
      throw serviceError('INVALID_WORKER_IDENTITY', 'Google worker identity diperlukan.', 403);
    }
    if (typeof store.listHostedAssignmentsForWorker !== 'function') {
      throw serviceError('HOSTED_POOL_UNAVAILABLE', 'Worker pool belum tersedia.', 503);
    }
    const assignments = await store.listHostedAssignmentsForWorker(workerIdentity);
    return {
      ok: true,
      host: {
        provider: workerIdentity.provider,
        projectId: workerIdentity.projectId,
        zone: workerIdentity.zone,
        instanceName: workerIdentity.instanceName
      },
      assignments
    };
  }

  async function leaseHostedAccount(workerIdentity, input = {}) {
    if (!hostedWorkerEnabled) {
      throw serviceError('HOSTED_WORKER_LOCKED', 'Google hosted worker masih dikunci.', 409);
    }
    if (workerIdentity?.provider !== 'GOOGLE_CLOUD') {
      throw serviceError('INVALID_WORKER_IDENTITY', 'Google worker identity diperlukan.', 403);
    }
    const {
      accountId: _accountId,
      cellId: _cellId,
      requestId: _requestId,
      requestTimestamp: _requestTimestamp,
      ...leaseOnly
    } = input;
    if (Core.containsForbiddenCredentialKey(leaseOnly)) {
      throw serviceError('PLAINTEXT_CREDENTIAL_REJECTED', 'Hosted lease tidak menerima credential MT5 plaintext.', 400);
    }
    const accountId = String(input.accountId || '');
    const cellId = String(input.cellId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId) ||
        !/^[A-Za-z0-9._-]{2,80}$/.test(cellId)) {
      throw serviceError('INVALID_HOSTED_LEASE', 'Hosted account atau worker slot tidak sah.', 400);
    }
    if (typeof store.leaseHostedAccount !== 'function') {
      throw serviceError('HOSTED_MT5_STORE_UNAVAILABLE', 'Hosted account lease belum tersedia.', 503);
    }

    const assignedSlot = typeof store.getHostedSlotForAccount === 'function'
      ? await store.getHostedSlotForAccount(accountId)
      : null;
    const assignedSlotCode = assignedSlot?.slot_code || assignedSlot?.slotCode || '';
    const legacyLease = hostedWorkerAccountId &&
      accountId === hostedWorkerAccountId &&
      cellId === workerIdentity.instanceName;

    if (assignedSlotCode) {
      if (cellId !== assignedSlotCode) {
        throw serviceError('INVALID_HOSTED_SLOT', 'Worker slot tidak sepadan dengan akaun ini.', 409);
      }
    } else if (!legacyLease) {
      throw serviceError('INVALID_HOSTED_LEASE', 'Hosted account atau worker slot tidak sah.', 400);
    }

    if (await store.isHostedTransportReplaced(accountId)) {
      throw serviceError('TRANSPORT_REPLACED', 'Akaun ini menggunakan EA tempatan.', 409);
    }
    const issuedAt = now();
    const lease = await store.leaseHostedAccount(
      accountId,
      workerIdentity,
      crypto.randomUUID(),
      issuedAt,
      issuedAt + hostedLeaseTtlMs,
      assignedSlotCode || null
    );
    if (!lease) {
      throw serviceError('HOSTED_ACCOUNT_NOT_AVAILABLE', 'Hosted account tidak tersedia untuk worker ini.', 409);
    }
    await requireHostedTransport(lease.userId);
    if (lease.keyId !== credentialEncryption.keyId) {
      throw serviceError('HOSTED_KEY_MISMATCH', 'Hosted account menggunakan encryption key yang berbeza.', 409);
    }
    const validation = validateCredentialEnvelope(lease.credentialEnvelope, credentialEncryption.keyId);
    if (!validation.ok) {
      throw serviceError('INVALID_CREDENTIAL_ENVELOPE', 'Credential envelope dalam vault ditolak.', 409);
    }
    await store.appendAudit(lease.userId, 'HOSTED_ENVELOPE_LEASED', {
      provider: workerIdentity.provider,
      workerCell: cellId,
      workerHost: workerIdentity.instanceName,
      leaseId: lease.leaseId,
      expiresAt: lease.leaseExpiresAt,
      plaintextReleased: false
    });
    return {
      ok: true,
      lease: {
        id: lease.leaseId,
        accountId: lease.id,
        keyId: lease.keyId,
        credentialEnvelope: lease.credentialEnvelope,
        expiresAt: lease.leaseExpiresAt,
        demoOnly: true,
        executionEnabled: allowDemoExecution,
        accountMask: lease.accountMask,
        serverMask: lease.serverMask,
        brokerMask: lease.brokerMask
      },
      serverTime: issuedAt
    };
  }

  async function hostedHeartbeat(workerIdentity, input = {}) {
    if (!hostedWorkerEnabled) {
      throw serviceError('HOSTED_WORKER_LOCKED', 'Google hosted worker masih dikunci.', 409);
    }
    if (workerIdentity?.provider !== 'GOOGLE_CLOUD') {
      throw serviceError('INVALID_WORKER_IDENTITY', 'Google worker identity diperlukan.', 403);
    }
    const accountId = String(input.accountId || '');
    const leaseId = String(input.leaseId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId) ||
        !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(leaseId)) {
      throw serviceError('INVALID_HOSTED_HEARTBEAT', 'Hosted account atau lease ID tidak sah.', 400);
    }
    const {
      accountId: _accountId,
      leaseId: _leaseId,
      connectionStatus: _connectionStatus,
      lastError: _lastError,
      requestId: _requestId,
      requestTimestamp: _requestTimestamp,
      ...heartbeatOnly
    } = input;
    if (String(heartbeatOnly.tradeMode).toUpperCase() !== 'DEMO') {
      throw serviceError('HOSTED_REAL_NOT_SUPPORTED', 'Worker cloud lama masih DEMO. Guna EA/Connector untuk REAL.', 409);
    }
    const heartbeatValidation = Core.normaliseHeartbeat(heartbeatOnly);
    if (!heartbeatValidation.ok) {
      throw serviceError('INVALID_HOSTED_HEARTBEAT', 'Hosted worker heartbeat ditolak.', 400,
        heartbeatValidation.errors);
    }
    if (heartbeatValidation.value.demoExecutionUnlocked !== allowDemoExecution) {
      throw serviceError(
        allowDemoExecution ? 'HOSTED_EXECUTION_GATE_REQUIRED' : 'HOSTED_EXECUTION_LOCKED',
        allowDemoExecution ? 'Hosted worker belum membuka gate DEMO execution.' : 'Hosted order execution masih dikunci.',
        409
      );
    }
    const reportedStatus = String(input.connectionStatus || 'CONNECTED').toUpperCase();
    if (!['CONNECTED', 'CONNECTING', 'ERROR'].includes(reportedStatus)) {
      throw serviceError('INVALID_HOSTED_HEARTBEAT', 'Status hosted worker tidak sah.', 400);
    }
    const rawErrorCode = String(input.lastError || '').toUpperCase();
    if (rawErrorCode && !/^[A-Z][A-Z0-9_.-]{0,63}$/.test(rawErrorCode)) {
      throw serviceError('INVALID_HOSTED_HEARTBEAT', 'Kod ralat hosted worker tidak sah.', 400);
    }
    const lastError = rawErrorCode || 'CONNECTION_FAILED';
    const connected = reportedStatus !== 'ERROR' &&
      heartbeatValidation.value.terminalTradeAllowed &&
      heartbeatValidation.value.accountTradeAllowed &&
      heartbeatValidation.value.expertTradeAllowed;
    const status = reportedStatus === 'ERROR' ? 'ERROR' : (connected ? 'CONNECTED_LOCKED' : 'LEASED');
    const leaseUserId = await store.validateHostedLease(accountId, workerIdentity, leaseId, now());
    if (!leaseUserId) throw serviceError('HOSTED_LEASE_NOT_FOUND', 'Lease tidak tersedia.', 404);
    await requireHostedTransport(leaseUserId);
    const seenAt = now();
    const updated = await store.updateHostedHeartbeat(
      accountId, workerIdentity, leaseId, heartbeatValidation.value,
      status, status === 'ERROR' ? (lastError || 'MT5 hosted connection failed.') : null, seenAt
    );
    if (!updated) {
      throw serviceError('HOSTED_LEASE_NOT_FOUND', 'Hosted worker lease tidak dijumpai.', 404);
    }
    await store.replacePositions(updated.userId, heartbeatValidation.value.positions, seenAt);
    if (status === 'ERROR') {
      await store.appendAudit(updated.userId, 'HOSTED_WORKER_ERROR', {
        workerCell: workerIdentity.instanceName,
        error: lastError || 'CONNECTION_FAILED'
      });
    }
    return {
      ok: true,
      connectionState: status,
      desiredState: (await store.getProfile(updated.userId))?.desiredState || 'STOPPED',
      executionEnabled: false,
      serverTime: seenAt
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
    const requestedOwnershipMode = ownershipMode(input.ownershipMode);
    const pairingCode = `zcpair_${crypto.randomBytes(32).toString('base64url')}`;
    const fallbackLabel = defaultPodLabel(requestedOwnershipMode);
    const label = String(input.label || fallbackLabel)
      .replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 60) || fallbackLabel;
    const pairing = await store.createPairingSession({
      id: crypto.randomUUID(),
      userId,
      label,
      ownershipMode: requestedOwnershipMode,
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
    const requestedOwnershipMode = ownershipMode(input.ownershipMode, '');
    const pairing = await store.consumePairingSession(tokenHash(pairingCode), now());
    if (!pairing) throw serviceError('INVALID_PAIRING_CODE', 'Kod pairing tidak sah atau telah tamat.', 401);
    if (pairing.ownershipMode !== requestedOwnershipMode) {
      throw serviceError(
        'PAIRING_HOST_MISMATCH',
        'Jenis Secure Pod tidak sepadan dengan kod pairing. Jana kod baharu untuk host ini.',
        409
      );
    }

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
    const localEa = isLocalEa(await store.getPodForUser(userId));
    const previous = await store.getProfile(userId);
    if (localEa && (!Array.isArray(input.symbols) || !input.symbols.length ||
        input.symbols.some(symbol => !allowedDemoSymbols.includes(Core.normaliseSymbol(symbol))))) {
      throw serviceError('DEMO_SYMBOL_NOT_VALIDATED', 'Pilih pair daripada skop broker yang disahkan.', 400);
    }
    const validation = Core.validateSettings({
      ...input,
      tradingSchedule: input.tradingSchedule ?? previous?.tradingSchedule,
      strategyExitPolicies: previous?.strategyExitPolicies,
      symbols: localEa ? input.symbols : allowedDemoSymbols
    });
    if (!validation.ok) throw serviceError('VALIDATION_ERROR', 'Semak konfigurasi Auto Trade.', 400, validation.errors);
    if (input.riskAcknowledged !== true) {
      throw serviceError('RISK_ACK_REQUIRED', 'Pengesahan risiko diperlukan.', 400, {
        riskAcknowledged: 'Tandakan pengesahan risiko untuk menyimpan.'
      });
    }
    const modeChanged = previous && (previous.strategyMode || 'TF2_SCALPING') !== validation.value.strategyMode;
    if (modeChanged && (previous.desiredState === 'ON' || (await store.listPositions(userId)).length > 0)) {
      throw serviceError('STOP_BEFORE_STRATEGY_CHANGE', 'STOP ENTRY dan tunggu posisi sedia ada selesai sebelum menukar strategi.', 409);
    }
    if (typeof store.cancelPendingEntryCommands === 'function') await store.cancelPendingEntryCommands(userId, 'SETTINGS_UPDATED');
    if (typeof store.cancelPendingHostedEntryCommands === 'function') await store.cancelPendingHostedEntryCommands(userId, 'SETTINGS_UPDATED');
    const saved = await store.saveSettings(userId, {
      ...validation.value,
      riskAcknowledgedAt: now()
    });
    await store.appendAudit(userId, 'SETTINGS_SAVED', {
      strategyMode: saved.strategyMode, modeSettings: saved.modeSettings, tradingSchedule: saved.tradingSchedule,
      capitalUsd: saved.capitalUsd,
      lotPerLayer: saved.lotPerLayer,
      layers: saved.layers,
      symbols: saved.symbols,
      symbolScope: localEa ? 'USER_SELECTED' : 'ZENCORE_MANAGED',
      totalLot: validation.value.totalLot
    });
    if (localEa && saved.desiredState === 'ON') {
      const pod = await store.getPodForUser(userId);
      const issued = await issueCommand({ userId, podId: pod.id, type: 'SYSTEM_ON',
        payload: { mode: pod.tradeMode, strategy: 'NORMAL_3M_SOP_V32', exitSchema: '32.3-EXIT-STEPLOCK', settings: validation.value } });
      await store.setControl(userId, { desiredState: 'ON', effectiveState: 'ARMING', pendingCommandId: issued.command.id, lastError: null });
    }
    return state(userId);
  }

  async function turnOn(userId, input = {}) {
    const allowDemoExecution = executionAllowed(userId, await store.getPodForUser(userId));
    if (!allowDemoExecution) {
      throw serviceError(
        'EXECUTION_ROLLOUT_LOCKED',
        'Fasa ini hanya membenarkan pairing dan monitoring. Execution DEMO masih dikunci.',
        409
      );
    }
    const paired = await store.getPodForUser(userId);
    const expectedConfirmation = paired?.tradeMode === 'REAL' ? 'AKTIFKAN REAL' : 'AKTIFKAN DEMO';
    if (String(input.confirmation || '').trim().toUpperCase() !== expectedConfirmation) {
      throw serviceError('CONFIRMATION_REQUIRED', `Taip ${expectedConfirmation} untuk menghidupkan sistem.`, 400);
    }
    const [profile, pod, hostedAccount] = await Promise.all([
      store.getProfile(userId),
      store.getPodForUser(userId),
      activeHostedAccount(userId)
    ]);
    if(profile?.strategyMode!=='TF15_INTRA' && profile?.strategyExitPolicies?.TF2_SCALPING &&
      (hostedAccount || !isLocalEa(pod) || !['1.1.0-ea-local','1.2.0-ea-local','1.3.0-ea-local'].includes(pod?.connectorVersion))) {
      throw serviceError('TF2_EA_UPGRADE_REQUIRED','Rule TF2 memerlukan EA/Connector 1.1 sebelum entry boleh dihidupkan.',409);
    }
    if(['TF15_INTRA','BOTH'].includes(profile?.strategyMode)&&(hostedAccount||!isLocalEa(pod)||!['1.2.0-ea-local','1.3.0-ea-local'].includes(pod?.connectorVersion)))throw serviceError('EA_STRATEGY_UPGRADE_REQUIRED','TF15/Both memerlukan EA/Connector 1.2.',409);
    if (hostedAccount) {
      const hostedConnection = hostedConnectionState(hostedAccount);
      const settingsValidation = Core.validateSettings(profile || {});
      if (!settingsValidation.ok || !profile?.riskAcknowledgedAt) {
        throw serviceError('SETTINGS_REQUIRED', 'Simpan konfigurasi dan pengesahan risiko dahulu.', 409);
      }
      const unsupportedSymbols = settingsValidation.value.symbols
        .filter(symbol => !allowedDemoSymbols.includes(symbol));
      if (unsupportedSymbols.length) {
        throw serviceError('DEMO_SYMBOL_NOT_VALIDATED',
          `Fasa Demo execution ini hanya dibuka untuk ${allowedDemoSymbols.join(', ')}.`, 409);
      }
      if (!hostedConnection.ready) {
        throw serviceError('HOSTED_WORKER_NOT_READY', hostedConnection.label, 409);
      }
      const issued = await issueHostedCommand({
        userId, accountId: hostedAccount.id, type: 'SYSTEM_ON',
        payload: {
          mode: 'DEMO', strategy: 'NORMAL_3M_SOP_V32',
          exitSchema: '32.3-EXIT-STEPLOCK', settings: settingsValidation.value
        }
      });
      await store.setControl(userId, {
        desiredState: 'ON', effectiveState: 'ARMING',
        pendingCommandId: issued.command.id, lastError: null
      });
      await store.appendAudit(userId, 'HOSTED_SYSTEM_ON_REQUESTED', { commandId: issued.command.id });
      return state(userId);
    }
    const settingsValidation = Core.validateSettings(profile || {});
    if (!settingsValidation.ok || !profile?.riskAcknowledgedAt) {
      throw serviceError('SETTINGS_REQUIRED', 'Simpan konfigurasi dan pengesahan risiko dahulu.', 409);
    }
    const unsupportedSymbols = settingsValidation.value.symbols
      .filter(symbol => !allowedDemoSymbols.includes(symbol));
    if (unsupportedSymbols.length) {
      throw serviceError(
        'DEMO_SYMBOL_NOT_VALIDATED',
        `Fasa Demo execution ini hanya dibuka untuk ${allowedDemoSymbols.join(', ')}.`,
        409,
        { symbols: `Belum divalidasi: ${unsupportedSymbols.join(', ')}` }
      );
    }
    const connection = connectionState(pod);
    if (!connection.ready) {
      throw serviceError('POD_NOT_READY', connection.label, 409);
    }
    const issued = await issueCommand({
      userId, podId: pod.id, type: 'SYSTEM_ON',
      payload: {
        mode: pod.tradeMode,
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
    const [pod, hostedAccount] = await Promise.all([
      store.getPodForUser(userId),
      activeHostedAccount(userId)
    ]);
    if (typeof store.cancelPendingEntryCommands === 'function') {
      await store.cancelPendingEntryCommands(userId, 'SYSTEM_STOP_REQUESTED');
    }
    if (typeof store.cancelPendingHostedEntryCommands === 'function') {
      await store.cancelPendingHostedEntryCommands(userId, 'SYSTEM_STOP_REQUESTED');
    }
    if (hostedAccount) {
      const issued = await issueHostedCommand({
        userId, accountId: hostedAccount.id, type: 'SYSTEM_STOP',
        payload: { keepExitManagement: true, blockNewEntriesImmediately: true }
      });
      await store.setControl(userId, {
        desiredState: 'STOPPED', effectiveState: 'STOPPING',
        pendingCommandId: issued.command.id, lastError: null
      });
      await store.appendAudit(userId, 'HOSTED_SYSTEM_STOP_REQUESTED', { commandId: issued.command.id });
      return state(userId);
    }
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
    const [pod, hostedAccount] = await Promise.all([
      store.getPodForUser(userId),
      activeHostedAccount(userId)
    ]);
    if (!pod && !hostedAccount) throw serviceError('POD_NOT_READY', 'Execution host belum disediakan.', 409);
    if (typeof store.cancelPendingEntryCommands === 'function') {
      await store.cancelPendingEntryCommands(userId, 'EMERGENCY_CLOSE_REQUESTED');
    }
    const issued = hostedAccount
      ? await issueHostedCommand({
          userId, accountId: hostedAccount.id, type: 'EMERGENCY_CLOSE_ALL',
          payload: { scope: 'ALL_OPEN_POSITIONS', blockNewEntriesImmediately: true },
          ttlMs: 10 * 60 * 1000
        })
      : await issueCommand({
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
    if (heartbeatValidation.value.tradeMode === 'REAL' &&
        (!isLocalEa(pod) || heartbeatValidation.value.connectorVersion !== '1.3.0-ea-local')) {
      throw serviceError('REAL_EA_UPGRADE_REQUIRED', 'Akaun REAL memerlukan EA/Connector Windows terbaru.', 409);
    }
    if (pod.tradeMode && pod.tradeMode !== heartbeatValidation.value.tradeMode) {
      throw serviceError('ACCOUNT_MODE_CHANGED', 'Jenis akaun berubah. OFF dan pautkan semula akaun yang dipilih.', 409);
    }
    const seenAt = now();
    const updated = await store.updatePodHeartbeat(pod.id, heartbeatValidation.value, seenAt);
    await store.replacePositions(pod.userId, heartbeatValidation.value.positions, seenAt);
    return {
      ok: true,
      podState: connectionState(updated),
      desiredState: (await store.getProfile(pod.userId))?.desiredState || 'STOPPED',
      serverTime: seenAt
    };
  }

  async function queuedEntryIsCurrent(command){
    if(command.type!=='PLACE_SETUP')return true;
    const profile=await store.getProfile(command.userId);
    const mode=command.payload?.strategyMode||'TF2_SCALPING';
    if(profile?.modeSettings?.[mode]?.gold?.enabled===false)return false;
    if(typeof options.getLatestMarket!=='function')return true;
    const p=command.payload||{},snap=p.analysisSnapshot||{},tf=p.strategyMode==='TF15_INTRA'?'15':'2';
    const m=options.getLatestMarket(p.symbol,tf),n=m?.strategyNormal;
    return !!m && now()-(Number(m.signalObservedAt)||m.receivedAt)<=30000 && (Number(m.signalObservedAt)||m.receivedAt)<=now()+5000 &&
      n?.state==='READY' && n.side===p.side && (!snap.setupKey||m.setupKey===snap.setupKey) &&
      ['entry','sl','tp1','tp2','tp3'].every(key=>n.plan?.[key]===p[key]);
  }
  async function nextCommand(rawToken) {
    const pod = await authenticatePod(rawToken);
    if (!pod) throw serviceError('INVALID_POD_TOKEN', 'Secure Pod tidak dibenarkan.', 401);
    const command = await store.nextCommandForPod(pod.id, now());
    if (!command) return { ok: true, command: null, serverTime: now() };
    if(!await queuedEntryIsCurrent(command)){
      await store.ackCommand(pod.id,command.id,'REJECTED',{code:'ENTRY_CONFIRMATION_CHANGED'});
      await store.appendAudit(pod.userId,'ENTRY_REVOKED',{symbol:command.payload?.symbol,code:'ENTRY_CONFIRMATION_CHANGED'});
      return {ok:true,command:null,serverTime:now()};
    }
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
        lastError: result.message || result.code || 'Secure Pod menolak arahan ON.'
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


  async function nextHostedCommand(workerIdentity, input = {}) {
    if (!allowDemoExecution) {
      throw serviceError('EXECUTION_ROLLOUT_LOCKED', 'Execution DEMO masih dikunci.', 409);
    }
    const accountId = String(input.accountId || '');
    const leaseId = String(input.leaseId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId) ||
        !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(leaseId)) {
      throw serviceError('INVALID_HOSTED_COMMAND_REQUEST', 'Hosted account atau lease ID tidak sah.', 400);
    }
    const userId = await store.validateHostedLease(accountId, workerIdentity, leaseId, now());
    if (!userId) throw serviceError('HOSTED_LEASE_NOT_FOUND', 'Hosted worker lease tidak dijumpai.', 404);
    await requireHostedTransport(userId);
    const command = await store.nextHostedCommand(accountId, now());
    if (!command) return { ok: true, command: null, serverTime: now() };
    if(!await queuedEntryIsCurrent(command)){
      await store.ackHostedCommand(accountId,command.id,'REJECTED',{code:'ENTRY_CONFIRMATION_CHANGED'});
      return {ok:true,command:null,serverTime:now()};
    }
    return {
      ok: true,
      command: {
        id: command.id, type: command.type, payload: command.payload,
        createdAt: command.createdAt, expiresAt: command.expiresAt
      },
      serverTime: now()
    };
  }

  async function acknowledgeHostedCommand(workerIdentity, commandId, input = {}) {
    if (!allowDemoExecution) {
      throw serviceError('EXECUTION_ROLLOUT_LOCKED', 'Execution DEMO masih dikunci.', 409);
    }
    const {
      accountId: _accountId,
      leaseId: _leaseId,
      requestId: _requestId,
      requestTimestamp: _requestTimestamp,
      ...ackOnly
    } = input;
    if (Core.containsForbiddenCredentialKey(ackOnly)) {
      throw serviceError('CREDENTIAL_REJECTED', 'Credential broker tidak dibenarkan dalam acknowledgement.', 400);
    }
    const accountId = String(input.accountId || '');
    const leaseId = String(input.leaseId || '');
    const userId = await store.validateHostedLease(accountId, workerIdentity, leaseId, now());
    if (!userId) throw serviceError('HOSTED_LEASE_NOT_FOUND', 'Hosted worker lease tidak dijumpai.', 404);
    await requireHostedTransport(userId);
    const status = String(input.status || '').toUpperCase();
    if (!['EXECUTED','FAILED','REJECTED'].includes(status)) {
      throw serviceError('INVALID_ACK', 'Status acknowledgement tidak sah.', 400);
    }
    const result = {
      code: String(input.code || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40),
      message: String(input.message || '').slice(0, 180),
      brokerOrderId: String(input.brokerOrderId || '').replace(/[^A-Za-z0-9._,-]/g, '').slice(0, 180)
    };
    const command = await store.ackHostedCommand(accountId, String(commandId || ''), status, result);
    if (!command) throw serviceError('COMMAND_NOT_FOUND', 'Arahan tidak dijumpai atau sudah diproses.', 404);
    if (command.type === 'SYSTEM_ON') {
      await store.setControl(userId, status === 'EXECUTED' ? {
        desiredState: 'ON', effectiveState: 'ON', pendingCommandId: null, lastError: null
      } : {
        desiredState: 'STOPPED', effectiveState: 'ERROR', pendingCommandId: null,
        lastError: result.message || 'Hosted worker menolak arahan ON.'
      });
    } else if (command.type === 'SYSTEM_STOP' || command.type === 'EMERGENCY_CLOSE_ALL') {
      await store.setControl(userId, status === 'EXECUTED' ? {
        desiredState: 'STOPPED', effectiveState: 'STOPPED', pendingCommandId: null, lastError: null
      } : {
        desiredState: 'STOPPED', effectiveState: 'ERROR', pendingCommandId: null,
        lastError: result.message || 'Hosted worker gagal melaksanakan arahan.'
      });
    }
    await store.appendAudit(userId, 'HOSTED_COMMAND_ACKNOWLEDGED', {
      commandId: command.id, commandType: command.type, status, code: result.code
    });
    return { ok: true, commandId: command.id, status };
  }

  async function dispatchMarkets(markets = [], isCurrent = () => true) {
    const profiles = (allowDemoExecution || localEaExecutionUserIds.size) ? await store.listOnProfiles() : [];
    let queued = 0;
    for (const profile of profiles) {
      const entryWindow=Core.tradingWindow(profile.tradingSchedule,now());
      if (!entryWindow.allowed) continue;
      const [pod, positions, hostedAccount] = await Promise.all([
        store.getPodForUser(profile.userId),
        store.listPositions(profile.userId),
        activeHostedAccount(profile.userId)
      ]);
      if (!executionAllowed(profile.userId, pod)) continue;
      const hostedConnection = hostedAccount ? hostedConnectionState(hostedAccount) : null;
      if (typeof options.onDispatchDiagnostic === 'function' &&
          now() - (dispatchDiagnosticAt.get(profile.userId) || 0) >= 60_000) {
        dispatchDiagnosticAt.set(profile.userId, now());
        const connection = hostedConnection || connectionState(pod);
        const specs = hostedAccount ? hostedAccount.symbolSpecs : pod?.symbolSpecs;
        const report = {
          connection: connection.state,
          enabledSymbols: profile.symbols,
          brokerSymbols: Object.keys(specs || {}),
          pairs: allowedDemoSymbols.flatMap(symbol => {
            const scoped = markets.filter(item => Core.normaliseSymbol(item?.symbol) === symbol);
            return (scoped.length ? scoped : [null]).map(market => {
            const normal = market?.strategyNormal || {}, sop = normal.sop || {};
            return {
              symbol,
              timeframe: market?.timeframe || null,
              freshness: market?.freshness || 'OFFLINE',
              ageSeconds: market?.receivedAt ? Math.round((now() - market.receivedAt) / 1000) : null,
              state: market?.strategyNormal?.state || 'WAIT',
              side: market?.strategyNormal?.side || 'WAIT',
              observedAgeSeconds: market?.signalObservedAt ? Math.round((now() - market.signalObservedAt) / 1000) : null,
              feedVersion: market?.feedVersion || null,
              feedChannel: market?.feedChannel || null,
              setupSolid: normal.solid === true,
              failedGates: (Array.isArray(sop.gates) ? sop.gates : []).filter(g => g.pass !== true).map(g => ({key:g.key,detail:g.detail || null})),
              sopGreen: sop.sopGreen ?? null,
              forecast: sop.forecast || null,
              marketPower: sop.marketPower ?? null,
              hemaOwn: sop['hema'+String(market?.timeframe)]?.mode || null,
              hemaHigher: sop['hema'+(String(market?.timeframe)==='15'?'30':'3')]?.mode || null,
              pullback: sop.pullback?.state || null,
              enabled: profile.symbols.includes(symbol),
              analysisEligible: !!(market && Core.buildSetupCommand(market, profile, specs?.[symbol],now())),
              positionAllowsEntry: !!(market && Core.permitsPositionEntry(market, positions))
            };
            });
          })
        };
        // Diagnostics never change the execution decision or expose account identity.
        try { options.onDispatchDiagnostic(report); } catch (_) {}
      }
      if(['TF15_INTRA','BOTH'].includes(profile.strategyMode)&&(hostedAccount||!isLocalEa(pod)||!['1.2.0-ea-local','1.3.0-ea-local'].includes(pod?.connectorVersion)))continue;
      if (hostedAccount ? !hostedConnection.ready : !connectionState(pod).ready) continue;
      // Never dispatch new exit rules to a hosted worker or old EA that would silently ignore them.
      if(profile.strategyMode!=='TF15_INTRA' && profile.strategyExitPolicies?.TF2_SCALPING &&
        (hostedAccount || !isLocalEa(pod) || !['1.1.0-ea-local','1.2.0-ea-local','1.3.0-ea-local'].includes(pod.connectorVersion)))continue;
      for (const market of Array.isArray(markets) ? markets : []) {
        const symbol = Core.normaliseSymbol(market?.symbol);
        if (!market?.receivedAt || now() - market.receivedAt > 30000) continue;
        if (!allowedDemoSymbols.includes(symbol) || !Core.permitsPositionEntry(market,positions)) continue;
        if (hostedAccount) {
          if (typeof store.hasRecentHostedEntryCommand === 'function' &&
              await store.hasRecentHostedEntryCommand(profile.userId, symbol, now() - 5 * 60 * 1000, String(market.timeframe)==='15'?'TF15_INTRA':'TF2_SCALPING')) continue;
        } else if (typeof store.hasRecentEntryCommand === 'function' &&
            await store.hasRecentEntryCommand(profile.userId, symbol, now() - 5 * 60 * 1000, String(market.timeframe)==='15'?'TF15_INTRA':'TF2_SCALPING')) continue;
        const symbolSpecs = hostedAccount ? hostedAccount.symbolSpecs : pod.symbolSpecs;
        const setup = Core.buildSetupCommand(market, profile, symbolSpecs?.[symbol],now());
        if (!setup || !isCurrent(market)) continue;
        const issued = hostedAccount
          ? await issueHostedCommand({
              userId: profile.userId, accountId: hostedAccount.id,
              type: 'PLACE_SETUP', payload: setup.payload,
              dedupeKey: `SETUP|${setup.signalKey}`, ttlMs: 15000, notAfterMs: Math.min(entryWindow.validUntil ?? Infinity,setup.notAfterMs ?? Infinity)
            })
          : await issueCommand({
              userId: profile.userId, podId: pod.id,
              type: 'PLACE_SETUP', payload: setup.payload,
              dedupeKey: `SETUP|${setup.signalKey}`, ttlMs: 15000, notAfterMs: Math.min(entryWindow.validUntil ?? Infinity,setup.notAfterMs ?? Infinity)
            });
        if (issued.created) {
          queued += 1;
          await store.appendAudit(profile.userId, 'SETUP_QUEUED', {
            commandId: issued.command.id,
            symbol: setup.payload.symbol,
            side: setup.payload.side,
            totalLot: setup.payload.totalLot,
            riskLevel: setup.payload.risk.level,
            riskBlocksOrder: false,
            timeframe: String(market.timeframe||''),
            signalToQueueMs: Math.max(0,now()-(Number(market.signalObservedAt)||market.receivedAt))
          });
        }
      }
    }
    const managedProfiles = typeof store.listManagedProfiles === 'function'
      ? await store.listManagedProfiles() : [];
    for (const profile of managedProfiles) {
      const [pod, positions, hostedAccount] = await Promise.all([
        store.getPodForUser(profile.userId),
        store.listPositions(profile.userId),
        activeHostedAccount(profile.userId)
      ]);
      if (!hostedAccount && !pod) continue;
      const positionSymbols = new Set(positions.map(position => position.symbol));
      for (const market of Array.isArray(markets) ? markets : []) {
        const symbol = Core.normaliseSymbol(market?.symbol);
        if (!positionSymbols.has(symbol)) continue;
        const mode=String(market.timeframe||market.strategyNormal?.tf||'2').replace(/m$/, '')==='15'?'TF15_INTRA':'TF2_SCALPING';
        if(!positions.some(p=>p.symbol===symbol&&(p.strategyMode||'TF2_SCALPING')===mode))continue;
        if(mode==='TF15_INTRA'&&(hostedAccount||!['1.2.0-ea-local','1.3.0-ea-local'].includes(pod?.connectorVersion)))continue;
        const management = Core.buildManagementCommand(market);
        if (!management) continue;
        const issued = hostedAccount
          ? await issueHostedCommand({
              userId: profile.userId, accountId: hostedAccount.id,
              type: 'MANAGE_POSITION', payload: management.payload,
              dedupeKey: `MANAGE|${management.managementKey}`, ttlMs: 10 * 60 * 1000
            })
          : await issueCommand({
              userId: profile.userId, podId: pod.id,
              type: 'MANAGE_POSITION', payload: management.payload,
              dedupeKey: `MANAGE|${management.managementKey}`, ttlMs: 10 * 60 * 1000
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
    connectionMonitor,
    executionDiagnostics,
    credentialEncryptionConfig,
    connectHostedAccount,
    listHostedAssignments,
    connectLocalEa,
    leaseHostedAccount,
    hostedHeartbeat,
    nextHostedCommand,
    acknowledgeHostedCommand,
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
  canonicalCommand,
  validateCredentialEnvelope,
  buildCredentialEncryptionConfig
};
