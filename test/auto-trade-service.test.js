const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { MemoryAutoTradeStore } = require('../auto-trade-store');
const { createAutoTradeService } = require('../auto-trade-service');

const SIGNING_KEY = 'test-signing-key-that-is-longer-than-thirty-two-bytes';

async function setup() {
  let currentTime = 1_790_000_000_000;
  const store = new MemoryAutoTradeStore();
  const service = createAutoTradeService({
    store,
    commandSigningKey: SIGNING_KEY,
    allowDemoExecution: true,
    allowedDemoOwnershipModes: ['INTERNAL_DEMO'],
    now: () => currentTime
  });
  const userId = '11111111-1111-4111-8111-111111111111';
  const provisioned = await service.provisionDemoPod(userId, 'Test Secure Pod');
  await service.heartbeat(provisioned.token, {
    accountMask: '****1234',
    serverMask: '****Demo',
    brokerMask: '****Stellar',
    tradeMode: 'DEMO',
    terminalTradeAllowed: true,
    accountTradeAllowed: true,
    expertTradeAllowed: true,
    demoExecutionUnlocked: true,
    connectorVersion: '1.4.0-demo-execution',
    terminalBuild: '5000',
    symbolSpecs: [{
      symbol: 'XAUUSD', tickSize: 0.01, tickValue: 1,
      volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01
    }],
    positions: []
  });
  return {
    store, service, userId, token: provisioned.token,
    advance(ms) { currentTime += ms; }
  };
}

test('pod token is one-time and public state exposes masked identity only', async () => {
  const { store, service, userId, token } = await setup();
  const state = await service.state(userId);
  assert.equal(state.pod.accountMask, '****1234');
  assert.equal(state.pod.serverMask, '****Demo');
  assert.equal(state.connection.ready, true);
  assert.equal(JSON.stringify(state).includes(token), false);
  assert.equal(JSON.stringify(state).includes('tokenHash'), false);
  assert.equal(JSON.stringify([...store.podsByUser.values()]).includes(token), false);
});

test('trader-owned Azure pairing is one-time and never exposes machine credentials in state', async () => {
  let currentTime = 1_790_000_000_000;
  const store = new MemoryAutoTradeStore();
  const service = createAutoTradeService({
    store,
    commandSigningKey: SIGNING_KEY,
    now: () => currentTime,
    pairingTtlMs: 5 * 60 * 1000
  });
  const userId = '22222222-2222-4222-8222-222222222222';

  await assert.rejects(
    () => service.createPairingSession(userId, {
      confirmation: 'PAIR SECURE POD', nested: { password: 'must-never-enter-pairing' }
    }),
    error => error.code === 'CREDENTIAL_REJECTED'
  );
  const created = await service.createPairingSession(userId, {
    confirmation: 'PAIR SECURE POD', ownershipMode: 'TRADER_OWNED_AZURE'
  });
  assert.match(created.pairing.code, /^zcpair_/);
  let state = await service.state(userId);
  assert.equal(state.pairing.ownershipMode, 'TRADER_OWNED_AZURE');
  assert.equal(JSON.stringify(state).includes(created.pairing.code), false);

  const paired = await service.pairTraderOwnedPod({
    pairingCode: created.pairing.code,
    ownershipMode: 'TRADER_OWNED_AZURE'
  });
  assert.match(paired.podToken, /^zcpod_/);
  assert.ok(paired.commandSigningKey.length >= 32);
  await assert.rejects(
    () => service.pairTraderOwnedPod({
      pairingCode: created.pairing.code,
      ownershipMode: 'TRADER_OWNED_AZURE'
    }),
    error => error.code === 'INVALID_PAIRING_CODE'
  );

  state = await service.state(userId);
  assert.equal(state.pod.ownershipMode, 'TRADER_OWNED_AZURE');
  const publicState = JSON.stringify(state);
  assert.equal(publicState.includes(paired.podToken), false);
  assert.equal(publicState.includes(paired.commandSigningKey), false);

  await service.heartbeat(paired.podToken, {
    accountMask: '****1234', serverMask: '****Demo', brokerMask: '****Stellar',
    tradeMode: 'DEMO', terminalTradeAllowed: true, accountTradeAllowed: true,
    expertTradeAllowed: true, demoExecutionUnlocked: true, positions: [{
      ticket: '900003', symbol: 'XAUUSD', side: 'BUY', volume: 0.03,
      entry: 2500, currentPrice: 2501, activeSl: 2495
    }]
  });
  await assert.rejects(
    () => service.createPairingSession(userId, { confirmation: 'PAIR SECURE POD' }),
    error => error.code === 'OPEN_POSITIONS'
  );
});

