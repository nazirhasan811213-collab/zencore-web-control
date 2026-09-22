const {
  normalizeEmail,
  normalizeDisplayName,
  normalizeIcNumber,
  normalizePhone,
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
const DEFAULT_IB_CODE = 'nazir';
const ROLE_ADMIN = 'admin';
const ROLE_IB = 'ib';
const ROLE_CLIENT = 'client';

function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    displayName: user.displayName || user.display_name,
    email: user.email,
    role: user.role || ROLE_CLIENT,
    status: user.status,
    createdAt: user.createdAt || user.created_at,
    lastLoginAt: user.lastLoginAt || user.last_login_at || null,
    ibCode: user.ibCode || user.ib_code || null,
    ibName: user.ibName || user.ib_name || null
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
  const defaultIbCode = String(options.defaultIbCode || DEFAULT_IB_CODE).trim().toLowerCase();

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

    const referrer = await store.resolveReferrer(validation.value.ibCode, defaultIbCode);
    if (!referrer) {
      throw authError('IB_UNAVAILABLE', 'Maklumat IB tidak dapat disahkan. Cuba semula.', 503);
    }

    const passwordHash = await hashPassword(validation.value.password);
    let user;
    try {
      user = await store.createUser({
        displayName: validation.value.displayName,
        email: validation.value.email,
        passwordHash,
        icNumber: validation.value.icNumber,
        phone: validation.value.phone,
        ibReferrerId: referrer.id,
        role: ROLE_CLIENT
      });
    } catch (error) {
      if (error?.code === 'EMAIL_EXISTS') {
        throw authError('EMAIL_EXISTS', 'E-mel ini sudah mempunyai akaun ZenCore.', 409, {
          email: 'Gunakan e-mel lain atau log masuk.'
        });
      }
      if (error?.code === 'IC_EXISTS') {
        throw authError('IC_EXISTS', 'No. ID / Passport ini sudah mempunyai akaun ZenCore.', 409, {
          icNumber: 'No. ID / Passport ini sudah didaftarkan.'
        });
      }
      throw error;
    }

    const session = await issueSession(user.id);
    return { user: safeUser(user), referrer, ...session };
  }

  async function resolveReferrer(code) {
    const referrer = await store.resolveReferrer(code, defaultIbCode);
    if (!referrer) throw authError('IB_UNAVAILABLE', 'Maklumat IB tidak dapat disahkan.', 503);
    return referrer;
  }


  function assertRole(user, role) {
    if (!user || user.role !== role) {
      throw authError('FORBIDDEN', 'Akses tidak dibenarkan untuk akaun ini.', 403);
    }
  }

  function normalizeIbCreateInput(input = {}) {
    const displayName = String(input.displayName || '').trim().replace(/\s+/g, ' ');
    const code = String(input.code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const email = normalizeEmail(input.email);
    const password = String(input.password || '');
    const phone = String(input.phone || '').trim().replace(/[\s()-]/g, '');
    const errors = {};
    if (displayName.length < 2 || displayName.length > 80) errors.displayName = 'Nama IB perlu antara 2 hingga 80 aksara.';
    if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(code)) errors.code = 'Kod IB mesti 2-48 aksara: huruf kecil, nombor, - atau _.';
    if (code === defaultIbCode) errors.code = 'Kod ini dikhaskan untuk Admin.';
    if (!validateEmail(email)) errors.email = 'Masukkan e-mel IB yang sah.';
    if (password.length < 10 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      errors.password = 'Password mesti minimum 10 aksara dengan sekurang-kurangnya satu huruf dan satu nombor.';
    }
    if (phone && !/^\+?\d{8,15}$/.test(phone)) errors.phone = 'Masukkan nombor telefon yang sah.';
    return { ok: Object.keys(errors).length === 0, errors, value: { displayName, code, email, password, phone } };
  }

  async function adminOverview(user) {
    assertRole(user, ROLE_ADMIN);
    return store.adminOverview();
  }

  async function adminClients(user, options = {}) {
    assertRole(user, ROLE_ADMIN);
    return store.listClientsForAdmin(options);
  }

  async function createIb(user, input = {}) {
    assertRole(user, ROLE_ADMIN);
    const validation = normalizeIbCreateInput(input);
    if (!validation.ok) {
      throw authError('VALIDATION_ERROR', 'Semak semula maklumat IB.', 400, validation.errors);
    }
    const passwordHash = await hashPassword(validation.value.password);
    try {
      return await store.createIbAccount({
        displayName: validation.value.displayName,
        code: validation.value.code,
        email: validation.value.email,
        passwordHash,
        phone: validation.value.phone || null
      });
    } catch (error) {
      if (error?.code === 'EMAIL_EXISTS') {
        throw authError('EMAIL_EXISTS', 'E-mel ini sudah digunakan.', 409, { email: 'Gunakan e-mel lain.' });
      }
      if (error?.code === 'IB_CODE_EXISTS') {
        throw authError('IB_CODE_EXISTS', 'Kod IB ini sudah digunakan.', 409, { code: 'Gunakan kod IB lain.' });
      }
      throw error;
    }
  }

  async function setIbActive(user, referrerId, active) {
    assertRole(user, ROLE_ADMIN);
    if (!/^[0-9a-f-]{36}$/i.test(String(referrerId || ''))) {
      throw authError('INVALID_IB', 'IB tidak sah.', 400);
    }
    const updated = await store.setIbActive(String(referrerId), active === true);
    if (!updated) throw authError('IB_NOT_FOUND', 'IB tidak dijumpai atau tidak boleh diubah.', 404);
    return updated;
  }


  async function setAdminClientActive(user, clientId, active) {
    assertRole(user, ROLE_ADMIN);
    if (!/^[0-9a-f-]{36}$/i.test(String(clientId || ''))) {
      throw authError('INVALID_CLIENT', 'Client tidak sah.', 400);
    }
    const client = await store.setClientActiveForAdmin(String(clientId), active === true);
    if (!client) throw authError('CLIENT_NOT_FOUND', 'Client tidak dijumpai.', 404);
    return client;
  }


  async function reassignAdminClientIb(user, clientId, ibCode) {
    assertRole(user, ROLE_ADMIN);
    if (!/^[0-9a-f-]{36}$/i.test(String(clientId || ''))) {
      throw authError('INVALID_CLIENT', 'Client tidak sah.', 400);
    }
    const safeCode = String(ibCode || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(safeCode)) {
      throw authError('INVALID_IB', 'Kod IB tidak sah.', 400, { ibCode: 'Pilih IB yang sah.' });
    }
    if (typeof store.reassignClientForAdmin !== 'function') {
      throw authError('IB_REASSIGN_UNAVAILABLE', 'Fungsi pindah IB belum tersedia.', 503);
    }
    const result = await store.reassignClientForAdmin(String(clientId), safeCode);
    if (!result?.referrer) throw authError('IB_NOT_FOUND', 'IB sasaran tidak dijumpai.', 404);
    if (!result?.client) throw authError('CLIENT_NOT_FOUND', 'Client tidak dijumpai.', 404);
    return result;
  }

  async function promoteAdminClientToIb(user, clientId, input = {}) {
    assertRole(user, ROLE_ADMIN);
    if (!/^[0-9a-f-]{36}$/i.test(String(clientId || ''))) {
      throw authError('INVALID_CLIENT', 'Client tidak sah.', 400);
    }
    const code = String(input.code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const client = await store.getClientForAdmin(String(clientId));
    if (!client) throw authError('CLIENT_NOT_FOUND', 'Client tidak dijumpai.', 404);
    const displayName = String(input.displayName || client.displayName || '').trim().replace(/\s+/g, ' ');
    const fields = {};
    if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(code)) {
      fields.code = 'Kod IB mesti 2-48 aksara: huruf kecil, nombor, - atau _.';
    } else if (code === defaultIbCode) {
      fields.code = 'Kod ini dikhaskan untuk Admin.';
    }
    if (displayName.length < 2 || displayName.length > 80) {
      fields.displayName = 'Nama IB perlu antara 2 hingga 80 aksara.';
    }
    if (Object.keys(fields).length) {
      throw authError('VALIDATION_ERROR', 'Semak semula maklumat IB.', 400, fields);
    }
    if (typeof store.promoteClientToIbForAdmin !== 'function') {
      throw authError('IB_PROMOTION_UNAVAILABLE', 'Fungsi tukar client kepada IB belum tersedia.', 503);
    }
    try {
      const promoted = await store.promoteClientToIbForAdmin(String(clientId), { code, displayName });
      if (!promoted) throw authError('CLIENT_NOT_FOUND', 'Client tidak dijumpai.', 404);
      return promoted;
    } catch (error) {
      if (error?.code === 'IB_CODE_EXISTS') {
        throw authError('IB_CODE_EXISTS', 'Kod IB ini sudah digunakan.', 409, {
          code: 'Gunakan kod IB lain.'
        });
      }
      throw error;
    }
  }

  async function setIbClientActive(user, clientId, active) {
    assertRole(user, ROLE_IB);
    if (!/^[0-9a-f-]{36}$/i.test(String(clientId || ''))) {
      throw authError('INVALID_CLIENT', 'Client tidak sah.', 400);
    }
    const client = await store.setClientActiveForIb(user.id, String(clientId), active === true);
    if (!client) throw authError('CLIENT_NOT_FOUND', 'Client bukan di bawah IB ini atau tidak dijumpai.', 404);
    return client;
  }


  async function adminIbDetail(user, code) {
    assertRole(user, ROLE_ADMIN);
    const safeCode = String(code || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(safeCode)) {
      throw authError('INVALID_IB', 'Kod IB tidak sah.', 400);
    }
    const detail = await store.getIbDetailForAdmin(safeCode);
    if (!detail) throw authError('IB_NOT_FOUND', 'IB tidak dijumpai.', 404);
    return detail;
  }

  async function adminClientDetail(user, clientId) {
    assertRole(user, ROLE_ADMIN);
    if (!/^[0-9a-f-]{36}$/i.test(String(clientId || ''))) {
      throw authError('INVALID_CLIENT', 'Client tidak sah.', 400);
    }
    const client = await store.getClientForAdmin(String(clientId));
    if (!client) throw authError('CLIENT_NOT_FOUND', 'Client tidak dijumpai.', 404);
    return client;
  }

  async function ibClientDetail(user, clientId) {
    assertRole(user, ROLE_IB);
    if (!/^[0-9a-f-]{36}$/i.test(String(clientId || ''))) {
      throw authError('INVALID_CLIENT', 'Client tidak sah.', 400);
    }
    const client = await store.getClientForIb(user.id, String(clientId));
    if (!client) throw authError('CLIENT_NOT_FOUND', 'Client bukan di bawah IB ini atau tidak dijumpai.', 404);
    return client;
  }

  async function ownClientProfile(user) {
    assertRole(user, ROLE_CLIENT);
    const profile = await store.getOwnClientProfile(user.id);
    if (!profile) throw authError('CLIENT_NOT_FOUND', 'Profil client tidak dijumpai.', 404);
    return profile;
  }

  function normalizeClientProfileInput(input = {}) {
    const displayName = normalizeDisplayName(input.displayName);
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    const icNumber = normalizeIcNumber(input.icNumber);
    const errors = {};
    if (displayName.length < 2 || displayName.length > 60) {
      errors.displayName = 'Nama perlu antara 2 hingga 60 aksara.';
    }
    if (!validateEmail(email)) {
      errors.email = 'Masukkan alamat e-mel yang sah.';
    }
    if (!/^\+?\d{8,15}$/.test(phone)) {
      errors.phone = 'Masukkan nombor telefon yang sah.';
    }
    if (icNumber.length < 3 || icNumber.length > 64 ||
        !/[\p{L}\p{N}]/u.test(icNumber) ||
        !/^[\p{L}\p{N} ._\-/()]+$/u.test(icNumber)) {
      errors.icNumber = 'Masukkan No. IC, Passport atau National ID yang sah (3–64 aksara).';
    }
    return {
      ok: Object.keys(errors).length === 0,
      errors,
      value: { displayName, email, phone, icNumber }
    };
  }

  function validateNewPassword(value) {
    const password = String(value || '');
    if (password.length < 10 || password.length > 128) {
      return 'Password perlu antara 10 hingga 128 aksara.';
    }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return 'Password mesti mempunyai sekurang-kurangnya satu huruf dan satu nombor.';
    }
    return '';
  }

  async function updateOwnClientProfile(user, input = {}) {
    assertRole(user, ROLE_CLIENT);
    const validation = normalizeClientProfileInput(input);
    if (!validation.ok) {
      throw authError('VALIDATION_ERROR', 'Semak semula maklumat akaun.', 400, validation.errors);
    }
    const current = await store.getOwnClientProfile(user.id);
    if (!current) throw authError('CLIENT_NOT_FOUND', 'Profil client tidak dijumpai.', 404);
    const sensitiveChanged =
      normalizeEmail(current.email) !== validation.value.email ||
      normalizeIcNumber(current.identityNumber) !== validation.value.icNumber;
    if (sensitiveChanged) {
      const confirmed = await reauthenticate(user.id, String(input.currentPassword || ''));
      if (!confirmed) {
        throw authError('REAUTH_REQUIRED', 'Password semasa diperlukan untuk menukar e-mel atau ID/Passport.', 401, {
          currentPassword: 'Password semasa tidak betul.'
        });
      }
    }
    try {
      const profile = await store.updateOwnClientProfile(user.id, validation.value);
      if (!profile) throw authError('CLIENT_NOT_FOUND', 'Profil client tidak dijumpai.', 404);
      return profile;
    } catch (error) {
      if (error?.code === 'EMAIL_EXISTS') {
        throw authError('EMAIL_EXISTS', 'E-mel ini sudah digunakan.', 409, { email: 'Gunakan e-mel lain.' });
      }
      if (error?.code === 'IC_EXISTS') {
        throw authError('IC_EXISTS', 'No. ID / Passport ini sudah digunakan.', 409, {
          icNumber: 'Gunakan No. ID / Passport lain.'
        });
      }
      throw error;
    }
  }

  async function changeOwnClientPassword(user, input = {}) {
    assertRole(user, ROLE_CLIENT);
    const currentPassword = String(input.currentPassword || '');
    const newPassword = String(input.newPassword || '');
    const confirmPassword = String(input.confirmPassword || '');
    const error = validateNewPassword(newPassword);
    const fields = {};
    if (error) fields.newPassword = error;
    if (newPassword !== confirmPassword) fields.confirmPassword = 'Pengesahan password tidak sepadan.';
    if (Object.keys(fields).length) {
      throw authError('VALIDATION_ERROR', 'Semak semula password baharu.', 400, fields);
    }
    if (!(await reauthenticate(user.id, currentPassword))) {
      throw authError('INVALID_CURRENT_PASSWORD', 'Password semasa tidak betul.', 401, {
        currentPassword: 'Password semasa tidak betul.'
      });
    }
    if (await verifyPassword(newPassword, (await store.findUserByIdForLogin(user.id))?.password_hash)) {
      throw authError('PASSWORD_UNCHANGED', 'Password baharu mesti berbeza daripada password semasa.', 400, {
        newPassword: 'Gunakan password yang berbeza.'
      });
    }
    const changed = await store.updatePasswordForUser(user.id, await hashPassword(newPassword), ROLE_CLIENT);
    if (!changed) throw authError('CLIENT_NOT_FOUND', 'Profil client tidak dijumpai.', 404);
    return { changed: true };
  }

  async function updateAdminClientProfile(user, clientId, input = {}) {
    assertRole(user, ROLE_ADMIN);
    if (!/^[0-9a-f-]{36}$/i.test(String(clientId || ''))) {
      throw authError('INVALID_CLIENT', 'Client tidak sah.', 400);
    }
    const validation = normalizeClientProfileInput(input);
    if (!validation.ok) {
      throw authError('VALIDATION_ERROR', 'Semak semula maklumat client.', 400, validation.errors);
    }
    if (!(await reauthenticate(user.id, String(input.adminPassword || '')))) {
      throw authError('ADMIN_REAUTH_REQUIRED', 'Password Admin tidak betul.', 401, {
        adminPassword: 'Password Admin diperlukan.'
      });
    }
    try {
      const profile = await store.updateClientProfileForAdmin(String(clientId), validation.value);
      if (!profile) throw authError('CLIENT_NOT_FOUND', 'Client tidak dijumpai.', 404);
      return profile;
    } catch (error) {
      if (error?.code === 'EMAIL_EXISTS') {
        throw authError('EMAIL_EXISTS', 'E-mel ini sudah digunakan.', 409, { email: 'Gunakan e-mel lain.' });
      }
      if (error?.code === 'IC_EXISTS') {
        throw authError('IC_EXISTS', 'No. ID / Passport ini sudah digunakan.', 409, {
          icNumber: 'Gunakan No. ID / Passport lain.'
        });
      }
      throw error;
    }
  }

  async function resetAdminClientPassword(user, clientId, input = {}) {
    assertRole(user, ROLE_ADMIN);
    if (!/^[0-9a-f-]{36}$/i.test(String(clientId || ''))) {
      throw authError('INVALID_CLIENT', 'Client tidak sah.', 400);
    }
    if (!(await reauthenticate(user.id, String(input.adminPassword || '')))) {
      throw authError('ADMIN_REAUTH_REQUIRED', 'Password Admin tidak betul.', 401, {
        adminPassword: 'Password Admin diperlukan.'
      });
    }
    const newPassword = String(input.newPassword || '');
    const confirmPassword = String(input.confirmPassword || '');
    const passwordError = validateNewPassword(newPassword);
    const fields = {};
    if (passwordError) fields.newPassword = passwordError;
    if (newPassword !== confirmPassword) fields.confirmPassword = 'Pengesahan password tidak sepadan.';
    if (Object.keys(fields).length) {
      throw authError('VALIDATION_ERROR', 'Semak semula password baharu.', 400, fields);
    }
    const changed = await store.updatePasswordForUser(
      String(clientId), await hashPassword(newPassword), ROLE_CLIENT
    );
    if (!changed) throw authError('CLIENT_NOT_FOUND', 'Client tidak dijumpai.', 404);
    return { changed: true };
  }

  async function ibOverview(user) {
    assertRole(user, ROLE_IB);
    const overview = await store.ibOverview(user.id);
    if (!overview) throw authError('IB_PROFILE_NOT_FOUND', 'Profil IB belum disambungkan.', 404);
    return overview;
  }

  async function ibClients(user) {
    assertRole(user, ROLE_IB);
    return store.listClientsForIb(user.id);
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
    resolveReferrer,
    adminOverview,
    adminClients,
    adminIbDetail,
    adminClientDetail,
    createIb,
    setIbActive,
    setAdminClientActive,
    reassignAdminClientIb,
    promoteAdminClientToIb,
    setIbClientActive,
    ibOverview,
    ibClientDetail,
    ownClientProfile,
    updateOwnClientProfile,
    changeOwnClientPassword,
    updateAdminClientProfile,
    resetAdminClientPassword,
    ibClients,
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
  DEFAULT_IB_CODE,
  ROLE_ADMIN,
  ROLE_IB,
  ROLE_CLIENT,
  createAuthService,
  authError,
  safeUser
};
