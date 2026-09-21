const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);
const PASSWORD_SCHEME = 'scrypt';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeDisplayName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeIcNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhone(value) {
  return String(value || '').trim().replace(/[\s()-]/g, '');
}

function normalizeIbCode(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48);
}

function validateEmail(email) {
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(email);
}

function validateRegistration(input = {}) {
  const displayName = normalizeDisplayName(input.displayName);
  const email = normalizeEmail(input.email);
  const password = String(input.password || '');
  const icNumber = normalizeIcNumber(input.icNumber);
  const phone = normalizePhone(input.phone);
  const ibCode = normalizeIbCode(input.ibCode);
  const errors = {};

  if (displayName.length < 2 || displayName.length > 60) {
    errors.displayName = 'Nama perlu antara 2 hingga 60 aksara.';
  }
  if (!validateEmail(email)) {
    errors.email = 'Masukkan alamat e-mel yang sah.';
  }
  if (!/^\d{12}$/.test(icNumber)) {
    errors.icNumber = 'No. IC mesti mengandungi 12 digit.';
  }
  if (!/^\+?\d{8,15}$/.test(phone)) {
    errors.phone = 'Masukkan nombor telefon yang sah.';
  }
  if (password.length < 10 || password.length > 128) {
    errors.password = 'Password perlu antara 10 hingga 128 aksara.';
  } else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.password = 'Password mesti mempunyai sekurang-kurangnya satu huruf dan satu nombor.';
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { displayName, email, password, icNumber, phone, ibCode }
  };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(String(password), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024
  });
  return [
    PASSWORD_SCHEME,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    Buffer.from(key).toString('base64url')
  ].join('$');
}

async function verifyPassword(password, encoded) {
  try {
    const [scheme, nRaw, rRaw, pRaw, saltRaw, hashRaw] = String(encoded || '').split('$');
    if (scheme !== PASSWORD_SCHEME || !saltRaw || !hashRaw) return false;
    const N = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;

    const expected = Buffer.from(hashRaw, 'base64url');
    const actual = Buffer.from(await scryptAsync(String(password), Buffer.from(saltRaw, 'base64url'), expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024
    }));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function parseCookies(header) {
  const cookies = {};
  for (const item of String(header || '').split(';')) {
    const index = item.indexOf('=');
    if (index < 1) continue;
    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch (_) {
      cookies[key] = value;
    }
  }
  return cookies;
}

function sessionCookie(name, token, options = {}) {
  const maxAgeSeconds = Math.max(0, Math.floor(Number(options.maxAgeSeconds) || 0));
  const pieces = [
    `${name}=${encodeURIComponent(token || '')}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict'
  ];
  if (options.secure !== false) pieces.push('Secure');
  if (maxAgeSeconds > 0) pieces.push(`Max-Age=${maxAgeSeconds}`);
  else pieces.push('Max-Age=0');
  return pieces.join('; ');
}

module.exports = {
  normalizeEmail,
  normalizeDisplayName,
  normalizeIcNumber,
  normalizePhone,
  normalizeIbCode,
  validateEmail,
  validateRegistration,
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  parseCookies,
  sessionCookie
};