test('trader-owned Windows PC pairs without exposing broker credentials and stays execution locked', async () => {
  const store = new MemoryAutoTradeStore();
  const service = createAutoTradeService({ store, commandSigningKey: SIGNING_KEY });
  const userId = '55555555-5555-4555-8555-555555555555';
  const created = await service.createPairingSession(userId, {
    confirmation: 'PAIR SECURE POD',
    ownershipMode: 'TRADER_OWNED_WINDOWS_PC'
  });
  assert.equal(created.pairing.ownershipMode, 'TRADER_OWNED_WINDOWS_PC');
  const paired = await service.pairTraderOwnedPod({
    pairingCode: created.pairing.code,
    ownershipMode: 'TRADER_OWNED_WINDOWS_PC'
  });
  await service.heartbeat(paired.podToken, {
    accountMask: '****1234', serverMask: '****Demo', brokerMask: '****Stellar',
    tradeMode: 'DEMO', terminalTradeAllowed: true, accountTradeAllowed: true,
    expertTradeAllowed: true, demoExecutionUnlocked: false, positions: []
  });
  const state = await service.state(userId);
  assert.equal(state.pod.ownershipMode, 'TRADER_OWNED_WINDOWS_PC');
  assert.equal(state.pod.demoExecutionUnlocked, false);
  assert.equal(state.connection.state, 'CONNECTED_LOCKED');
  assert.equal(state.control.canTurnOn, false);
  assert.equal(state.safeguards.brokerCredentialsInControlPlane, false);
  assert.equal(JSON.stringify(state).includes(paired.podToken), false);
});

test('server-side rollout gate blocks ON and setup dispatch independently of the worker', async () => {
  const store = new MemoryAutoTradeStore();
  const service = createAutoTradeService({ store, commandSigningKey: SIGNING_KEY });
  const userId = '77777777-7777-4777-8777-777777777777';
  const provisioned = await service.provisionDemoPod(userId, 'Locked rollout pod');
  await service.heartbeat(provisioned.token, {
    accountMask: '****1234', serverMask: '****Demo', brokerMask: '****Stellar',
    tradeMode: 'DEMO', terminalTradeAllowed: true, accountTradeAllowed: true,
    expertTradeAllowed: true, demoExecutionUnlocked: true, positions: []
  });
  await service.saveSettings(userId, {
    capitalUsd: 100, lotPerLayer: 0.01, layers: 3,
    symbols: ['XAUUSD'], riskAcknowledged: true
  });
  await assert.rejects(
    () => service.turnOn(userId, { confirmation: 'AKTIFKAN DEMO' }),
    error => error.code === 'EXECUTION_ROLLOUT_LOCKED'
  );
  const state = await service.state(userId);
  assert.equal(state.control.executionRolloutUnlocked, false);
  assert.equal(state.control.canTurnOn, false);
  assert.deepEqual(await service.dispatchMarkets([{
    symbol: 'XAUUSD', receivedAt: 1_790_000_008_000,
    strategyNormal: {
      state: 'READY', side: 'BUY',
      plan: { entry: 2500, sl: 2495, tp1: 2505, tp2: 2510, tp3: 2515 }
    }
  }]), { queued: 0 });
});

test('pairing code cannot cross from the selected Windows host profile to another host type', async () => {
  const store = new MemoryAutoTradeStore();
  const service = createAutoTradeService({ store, commandSigningKey: SIGNING_KEY });
  const created = await service.createPairingSession(
    '66666666-6666-4666-8666-666666666666',
    { confirmation: 'PAIR SECURE POD', ownershipMode: 'TRADER_OWNED_WINDOWS_PC' }
  );
  await assert.rejects(
    () => service.pairTraderOwnedPod({
      pairingCode: created.pairing.code,
      ownershipMode: 'TRADER_OWNED_AZURE'
    }),
    error => error.code === 'PAIRING_HOST_MISMATCH'
  );
});

test('each Secure Pod receives an isolated command signing key', async () => {
  const store = new MemoryAutoTradeStore();
  const service = createAutoTradeService({ store, commandSigningKey: SIGNING_KEY });
  const first = await service.provisionDemoPod('33333333-3333-4333-8333-333333333333', 'First');
  const second = await service.provisionDemoPod('44444444-4444-4444-8444-444444444444', 'Second');
  assert.notEqual(first.commandSigningKey, second.commandSigningKey);
  assert.equal(first.commandSigningKey, service.commandSigningKeyForPod(first.pod.id));
  assert.equal(second.commandSigningKey, service.commandSigningKeyForPod(second.pod.id));
});

