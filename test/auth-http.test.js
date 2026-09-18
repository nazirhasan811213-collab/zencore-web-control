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
        ZENCORE_POD_PROVISIONING_SECRET: POD_PROVISIONING_SECRET,
        ZENCORE_COMMAND_SIGNING_KEY: COMMAND_SIGNING_KEY
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
    assert.match(await response.text(), /Log masuk/);

    response = await fetch(`${BASE}/api/markets`);
    assert.equal(response.status, 401);

    response = await fetch(`${BASE}/results`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');

    response = await fetch(`${BASE}/auto-trade`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');

    const registration = {
      displayName: 'HTTP Test Trader',
      email: 'http-test@example.com',
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
    const userId = registered.user.id;
    const setCookie = response.headers.get('set-cookie');
    assert.ok(setCookie);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0];

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
    assert.doesNotMatch(autoTradePage, /name="(?:login|password|server)"/i);

    response = await fetch(`${BASE}/auto-trade-core.js`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /FORBIDDEN_CREDENTIAL_KEYS/);

    response = await fetch(`${BASE}/api/auto-trade/state`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    let autoState = await response.json();
    assert.equal(autoState.control.effectiveState, 'UNPROVISIONED');
    assert.equal(autoState.safeguards.brokerCredentialsInControlPlane, false);

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
