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
  if (!Core.POD_OWNERSHIP_MODES.includes(value)) {
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
  const hostedMt5Enabled = options.hostedMt5Enabled === true;
  const hostedWorkerEnabled = hostedMt5Enabled && options.hostedWorkerEnabled === true;
  const hostedWorkerAccountId = String(options.hostedWorkerAccountId || '');
  if (hostedWorkerEnabled &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hostedWorkerAccountId)) {
    throw new Error('ZENCORE_GCP_WORKER_HOSTED_ACCOUNT_ID must be the assigned UUIDv4.');
  }
  const credentialEncryption = buildCredentialEncryptionConfig(
    hostedMt5Enabled,
    String(options.credentialKeyId || ''),
    String(options.credentialPublicKey || '')
  );
  const requiredDemoConnectorVersion = String(
    options.requiredDemoConnectorVersion || '1.4.0-demo-execution'
  );
  const requiredHostedConnectorVersion = String(
    options.requiredHostedConnectorVersion || '2.1.0-gcp-demo-execution'
  );
  const allowedDemoSymbols = [...new Set(
    (Array.isArray(options.allowedDemoSymbols) ? options.allowedDemoSymbols : ['XAUUSD'])
      .map(Core.normaliseSymbol)
      .filter(symbol => Core.SUPPORTED_MARKETS.includes(symbol))
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

  function connectionState(pod) {
    return Core.podConnectionState(pod, now(), allowDemoExecution ? {
      connectorVersion: requiredDemoConnectorVersion,
      ownershipModes: allowedDemoOwnershipModes
    } : {});
  }

  function hostedConnectionState(hostedAccount) {
    if (!hostedAccount) {
      return { state: 'HOSTED_PENDING', label: 'MT5 HOSTED MENUNGGU WORKER', online: false, connected: false, ready: false };
    }
    const online = !!hostedAccount.lastSeenAt && now() - hostedAccount.lastSeenAt <= 30_000;
    if (hostedAccount.status === 'ERROR') {
      return { state: 'HOSTED_ERROR', label: 'MT5 HOSTED PERLU PERHATIAN', online, connected: false, ready: false };
    }
    if (online && hostedAccount.status === 'CONNECTED_LOCKED') {
      const ready = allowDemoExecution &&
        hostedAccount.demoExecutionUnlocked === true &&
        hostedAccount.connectorVersion === requiredHostedConnectorVersion &&
        hostedAccount.tradeMode === 'DEMO' &&
        hostedAccount.terminalTradeAllowed === true &&
        hostedAccount.accountTradeAllowed === true &&
        hostedAccount.expertTradeAllowed === true;
      return ready ? {
        state: 'HOSTED_READY', label: 'MT5 HOSTED DEMO READY',
        online: true, connected: true, ready: true
      } : {
        state: 'HOSTED_CONNECTED_LOCKED', label: 'CONNECTED • EXECUTION LOCKED',
        online: true, connected: true, ready: false
      };
    }
    return {
      state: hostedAccount.status === 'LEASED' ? 'HOSTED_CONNECTING' : 'HOSTED_PENDING',
      label: hostedAccount.status === 'LEASED'
        ? 'MT5 HOSTED SEDANG DISAHKAN'
        : 'MT5 HOSTED MENUNGGU WORKER',
      online: false, connected: false, ready: false
    };
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
    const [profile, pod, positions, audit, pairing, hostedAccount] = await Promise.all([
      store.getProfile(userId),
      store.getPodForUser(userId),
      store.listPositions(userId),
      store.listAudit(userId, 30),
      typeof store.getActivePairingForUser === 'function'
        ? store.getActivePairingForUser(userId, now()) : null,
      typeof store.getHostedAccount === 'function' ? store.getHostedAccount(userId) : null
    ]);
    const podConnection = connectionState(pod);
    const connection = hostedAccount ? hostedConnectionState(hostedAccount) : podConnection;
    const settings = profile ? {
      capitalUsd: profile.capitalUsd,
      lotPerLayer: profile.lotPerLayer,
      layers: profile.layers,
      symbols: profile.symbols,
      totalLot: profile.lotPerLayer != null && profile.layers != null
        ? Math.round(profile.lotPerLayer * profile.layers * 100000) / 100000 : null,
      riskAcknowledgedAt: profile.riskAcknowledgedAt
    } : null;
    const effectiveState = !pod && !hostedAccount ? 'UNPROVISIONED' : (profile?.effectiveState || 'STOPPED');
    const desiredState = profile?.desiredState || 'STOPPED';
    const settingsReady = !!profile && Core.validateSettings(profile).ok && !!profile.riskAcknowledgedAt;
    return {
      ok: true,
      mode: 'DEMO',
      control: {
        desiredState,
        effectiveState,
        executionRolloutUnlocked: allowDemoExecution,
        executionSymbols: allowedDemoSymbols,
        requiredConnectorVersion: allowDemoExecution
          ? (hostedAccount ? requiredHostedConnectorVersion : requiredDemoConnectorVersion)
          : null,
        stateVersion: profile?.stateVersion || 0,
        pendingCommandId: profile?.pendingCommandId || null,
        lastError: profile?.lastError || null,
        canEnter: allowDemoExecution && desiredState === 'ON' && effectiveState === 'ON' && connection.ready,
        canTurnOn: allowDemoExecution && settingsReady && connection.ready
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
        executionReady: hostedAccount ? hostedConnectionState(hostedAccount).ready : false,
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
        demoOnly: true,
        allowedDemoSymbols,
        requiredConnectorVersion: allowDemoExecution
          ? (hostedAccount ? requiredHostedConnectorVersion : requiredDemoConnectorVersion)
          : null,
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
    if (typeof store.provisionHostedCommandPod !== 'function') {
      throw serviceError('HOSTED_COMMAND_TARGET_UNAVAILABLE', 'Hosted command target belum tersedia.', 503);
    }
    await store.provisionHostedCommandPod(userId, saved.id);
    await store.appendAudit(userId, 'HOSTED_MT5_ENVELOPE_SAVED', {
      accountMask: saved.accountMask,
      serverMask: saved.serverMask,
      tradeMode: saved.tradeMode,
      keyId: saved.keyId,
      plaintextStored: false,
      status: saved.status
    });
    return state(userId);
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
    if (accountId !== hostedWorkerAccountId || cellId !== workerIdentity.instanceName) {
      throw serviceError('INVALID_HOSTED_LEASE', 'Hosted account atau cell ID tidak sah.', 400);
    }
    if (typeof store.leaseHostedAccount !== 'function') {
      throw serviceError('HOSTED_MT5_STORE_UNAVAILABLE', 'Hosted account lease belum tersedia.', 503);
    }
    const issuedAt = now();
    const lease = await store.leaseHostedAccount(
      accountId,
      workerIdentity,
      crypto.randomUUID(),
      issuedAt,
      issuedAt + hostedLeaseTtlMs
    );
    if (!lease) {
      throw serviceError('HOSTED_ACCOUNT_NOT_AVAILABLE', 'Hosted account tidak tersedia untuk worker ini.', 409);
    }
    if (lease.keyId !== credentialEncryption.keyId) {
      throw serviceError('HOSTED_KEY_MISMATCH', 'Hosted account menggunakan encryption key yang berbeza.', 409);
    }
    const validation = validateCredentialEnvelope(lease.credentialEnvelope, credentialEncryption.keyId);
    if (!validation.ok) {
      throw serviceError('INVALID_CREDENTIAL_ENVELOPE', 'Credential envelope dalam vault ditolak.', 409);
    }
    const commandPod = await store.getPodForUser(lease.userId);
    const executionEnabled = allowDemoExecution &&
      lease.status === 'CONNECTED_LOCKED' &&
      lease.tradeMode === 'DEMO' &&
      lease.terminalTradeAllowed === true &&
      lease.accountTradeAllowed === true &&
      lease.expertTradeAllowed === true &&
      lease.connectorVersion === requiredHostedConnectorVersion &&
      !!commandPod &&
      commandPod.ownershipMode === 'INTERNAL_DEMO';
    await store.appendAudit(lease.userId, 'HOSTED_ENVELOPE_LEASED', {
      provider: workerIdentity.provider,
      workerCell: workerIdentity.instanceName,
      leaseId: lease.leaseId,
      expiresAt: lease.leaseExpiresAt,
      executionEnabled,
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
        executionEnabled,
        accountMask: lease.accountMask,
        serverMask: lease.serverMask,
        brokerMask: lease.brokerMask,
        commandPodId: executionEnabled ? commandPod.id : '',
        commandSigningKey: executionEnabled ? commandSigningKeyForPod(commandPod.id) : ''
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
    if (accountId !== hostedWorkerAccountId ||
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
    const heartbeatValidation = Core.normaliseHeartbeat(heartbeatOnly);
    if (!heartbeatValidation.ok) {
      throw serviceError('INVALID_HOSTED_HEARTBEAT', 'Hosted worker heartbeat ditolak.', 400,
        heartbeatValidation.errors);
    }
    if (heartbeatValidation.value.demoExecutionUnlocked && (
      !allowDemoExecution ||
      heartbeatValidation.value.connectorVersion !== requiredHostedConnectorVersion
    )) {
      throw serviceError(
        'HOSTED_EXECUTION_LOCKED',
        'Hosted DEMO execution belum dibuka untuk connector ini.',
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
      executionEnabled: allowDemoExecution &&
        updated.demoExecutionUnlocked === true &&
        updated.connectorVersion === requiredHostedConnectorVersion,
      serverTime: seenAt
    };
  }

  async function hostedCommandContext(workerIdentity, input = {}) {
    if (!allowDemoExecution) {
      throw serviceError('HOSTED_EXECUTION_LOCKED', 'Hosted DEMO execution masih dikunci.', 409);
    }
    if (workerIdentity?.provider !== 'GOOGLE_CLOUD') {
      throw serviceError('INVALID_WORKER_IDENTITY', 'Google worker identity diperlukan.', 403);
    }
    const accountId = String(input.accountId || '');
    const leaseId = String(input.leaseId || '');
    if (accountId !== hostedWorkerAccountId ||
        !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(leaseId)) {
      throw serviceError('INVALID_HOSTED_COMMAND_LEASE', 'Hosted command lease tidak sah.', 400);
    }
    if (typeof store.getHostedLeaseContext !== 'function') {
      throw serviceError('HOSTED_COMMAND_STORE_UNAVAILABLE', 'Hosted command store belum tersedia.', 503);
    }
    const context = await store.getHostedLeaseContext(
      accountId, workerIdentity, leaseId, now()
    );
    if (!context ||
        context.tradeMode !== 'DEMO' ||
        context.demoExecutionUnlocked !== true ||
        context.connectorVersion !== requiredHostedConnectorVersion) {
      throw serviceError('HOSTED_COMMAND_LEASE_NOT_READY', 'Hosted DEMO command lease belum ready.', 409);
    }
    const commandPod = await store.getPodForUser(context.userId);
    if (!commandPod || commandPod.ownershipMode !== 'INTERNAL_DEMO') {
      throw serviceError('HOSTED_COMMAND_TARGET_INVALID', 'Hosted command target tidak sah.', 409);
    }
    return { context, commandPod };
  }

  async function hostedNextCommand(workerIdentity, input = {}) {
    const { commandPod } = await hostedCommandContext(workerIdentity, input);
    const command = await store.nextCommandForPod(commandPod.id, now());
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

  async function hostedAcknowledgeCommand(workerIdentity, commandId, input = {}) {
    const { context, commandPod } = await hostedCommandContext(workerIdentity, input);
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
    const command = await store.ackCommand(
      commandPod.id, String(commandId || ''), status, result
    );
    if (!command) {
      throw serviceError('COMMAND_NOT_FOUND', 'Arahan hosted tidak dijumpai atau sudah diproses.', 404);
    }
    if (command.type === 'SYSTEM_ON') {
      await store.setControl(context.userId, status === 'EXECUTED' ? {
        desiredState: 'ON', effectiveState: 'ON', pendingCommandId: null, lastError: null
      } : {
        desiredState: 'STOPPED', effectiveState: 'ERROR', pendingCommandId: null,
        lastError: result.message || 'Hosted worker menolak arahan ON.'
      });
    } else if (command.type === 'SYSTEM_STOP' || command.type === 'EMERGENCY_CLOSE_ALL') {
      await store.setControl(context.userId, status === 'EXECUTED' ? {
        desiredState: 'STOPPED', effectiveState: 'STOPPED', pendingCommandId: null, lastError: null
      } : {
        desiredState: 'STOPPED', effectiveState: 'ERROR', pendingCommandId: null,
        lastError: result.message || 'Hosted worker gagal melaksanakan arahan.'
      });
    }
    await store.appendAudit(context.userId, 'HOSTED_COMMAND_ACKNOWLEDGED', {
      commandId: command.id,
      commandType: command.type,
      status,
      code: result.code,
      workerCell: workerIdentity.instanceName
    });
    return { ok: true, commandId: command.id, status };
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
    if (!allowDemoExecution) {
      throw serviceError(
        'EXECUTION_ROLLOUT_LOCKED',
        'Fasa ini hanya membenarkan pairing dan monitoring. Execution DEMO masih dikunci.',
        409
      );
    }
    if (String(input.confirmation || '').trim().toUpperCase() !== 'AKTIFKAN DEMO') {
      throw serviceError('CONFIRMATION_REQUIRED', 'Taip AKTIFKAN DEMO untuk menghidupkan sistem.', 400);
    }
    const [profile, pod, hostedAccount] = await Promise.all([
      store.getProfile(userId),
      store.getPodForUser(userId),
      typeof store.getHostedAccount === 'function' ? store.getHostedAccount(userId) : null
    ]);
    if (hostedAccount) {
      throw serviceError(
        'HOSTED_WORKER_NOT_READY',
        'Managed Windows worker belum mengesahkan akaun Demo. Sistem kekal STOPPED.',
        409
      );
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
    if (typeof store.cancelPendingEntryCommands === 'function') {
      await store.cancelPendingEntryCommands(userId, 'SYSTEM_STOP_REQUESTED');
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
    const pod = await store.getPodForUser(userId);
    if (!pod) throw serviceError('POD_NOT_READY', 'Secure Pod belum disediakan.', 409);
    if (typeof store.cancelPendingEntryCommands === 'function') {
      await store.cancelPendingEntryCommands(userId, 'EMERGENCY_CLOSE_REQUESTED');
    }
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
      podState: connectionState(updated),
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
    const profiles = allowDemoExecution ? await store.listOnProfiles() : [];
    let queued = 0;
    for (const profile of profiles) {
      const [pod, positions, hostedAccount] = await Promise.all([
        store.getPodForUser(profile.userId),
        store.listPositions(profile.userId),
        typeof store.getHostedAccount === 'function' ? store.getHostedAccount(profile.userId) : null
      ]);
      if (hostedAccount) continue;
      if (!connectionState(pod).ready) continue;
      const openSymbols = new Set(positions.map(position => Core.normaliseSymbol(position.symbol)));
      for (const market of Array.isArray(markets) ? markets : []) {
        const symbol = Core.normaliseSymbol(market?.symbol);
        if (!allowedDemoSymbols.includes(symbol) || openSymbols.has(symbol)) continue;
        if (typeof store.hasRecentEntryCommand === 'function' &&
            await store.hasRecentEntryCommand(profile.userId, symbol, now() - 5 * 60 * 1000)) continue;
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
      const [pod, positions, hostedAccount] = await Promise.all([
        store.getPodForUser(profile.userId),
        store.listPositions(profile.userId),
        typeof store.getHostedAccount === 'function' ? store.getHostedAccount(profile.userId) : null
      ]);
      if (hostedAccount) continue;
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
    credentialEncryptionConfig,
    connectHostedAccount,
    leaseHostedAccount,
    hostedHeartbeat,
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
