const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18771;
const BASE = `http://127.0.0.1:${PORT}`;
const POD_PROVISIONING_SECRET = 'test-pod-provisioning-secret-at-least-32-bytes';
const COMMAND_SIGNING_KEY = 'test-command-signing-key-at-least-32-bytes';

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-r', './compat-v17.js', 'server-analysis.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(PORT),
        SITE_MODE: 'precision-entry',
        ZENCORE_AUTH_ENABLED: 'true',
        ZENCORE_AUTH_MEMORY: 'true',
        ZENCORE_INSECURE_COOKIE: 'true',
        ZENCORE_AUTOTRADE_ENABLED: 'true',
        ZENCORE_AUTOTRADE_EXECUTION_ENABLED: 'true',
        ZENCORE_AUTOTRADE_MEMORY: 'true',
        ZENCORE_HOSTED_MT5_ENABLED: 'false',
        ZENCORE_GCP_HOSTED_WORKER_ENABLED: 'false',
        ZENCORE_POD_PROVISIONING_SECRET: POD_PROVISIONING_SECRET,
        ZENCORE_COMMAND_SIGNING_KEY: COMMAND_SIGNING_KEY,
        ZENCORE_PUBLIC_VIEWER_ENABLED: 'true',
        ZENCORE_PUBLIC_VIEWER_EMAIL: 'public@zencore.my',
        ZENCORE_PUBLIC_VIEWER_PASSWORD: 'ZenCoreView2026!',
        ZENCORE_PUBLIC_VIEWER_NAME: 'ZenCore Public Viewer'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`ZenCore test server did not become ready:\n${output}`));
    }, 15000);

    const onData = chunk => {
      output += chunk.toString();
      if (!settled && output.includes('gateway running') && output.includes('authentication ready') && output.includes('Auto Trade control plane ready')) {
        settled = true;
        clearTimeout(timer);
        resolve({ child, output: () => output });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`ZenCore test server exited with ${code}:\n${output}`));
    });
  });
}

