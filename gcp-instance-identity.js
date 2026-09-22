const crypto = require('crypto');

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

function identityError(code, message, status = 401) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function decodeJwtObject(part, label) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(part || '')) || part.length > 12000) {
    throw identityError('INVALID_GCP_IDENTITY', `Google ${label} token tidak sah.`);
  }
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value;
  } catch (_) {
    throw identityError('INVALID_GCP_IDENTITY', `Google ${label} token tidak sah.`);
  }
}

function exactString(value, expected, code = 'GCP_IDENTITY_MISMATCH') {
  if (String(value || '') !== String(expected || '')) {
    throw identityError(code, 'Google worker identity tidak sepadan dengan deployment yang diluluskan.', 403);
  }
}

function cacheSeconds(header) {
  const match = String(header || '').match(/(?:^|,)\s*max-age=(\d+)/i);
  return Math.max(300, Math.min(86400, Number(match?.[1]) || 3600));
}

function createGcpRequestReplayGuard(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const maximumAgeMs = Math.max(10_000, Math.min(5 * 60_000, Number(options.maximumAgeMs) || 60_000));
  const maximumEntries = Math.max(100, Math.min(100_000, Number(options.maximumEntries) || 10_000));
  const consumed = new Map();

  function clearExpired(current) {
    for (const [key, expiry] of consumed) {
      if (expiry <= current) consumed.delete(key);
    }
  }

  function consume(identity, input = {}) {
    const requestId = String(input.requestId || '');
    const requestTimestamp = Number(input.requestTimestamp);
    const current = now();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw identityError('INVALID_GCP_REQUEST', 'Google worker request ID tidak sah.', 400);
    }
    if (!Number.isInteger(requestTimestamp) || Math.abs(current - requestTimestamp) > maximumAgeMs) {
      throw identityError('STALE_GCP_REQUEST', 'Google worker request telah tamat atau belum sah.', 401);
    }
    clearExpired(current);
    const key = crypto.createHash('sha256')
      .update(`${String(identity?.instanceId || '')}\n${requestId}`)
      .digest('hex');
    if (consumed.has(key)) {
      throw identityError('GCP_REQUEST_REPLAY', 'Google worker request telah digunakan.', 409);
    }
    if (consumed.size >= maximumEntries) {
      throw identityError('GCP_REPLAY_CACHE_FULL', 'Google worker replay cache penuh.', 503);
    }
    consumed.set(key, current + maximumAgeMs * 2);
    return { requestId, requestTimestamp };
  }

  return { consume };
}

