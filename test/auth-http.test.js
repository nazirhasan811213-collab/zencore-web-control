const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18771;
const BASE = `http://127.0.0.1:${PORT}`;

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
        ZENCORE_INSECURE_COOKIE: 'true'
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
      if (!settled && output.includes('gateway running') && output.includes('authentication ready')) {
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

test('HTTP auth flow protects Page Utama, Analysis, Result and analysis APIs', { timeout: 30000 }, async () => {
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
    assert.match(await response.text(), /ZenCore Precision Entry/);

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
  } finally {
    await stopServer(child);
  }
});