test('ON waits for pod acknowledgement and STOP preserves open position management', async () => {
  const { service, userId, token } = await setup();
  await service.saveSettings(userId, {
    capitalUsd: 100,
    lotPerLayer: 0.01,
    layers: 3,
    symbols: ['XAUUSD'],
    riskAcknowledged: true
  });

  let state = await service.turnOn(userId, { confirmation: 'AKTIFKAN DEMO' });
  assert.equal(state.control.desiredState, 'ON');
  assert.equal(state.control.effectiveState, 'ARMING');
  assert.equal(state.control.canEnter, false);

  const onCommand = await service.nextCommand(token);
  assert.equal(onCommand.command.type, 'SYSTEM_ON');
  assert.match(onCommand.command.signature, /^[a-f0-9]{64}$/);
  assert.match(onCommand.command.signedEnvelope, /^[A-Za-z0-9_-]+$/);
  await service.acknowledgeCommand(token, onCommand.command.id, {
    status: 'EXECUTED', code: 'OK', message: 'Auto Trade armed'
  });
  state = await service.state(userId);
  assert.equal(state.control.effectiveState, 'ON');
  assert.equal(state.control.canEnter, true);

  await service.heartbeat(token, {
    accountMask: '****1234', serverMask: '****Demo', brokerMask: '****Stellar',
    tradeMode: 'DEMO', terminalTradeAllowed: true, accountTradeAllowed: true,
    expertTradeAllowed: true, demoExecutionUnlocked: true,
    positions: [{
      ticket: '900001', symbol: 'XAUUSD', side: 'BUY', volume: 0.03,
      layers: 3, entry: 2500, currentPrice: 2505, initialSl: 2495,
      activeSl: 2500, tp1: 2505, tp2: 2510, tp3: 2515,
      profitUsd: 15, exitStage: 'TP1_HIT', slLock: 'BREAK_EVEN'
    }]
  });

  state = await service.stop(userId);
  assert.equal(state.control.desiredState, 'STOPPED');
  assert.equal(state.control.effectiveState, 'STOPPING');
  assert.equal(state.positions.length, 1);
  const stopCommand = await service.nextCommand(token);
  assert.equal(stopCommand.command.type, 'SYSTEM_STOP');
  assert.equal(stopCommand.command.payload.keepExitManagement, true);
  await service.acknowledgeCommand(token, stopCommand.command.id, { status: 'EXECUTED', code: 'OK' });
  state = await service.state(userId);
  assert.equal(state.control.effectiveState, 'STOPPED');
  assert.equal(state.positions.length, 1);
  assert.equal(state.positions[0].slLock, 'BREAK_EVEN');
});

test('high-risk READY signal is queued once because risk is warning-only', async () => {
  const { service, userId, token } = await setup();
  await service.saveSettings(userId, {
    capitalUsd: 100, lotPerLayer: 0.01, layers: 3,
    symbols: ['XAUUSD'], riskAcknowledged: true
  });
  await service.turnOn(userId, { confirmation: 'AKTIFKAN DEMO' });
  const onCommand = await service.nextCommand(token);
  await service.acknowledgeCommand(token, onCommand.command.id, { status: 'EXECUTED' });

  const market = {
    symbol: 'XAUUSD', receivedAt: 1_790_000_001_000,
    strategyNormal: {
      state: 'READY', side: 'BUY',
      plan: { entry: 2500, sl: 2490, tp1: 2510, tp2: 2520, tp3: 2530 }
    }
  };
  assert.deepEqual(await service.dispatchMarkets([market]), { queued: 1 });
  assert.deepEqual(await service.dispatchMarkets([market]), { queued: 0 });
  const setupCommand = await service.nextCommand(token);
  assert.equal(setupCommand.command.type, 'PLACE_SETUP');
  assert.equal(setupCommand.command.payload.risk.level, 'HIGH');
  assert.equal(setupCommand.command.payload.risk.blocksOrder, false);
});