function createGcpInstanceIdentityVerifier(options = {}) {
  const audience = String(options.audience || '');
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/[A-Za-z0-9/_-]+$/.test(audience)) {
    throw new Error('ZENCORE_GCP_WORKER_AUDIENCE must be an exact HTTPS endpoint.');
  }
  const configuredWorkers = Array.isArray(options.workers) && options.workers.length
    ? options.workers
    : [options];
  if (configuredWorkers.length > 50) throw new Error('ZenCore worker fleet cannot exceed 50 hosts.');
  const expectedWorkers = new Map();
  for (const input of configuredWorkers) {
    const worker = Object.freeze({
      projectId: String(input.projectId || ''),
      zone: String(input.zone || ''),
      instanceName: String(input.instanceName || ''),
      serviceAccountEmail: String(input.serviceAccountEmail || '')
    });
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(worker.projectId)) {
      throw new Error('ZENCORE_GCP_WORKER_PROJECT_ID is invalid.');
    }
    if (!/^[a-z]+-[a-z]+\d-[a-z]$/.test(worker.zone)) {
      throw new Error('ZENCORE_GCP_WORKER_ZONE is invalid.');
    }
    if (!/^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/.test(worker.instanceName)) {
      throw new Error('ZENCORE_GCP_WORKER_INSTANCE is invalid.');
    }
    if (!/^[a-z0-9-]{6,30}@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(worker.serviceAccountEmail)) {
      throw new Error('ZENCORE_GCP_WORKER_SERVICE_ACCOUNT is invalid.');
    }
    const key = `${worker.projectId}|${worker.zone}|${worker.instanceName}`;
    if (expectedWorkers.has(key)) throw new Error('ZenCore worker fleet contains a duplicate host.');
    expectedWorkers.set(key, worker);
  }

  const fetcher = options.fetcher || globalThis.fetch;
  if (typeof fetcher !== 'function') throw new Error('A fetch implementation is required.');
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const keys = new Map();
  let keysExpireAt = 0;
  let keysRefreshedAt = 0;
  const consumed = new Map();

  function clearExpired(current) {
    for (const [digest, expiry] of consumed) {
      if (expiry <= current) consumed.delete(digest);
    }
  }

  async function refreshKeys() {
    let response;
    try {
      response = await fetcher(GOOGLE_JWKS_URL, {
        method: 'GET', redirect: 'error', headers: { Accept: 'application/json' }
      });
    } catch (error) {
      throw identityError('GCP_IDENTITY_KEYS_UNAVAILABLE', 'Google identity key tidak dapat disahkan.', 503);
    }
    if (!response?.ok) {
      throw identityError('GCP_IDENTITY_KEYS_UNAVAILABLE', 'Google identity key tidak dapat disahkan.', 503);
    }
    const text = await response.text();
    if (text.length > 256 * 1024) {
      throw identityError('GCP_IDENTITY_KEYS_UNAVAILABLE', 'Respons Google identity terlalu besar.', 503);
    }
    let body;
    try { body = JSON.parse(text); } catch (_) {
      throw identityError('GCP_IDENTITY_KEYS_UNAVAILABLE', 'Respons Google identity tidak sah.', 503);
    }
    const next = new Map();
    for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
      if (
        jwk?.kty !== 'RSA' || jwk?.alg !== 'RS256' || jwk?.use !== 'sig' ||
        !/^[A-Za-z0-9._-]{8,160}$/.test(String(jwk.kid || ''))
      ) continue;
      try { next.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })); } catch (_) {}
    }
    if (!next.size) {
      throw identityError('GCP_IDENTITY_KEYS_UNAVAILABLE', 'Google identity key tidak sah.', 503);
    }
    keys.clear();
    for (const [kid, key] of next) keys.set(kid, key);
    keysRefreshedAt = now();
    keysExpireAt = keysRefreshedAt + cacheSeconds(response.headers?.get?.('cache-control')) * 1000;
  }

  async function verificationKey(kid) {
    const current = now();
    if (current >= keysExpireAt || (!keys.has(kid) && current - keysRefreshedAt >= 60_000)) {
      await refreshKeys();
    }
    const key = keys.get(kid);
    if (!key) throw identityError('INVALID_GCP_IDENTITY', 'Google identity signing key tidak dikenali.');
    return key;
  }

  async function verify(rawToken, settings = {}) {
    const token = String(rawToken || '');
    if (token.length < 100 || token.length > 20000) {
      throw identityError('INVALID_GCP_IDENTITY', 'Google worker token tidak sah.');
    }
    const parts = token.split('.');
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
      throw identityError('INVALID_GCP_IDENTITY', 'Google worker token tidak sah.');
    }
    const header = decodeJwtObject(parts[0], 'header');
    const claims = decodeJwtObject(parts[1], 'payload');
    if (header.alg !== 'RS256' || !/^[A-Za-z0-9._-]{8,160}$/.test(String(header.kid || ''))) {
      throw identityError('INVALID_GCP_IDENTITY', 'Google worker signature algorithm tidak sah.');
    }
    const signature = Buffer.from(parts[2], 'base64url');
    if (signature.length < 256 || signature.length > 512) {
      throw identityError('INVALID_GCP_IDENTITY', 'Google worker signature tidak sah.');
    }
    const key = await verificationKey(header.kid);
    const valid = crypto.verify(
      'RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, signature
    );
    if (!valid) throw identityError('INVALID_GCP_IDENTITY', 'Google worker signature tidak sah.');

    const currentSeconds = Math.floor(now() / 1000);
    const issuedAt = Number(claims.iat);
    const expiresAt = Number(claims.exp);
    if (
      !Number.isInteger(issuedAt) || !Number.isInteger(expiresAt) ||
      issuedAt > currentSeconds + 30 || issuedAt < currentSeconds - 300 ||
      expiresAt <= currentSeconds || expiresAt - issuedAt > 3700
    ) {
      throw identityError('STALE_GCP_IDENTITY', 'Google worker identity telah tamat atau terlalu lama.');
    }
    exactString(claims.iss, 'https://accounts.google.com');
    exactString(claims.aud, audience);
    if (claims.email_verified !== true) {
      throw identityError('GCP_IDENTITY_MISMATCH', 'Google service account belum disahkan.', 403);
    }
    const compute = claims.google?.compute_engine;
    if (!compute || typeof compute !== 'object') {
      throw identityError('GCP_IDENTITY_MISMATCH', 'Full Google Compute identity diperlukan.', 403);
    }
    const workerKey = `${String(compute.project_id || '')}|${String(compute.zone || '')}|${String(compute.instance_name || '')}`;
    const expectedWorker = expectedWorkers.get(workerKey);
    if (!expectedWorker) {
      throw identityError('GCP_IDENTITY_MISMATCH', 'Google worker identity tidak sepadan dengan deployment yang diluluskan.', 403);
    }
    exactString(claims.email, expectedWorker.serviceAccountEmail);
    if (!/^[0-9]{6,30}$/.test(String(compute.instance_id || ''))) {
      throw identityError('GCP_IDENTITY_MISMATCH', 'Google instance ID tidak sah.', 403);
    }

    const digest = crypto.createHash('sha256').update(token).digest('hex');
    const current = now();
    clearExpired(current);
    if (settings.consume !== false) {
      if (consumed.has(digest)) {
        throw identityError('GCP_IDENTITY_REPLAY', 'Google worker token telah digunakan.', 409);
      }
      consumed.set(digest, expiresAt * 1000);
    }
    return Object.freeze({
      provider: 'GOOGLE_CLOUD',
      subject: String(claims.sub || ''),
      email: claims.email,
      projectId: compute.project_id,
      zone: compute.zone,
      instanceName: compute.instance_name,
      instanceId: String(compute.instance_id),
      issuedAt: issuedAt * 1000,
      expiresAt: expiresAt * 1000
    });
  }

  return {
    verify,
    expected: Object.freeze({
      audience,
      workers: Object.freeze([...expectedWorkers.values()].map(worker => Object.freeze({ ...worker })))
    })
  };
}

module.exports = {
  GOOGLE_JWKS_URL,
  createGcpInstanceIdentityVerifier,
  createGcpRequestReplayGuard,
  identityError
};