function stopServer(child) {
  return new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

test('HTTP auth flow protects pages, analysis APIs and the MT5 control plane', { timeout: 30000 }, async () => {
  const { child, output } = await startServer();
  try {
    let response = await fetch(`${BASE}/`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');

    response = await fetch(`${BASE}/login`);
    assert.equal(response.status, 200);
    const loginPage = await response.text();
    assert.match(loginPage, /Log masuk/);
    assert.doesNotMatch(loginPage, /href="\/register"/);

    response = await fetch(`${BASE}/register`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');

    response = await fetch(`${BASE}/u/does-not-exist`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');

    response = await fetch(`${BASE}/u/nazir`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/register?ib=nazir');

    response = await fetch(`${BASE}/api/markets`);
    assert.equal(response.status, 401);

    response = await fetch(`${BASE}/results`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');

    response = await fetch(`${BASE}/auto-trade`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');

    response = await fetch(`${BASE}/auth/referrer/nazir`);
    assert.equal(response.status, 200);
    const defaultIb = await response.json();
    assert.equal(defaultIb.referrer.code, 'nazir');
    assert.equal(defaultIb.referrer.displayName, 'Nazir (Admin)');

    response = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE, Accept: 'application/json' },
      body: JSON.stringify({
        email: 'public@zencore.my',
        password: 'ZenCoreView2026!'
      })
    });
    assert.equal(response.status, 200, output());
    const viewerLogin = await response.json();
    assert.equal(viewerLogin.user.role, 'viewer');
    const viewerCookie = response.headers.get('set-cookie').split(';')[0];

    response = await fetch(`${BASE}/app`, { headers: { Cookie: viewerCookie } });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Market Radar/);

    response = await fetch(`${BASE}/analysis?pair=XAUUSD`, { headers: { Cookie: viewerCookie } });
    assert.equal(response.status, 200);

    response = await fetch(`${BASE}/results`, { headers: { Cookie: viewerCookie } });
    assert.equal(response.status, 200);

    response = await fetch(`${BASE}/auto-trade`, {
      headers: { Cookie: viewerCookie }
    });
    assert.equal(response.status, 200);
    const viewerAutoTradePage = await response.text();
    assert.match(viewerAutoTradePage, /ZenCore Total Trade System/);
    assert.match(viewerAutoTradePage, /viewer-mode\.js/);

    response = await fetch(`${BASE}/account`, {
      headers: { Cookie: viewerCookie },
      redirect: 'manual'
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/app');

    response = await fetch(`${BASE}/api/auto-trade/state`, {
      headers: { Cookie: viewerCookie }
    });
    assert.equal(response.status, 200);
    const viewerAutoState = await response.json();
    assert.equal(viewerAutoState.viewerMode, true);
    assert.equal(viewerAutoState.connection.state, 'VIEW_ONLY');
    assert.equal(viewerAutoState.connection.ready, false);
    assert.equal(viewerAutoState.hostedAccount, null);
    assert.equal(viewerAutoState.pod, null);
    assert.equal(viewerAutoState.control.canTurnOn, false);

    response = await fetch(`${BASE}/api/auto-trade/credential-key`, {
      headers: { Cookie: viewerCookie }
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'VIEW_ONLY');

    response = await fetch(`${BASE}/api/auto-trade/on`, {
      method: 'POST',
      headers: { Cookie: viewerCookie, Origin: BASE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'AKTIFKAN DEMO' })
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'VIEW_ONLY');

    response = await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: viewerCookie, Origin: BASE, Accept: 'application/json' }
    });
    assert.equal(response.status, 200);

    response = await fetch(`${BASE}/register?ib=nazir`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Daftar ZenCore/);

    const registration = {
      displayName: 'HTTP Test Trader',
      email: 'http-test@example.com',
      icNumber: '900101011240',
      phone: '0123456782',
      ibCode: 'nazir',
      password: 'ZenCore2026!'
    };

    response = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
      body: JSON.stringify({ ...registration, riskAccepted: true })
    });
    assert.equal(response.status, 403);

    response = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({
        ...registration,
        ibCode: 'does-not-exist',
        riskAccepted: true
      })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_REGISTRATION_LINK');

    response = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ ...registration, riskAccepted: false })
    });
    assert.equal(response.status, 400);

    response = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': BASE
      },
      body: JSON.stringify({
        ...registration,
        riskAccepted: true
      })
    });
    assert.equal(response.status, 201, output());
    const registered = await response.json();
    assert.equal(registered.user.role, 'client');
    const userId = registered.user.id;
    const setCookie = response.headers.get('set-cookie');
    assert.ok(setCookie);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0];

    response = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': BASE
      },
      body: JSON.stringify({
        displayName: 'Overseas Client',
        email: 'overseas-client@example.com',
        icNumber: 'A 1234-5678',
        phone: '+66812345678',
        ibCode: 'nazir',
        password: 'ZenCore2026!',
        riskAccepted: true
      })
    });
    assert.equal(response.status, 201, output());
    assert.equal((await response.json()).user.role, 'client');

    response = await fetch(`${BASE}/admin`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/app');

    response = await fetch(`${BASE}/ib`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/app');

    response = await fetch(`${BASE}/api/admin/overview`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 403);

    response = await fetch(`${BASE}/api/ib/overview`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 403);

    response = await fetch(`${BASE}/app`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
    const home = await response.text();
    assert.match(home, /Market Radar/);
    assert.match(home, /marketGrid/);
    assert.match(home, /\/analysis\?pair=XAUUSD/);
    assert.match(home, /href="\/results"/);

    response = await fetch(`${BASE}/market-radar-core.js`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /SUPPORTED_MARKETS/);

    response = await fetch(`${BASE}/home.css`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /market-grid/);

    response = await fetch(`${BASE}/analysis`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const analysisPage = await response.text();
    assert.match(analysisPage, /ZenCore Precision Entry/);
    assert.match(analysisPage, /MT5 Live Execution Monitor/);
    assert.match(analysisPage, /mt5LiveMonitor[^>]+hidden/);
    assert.match(analysisPage, /auto-trade-monitor\.js/);

    response = await fetch(`${BASE}/results`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
    const results = await response.text();
    assert.match(results, /ZenCore Signal Validation/);
    assert.match(results, /Bukan trade broker atau rekod P\/L MT5/);

    response = await fetch(`${BASE}/results-core.js`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /aggregatePerformance/);

    response = await fetch(`${BASE}/results.css`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /result-summary/);

    response = await fetch(`${BASE}/results.js`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /refreshResults/);

    response = await fetch(`${BASE}/auto-trade`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
    const autoTradePage = await response.text();
    assert.match(autoTradePage, /ZenCore Total Trade System/);
    assert.match(autoTradePage, /EMERGENCY CLOSE ALL/);
    assert.match(autoTradePage, /mt5ConnectDialog/);
    assert.match(autoTradePage, /Credential MT5 dienkripsi dalam browser/);
    assert.doesNotMatch(autoTradePage, /name="(?:login|password|server)"/i);

    response = await fetch(`${BASE}/analysis-execution-contract.js`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /ZENCORE_ANALYSIS_EXECUTION_V1/);

    response = await fetch(`${BASE}/auto-trade-core.js`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /FORBIDDEN_CREDENTIAL_KEYS/);

    response = await fetch(`${BASE}/api/auto-trade/state`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    let autoState = await response.json();
    assert.equal(autoState.control.effectiveState, 'UNPROVISIONED');
    assert.equal(autoState.safeguards.brokerCredentialsInControlPlane, false);
    assert.equal(autoState.hostedMt5.available, false);

    response = await fetch(`${BASE}/api/auto-trade/credential-key`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'HOSTED_MT5_LOCKED');

    response = await fetch(`${BASE}/api/hosted-execution/lease`, {
      method: 'POST',
      headers: { Authorization: 'Bearer not-a-google-token', 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'HOSTED_WORKER_LOCKED');

    response = await fetch(`${BASE}/api/auto-trade/settings`, {
      method: 'PUT',
      headers: { Cookie: cookie, Origin: BASE, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capitalUsd: 100, lotPerLayer: 0.01, layers: 3,
        symbols: ['XAUUSD'], riskAcknowledged: true,
        server: 'InterStellarFinancial-Demo', password: 'must-never-be-stored'
      })
    });
    assert.equal(response.status, 400);

    response = await fetch(`${BASE}/api/auto-trade/settings`, {
      method: 'PUT',
      headers: { Cookie: cookie, Origin: BASE, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capitalUsd: 100, lotPerLayer: 0.01, layers: 3,
        symbols: ['XAUUSD'], riskAcknowledged: true
      })
    });
    assert.equal(response.status, 200);

    response = await fetch(`${BASE}/internal/auto-trade/provision-demo`, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
    assert.equal(response.status, 401);

    response = await fetch(`${BASE}/api/auto-trade/pairing`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: BASE, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirmation: 'PAIR SECURE POD', ownershipMode: 'TRADER_OWNED_WINDOWS_PC'
      })
    });
    assert.equal(response.status, 201);
    const pairing = await response.json();
    assert.match(pairing.pairing.code, /^zcpair_/);

    response = await fetch(`${BASE}/api/auto-trade/state`, { headers: { Cookie: cookie } });
    autoState = await response.json();
    assert.equal(autoState.pairing.ownershipMode, 'TRADER_OWNED_WINDOWS_PC');
    assert.equal(JSON.stringify(autoState).includes(pairing.pairing.code), false);

    response = await fetch(`${BASE}/api/execution/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode: pairing.pairing.code,
        ownershipMode: 'TRADER_OWNED_WINDOWS_PC'
      })
    });
    assert.equal(response.status, 201);
    const provisioned = await response.json();
    const podToken = provisioned.podToken;
    const podSigningKey = provisioned.commandSigningKey;
    assert.match(podToken, /^zcpod_/);
    assert.ok(podSigningKey.length >= 32);

    response = await fetch(`${BASE}/api/execution/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode: pairing.pairing.code,
        ownershipMode: 'TRADER_OWNED_WINDOWS_PC'
      })
    });
    assert.equal(response.status, 401);

    response = await fetch(`${BASE}/api/execution/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${podToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountMask: '****1234', serverMask: '****Demo', tradeMode: 'DEMO',
        nested: { password: 'must-never-be-stored' }
      })
    });
    assert.equal(response.status, 400);

    const heartbeat = (positions, demoExecutionUnlocked = true) => fetch(`${BASE}/api/execution/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${podToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountMask: '****1234', serverMask: '****Demo', brokerMask: '****Stellar',
        tradeMode: 'DEMO', terminalTradeAllowed: true, accountTradeAllowed: true,
        expertTradeAllowed: true, demoExecutionUnlocked,
        connectorVersion: '1.4.0-demo-execution', terminalBuild: '5000',
        symbolSpecs: [{ symbol: 'XAUUSD', tickSize: 0.01, tickValue: 1, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01 }],
        positions
      })
    });
    response = await heartbeat([], false);
    assert.equal(response.status, 200);

    response = await fetch(`${BASE}/api/auto-trade/state`, { headers: { Cookie: cookie } });
    autoState = await response.json();
    assert.equal(autoState.connection.state, 'CONNECTED_LOCKED');
    assert.equal(autoState.control.canTurnOn, false);

    response = await fetch(`${BASE}/api/auto-trade/on`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: BASE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'AKTIFKAN DEMO' })
    });
    assert.equal(response.status, 409);

    response = await heartbeat([], true);
    assert.equal(response.status, 200);

    response = await fetch(`${BASE}/api/auto-trade/on`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: BASE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'AKTIFKAN DEMO' })
    });
    assert.equal(response.status, 202);
    autoState = await response.json();
    assert.equal(autoState.control.effectiveState, 'ARMING');

    response = await fetch(`${BASE}/api/execution/commands/next`, {
      headers: { Authorization: `Bearer ${podToken}` }
    });
    assert.equal(response.status, 200);
    let command = (await response.json()).command;
    assert.equal(command.type, 'SYSTEM_ON');
    assert.match(command.signature, /^[a-f0-9]{64}$/);
    assert.match(command.signedEnvelope, /^[A-Za-z0-9_-]+$/);
    const expectedSignature = crypto.createHmac('sha256', podSigningKey)
      .update(Buffer.from(command.signedEnvelope, 'base64url')).digest('hex');
    assert.equal(command.signature, expectedSignature);

    response = await fetch(`${BASE}/api/execution/commands/${command.id}/ack`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${podToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'EXECUTED', code: 'OK' })
    });
    assert.equal(response.status, 200);

    response = await heartbeat([{
      ticket: '900001', symbol: 'XAUUSD', side: 'BUY', volume: 0.03, layers: 3,
      entry: 2500, currentPrice: 2505, initialSl: 2495, activeSl: 2500,
      tp1: 2505, tp2: 2510, tp3: 2515, profitUsd: 15,
      exitStage: 'TP1_HIT', slLock: 'BREAK_EVEN'
    }]);
    assert.equal(response.status, 200);

    response = await fetch(`${BASE}/api/auto-trade/state`, { headers: { Cookie: cookie } });
    autoState = await response.json();
    assert.equal(autoState.control.effectiveState, 'ON');
    assert.equal(autoState.positions.length, 1);
    assert.equal(autoState.positions[0].slLock, 'BREAK_EVEN');
    const stateText = JSON.stringify(autoState);
    assert.equal(stateText.includes(podToken), false);
    assert.equal(stateText.includes(podSigningKey), false);
    assert.equal(stateText.includes('must-never-be-stored'), false);

    response = await fetch(`${BASE}/api/auto-trade/stop`, {
      method: 'POST', headers: { Cookie: cookie, Origin: BASE, 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(response.status, 202);
    autoState = await response.json();
    assert.equal(autoState.control.desiredState, 'STOPPED');
    assert.equal(autoState.positions.length, 1);

    response = await fetch(`${BASE}/api/execution/commands/next`, { headers: { Authorization: `Bearer ${podToken}` } });
    command = (await response.json()).command;
    assert.equal(command.type, 'SYSTEM_STOP');
    assert.equal(command.payload.keepExitManagement, true);
    await fetch(`${BASE}/api/execution/commands/${command.id}/ack`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${podToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'EXECUTED', code: 'OK' })
    });

    response = await fetch(`${BASE}/api/auto-trade/emergency-close`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: BASE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'WrongPassword1', confirmation: 'TUTUP SEMUA' })
    });
    assert.equal(response.status, 401);

    response = await fetch(`${BASE}/api/auto-trade/emergency-close`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: BASE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: registration.password, confirmation: 'TUTUP SEMUA' })
    });
    assert.equal(response.status, 202);
    autoState = await response.json();
    assert.equal(autoState.control.effectiveState, 'EMERGENCY_CLOSING');

    response = await fetch(`${BASE}/api/strategy-performance/XAUUSD/NORMAL`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const performance = await response.json();
    assert.equal(performance.ok, true);
    assert.equal(performance.symbol, 'XAUUSD');
    assert.equal(performance.mode, 'NORMAL');

    response = await fetch(`${BASE}/api/markets`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const markets = await response.json();
    assert.equal(markets.ok, true);
    assert.equal(markets.markets.length, 11);

    response = await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: BASE, Accept: 'application/json' }
    });
    assert.equal(response.status, 200);

    response = await fetch(`${BASE}/app`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');

    response = await fetch(`${BASE}/results`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');

    response = await fetch(`${BASE}/auto-trade`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
  } finally {
    await stopServer(child);
  }
});