test('reviewed connector version is mandatory before Demo execution can arm', async () => {
  const { service, userId, token } = await setup();
  await service.heartbeat(token, {
    accountMask: '****1234', serverMask: '****Demo', brokerMask: '****Stellar',
    tradeMode: 'DEMO', terminalTradeAllowed: true, accountTradeAllowed: true,
    expertTradeAllowed: true, demoExecutionUnlocked: true,
    connectorVersion: '1.3.0-demo', positions: []
  });
  await service.saveSettings(userId, {
    capitalUsd: 100, lotPerLayer: 0.01, layers: 3,
    symbols: ['XAUUSD'], riskAcknowledged: true
  });
  const state = await service.state(userId);
  assert.equal(state.connection.state, 'UPDATE_REQUIRED');
  assert.equal(state.control.canTurnOn, false);
  await assert.rejects(
    () => service.turnOn(userId, { confirmation: 'AKTIFKAN DEMO' }),
    error => error.code === 'POD_NOT_READY'
  );
});

test('first Demo execution rollout blocks unvalidated symbols as a technical safeguard', async () => {
  const { service, userId } = await setup();
  await service.saveSettings(userId, {
    capitalUsd: 100, lotPerLayer: 0.01, layers: 3,
    symbols: ['EURUSD'], riskAcknowledged: true
  });
  await assert.rejects(
    () => service.turnOn(userId, { confirmation: 'AKTIFKAN DEMO' }),
    error => error.code === 'DEMO_SYMBOL_NOT_VALIDATED'
  );
});

test('STOP cancels queued entries and is delivered before any broker setup', async () => {
  const { service, userId, token } = await setup();
  await service.saveSettings(userId, {
    capitalUsd: 100, lotPerLayer: 0.01, layers: 3,
    symbols: ['XAUUSD'], riskAcknowledged: true
  });
  await service.turnOn(userId, { confirmation: 'AKTIFKAN DEMO' });
  let command = await service.nextCommand(token);
  await service.acknowledgeCommand(token, command.command.id, { status: 'EXECUTED' });
  await service.dispatchMarkets([{
    symbol: 'XAUUSD', receivedAt: 1_790_000_001_000,
    strategyNormal: {
      state: 'READY', side: 'BUY',
      plan: { entry: 2500, sl: 2495, tp1: 2505, tp2: 2510, tp3: 2515 }
    }
  }]);
  await service.stop(userId);
  command = await service.nextCommand(token);
  assert.equal(command.command.type, 'SYSTEM_STOP');
  await service.acknowledgeCommand(token, command.command.id, { status: 'EXECUTED' });
  const afterStop = await service.nextCommand(token);
  assert.equal(afterStop.command, null);
});

test('an open symbol position blocks a second setup command', async () => {
  const { service, userId, token } = await setup();
  await service.saveSettings(userId, {
    capitalUsd: 100, lotPerLayer: 0.01, layers: 3,
    symbols: ['XAUUSD'], riskAcknowledged: true
  });
  await service.turnOn(userId, { confirmation: 'AKTIFKAN DEMO' });
  const onCommand = await service.nextCommand(token);
  await service.acknowledgeCommand(token, onCommand.command.id, { status: 'EXECUTED' });
  await service.heartbeat(token, {
    accountMask: '****1234', serverMask: '****Demo', brokerMask: '****Stellar',
    tradeMode: 'DEMO', terminalTradeAllowed: true, accountTradeAllowed: true,
    expertTradeAllowed: true, demoExecutionUnlocked: true,
    connectorVersion: '1.4.0-demo-execution',
    positions: [{
      ticket: '900010', symbol: 'XAUUSD', side: 'BUY', volume: 0.03,
      entry: 2500, currentPrice: 2501, activeSl: 2495
    }]
  });
  const result = await service.dispatchMarkets([{
    symbol: 'XAUUSD', receivedAt: 1_790_000_003_000,
    strategyNormal: {
      state: 'READY', side: 'BUY',
      plan: { entry: 2501, sl: 2496, tp1: 2506, tp2: 2511, tp3: 2516 }
    }
  }]);
  assert.deepEqual(result, { queued: 0 });
});

test('emergency close requires step-up and exact phrase', async () => {
  const { service, userId } = await setup();
  await assert.rejects(
    () => service.emergencyCloseAll(userId, { confirmation: 'TUTUP SEMUA' }, false),
    error => error.code === 'STEP_UP_REQUIRED'
  );
  await assert.rejects(
    () => service.emergencyCloseAll(userId, { confirmation: 'close' }, true),
    error => error.code === 'CONFIRMATION_REQUIRED'
  );
  const state = await service.emergencyCloseAll(userId, { confirmation: 'TUTUP SEMUA' }, true);
  assert.equal(state.control.desiredState, 'STOPPED');
  assert.equal(state.control.effectiveState, 'EMERGENCY_CLOSING');
});

