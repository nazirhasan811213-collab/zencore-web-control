const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createAuthStore } = require('./auth-store');
const { createAuthService } = require('./auth-service');
const { createAutoTradeStore } = require('./auto-trade-store');
const { createAutoTradeService } = require('./auto-trade-service');
const {
  createGcpInstanceIdentityVerifier,
  createGcpRequestReplayGuard,
  identityError
} = require('./gcp-instance-identity');

const PUBLIC_PORT = Number(process.env.PORT || 8080);
const V17_PORT = 10003;
const SITE_MODE = String(process.env.SITE_MODE || 'legacy').toLowerCase();
const AUTH_ENABLED = /^(?:1|true|yes|on)$/i.test(String(process.env.ZENCORE_AUTH_ENABLED || ''));
const AUTH_MEMORY = /^(?:1|true|yes|on)$/i.test(String(process.env.ZENCORE_AUTH_MEMORY || ''));
const INSECURE_COOKIE = /^(?:1|true|yes|on)$/i.test(String(process.env.ZENCORE_INSECURE_COOKIE || ''));
const ALLOW_ORIGINLESS_AUTH = /^(?:1|true|yes|on)$/i.test(String(process.env.ZENCORE_ALLOW_ORIGINLESS_AUTH || ''));
const REGISTRATION_ENABLED = !/^(?:0|false|no|off)$/i.test(String(process.env.ZENCORE_REGISTRATION_ENABLED || 'true'));
const DEFAULT_IB_CODE = String(process.env.ZENCORE_DEFAULT_IB_CODE || 'nazir').trim().toLowerCase();
const IB_REGISTRY_JSON = String(process.env.ZENCORE_IB_REGISTRY_JSON || '').trim();
const ADMIN_EMAILS = String(process.env.ZENCORE_ADMIN_EMAILS || '')
  .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
const AUTOTRADE_ENABLED = AUTH_ENABLED && /^(?:1|true|yes|on)$/i.test(String(process.env.ZENCORE_AUTOTRADE_ENABLED || ''));
const AUTOTRADE_EXECUTION_ENABLED = AUTOTRADE_ENABLED && /^(?:1|true|yes|on)$/i.test(String(process.env.ZENCORE_AUTOTRADE_EXECUTION_ENABLED || ''));
const AUTOTRADE_MEMORY = /^(?:1|true|yes|on)$/i.test(String(process.env.ZENCORE_AUTOTRADE_MEMORY || ''));
const POD_PROVISIONING_SECRET = String(process.env.ZENCORE_POD_PROVISIONING_SECRET || '');
const COMMAND_SIGNING_KEY = String(process.env.ZENCORE_COMMAND_SIGNING_KEY || '');
const AUTOTRADE_DEMO_SYMBOLS = String(process.env.ZENCORE_AUTOTRADE_DEMO_SYMBOLS || 'XAUUSD')
  .split(',').map(value => value.trim()).filter(Boolean);
const AUTOTRADE_DEMO_CONNECTOR_VERSION = String(
  process.env.ZENCORE_AUTOTRADE_DEMO_CONNECTOR_VERSION || '1.4.0-demo-execution'
);
const HOSTED_MT5_ENABLED = AUTOTRADE_ENABLED && /^(?:1|true|yes|on)$/i.test(
  String(process.env.ZENCORE_HOSTED_MT5_ENABLED || '')
);
const GCP_HOSTED_WORKER_ENABLED = HOSTED_MT5_ENABLED && /^(?:1|true|yes|on)$/i.test(
  String(process.env.ZENCORE_GCP_HOSTED_WORKER_ENABLED || '')
);
const MT5_CREDENTIAL_KEY_ID = String(process.env.ZENCORE_MT5_CREDENTIAL_KEY_ID || '');
const MT5_CREDENTIAL_PUBLIC_KEY = String(process.env.ZENCORE_MT5_CREDENTIAL_PUBLIC_KEY || '').replace(/\\n/g, '\n');
const GCP_HOSTED_WORKER_SLOT_CAPACITY = Math.min(
  50,
  Math.max(1, Number(process.env.ZENCORE_GCP_WORKER_SLOT_CAPACITY || 10) || 10)
);

process.env.PORT = String(V17_PORT);
require('./server-v17.js');
process.env.PORT = String(PUBLIC_PORT);

const authState = {
  ready: !AUTH_ENABLED,
  error: null,
  store: null,
  service: null
};

const autoTradeState = {
  enabled: AUTOTRADE_ENABLED,
  ready: false,
  error: null,
  store: null,
  service: null,
  workerIdentityVerifier: null,
  workerReplayGuard: null,
  dispatchTimer: null
};

