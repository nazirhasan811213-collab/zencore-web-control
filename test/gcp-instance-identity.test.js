const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  createGcpInstanceIdentityVerifier,
  createGcpRequestReplayGuard,
  GOOGLE_JWKS_URL
} = require('../gcp-instance-identity');

const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = keyPair.publicKey.export({ format: 'jwk' });
const KID = 'zencore-test-google-key';
const NOW = 1_790_000_000_000;
const expected = {
  audience: 'https://zencore-precision-entry.onrender.com/api/hosted-execution',
  projectId: 'zencore-demo-12345',
  zone: 'asia-southeast1-b',
  instanceName: 'zencore-mt5-demo-01',
  serviceAccountEmail: 'zencore-mt5-demo-worker@zencore-demo-12345.iam.gserviceaccount.com'
};

function b64(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function token(overrides = {}, headerOverrides = {}) {
  const seconds = Math.floor(NOW / 1000);
  const claims = {
    iss: 'https://accounts.google.com',
    aud: expected.audience,
    sub: '100000000000000000001',
    azp: '100000000000000000001',
    email: expected.serviceAccountEmail,
    email_verified: true,
    iat: seconds - 5,
    exp: seconds + 300,
    google: {
      compute_engine: {
        project_id: expected.projectId,
        project_number: 123456789012,
        zone: expected.zone,
        instance_id: '9876543210987654321',
        instance_name: expected.instanceName,
        instance_creation_timestamp: seconds - 600,
        instance_confidentiality: 0
      }
    },
    ...overrides
  };
  const header = { alg: 'RS256', kid: KID, typ: 'JWT', ...headerOverrides };
  const signingInput = `${b64(header)}.${b64(claims)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), keyPair.privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function fakeFetcher(counter = { value: 0 }) {
  return async (url, options) => {
    counter.value += 1;
    assert.equal(url, GOOGLE_JWKS_URL);
    assert.equal(options.redirect, 'error');
    return {
      ok: true,
      headers: { get: name => name.toLowerCase() === 'cache-control' ? 'public, max-age=3600' : null },
      text: async () => JSON.stringify({ keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] })
    };
  };
}

test('valid full Google instance identity is pinned to project, zone, VM and service account', async () => {
  const verifier = createGcpInstanceIdentityVerifier({ ...expected, fetcher: fakeFetcher(), now: () => NOW });
  const identity = await verifier.verify(token());
  assert.deepEqual(identity, {
    provider: 'GOOGLE_CLOUD',
    subject: '100000000000000000001',
    email: expected.serviceAccountEmail,
    projectId: expected.projectId,
    zone: expected.zone,
    instanceName: expected.instanceName,
    instanceId: '9876543210987654321',
    issuedAt: NOW - 5000,
    expiresAt: NOW + 300000
  });
});

test('Google identity keys are cached but each instance token can be consumed only once', async () => {
  const counter = { value: 0 };
  const verifier = createGcpInstanceIdentityVerifier({ ...expected, fetcher: fakeFetcher(counter), now: () => NOW });
  const first = token();
  await verifier.verify(first);
  await assert.rejects(() => verifier.verify(first), error => error.code === 'GCP_IDENTITY_REPLAY');
  await verifier.verify(token({ iat: Math.floor(NOW / 1000) - 4 }));
  assert.equal(counter.value, 1);
});

test('wrong audience, project, instance and stale tokens fail closed', async () => {
  const make = () => createGcpInstanceIdentityVerifier({ ...expected, fetcher: fakeFetcher(), now: () => NOW });
  await assert.rejects(() => make().verify(token({ aud: 'https://evil.invalid/' })), error => error.code === 'GCP_IDENTITY_MISMATCH');
  await assert.rejects(() => make().verify(token({ google: { compute_engine: {
    project_id: 'different-12345', zone: expected.zone, instance_id: '9876543210987654321',
    instance_name: expected.instanceName
  } } })), error => error.code === 'GCP_IDENTITY_MISMATCH');
  await assert.rejects(() => make().verify(token({ google: { compute_engine: {
    project_id: expected.projectId, zone: expected.zone, instance_id: '9876543210987654321',
    instance_name: 'different-worker'
  } } })), error => error.code === 'GCP_IDENTITY_MISMATCH');
  await assert.rejects(() => make().verify(token({ iat: Math.floor(NOW / 1000) - 600 })), error => error.code === 'STALE_GCP_IDENTITY');
});

test('non-RS256 and modified signatures are rejected', async () => {
  const verifier = createGcpInstanceIdentityVerifier({ ...expected, fetcher: fakeFetcher(), now: () => NOW });
  await assert.rejects(() => verifier.verify(token({}, { alg: 'HS256' })), error => error.code === 'INVALID_GCP_IDENTITY');
  const original = token();
  const modified = `${original.slice(0, -2)}AA`;
  await assert.rejects(() => verifier.verify(modified), error => error.code === 'INVALID_GCP_IDENTITY');
});

test('worker request IDs are fresh, instance-bound and single-use', () => {
  const guard = createGcpRequestReplayGuard({ now: () => NOW, maximumAgeMs: 60_000 });
  const identity = { instanceId: '9876543210987654321' };
  const request = {
    requestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    requestTimestamp: NOW - 1000
  };
  assert.deepEqual(guard.consume(identity, request), request);
  assert.throws(() => guard.consume(identity, request), error => error.code === 'GCP_REQUEST_REPLAY');
  assert.throws(() => guard.consume(identity, {
    requestId: '11111111-2222-4333-8444-555555555555',
    requestTimestamp: NOW - 61_000
  }), error => error.code === 'STALE_GCP_REQUEST');
});
