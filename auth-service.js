const {
  normalizeEmail,
  validateEmail,
  validateRegistration,
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  parseCookies,
  sessionCookie
} = require('./auth-core');

const DEFAULT_COOKIE_NAME = 'zencore_session';
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    displayName: user.displayName || user.display_name,
    email: user.email,
    status: user.status,
    createdAt: user.createdAt || user.created_at,
    lastLoginAt: user.lastLoginAt || user.last_login_at || null
  };
}

function authError(code, message, status = 400, fields = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.fields = fields;
  return error;
}

function createAuthService(options = {}) {
  const store = options.store;
  if (!store) throw new Error('Auth store is required');

  const cookieName = options.cookieName || DEFAULT_COOKIE_NAME;
  const secureCookies = options.secureCookies !== false;
  const sessionTtlMs = Math.max(60 * 60 * 1000, Number(options.sessionTtlMs) || DEFAULT_SESSION_TTL_MS);
  const maxAgeSeconds = Math.floor(sessionTtlMs / 1000);

  async function issueSession(userId) {
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + sessionTtlMs);
    await store.createSession({
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt
    });
    return { token, expiresAt };
  }

  async function register(input) {
    const validation = validateRegistration(input);
    if (!validation.ok) {
      throw authError('VALIDATION_ERROR', 'Semak semula maklumat pendaftaran.', 400, validation.errors);
    }

    const passwordHash = await hashPassword(validation.value.password);
    let user;
    try {
      user = await store.createUser({
        displayName: validation.value.displayName,
        email: validation.value.email,
        passwordHash
      });
    } catch (error) {
      if (error?.code === 'EMAIL_EXISTS') {
        throw authError('EMAIL_EXISTS', 'E-mel ini sudah mempunyai akaun ZenCore.', 409, {
          email: 'Gunakan e-mel lain atau log masuk.'
        });
      }
      throw error;
    }

    const session = await issueSession(user.id);
    return { user: safeUser(user), ...session };
  }

  async function login(input = {}) {
    const email = normalizeEmail(input.email);
    const password = String(input.password || '');
    if (!validateEmail(email) || !password) {
      throw authError('INVALID_CREDENTIALS', 'E-mel atau password tidak betul.', 401);
    }

    const userRow = await store.findUserForLogin(email);
    // Spend comparable work for unknown accounts so the response does not reveal
    // whether an e-mail exists through an obvious timing difference.
    const valid = userRow
      ? await verifyPassword(password, userRow.password_hash)
      : (await hashPassword(password), false);
    if (!valid || userRow.status !== 'active') {
      throw authError('INVALID_CREDENTIALS', 'E-mel atau password tidak betul.', 401);
    }

    await store.markLogin(userRow.id);
    const session = await issueSession(userRow.id);
    return { user: safeUser(userRow), ...session };
  }

  async function sessionFromRequest(req) {
    const token = parseCookies(req?.headers?.cookie)[cookieName];
    if (!token) return null;
    const session = await store.findSession(hashSessionToken(token));
    if (!session) return null;
    return { ...session, token, user: safeUser(session.user) };
  }

  async function reauthenticate(userId, password) {
    const value = String(password || '');
    if (!userId || !value || typeof store.findUserByIdForLogin !== 'function') return false;
    const userRow = await store.findUserByIdForLogin(userId);
    if (!userRow || userRow.status !== 'active') return false;
    return verifyPassword(value, userRow.password_hash);
  }

  async function logoutFromRequest(req) {
    const token = parseCookies(req?.headers?.cookie)[cookieName];
    if (token) await store.deleteSession(hashSessionToken(token));
  }

  function createCookie(token) {
    return sessionCookie(cookieName, token, { secure: secureCookies, maxAgeSeconds });
  }

  function clearCookie() {
    return sessionCookie(cookieName, '', { secure: secureCookies, maxAgeSeconds: 0 });
  }

  return {
    register,
    login,
    sessionFromRequest,
    reauthenticate,
    logoutFromRequest,
    createCookie,
    clearCookie,
    cookieName,
    sessionTtlMs
  };
}

module.exports = {
  DEFAULT_COOKIE_NAME,
  DEFAULT_SESSION_TTL_MS,
  createAuthService,
  authError,
  safeUser
};