if (AUTH_ENABLED) {
  Promise.resolve().then(async () => {
    const usingMemory = !process.env.DATABASE_URL;
    const store = createAuthStore({
      databaseUrl: process.env.DATABASE_URL,
      allowMemory: AUTH_MEMORY && process.env.NODE_ENV !== 'production'
    });
    await store.init();
    if (ADMIN_EMAILS.length && typeof store.promoteAdminsByEmail === 'function') {
      const promoted = await store.promoteAdminsByEmail(ADMIN_EMAILS);
      if (promoted) console.log(`ZenCore RBAC promoted ${promoted} configured admin account(s).`);
    }
    if (IB_REGISTRY_JSON && typeof store.createIbReferrer === 'function') {
      let ibRegistry;
      try {
        ibRegistry = JSON.parse(IB_REGISTRY_JSON);
      } catch (_) {
        throw new Error('ZENCORE_IB_REGISTRY_JSON must be valid JSON.');
      }
      if (!Array.isArray(ibRegistry)) {
        throw new Error('ZENCORE_IB_REGISTRY_JSON must be a JSON array.');
      }
      for (const item of ibRegistry) {
        const code = String(item?.code || '').trim().toLowerCase();
        const displayName = String(item?.displayName || '').trim();
        if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(code) || displayName.length < 2 || displayName.length > 80) {
          throw new Error('ZENCORE_IB_REGISTRY_JSON contains an invalid IB entry.');
        }
        await store.createIbReferrer({ code, displayName });
      }
    }
    authState.store = store;
    authState.service = createAuthService({
      store,
      secureCookies: !INSECURE_COOKIE,
      sessionTtlMs: Number(process.env.ZENCORE_SESSION_TTL_MS) || undefined,
      defaultIbCode: DEFAULT_IB_CODE
    });
    authState.ready = true;
    console.log(`ZenCore authentication ready (${usingMemory ? 'development memory store' : 'PostgreSQL'})`);

    if (AUTOTRADE_ENABLED) {
      if (process.env.NODE_ENV === 'production' && Buffer.byteLength(POD_PROVISIONING_SECRET) < 32) {
        throw new Error('ZENCORE_POD_PROVISIONING_SECRET must be at least 32 bytes in production.');
      }
      const autoStore = createAutoTradeStore({
        databaseUrl: process.env.DATABASE_URL,
        allowMemory: AUTOTRADE_MEMORY && process.env.NODE_ENV !== 'production'
      });
      await autoStore.init();
      if (GCP_HOSTED_WORKER_ENABLED && typeof autoStore.ensureHostedWorkerHost === 'function') {
        const workerHost = await autoStore.ensureHostedWorkerHost({
          provider: 'GOOGLE_CLOUD',
          projectId: String(process.env.ZENCORE_GCP_WORKER_PROJECT_ID || ''),
          zone: String(process.env.ZENCORE_GCP_WORKER_ZONE || ''),
          instanceName: String(process.env.ZENCORE_GCP_WORKER_INSTANCE || ''),
          capacity: GCP_HOSTED_WORKER_SLOT_CAPACITY
        });
        if (workerHost) {
          console.log(`ZenCore hosted worker pool ready: ${workerHost.instanceName} • ${workerHost.capacity} slots`);
        }
      }
      autoTradeState.store = autoStore;
      if (GCP_HOSTED_WORKER_ENABLED) {
        autoTradeState.workerIdentityVerifier = createGcpInstanceIdentityVerifier({
          audience: process.env.ZENCORE_GCP_WORKER_AUDIENCE,
          projectId: process.env.ZENCORE_GCP_WORKER_PROJECT_ID,
          zone: process.env.ZENCORE_GCP_WORKER_ZONE,
          instanceName: process.env.ZENCORE_GCP_WORKER_INSTANCE,
          serviceAccountEmail: process.env.ZENCORE_GCP_WORKER_SERVICE_ACCOUNT
        });
        autoTradeState.workerReplayGuard = createGcpRequestReplayGuard();
      }
      autoTradeState.service = createAutoTradeService({
        store: autoStore,
        commandSigningKey: COMMAND_SIGNING_KEY,
        allowDemoExecution: AUTOTRADE_EXECUTION_ENABLED,
        allowedDemoSymbols: AUTOTRADE_DEMO_SYMBOLS,
        requiredDemoConnectorVersion: AUTOTRADE_DEMO_CONNECTOR_VERSION,
        hostedMt5Enabled: HOSTED_MT5_ENABLED,
        hostedWorkerEnabled: GCP_HOSTED_WORKER_ENABLED,
        hostedWorkerAccountId: process.env.ZENCORE_GCP_WORKER_HOSTED_ACCOUNT_ID,
        credentialKeyId: MT5_CREDENTIAL_KEY_ID,
        credentialPublicKey: MT5_CREDENTIAL_PUBLIC_KEY
      });
      autoTradeState.ready = true;
      console.log(`ZenCore Auto Trade control plane ready (${usingMemory ? 'development memory store' : 'PostgreSQL'}) • execution ${AUTOTRADE_EXECUTION_ENABLED ? 'UNLOCKED' : 'LOCKED'} • hosted MT5 ${HOSTED_MT5_ENABLED ? 'ENVELOPE ENABLED' : 'LOCKED'} • GCP worker ${GCP_HOSTED_WORKER_ENABLED ? 'IDENTITY ENABLED' : 'LOCKED'}`);
      startAutoTradeDispatcher();
    }
  }).catch(error => {
    if (!authState.ready) {
      authState.error = error;
      authState.ready = false;
      console.error('ZenCore authentication failed to initialize:', error.message);
      return;
    }
    autoTradeState.error = error;
    autoTradeState.ready = false;
    console.error('ZenCore Auto Trade failed to initialize:', error.message);
  });
}

const AUTH_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'"
].join('; ');

const authAttempts = new Map();
const AUTH_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_ATTEMPT_LIMIT = 10;
let authAttemptOperations = 0;

function securityHeaders(csp = null) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  };
  if (csp) headers['Content-Security-Policy'] = csp;
  return headers;
}

function sendAsset(res, file, type, extraHeaders = {}) {
  try {
    const body = fs.readFileSync(path.join(__dirname, file));
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      ...securityHeaders(),
      ...extraHeaders
    });
    return res.end(body);
  } catch (_) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders() });
    return res.end('Asset not found');
  }
}

function sendAuthAsset(res, file, type) {
  return sendAsset(res, file, type, securityHeaders(AUTH_CSP));
}

function sendJson(res, code, value, extraHeaders = {}) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    ...securityHeaders(),
    ...extraHeaders
  });
  res.end(JSON.stringify(value));
}

function redirect(res, location, code = 302) {
  res.writeHead(code, {
    Location: location,
    'Cache-Control': 'no-store',
    ...securityHeaders()
  });
  res.end();
}