test('STOPPED users still receive StepLock management for open positions', async () => {
  const { service, token } = await setup();
  await service.heartbeat(token, {
    accountMask: '****1234', serverMask: '****Demo', brokerMask: '****Stellar',
    tradeMode: 'DEMO', terminalTradeAllowed: true, accountTradeAllowed: true,
    expertTradeAllowed: true, demoExecutionUnlocked: true,
    positions: [{
      ticket: '900002', symbol: 'XAUUSD', side: 'BUY', volume: 0.02,
      entry: 2500, currentPrice: 2510, initialSl: 2495, activeSl: 2500,
      profitUsd: 20, exitStage: 'TP2_HIT', slLock: 'TP1'
    }]
  });
  const result = await service.dispatchMarkets([{
    symbol: 'XAUUSD', receivedAt: 1_790_000_004_000,
    positionManagement: {
      action: 'HOLD', slMoveTriggered: true,
      slMoveAction: 'MOVE_SL_TP1', activeSl: 2505, slLockLabel: 'TP1'
    }
  }]);
  assert.deepEqual(result, { queued: 1 });
  const command = await service.nextCommand(token);
  assert.equal(command.command.type, 'MANAGE_POSITION');
  assert.equal(command.command.payload.actions[0].type, 'MOVE_SL_TP1');
});

test('pod heartbeat rejects raw broker credential fields', async () => {
  const { service, token } = await setup();
  await assert.rejects(
    () => service.heartbeat(token, {
      accountMask: '****1234', serverMask: '****Demo', tradeMode: 'DEMO',
      nested: { login: 1234, password: 'do-not-store' }
    }),
    error => error.code === 'INVALID_HEARTBEAT' && !!error.fields.credential
  );
});

test('hosted MT5 stores only a validated encrypted envelope and never returns it', async () => {
  const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const store = new MemoryAutoTradeStore();
  const service = createAutoTradeService({
    store,
    commandSigningKey: SIGNING_KEY,
    hostedMt5Enabled: true,
    credentialKeyId: 'zencore-demo-key-v1',
    credentialPublicKey: keyPair.publicKey.export({ type: 'spki', format: 'pem' })
  });
  const userId = '99999999-9999-4999-8999-999999999999';
  const encryption = service.credentialEncryptionConfig();
  assert.equal(encryption.encryption.algorithm, 'RSA-OAEP-256+A256GCM');
  assert.equal(encryption.encryption.keyId, 'zencore-demo-key-v1');
  assert.ok(encryption.encryption.publicKeySpki.length > 100);
  assert.equal(JSON.stringify(encryption).includes('PRIVATE'), false);

  const credentialEnvelope = {
    version: 1,
    algorithm: 'RSA-OAEP-256+A256GCM',
    keyId: 'zencore-demo-key-v1',
    wrappedKey: crypto.randomBytes(256).toString('base64url'),
    iv: crypto.randomBytes(12).toString('base64url'),
    ciphertext: crypto.randomBytes(80).toString('base64url')
  };
  const state = await service.connectHostedAccount(userId, {
    credentialEnvelope,
    accountMask: '****123456',
    serverMask: '****ncial-Demo',
    brokerMask: '****ellarFinancial',
    tradeMode: 'DEMO',
    confirmation: 'CONNECT MT5 DEMO'
  }, true);
  assert.equal(state.hostedAccount.status, 'PENDING_VERIFICATION');
  assert.equal(state.hostedAccount.accountMask, '****123456');
  assert.equal(state.ui.autoTradeConfigured, true);
  assert.equal(state.control.canTurnOn, false);
  assert.equal(state.safeguards.brokerCredentialsInControlPlane, 'ENCRYPTED_ENVELOPE_ONLY');
  assert.equal(JSON.stringify(state).includes(credentialEnvelope.ciphertext), false);
  assert.deepEqual(store.hostedAccounts.get(userId).credentialEnvelope, credentialEnvelope);
  assert.equal(JSON.stringify(store.hostedAccounts.get(userId)).includes('broker-secret'), false);
});

