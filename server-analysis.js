const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createAuthStore } = require('./auth-store');
const { createAuthService } = require('./auth-service');

const PUBLIC_PORT = Number(process.env.PORT || 8080);
const V17_PORT = 10003;
const SITE_MODE = String(process.env.SITE_MODE || 'legacy').toLowerCase();
const AUTH_ENABLED = /^(?:1|true|yes|on)$/i.test(String(process.env.ZENCORE_AUTH_ENABLED || ''));
const AUTH_MEMORY = /^(?:1|true|yes|on)$/i.test(String(process.env.ZENCORE_AUTH_MEMORY || ''));
const INSECURE_COOKIE = /^(?:1|true|yes|on)$/i.test(String(process.env.ZENCORE_INSECURE_COOKIE || ''));
const ALLOW_ORIGINLESS_AUTH = /^(?:1|true|yes|on)$/i.test(String(process.env.ZENCORE_ALLOW_ORIGINLESS_AUTH || ''));
const REGISTRATION_ENABLED = !/^(?:0|false|no|off)$/i.test(String(process.env.ZENCORE_REGISTRATION_ENABLED || 'true'));

process.env.PORT = String(V17_PORT);
require('./server-v17.js');
process.env.PORT = String(PUBLIC_PORT);

const authState = {
  ready: !AUTH_ENABLED,
  error: null,
  store: null,
  service: null
};

if (AUTH_ENABLED) {
  Promise.resolve().then(async () => {
    const usingMemory = !process.env.DATABASE_URL;
    const store = createAuthStore({
      databaseUrl: process.env.DATABASE_URL,
      allowMemory: AUTH_MEMORY && process.env.NODE_ENV !== 'production'
    });
    await store.init();
    authState.store = store;
    authState.service = createAuthService({
      store,
      secureCookies: !INSECURE_COOKIE,
      sessionTtlMs: Number(process.env.ZENCORE_SESSION_TTL_MS) || undefined
    });
    authState.ready = true;
    console.log(`ZenCore authentication ready (${usingMemory ? 'development memory store' : 'PostgreSQL'})`);
  }).catch(error => {
    authState.error = error;
    authState.ready = false;
    console.error('ZenCore authentication failed to initialize:', error.message);
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

async function handleAuthApi(req, res, pathname) {
  if (!authState.ready || !authState.service) return authUnavailable(res);

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

  if (pathname === '/auth/register' && !REGISTRATION_ENABLED) {
    return sendJson(res, 403, { ok: false, error: 'Pendaftaran baharu sedang ditutup.' });
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
  if (req.method === 'GET' && pathname === '/auth.js') return sendAuthAsset(res, 'auth.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && pathname === '/portal.js') return sendAuthAsset(res, 'portal.js', 'application/javascript; charset=utf-8');

  if (AUTH_ENABLED && pathname.startsWith('/auth/')) {
    return handleAuthApi(req, res, pathname);
  }

  if (AUTH_ENABLED && req.method === 'GET' && (pathname === '/login' || pathname === '/register')) {
    if (authState.ready && authState.service) {
      try {
        const session = await authState.service.sessionFromRequest(req);
        if (session) return redirect(res, '/app');
      } catch (_) {}
    }
    return sendAuthAsset(res, pathname === '/login' ? 'login.html' : 'register.html', 'text/html; charset=utf-8');
  }

  if (req.method === 'GET' && pathname === '/precision-entry.css') return sendAsset(res, 'precision-entry.css', 'text/css; charset=utf-8');
  if (req.method === 'GET' && pathname === '/precision-entry.js') return sendAsset(res, 'precision-entry.js', 'application/javascript; charset=utf-8');

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    if (SITE_MODE !== 'precision-entry') return sendAsset(res, 'retired.html', 'text/html; charset=utf-8');
    if (!AUTH_ENABLED) return sendAsset(res, 'precision-entry.html', 'text/html; charset=utf-8');
    if (!authState.ready || !authState.service) return redirect(res, '/login');
    try {
      const session = await authState.service.sessionFromRequest(req);
      return redirect(res, session ? '/app' : '/login');
    } catch (_) {
      return redirect(res, '/login');
    }
  }

  if (SITE_MODE !== 'precision-entry' && req.method === 'GET') {
    return sendAsset(res, 'retired.html', 'text/html; charset=utf-8');
  }

  if (AUTH_ENABLED && req.method === 'GET' && pathname === '/app') {
    const session = await requireSession(req, res, '/login');
    if (!session) return;
    return sendAuthAsset(res, 'home.html', 'text/html; charset=utf-8');
  }

  if (AUTH_ENABLED && req.method === 'GET' && pathname === '/analysis') {
    const session = await requireSession(req, res, '/login');
    if (!session) return;
    return sendAsset(res, 'precision-entry.html', 'text/html; charset=utf-8');
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