function proxy(req, res, targetPath) {
  const headers = { ...req.headers, host: `127.0.0.1:${V17_PORT}` };
  const proxied = http.request({
    hostname: '127.0.0.1',
    port: V17_PORT,
    path: targetPath || req.url,
    method: req.method,
    headers
  }, upstream => {
    res.writeHead(upstream.statusCode || 200, upstream.headers);
    upstream.pipe(res);
  });
  proxied.on('error', error => {
    if (res.headersSent) {
      try { res.end(); } catch (_) {}
      return;
    }
    sendJson(res, 503, { ok: false, error: 'ZenCore analysis stack is starting', detail: error.message });
  });
  req.pipe(proxied);
}

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let overflow = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      if (overflow) return;
      body += chunk;
      if (Buffer.byteLength(body) > limit) overflow = true;
    });
    req.on('end', () => {
      if (overflow) return reject(Object.assign(new Error('Request too large'), { code: 'TOO_LARGE' }));
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (_) {
        reject(Object.assign(new Error('Invalid JSON'), { code: 'INVALID_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

function requestOriginAllowed(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return process.env.NODE_ENV !== 'production' || ALLOW_ORIGINLESS_AUTH;
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const forwardedProto = String(req.headers['x-forwarded-proto'] || (INSECURE_COOKIE ? 'http' : 'https')).split(',')[0].trim();
  try {
    const parsed = new URL(origin);
    return parsed.host === forwardedHost && parsed.protocol === `${forwardedProto}:`;
  } catch (_) {
    return false;
  }
}

function attemptKey(req, pathname, email) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.socket.remoteAddress || 'unknown';
  return crypto.createHash('sha256').update(`${pathname}|${ip}|${String(email || '').toLowerCase()}`).digest('hex');
}

function consumeAttempt(key) {
  const now = Date.now();
  authAttemptOperations += 1;
  if (authAttemptOperations % 100 === 0) {
    for (const [storedKey, value] of authAttempts) {
      if (value.resetAt <= now) authAttempts.delete(storedKey);
    }
  }
  const current = authAttempts.get(key);
  if (!current || current.resetAt <= now) {
    authAttempts.set(key, { count: 1, resetAt: now + AUTH_ATTEMPT_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  if (current.count >= AUTH_ATTEMPT_LIMIT) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

function authUnavailable(res) {
  return sendJson(res, 503, {
    ok: false,
    error: 'Sistem akaun ZenCore belum tersedia. Cuba semula sebentar lagi.'
  });
}

async function requireSession(req, res, redirectTo = null) {
  if (!authState.ready || !authState.service) {
    if (redirectTo) redirect(res, redirectTo);
    else authUnavailable(res);
    return null;
  }
  try {
    const session = await authState.service.sessionFromRequest(req);
    if (!session) {
      if (redirectTo) redirect(res, redirectTo);
      else sendJson(res, 401, { ok: false, error: 'Sesi tamat. Sila log masuk semula.' });
      return null;
    }
    return session;
  } catch (_) {
    if (redirectTo) redirect(res, redirectTo);
    else authUnavailable(res);
    return null;
  }
}


function landingForRole(role) {
  if (role === 'admin') return '/admin';
  if (role === 'ib') return '/ib';
  return '/app';
}

async function requireRole(req, res, role, redirectTo = null) {
  const session = await requireSession(req, res, redirectTo);
  if (!session) return null;
  if (session.user.role !== role) {
    if (redirectTo) {
      redirect(res, landingForRole(session.user.role));
    } else {
      sendJson(res, 403, { ok: false, code: 'FORBIDDEN', error: 'Akses tidak dibenarkan untuk akaun ini.' });
    }
    return null;
  }
  return session;
}


async function clientTradingSummary(userId) {
  if (!autoTradeState.ready || !autoTradeState.service) {
    return { available: false, status: 'STARTING' };
  }
  try {
    const state = await autoTradeState.service.state(userId);
    return {
      available: true,
      mode: state.mode || 'DEMO',
      connection: state.connection ? {
        state: state.connection.state || null,
        label: state.connection.label || null,
        online: state.connection.online === true,
        connected: state.connection.connected === true,
        ready: state.connection.ready === true
      } : null,
      control: {
        desiredState: state.control?.desiredState || 'STOPPED',
        effectiveState: state.control?.effectiveState || 'STOPPED',
        executionRolloutUnlocked: state.control?.executionRolloutUnlocked === true
      },
      mt5: {
        status: state.hostedMt5?.status || state.hostedAccount?.status || 'NOT_CONNECTED',
        executionReady: state.hostedMt5?.executionReady === true,
        accountMask: state.hostedAccount?.accountMask || state.pod?.accountMask || null,
        serverMask: state.hostedAccount?.serverMask || state.pod?.serverMask || null,
        brokerMask: state.hostedAccount?.brokerMask || state.pod?.brokerMask || null
      },
      settings: state.settings ? {
        capitalUsd: state.settings.capitalUsd ?? null,
        lotPerLayer: state.settings.lotPerLayer ?? null,
        layers: state.settings.layers ?? null,
        totalLot: state.settings.totalLot ?? null,
        symbols: Array.isArray(state.settings.symbols) ? state.settings.symbols : []
      } : null,
      summary: {
        openPositions: Number(state.summary?.openPositions || 0),
        floatingProfitUsd: Number(state.summary?.floatingProfitUsd || 0),
        totalVolume: Number(state.summary?.totalVolume || 0)
      }
    };
  } catch (error) {
    return { available: false, status: 'UNAVAILABLE' };
  }
}


function sanitizeAdminAuditDetail(value, depth = 0) {
  if (depth > 5) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitizeAdminAuditDetail(item, depth + 1));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return value.slice(0, 240);
    return value;
  }
  const blocked = /(password|credential|token|secret|private|cipher|wrapped|envelope|authorization|cookie)/i;
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    output[key] = blocked.test(key) ? '[REDACTED]' : sanitizeAdminAuditDetail(item, depth + 1);
  }
  return output;
}

async function effectiveRegistrationSetting() {
  let databaseEnabled = true;
  if (authState.store && typeof authState.store.getSystemSettings === 'function') {
    try {
      const settings = await authState.store.getSystemSettings();
      databaseEnabled = settings?.registrationEnabled !== false;
    } catch (_) {}
  }
  return {
    envEnabled: REGISTRATION_ENABLED,
    databaseEnabled,
    effective: REGISTRATION_ENABLED && databaseEnabled
  };
}

async function handleManagementApi(req, res, pathname, session) {
  if (!authState.ready || !authState.service) return authUnavailable(res);
  try {
    if (pathname.startsWith('/api/admin/')) {
      if (session.user.role !== 'admin') {
        return sendJson(res, 403, { ok: false, code: 'FORBIDDEN', error: 'Admin access required.' });
      }
      if (req.method === 'GET' && pathname === '/api/admin/overview') {
        return sendJson(res, 200, { ok: true, ...(await authState.service.adminOverview(session.user)) });
      }
      if (req.method === 'GET' && pathname === '/api/admin/mt5') {
        if (!autoTradeState.ready || !autoTradeState.store ||
            typeof autoTradeState.store.listAdminMt5Overview !== 'function') {
          return sendJson(res, 200, { ok: true, ready: false, accounts: [] });
        }
        const accounts = await autoTradeState.store.listAdminMt5Overview(1000);
        return sendJson(res, 200, {
          ok: true,
          ready: true,
          executionUnlocked: AUTOTRADE_EXECUTION_ENABLED,
          requiredConnectorVersion: AUTOTRADE_EXECUTION_ENABLED ? AUTOTRADE_DEMO_CONNECTOR_VERSION : null,
          accounts
        });
      }
      if (req.method === 'GET' && pathname === '/api/admin/activity') {
        if (!autoTradeState.ready || !autoTradeState.store ||
            typeof autoTradeState.store.listAdminAudit !== 'function') {
          return sendJson(res, 200, { ok: true, ready: false, events: [] });
        }
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const events = await autoTradeState.store.listAdminAudit(Number(url.searchParams.get('limit') || 150));
        return sendJson(res, 200, {
          ok: true,
          ready: true,
          events: events.map(event => ({
            ...event,
            detail: sanitizeAdminAuditDetail(event.detail || {})
          }))
        });
      }
      if (req.method === 'GET' && pathname === '/api/admin/system') {
        const registration = await effectiveRegistrationSetting();
        return sendJson(res, 200, {
          ok: true,
          settings: {
            authentication: AUTH_ENABLED,
            registration,
            autoTrade: AUTOTRADE_ENABLED,
            executionUnlocked: AUTOTRADE_EXECUTION_ENABLED,
            hostedMt5: HOSTED_MT5_ENABLED,
            gcpWorkerIdentity: GCP_HOSTED_WORKER_ENABLED,
            defaultIbCode: DEFAULT_IB_CODE,
            demoSymbols: AUTOTRADE_DEMO_SYMBOLS,
            requiredConnectorVersion: AUTOTRADE_DEMO_CONNECTOR_VERSION
          }
        });
      }
      if (req.method === 'PATCH' && pathname === '/api/admin/system/registration') {
        if (!requestOriginAllowed(req)) {
          return sendJson(res, 403, { ok: false, error: 'Permintaan tidak dibenarkan.' });
        }
        if (!authState.store || typeof authState.store.setRegistrationEnabled !== 'function') {
          return sendJson(res, 503, { ok: false, error: 'System settings store belum tersedia.' });
        }
        const body = await parseApiJson(req, res);
        if (body === null) return;
        const requested = body.enabled === true;
        if (requested && !REGISTRATION_ENABLED) {
          return sendJson(res, 409, {
            ok: false,
            code: 'REGISTRATION_ENV_LOCKED',
            error: 'Registration dikunci oleh environment production dan tidak boleh dibuka dari dashboard.'
          });
        }
        await authState.store.setRegistrationEnabled(requested);
        return sendJson(res, 200, {
          ok: true,
          registration: await effectiveRegistrationSetting()
        });
      }
      if (req.method === 'GET' && pathname === '/api/admin/clients') {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const clients = await authState.service.adminClients(session.user, {
          ibCode: String(url.searchParams.get('ib') || '').trim().toLowerCase(),
          limit: Number(url.searchParams.get('limit') || 200)
        });
        return sendJson(res, 200, { ok: true, clients });
      }
      const adminClientDetailMatch = pathname.match(/^\/api\/admin\/clients\/([0-9a-f-]{36})$/i);
      if (req.method === 'GET' && adminClientDetailMatch) {
        const client = await authState.service.adminClientDetail(session.user, adminClientDetailMatch[1]);
        return sendJson(res, 200, {
          ok: true,
          client,
          trading: await clientTradingSummary(client.id)
        });
      }
      const adminIbDetailMatch = pathname.match(/^\/api\/admin\/ibs\/([a-z0-9_-]{2,48})$/i);
      if (req.method === 'GET' && adminIbDetailMatch) {
        const detail = await authState.service.adminIbDetail(session.user, adminIbDetailMatch[1]);
        return sendJson(res, 200, { ok: true, ...detail });
      }
      const adminClientStatusMatch = pathname.match(/^\/api\/admin\/clients\/([0-9a-f-]{36})\/status$/i);
      if (req.method === 'PATCH' && adminClientStatusMatch) {
        if (!requestOriginAllowed(req)) {
          return sendJson(res, 403, { ok: false, error: 'Permintaan tidak dibenarkan.' });
        }
        const body = await parseApiJson(req, res);
        if (body === null) return;
        const client = await authState.service.setAdminClientActive(
          session.user, adminClientStatusMatch[1], body.active === true
        );
        return sendJson(res, 200, { ok: true, client });
      }
      if (req.method === 'POST' && pathname === '/api/admin/ibs') {
        if (!requestOriginAllowed(req)) {
          return sendJson(res, 403, { ok: false, error: 'Permintaan tidak dibenarkan.' });
        }
        const body = await parseApiJson(req, res);
        if (body === null) return;
        const created = await authState.service.createIb(session.user, body);
        return sendJson(res, 201, { ok: true, ...created });
      }
      const ibStatusMatch = pathname.match(/^\/api\/admin\/ibs\/([0-9a-f-]{36})\/status$/i);
      if (req.method === 'PATCH' && ibStatusMatch) {
        if (!requestOriginAllowed(req)) {
          return sendJson(res, 403, { ok: false, error: 'Permintaan tidak dibenarkan.' });
        }
        const body = await parseApiJson(req, res);
        if (body === null) return;
        const referrer = await authState.service.setIbActive(session.user, ibStatusMatch[1], body.active === true);
        return sendJson(res, 200, { ok: true, referrer });
      }
      return sendJson(res, 404, { ok: false, error: 'Admin route tidak dijumpai.' });
    }

    if (pathname.startsWith('/api/ib/')) {
      if (session.user.role !== 'ib') {
        return sendJson(res, 403, { ok: false, code: 'FORBIDDEN', error: 'IB access required.' });
      }
      if (req.method === 'GET' && pathname === '/api/ib/overview') {
        return sendJson(res, 200, { ok: true, ...(await authState.service.ibOverview(session.user)) });
      }
      if (req.method === 'GET' && pathname === '/api/ib/clients') {
        return sendJson(res, 200, { ok: true, clients: await authState.service.ibClients(session.user) });
      }
      const ibClientDetailMatch = pathname.match(/^\/api\/ib\/clients\/([0-9a-f-]{36})$/i);
      if (req.method === 'GET' && ibClientDetailMatch) {
        const client = await authState.service.ibClientDetail(session.user, ibClientDetailMatch[1]);
        return sendJson(res, 200, {
          ok: true,
          client,
          trading: await clientTradingSummary(client.id)
        });
      }
      const ibClientStatusMatch = pathname.match(/^\/api\/ib\/clients\/([0-9a-f-]{36})\/status$/i);
      if (req.method === 'PATCH' && ibClientStatusMatch) {
        if (!requestOriginAllowed(req)) {
          return sendJson(res, 403, { ok: false, error: 'Permintaan tidak dibenarkan.' });
        }
        const body = await parseApiJson(req, res);
        if (body === null) return;
        const client = await authState.service.setIbClientActive(
          session.user, ibClientStatusMatch[1], body.active === true
        );
        return sendJson(res, 200, { ok: true, client });
      }
      return sendJson(res, 404, { ok: false, error: 'IB route tidak dijumpai.' });
    }

    return sendJson(res, 404, { ok: false, error: 'Management route tidak dijumpai.' });
  } catch (error) {
    if (error?.status) {
      return sendJson(res, error.status, {
        ok: false, code: error.code, error: error.message, fields: error.fields || undefined
      });
    }
    console.error('ZenCore management request failed:', error?.message || 'Unknown error');
    return sendJson(res, 500, { ok: false, error: 'Permintaan management tidak dapat diselesaikan.' });
  }
}


async function handleAccountApi(req, res, pathname, session) {
  if (!authState.ready || !authState.service) return authUnavailable(res);
  if (session.user.role !== 'client') {
    return sendJson(res, 403, { ok: false, code: 'FORBIDDEN', error: 'Client access required.' });
  }
  try {
    if (req.method === 'GET' && pathname === '/api/account/profile') {
      const profile = await authState.service.ownClientProfile(session.user);
      return sendJson(res, 200, {
        ok: true,
        profile,
        trading: await clientTradingSummary(profile.id)
      });
    }
    if (req.method === 'PATCH' && pathname === '/api/account/profile') {
      if (!requestOriginAllowed(req)) {
        return sendJson(res, 403, { ok: false, error: 'Permintaan tidak dibenarkan.' });
      }
      const body = await parseApiJson(req, res);
      if (body === null) return;
      const profile = await authState.service.updateOwnClientProfile(session.user, body);
      return sendJson(res, 200, { ok: true, profile });
    }
    return sendJson(res, 404, { ok: false, error: 'Account route tidak dijumpai.' });
  } catch (error) {
    if (error?.status) {
      return sendJson(res, error.status, {
        ok: false, code: error.code, error: error.message, fields: error.fields || undefined
      });
    }
    console.error('ZenCore account request failed:', error?.message || 'Unknown error');
    return sendJson(res, 500, { ok: false, error: 'Permintaan akaun tidak dapat diselesaikan.' });
  }
}

async function handleAuthApi(req, res, pathname) {
  if (!authState.ready || !authState.service) return authUnavailable(res);

  const referrerMatch = pathname.match(/^\/auth\/referrer\/([a-z0-9_-]{1,48})$/i);
  if (req.method === 'GET' && referrerMatch) {
    try {
      const referrer = await authState.service.resolveReferrer(decodeURIComponent(referrerMatch[1]));
      return sendJson(res, 200, { ok: true, referrer });
    } catch (error) {
      if (error?.status) return sendJson(res, error.status, { ok: false, code: error.code, error: error.message });
      return authUnavailable(res);
    }
  }

  if (req.method === 'GET' && pathname === '/auth/me') {
    const session = await authState.service.sessionFromRequest(req);
    if (!session) return sendJson(res, 401, { ok: false, authenticated: false });
    return sendJson(res, 200, { ok: true, authenticated: true, user: session.user });
  }

  if (req.method !== 'POST' || !['/auth/login', '/auth/register', '/auth/logout'].includes(pathname)) {
    return sendJson(res, 404, { ok: false, error: 'Route tidak dijumpai.' });
  }

  if (!requestOriginAllowed(req)) {
    return sendJson(res, 403, { ok: false, error: 'Permintaan tidak dibenarkan.' });
  }

  if (pathname === '/auth/logout') {
    await authState.service.logoutFromRequest(req);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': authState.service.clearCookie() });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendJson(res, error.code === 'TOO_LARGE' ? 413 : 400, {
      ok: false,
      error: error.code === 'TOO_LARGE' ? 'Permintaan terlalu besar.' : 'Format permintaan tidak sah.'
    });
  }

  const key = attemptKey(req, pathname, body.email);
  const limit = consumeAttempt(key);
  if (!limit.allowed) {
    return sendJson(res, 429, {
      ok: false,
      error: 'Terlalu banyak cubaan. Tunggu sebentar dan cuba semula.'
    }, { 'Retry-After': String(limit.retryAfter) });
  }

  if (pathname === '/auth/register') {
    const registration = await effectiveRegistrationSetting();
    if (!registration.effective) {
      return sendJson(res, 403, { ok: false, error: 'Pendaftaran baharu sedang ditutup oleh Admin.' });
    }
  }
  if (pathname === '/auth/register' && body.riskAccepted !== true) {
    return sendJson(res, 400, {
      ok: false,
      error: 'Pengesahan risiko diperlukan.',
      fields: { riskAck: 'Tandakan pengesahan ini untuk meneruskan.' }
    });
  }

  try {
    const result = pathname === '/auth/register'
      ? await authState.service.register(body)
      : await authState.service.login(body);
    authAttempts.delete(key);
    return sendJson(res, pathname === '/auth/register' ? 201 : 200, {
      ok: true,
      user: result.user
    }, { 'Set-Cookie': authState.service.createCookie(result.token) });
  } catch (error) {
    if (error?.status) {
      return sendJson(res, error.status, {
        ok: false,
        code: error.code,
        error: error.message,
        fields: error.fields || undefined
      });
    }
    console.error('ZenCore auth request failed:', error.message);
    return sendJson(res, 500, { ok: false, error: 'Permintaan tidak dapat diselesaikan.' });
  }
}

function autoTradeUnavailable(res) {
  return sendJson(res, 503, {
    ok: false,
    code: autoTradeState.enabled ? 'AUTOTRADE_STARTING' : 'AUTOTRADE_DISABLED',
    error: autoTradeState.enabled
      ? 'Auto Trade control plane belum tersedia.'
      : 'Auto Trade belum diaktifkan pada environment ini.'
  });
}

function autoTradeError(res, error) {
  if (error?.status) {
    return sendJson(res, error.status, {
      ok: false,
      code: error.code,
      error: error.message,
      fields: error.fields || undefined
    });
  }
  console.error('ZenCore Auto Trade request failed:', error?.message || 'Unknown error');
  return sendJson(res, 500, { ok: false, error: 'Permintaan Auto Trade tidak dapat diselesaikan.' });
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : '';
}

function safeSecretEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function parseApiJson(req, res) {
  try {
    return await readJson(req, 32 * 1024);
  } catch (error) {
    sendJson(res, error.code === 'TOO_LARGE' ? 413 : 400, {
      ok: false,
      error: error.code === 'TOO_LARGE' ? 'Permintaan terlalu besar.' : 'Format permintaan tidak sah.'
    });
    return null;
  }
}

async function handleHostedExecutionApi(req, res, pathname) {
  if (!autoTradeState.ready || !autoTradeState.service) return autoTradeUnavailable(res);
  if (!GCP_HOSTED_WORKER_ENABLED || !autoTradeState.workerIdentityVerifier ||
      !autoTradeState.workerReplayGuard) {
    return sendJson(res, 409, {
      ok: false,
      code: 'HOSTED_WORKER_LOCKED',
      error: 'Google hosted worker masih dikunci.'
    });
  }
  const hostedAckMatch = pathname.match(/^\/api\/hosted-execution\/commands\/([0-9a-f-]{36})\/ack$/i);
  const hostedRouteAllowed = req.method === 'POST' && (
    pathname === '/api/hosted-execution/lease' ||
    pathname === '/api/hosted-execution/heartbeat' ||
    pathname === '/api/hosted-execution/commands/next' ||
    !!hostedAckMatch
  );
  if (!hostedRouteAllowed) {
    return sendJson(res, 404, { ok: false, error: 'Route hosted worker tidak dijumpai.' });
  }
  const token = bearerToken(req);
  if (!token || token.length > 20_000) {
    return sendJson(res, 401, { ok: false, error: 'Google hosted worker tidak dibenarkan.' });
  }
  try {
    // Compute metadata identity tokens can be cached for their lifetime. The signed
    // identity is therefore reusable, while each HTTPS request carries a fresh,
    // instance-bound request ID that is accepted only once.
    const identity = await autoTradeState.workerIdentityVerifier.verify(token, { consume: false });
    const body = await parseApiJson(req, res);
    if (body === null) return;
    const request = autoTradeState.workerReplayGuard.consume(identity, body);
    if (typeof autoTradeState.store.consumeHostedWorkerRequest !== 'function') {
      throw identityError('GCP_REPLAY_STORE_UNAVAILABLE', 'Google worker replay store tidak tersedia.', 503);
    }
    const persisted = await autoTradeState.store.consumeHostedWorkerRequest(
      identity, request.requestId, request.requestTimestamp, Date.now()
    );
    if (!persisted) {
      throw identityError('GCP_REQUEST_REPLAY', 'Google worker request telah digunakan.', 409);
    }
    if (pathname === '/api/hosted-execution/lease') {
      return sendJson(res, 200, await autoTradeState.service.leaseHostedAccount(identity, body));
    }
    if (pathname === '/api/hosted-execution/heartbeat') {
      return sendJson(res, 200, await autoTradeState.service.hostedHeartbeat(identity, body));
    }
    if (pathname === '/api/hosted-execution/commands/next') {
      return sendJson(res, 200, await autoTradeState.service.nextHostedCommand(identity, body));
    }
    return sendJson(res, 200, await autoTradeState.service.acknowledgeHostedCommand(
      identity, hostedAckMatch[1], body
    ));
  } catch (error) {
    return autoTradeError(res, error);
  }
}

async function handleAutoTradeUserApi(req, res, pathname, session) {
  if (!autoTradeState.ready || !autoTradeState.service) return autoTradeUnavailable(res);
  const userId = session.user.id;
  try {
    if (req.method === 'GET' && pathname === '/api/auto-trade/state') {
      return sendJson(res, 200, await autoTradeState.service.state(userId));
    }
    if (req.method === 'GET' && pathname === '/api/auto-trade/credential-key') {
      return sendJson(res, 200, autoTradeState.service.credentialEncryptionConfig());
    }
    if (!requestOriginAllowed(req)) {
      return sendJson(res, 403, { ok: false, error: 'Permintaan tidak dibenarkan.' });
    }
    if (req.method === 'PUT' && pathname === '/api/auto-trade/settings') {
      const body = await parseApiJson(req, res);
      if (body === null) return;
      return sendJson(res, 200, await autoTradeState.service.saveSettings(userId, body));
    }
    if (req.method === 'POST' && pathname === '/api/auto-trade/pairing') {
      const body = await parseApiJson(req, res);
      if (body === null) return;
      const key = attemptKey(req, pathname, userId);
      const limit = consumeAttempt(key);
      if (!limit.allowed) {
        return sendJson(res, 429, {
          ok: false,
          error: 'Terlalu banyak kod pairing dijana. Tunggu sebentar dan cuba semula.'
        }, { 'Retry-After': String(limit.retryAfter) });
      }
      return sendJson(res, 201, await autoTradeState.service.createPairingSession(userId, body));
    }
    if (req.method === 'POST' && pathname === '/api/auto-trade/hosted-account') {
      const body = await parseApiJson(req, res);
      if (body === null) return;
      const key = attemptKey(req, pathname, userId);
      const limit = consumeAttempt(key);
      if (!limit.allowed) {
        return sendJson(res, 429, {
          ok: false,
          error: 'Terlalu banyak cubaan sambungan MT5. Tunggu sebentar dan cuba semula.'
        }, { 'Retry-After': String(limit.retryAfter) });
      }
      const stepUp = await authState.service.reauthenticate(userId, body.zencorePassword);
      if (stepUp) authAttempts.delete(key);
      const { zencorePassword: _discardedPassword, ...encryptedOnly } = body;
      return sendJson(res, 202, await autoTradeState.service.connectHostedAccount(
        userId,
        encryptedOnly,
        stepUp
      ));
    }
    if (req.method === 'POST' && pathname === '/api/auto-trade/on') {
      const body = await parseApiJson(req, res);
      if (body === null) return;
      return sendJson(res, 202, await autoTradeState.service.turnOn(userId, body));
    }
    if (req.method === 'POST' && pathname === '/api/auto-trade/stop') {
      const body = await parseApiJson(req, res);
      if (body === null) return;
      return sendJson(res, 202, await autoTradeState.service.stop(userId));
    }
    if (req.method === 'POST' && pathname === '/api/auto-trade/emergency-close') {
      const body = await parseApiJson(req, res);
      if (body === null) return;
      const key = attemptKey(req, pathname, userId);
      const limit = consumeAttempt(key);
      if (!limit.allowed) {
        return sendJson(res, 429, {
          ok: false,
          error: 'Terlalu banyak cubaan pengesahan. Tunggu sebentar dan cuba semula.'
        }, { 'Retry-After': String(limit.retryAfter) });
      }
      const stepUp = await authState.service.reauthenticate(userId, body.password);
      if (stepUp) authAttempts.delete(key);
      return sendJson(res, 202, await autoTradeState.service.emergencyCloseAll(
        userId,
        { confirmation: body.confirmation },
        stepUp
      ));
    }
    return sendJson(res, 404, { ok: false, error: 'Route Auto Trade tidak dijumpai.' });
  } catch (error) {
    return autoTradeError(res, error);
  }
}

async function handleExecutionApi(req, res, pathname) {
  if (!autoTradeState.ready || !autoTradeState.service) return autoTradeUnavailable(res);
  if (req.method === 'POST' && pathname === '/api/execution/pair') {
    const key = attemptKey(req, pathname, 'secure-pod');
    const limit = consumeAttempt(key);
    if (!limit.allowed) {
      return sendJson(res, 429, {
        ok: false,
        error: 'Terlalu banyak cubaan pairing. Tunggu sebentar dan cuba semula.'
      }, { 'Retry-After': String(limit.retryAfter) });
    }
    const body = await parseApiJson(req, res);
    if (body === null) return;
    try {
      const result = await autoTradeState.service.pairTraderOwnedPod(body);
      authAttempts.delete(key);
      return sendJson(res, 201, result);
    } catch (error) {
      return autoTradeError(res, error);
    }
  }
  const token = bearerToken(req) || String(req.headers['x-zencore-pod-token'] || '');
  if (!token || token.length > 256) {
    return sendJson(res, 401, { ok: false, error: 'Secure Pod tidak dibenarkan.' });
  }
  try {
    if (req.method === 'POST' && pathname === '/api/execution/heartbeat') {
      const body = await parseApiJson(req, res);
      if (body === null) return;
      return sendJson(res, 200, await autoTradeState.service.heartbeat(token, body));
    }
    if (req.method === 'GET' && pathname === '/api/execution/commands/next') {
      return sendJson(res, 200, await autoTradeState.service.nextCommand(token));
    }
    const match = pathname.match(/^\/api\/execution\/commands\/([0-9a-f-]{36})\/ack$/i);
    if (req.method === 'POST' && match) {
      const body = await parseApiJson(req, res);
      if (body === null) return;
      return sendJson(res, 200, await autoTradeState.service.acknowledgeCommand(token, match[1], body));
    }
    return sendJson(res, 404, { ok: false, error: 'Route Secure Pod tidak dijumpai.' });
  } catch (error) {
    return autoTradeError(res, error);
  }
}

async function handlePodProvisioning(req, res) {
  if (!autoTradeState.ready || !autoTradeState.service) return autoTradeUnavailable(res);
  if (!safeSecretEqual(bearerToken(req), POD_PROVISIONING_SECRET)) {
    return sendJson(res, 401, { ok: false, error: 'Provisioning tidak dibenarkan.' });
  }
  const body = await parseApiJson(req, res);
  if (body === null) return;
  const userId = String(body.userId || '');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    return sendJson(res, 400, { ok: false, error: 'User ID tidak sah.' });
  }
  try {
    const user = await authState.store.findUserByIdForLogin(userId);
    if (!user || user.status !== 'active') {
      return sendJson(res, 404, { ok: false, error: 'Akaun ZenCore tidak dijumpai.' });
    }
    const result = await autoTradeState.service.provisionDemoPod(userId, body.label);
    return sendJson(res, 201, {
      ok: true,
      pod: result.pod,
      token: result.token,
      commandSigningKey: result.commandSigningKey,
      tokenNotice: 'Machine credentials ini dipaparkan sekali sahaja dan mesti dihantar terus ke Secure Pod.'
    });
  } catch (error) {
    return autoTradeError(res, error);
  }
}

function fetchLocalMarkets() {
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: '127.0.0.1', port: V17_PORT, path: '/api/markets',
      headers: { Accept: 'application/json' }, timeout: 3000
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        if (body.length < 2 * 1024 * 1024) body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`Market API HTTP ${response.statusCode}`));
        try {
          const parsed = JSON.parse(body);
          resolve(Array.isArray(parsed.markets) ? parsed.markets : []);
        } catch (_) {
          reject(new Error('Market API returned invalid JSON'));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Market API timeout')));
    request.on('error', reject);
  });
}