test('hosted MT5 rejects plaintext credential fields and wrong envelope keys', async () => {
  const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const service = createAutoTradeService({
    store: new MemoryAutoTradeStore(),
    commandSigningKey: SIGNING_KEY,
    hostedMt5Enabled: true,
    credentialKeyId: 'zencore-demo-key-v1',
    credentialPublicKey: keyPair.publicKey.export({ type: 'spki', format: 'pem' })
  });
  const base = {
    credentialEnvelope: {
      version: 1,
      algorithm: 'RSA-OAEP-256+A256GCM',
      keyId: 'wrong-key',
      wrappedKey: crypto.randomBytes(256).toString('base64url'),
      iv: crypto.randomBytes(12).toString('base64url'),
      ciphertext: crypto.randomBytes(80).toString('base64url')
    },
    accountMask: '****123456',
    serverMask: '****ncial-Demo',
    brokerMask: '****ellarFinancial',
    tradeMode: 'DEMO',
    confirmation: 'CONNECT MT5 DEMO'
  };
  await assert.rejects(
    () => service.connectHostedAccount('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      ...base,
      password: 'must-never-reach-service'
    }, true),
    error => error.code === 'PLAINTEXT_CREDENTIAL_REJECTED'
  );
  await assert.rejects(
    () => service.connectHostedAccount('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', base, true),
    error => error.code === 'INVALID_CREDENTIAL_ENVELOPE' && !!error.fields.keyId
  );
});

test('Google hosted worker leases only ciphertext and reports connection with execution locked', async () => {
  let currentTime = 1_790_000_100_000;
  const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const store = new MemoryAutoTradeStore();
  const connectionService = createAutoTradeService({
    store,
    commandSigningKey: SIGNING_KEY,
    hostedMt5Enabled: true,
    credentialKeyId: 'zencore-gcp-hsm-demo-v1',
    credentialPublicKey: keyPair.publicKey.export({ type: 'spki', format: 'pem' }),
    now: () => currentTime
  });
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const credentialEnvelope = {
    version: 1,
    algorithm: 'RSA-OAEP-256+A256GCM',
    keyId: 'zencore-gcp-hsm-demo-v1',
    wrappedKey: crypto.randomBytes(384).toString('base64url'),
    iv: crypto.randomBytes(12).toString('base64url'),
    ciphertext: crypto.randomBytes(96).toString('base64url')
  };
  const connected = await connectionService.connectHostedAccount(userId, {
    credentialEnvelope,
    accountMask: '****123456',
    serverMask: '****ncial-Demo',
    brokerMask: '****ellarFinancial',
    tradeMode: 'DEMO',
    confirmation: 'CONNECT MT5 DEMO'
  }, true);
  const accountId = connected.hostedAccount.id;
  const service = createAutoTradeService({
    store,
    commandSigningKey: SIGNING_KEY,
    hostedMt5Enabled: true,
    hostedWorkerEnabled: true,
    hostedWorkerAccountId: accountId,
    credentialKeyId: 'zencore-gcp-hsm-demo-v1',
    credentialPublicKey: keyPair.publicKey.export({ type: 'spki', format: 'pem' }),
    now: () => currentTime
  });
  const identity = {
    provider: 'GOOGLE_CLOUD',
    subject: '100000000000000000001',
    email: 'zencore-mt5-demo-worker@zencore-demo-12345.iam.gserviceaccount.com',
    projectId: 'zencore-demo-12345',
    zone: 'asia-southeast1-b',
    instanceName: 'zencore-mt5-demo-01',
    instanceId: '9876543210987654321'
  };
  const leased = await service.leaseHostedAccount(identity, {
    accountId,
    cellId: identity.instanceName
  });
  assert.deepEqual(leased.lease.credentialEnvelope, credentialEnvelope);
  assert.equal(leased.lease.executionEnabled, false);
  assert.equal(leased.lease.demoOnly, true);
  assert.equal(leased.lease.accountMask, '****123456');
  assert.equal(leased.lease.serverMask, '****ncial-Demo');
  assert.equal(leased.lease.brokerMask, '****ellarFinancial');
  assert.equal(JSON.stringify(await service.state(userId)).includes(credentialEnvelope.ciphertext), false);
  await assert.rejects(
    () => service.leaseHostedAccount(identity, {
      accountId: '11111111-2222-4333-8444-555555555555',
      cellId: identity.instanceName
    }),
    error => error.code === 'INVALID_HOSTED_LEASE'
  );
  await assert.rejects(
    () => service.leaseHostedAccount(identity, {
      accountId,
      cellId: identity.instanceName,
      nested: { password: 'must-never-reach-the-control-plane' }
    }),
    error => error.code === 'PLAINTEXT_CREDENTIAL_REJECTED'
  );

  currentTime += 1000;
  const heartbeat = await service.hostedHeartbeat(identity, {
    accountId,
    leaseId: leased.lease.id,
    accountMask: '****123456',
    serverMask: '****ncial-Demo',
    brokerMask: '****ellarFinancial',
    tradeMode: 'DEMO',
    connectionStatus: 'CONNECTED',
    terminalTradeAllowed: true,
    accountTradeAllowed: true,
    expertTradeAllowed: true,
    demoExecutionUnlocked: false,
    connectorVersion: '2.0.0-gcp-connect',
    terminalBuild: '5000',
    symbolSpecs: [{
      symbol: 'XAUUSD', tickSize: 0.01, tickValue: 1,
      volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01
    }],
    positions: []
  });
  assert.equal(heartbeat.connectionState, 'CONNECTED_LOCKED');
  assert.equal(heartbeat.executionEnabled, false);
  const state = await service.state(userId);
  assert.equal(state.connection.state, 'HOSTED_CONNECTED_LOCKED');
  assert.equal(state.hostedAccount.workerProvider, 'GOOGLE_CLOUD');
  assert.equal(state.hostedAccount.workerCell, identity.instanceName);
  assert.equal(state.control.canTurnOn, false);
  assert.equal(state.hostedMt5.executionReady, false);

  await assert.rejects(
    () => service.hostedHeartbeat(identity, {
      accountId,
      leaseId: leased.lease.id,
      accountMask: '****123456', serverMask: '****ncial-Demo',
      brokerMask: '****ellarFinancial', tradeMode: 'DEMO',
      demoExecutionUnlocked: true
    }),
    error => error.code === 'HOSTED_EXECUTION_LOCKED'
  );

  currentTime = leased.lease.expiresAt;
  await assert.rejects(
    () => service.hostedHeartbeat(identity, {
      accountId,
      leaseId: leased.lease.id,
      accountMask: '****123456', serverMask: '****ncial-Demo',
      brokerMask: '****ellarFinancial', tradeMode: 'DEMO',
      connectionStatus: 'CONNECTED', terminalTradeAllowed: true,
      accountTradeAllowed: true, expertTradeAllowed: true,
      demoExecutionUnlocked: false, connectorVersion: '2.0.0-gcp-connect',
      terminalBuild: '5000', symbolSpecs: [], positions: []
    }),
    error => error.code === 'HOSTED_LEASE_NOT_FOUND'
  );
});

test('GCP hosted v2.1 requires local intent plus rollout gate before signed DEMO commands', async () => {
  let currentTime = 1_790_000_300_000;
  const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const store = new MemoryAutoTradeStore();
  const bootstrap = createAutoTradeService({
    store,
    commandSigningKey: SIGNING_KEY,
    hostedMt5Enabled: true,
    credentialKeyId: 'zencore-gcp-hsm-demo-v1',
    credentialPublicKey: keyPair.publicKey.export({ type: 'spki', format: 'pem' }),
    now: () => currentTime
  });
  const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const credentialEnvelope = {
    version: 1,
    algorithm: 'RSA-OAEP-256+A256GCM',
    keyId: 'zencore-gcp-hsm-demo-v1',
    wrappedKey: crypto.randomBytes(384).toString('base64url'),
    iv: crypto.randomBytes(12).toString('base64url'),
    ciphertext: crypto.randomBytes(96).toString('base64url')
  };
  const connected = await bootstrap.connectHostedAccount(userId, {
    credentialEnvelope,
    accountMask: '****123456',
    serverMask: '****ncial-Demo',
    brokerMask: '****ellarFinancial',
    tradeMode: 'DEMO',
    confirmation: 'CONNECT MT5 DEMO'
  }, true);
  const accountId = connected.hostedAccount.id;
  const service = createAutoTradeService({
    store,
    commandSigningKey: SIGNING_KEY,
    allowDemoExecution: true,
    allowedDemoSymbols: ['XAUUSD'],
    requiredHostedConnectorVersion: '2.1.0-gcp-demo-execution',
    hostedMt5Enabled: true,
    hostedWorkerEnabled: true,
    hostedWorkerAccountId: accountId,
    credentialKeyId: 'zencore-gcp-hsm-demo-v1',
    credentialPublicKey: keyPair.publicKey.export({ type: 'spki', format: 'pem' }),
    now: () => currentTime
  });
  const identity = {
    provider: 'GOOGLE_CLOUD',
    subject: '100000000000000000001',
    email: 'zencore-mt5-demo-worker@zencore-demo-12345.iam.gserviceaccount.com',
    projectId: 'zencore-demo-12345',
    zone: 'asia-southeast1-b',
    instanceName: 'zencore-mt5-demo-01',
    instanceId: '9876543210987654321'
  };

  let lease = await service.leaseHostedAccount(identity, {
    accountId,
    cellId: identity.instanceName,
    executionRequested: false
  });
  assert.equal(lease.lease.executionEnabled, false);

  currentTime += 1000;
  await service.hostedHeartbeat(identity, {
    accountId,
    leaseId: lease.lease.id,
    accountMask: '****123456',
    serverMask: '****ncial-Demo',
    brokerMask: '****ellarFinancial',
    tradeMode: 'DEMO',
    connectionStatus: 'CONNECTED',
    terminalTradeAllowed: true,
    accountTradeAllowed: true,
    expertTradeAllowed: true,
    demoExecutionUnlocked: false,
    connectorVersion: '2.1.0-gcp-demo-execution',
    terminalBuild: '6204',
    symbolSpecs: [{
      symbol: 'XAUUSD', tickSize: 0.01, tickValue: 1,
      volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01
    }],
    positions: []
  });
  let state = await service.state(userId);
  assert.equal(state.connection.state, 'HOSTED_CONNECTED_LOCKED');
  assert.equal(state.connection.ready, false);

  currentTime += 1000;
  lease = await service.leaseHostedAccount(identity, {
    accountId,
    cellId: identity.instanceName,
    executionRequested: true
  });
  assert.equal(lease.lease.executionEnabled, true);
  assert.match(lease.lease.commandPodId, /^[0-9a-f-]{36}$/i);
  assert.ok(lease.lease.commandSigningKey.length >= 32);

  currentTime += 1000;
  const heartbeat = await service.hostedHeartbeat(identity, {
    accountId,
    leaseId: lease.lease.id,
    accountMask: '****123456',
    serverMask: '****ncial-Demo',
    brokerMask: '****ellarFinancial',
    tradeMode: 'DEMO',
    connectionStatus: 'CONNECTED',
    terminalTradeAllowed: true,
    accountTradeAllowed: true,
    expertTradeAllowed: true,
    demoExecutionUnlocked: true,
    connectorVersion: '2.1.0-gcp-demo-execution',
    terminalBuild: '6204',
    symbolSpecs: [{
      symbol: 'XAUUSD', tickSize: 0.01, tickValue: 1,
      volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01
    }],
    positions: []
  });
  assert.equal(heartbeat.executionEnabled, true);
  state = await service.state(userId);
  assert.equal(state.connection.state, 'HOSTED_READY');
  assert.equal(state.connection.ready, true);

  await service.saveSettings(userId, {
    capitalUsd: 100,
    lotPerLayer: 0.01,
    layers: 3,
    symbols: ['XAUUSD'],
    riskAcknowledged: true
  });
  state = await service.state(userId);
  assert.equal(state.control.canTurnOn, true);

  state = await service.turnOn(userId, { confirmation: 'AKTIFKAN DEMO' });
  assert.equal(state.control.effectiveState, 'ARMING');
  const next = await service.hostedNextCommand(identity, {
    accountId,
    leaseId: lease.lease.id
  });
  assert.equal(next.command.type, 'SYSTEM_ON');
  const ack = await service.hostedAcknowledgeCommand(identity, next.command.id, {
    accountId,
    leaseId: lease.lease.id,
    status: 'EXECUTED',
    code: 'ARMED',
    message: 'Hosted DEMO Auto Trade armed'
  });
  assert.equal(ack.status, 'EXECUTED');
  state = await service.state(userId);
  assert.equal(state.control.effectiveState, 'ON');
  assert.equal(state.control.canEnter, true);
});

test('hosted worker replay IDs survive outside the in-process verifier cache', async () => {
  const store = new MemoryAutoTradeStore();
  const identity = { instanceId: '9876543210987654321' };
  const requestId = '99999999-8888-4777-8666-555555555555';
  const now = 1_790_000_200_000;
  assert.equal(await store.consumeHostedWorkerRequest(identity, requestId, now - 1000, now), true);
  assert.equal(await store.consumeHostedWorkerRequest(identity, requestId, now - 1000, now + 1), false);
  assert.equal(await store.consumeHostedWorkerRequest(
    identity, '11111111-2222-4333-8444-555555555555', now, now + 11 * 60 * 1000
  ), true);
  assert.equal(store.hostedWorkerRequests.has(requestId), false);
});