function startAutoTradeDispatcher() {
  if (autoTradeState.dispatchTimer || !autoTradeState.service) return;
  let running = false;
  let lastErrorLogAt = 0;
  const tick = async () => {
    if (running || !autoTradeState.ready) return;
    running = true;
    try {
      const markets = await fetchLocalMarkets();
      await autoTradeState.service.dispatchMarkets(markets);
    } catch (error) {
      if (Date.now() - lastErrorLogAt > 60_000) {
        lastErrorLogAt = Date.now();
        console.error('ZenCore Auto Trade dispatcher waiting:', error.message);
      }
    } finally {
      running = false;
    }
  };
  autoTradeState.dispatchTimer = setInterval(tick, 3000);
  autoTradeState.dispatchTimer.unref?.();
  setTimeout(tick, 1000).unref?.();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (SITE_MODE === 'closed') {
    try {
      const body = fs.readFileSync(path.join(__dirname, 'retired.html'));
      res.writeHead(410, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        ...securityHeaders()
      });
      return res.end(body);
    } catch (_) {
      res.writeHead(410, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('ZenCore legacy service is closed.');
    }
  }

  if (req.method === 'GET' && pathname === '/auth.css') return sendAuthAsset(res, 'auth.css', 'text/css; charset=utf-8');
  if (req.method === 'GET' && pathname === '/management.css') return sendAuthAsset(res, 'management.css', 'text/css; charset=utf-8');
  if (req.method === 'GET' && pathname === '/management.js') return sendAuthAsset(res, 'management.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && pathname === '/detail.js') return sendAuthAsset(res, 'detail.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && pathname === '/account.js') return sendAuthAsset(res, 'account.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && pathname === '/admin-ops.js') return sendAuthAsset(res, 'admin-ops.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && pathname === '/auth.js') return sendAuthAsset(res, 'auth.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && pathname === '/home.css') return sendAuthAsset(res, 'home.css', 'text/css; charset=utf-8');
  if (req.method === 'GET' && pathname === '/market-radar-core.js') return sendAuthAsset(res, 'market-radar-core.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && pathname === '/portal.js') return sendAuthAsset(res, 'portal.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && pathname === '/results.css') return sendAuthAsset(res, 'results.css', 'text/css; charset=utf-8');
  if (req.method === 'GET' && pathname === '/results-core.js') return sendAuthAsset(res, 'results-core.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && pathname === '/results.js') return sendAuthAsset(res, 'results.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && pathname === '/auto-trade.css') return sendAuthAsset(res, 'auto-trade.css', 'text/css; charset=utf-8');
  if (req.method === 'GET' && pathname === '/analysis-execution-contract.js') return sendAuthAsset(res, 'analysis-execution-contract.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && pathname === '/auto-trade-core.js') return sendAuthAsset(res, 'auto-trade-core.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && pathname === '/auto-trade.js') return sendAuthAsset(res, 'auto-trade.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && pathname === '/auto-trade-monitor.css') return sendAuthAsset(res, 'auto-trade-monitor.css', 'text/css; charset=utf-8');
  if (req.method === 'GET' && pathname === '/auto-trade-monitor.js') return sendAuthAsset(res, 'auto-trade-monitor.js', 'application/javascript; charset=utf-8');

  if (pathname.startsWith('/api/execution/')) {
    return handleExecutionApi(req, res, pathname);
  }
  if (pathname.startsWith('/api/hosted-execution/')) {
    return handleHostedExecutionApi(req, res, pathname);
  }
  if (req.method === 'POST' && pathname === '/internal/auto-trade/provision-demo') {
    return handlePodProvisioning(req, res);
  }

  if (AUTH_ENABLED && pathname.startsWith('/auth/')) {
    return handleAuthApi(req, res, pathname);
  }

  if (AUTH_ENABLED && req.method === 'GET' && (pathname === '/login' || pathname === '/register')) {
    if (authState.ready && authState.service) {
      try {
        const session = await authState.service.sessionFromRequest(req);
        if (session) return redirect(res, landingForRole(session.user.role));
      } catch (_) {}
    }
    return sendAuthAsset(res, pathname === '/login' ? 'login.html' : 'register.html', 'text/html; charset=utf-8');
  }

  const shortReferralMatch = pathname.match(/^\/u\/([a-z0-9_-]{1,48})$/i);
  if (AUTH_ENABLED && req.method === 'GET' && shortReferralMatch) {
    if (authState.ready && authState.service) {
      try {
        const session = await authState.service.sessionFromRequest(req);
        if (session) return redirect(res, landingForRole(session.user.role));
      } catch (_) {}
    }
    return redirect(res, `/register?ib=${encodeURIComponent(shortReferralMatch[1].toLowerCase())}`);
  }

  if (req.method === 'GET' && pathname === '/precision-entry.css') return sendAsset(res, 'precision-entry.css', 'text/css; charset=utf-8');
  if (req.method === 'GET' && pathname === '/precision-entry.js') return sendAsset(res, 'precision-entry.js', 'application/javascript; charset=utf-8');

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    if (SITE_MODE !== 'precision-entry') return sendAsset(res, 'retired.html', 'text/html; charset=utf-8');
    if (!AUTH_ENABLED) return sendAsset(res, 'precision-entry.html', 'text/html; charset=utf-8');
    if (!authState.ready || !authState.service) return redirect(res, '/login');
    try {
      const session = await authState.service.sessionFromRequest(req);
      return redirect(res, session ? landingForRole(session.user.role) : '/login');
    } catch (_) {
      return redirect(res, '/login');
    }
  }

  if (SITE_MODE !== 'precision-entry' && req.method === 'GET') {
    return sendAsset(res, 'retired.html', 'text/html; charset=utf-8');
  }

  if (AUTH_ENABLED && req.method === 'GET' && pathname === '/admin') {
    const session = await requireRole(req, res, 'admin', '/login');
    if (!session) return;
    return sendAuthAsset(res, 'admin.html', 'text/html; charset=utf-8');
  }

  if (AUTH_ENABLED && req.method === 'GET' && pathname === '/admin/mt5') {
    const session = await requireRole(req, res, 'admin', '/login');
    if (!session) return;
    return sendAuthAsset(res, 'admin-mt5.html', 'text/html; charset=utf-8');
  }

  if (AUTH_ENABLED && req.method === 'GET' && pathname === '/admin/activity') {
    const session = await requireRole(req, res, 'admin', '/login');
    if (!session) return;
    return sendAuthAsset(res, 'admin-activity.html', 'text/html; charset=utf-8');
  }

  if (AUTH_ENABLED && req.method === 'GET' && pathname === '/admin/system') {
    const session = await requireRole(req, res, 'admin', '/login');
    if (!session) return;
    return sendAuthAsset(res, 'admin-system.html', 'text/html; charset=utf-8');
  }

  if (AUTH_ENABLED && req.method === 'GET' && pathname === '/ib') {
    const session = await requireRole(req, res, 'ib', '/login');
    if (!session) return;
    return sendAuthAsset(res, 'ib.html', 'text/html; charset=utf-8');
  }

  const adminIbPageMatch = pathname.match(/^\/admin\/ib\/([a-z0-9_-]{2,48})$/i);
  if (AUTH_ENABLED && req.method === 'GET' && adminIbPageMatch) {
    const session = await requireRole(req, res, 'admin', '/login');
    if (!session) return;
    return sendAuthAsset(res, 'ib-detail.html', 'text/html; charset=utf-8');
  }

  const adminClientPageMatch = pathname.match(/^\/admin\/client\/([0-9a-f-]{36})$/i);
  if (AUTH_ENABLED && req.method === 'GET' && adminClientPageMatch) {
    const session = await requireRole(req, res, 'admin', '/login');
    if (!session) return;
    return sendAuthAsset(res, 'client-detail.html', 'text/html; charset=utf-8');
  }

  const ibClientPageMatch = pathname.match(/^\/ib\/client\/([0-9a-f-]{36})$/i);
  if (AUTH_ENABLED && req.method === 'GET' && ibClientPageMatch) {
    const session = await requireRole(req, res, 'ib', '/login');
    if (!session) return;
    return sendAuthAsset(res, 'client-detail.html', 'text/html; charset=utf-8');
  }

  if (AUTH_ENABLED && req.method === 'GET' && pathname === '/account') {
    const session = await requireRole(req, res, 'client', '/login');
    if (!session) return;
    return sendAuthAsset(res, 'account.html', 'text/html; charset=utf-8');
  }

  if (AUTH_ENABLED && pathname.startsWith('/api/account/')) {
    const session = await requireSession(req, res);
    if (!session) return;
    return handleAccountApi(req, res, pathname, session);
  }

  if (AUTH_ENABLED && (pathname.startsWith('/api/admin/') || pathname.startsWith('/api/ib/'))) {
    const session = await requireSession(req, res);
    if (!session) return;
    return handleManagementApi(req, res, pathname, session);
  }

  if (AUTH_ENABLED && req.method === 'GET' && pathname === '/app') {
    const session = await requireSession(req, res, '/login');
    if (!session) return;
    if (session.user.role === 'admin') return redirect(res, '/admin');
    if (session.user.role === 'ib') return redirect(res, '/ib');
    return sendAuthAsset(res, 'home.html', 'text/html; charset=utf-8');
  }

  if (AUTH_ENABLED && req.method === 'GET' && pathname === '/analysis') {
    const session = await requireSession(req, res, '/login');
    if (!session) return;
    return sendAsset(res, 'precision-entry.html', 'text/html; charset=utf-8');
  }

  if (AUTH_ENABLED && req.method === 'GET' && pathname === '/results') {
    const session = await requireSession(req, res, '/login');
    if (!session) return;
    return sendAuthAsset(res, 'results.html', 'text/html; charset=utf-8');
  }

  if (AUTH_ENABLED && req.method === 'GET' && pathname === '/auto-trade') {
    const session = await requireSession(req, res, '/login');
    if (!session) return;
    return sendAuthAsset(res, 'auto-trade.html', 'text/html; charset=utf-8');
  }

  if (AUTH_ENABLED && pathname.startsWith('/api/auto-trade/')) {
    const session = await requireSession(req, res);
    if (!session) return;
    return handleAutoTradeUserApi(req, res, pathname, session);
  }

  const publicProxy = (req.method === 'POST' && pathname === '/webhook') ||
    (req.method === 'GET' && pathname === '/health');
  if (AUTH_ENABLED && !publicProxy) {
    const session = await requireSession(req, res);
    if (!session) return;
  }

  return proxy(req, res);
});

server.listen(PUBLIC_PORT, '0.0.0.0', () => {
  console.log(`ZenCore ${SITE_MODE === 'precision-entry' ? 'Precision Entry' : 'Retired Legacy'} gateway running on port ${PUBLIC_PORT} -> V17 ${V17_PORT}${AUTH_ENABLED ? ' • AUTH ON' : ' • AUTH OFF'}`);
});
