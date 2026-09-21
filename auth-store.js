const crypto = require('crypto');
const { Pool } = require('pg');

const DEFAULT_IB_CODE = 'nazir';
const DEFAULT_IB_NAME = 'Nazir (Admin)';
const DEFAULT_IB_ID = '00000000-0000-4000-8000-000000000001';

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    ibCode: row.ib_code || null,
    ibName: row.ib_name || null
  };
}

function publicReferrer(row, requestedCode = '') {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    active: row.active === true,
    fallback: !!requestedCode && requestedCode !== row.code
  };
}

class PostgresAuthStore {
  constructor(databaseUrl) {
    const local = /(?:localhost|127\.0\.0\.1)/i.test(databaseUrl);
    const sslDisabled = String(process.env.PGSSLMODE || '').toLowerCase() === 'disable';
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: local || sslDisabled ? undefined : { rejectUnauthorized: false }
    });
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS zencore_ib_referrers (
        id UUID PRIMARY KEY,
        code VARCHAR(48) NOT NULL UNIQUE,
        display_name VARCHAR(80) NOT NULL,
        user_id UUID,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      INSERT INTO zencore_ib_referrers (id, code, display_name, active)
      VALUES ('${DEFAULT_IB_ID}', '${DEFAULT_IB_CODE}', '${DEFAULT_IB_NAME}', TRUE)
      ON CONFLICT (code) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        active = TRUE;

      CREATE TABLE IF NOT EXISTS zencore_users (
        id UUID PRIMARY KEY,
        display_name VARCHAR(60) NOT NULL,
        email VARCHAR(254) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        ic_number VARCHAR(12),
        phone VARCHAR(24),
        ib_referrer_id UUID REFERENCES zencore_ib_referrers(id),
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      );

      ALTER TABLE zencore_users
        ADD COLUMN IF NOT EXISTS ic_number VARCHAR(12),
        ADD COLUMN IF NOT EXISTS phone VARCHAR(24),
        ADD COLUMN IF NOT EXISTS ib_referrer_id UUID;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'zencore_users_ib_referrer_fk'
        ) THEN
          ALTER TABLE zencore_users
            ADD CONSTRAINT zencore_users_ib_referrer_fk
            FOREIGN KEY (ib_referrer_id)
            REFERENCES zencore_ib_referrers(id);
        END IF;
      END $$;

      CREATE UNIQUE INDEX IF NOT EXISTS zencore_users_ic_number_idx
        ON zencore_users(ic_number)
        WHERE ic_number IS NOT NULL;

      CREATE OR REPLACE FUNCTION zencore_lock_ib_assignment()
      RETURNS trigger AS $$
      BEGIN
        IF OLD.ib_referrer_id IS NOT NULL
           AND NEW.ib_referrer_id IS DISTINCT FROM OLD.ib_referrer_id THEN
          RAISE EXCEPTION 'IB assignment is immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS zencore_users_lock_ib_assignment ON zencore_users;
      CREATE TRIGGER zencore_users_lock_ib_assignment
        BEFORE UPDATE OF ib_referrer_id ON zencore_users
        FOR EACH ROW EXECUTE FUNCTION zencore_lock_ib_assignment();

      CREATE TABLE IF NOT EXISTS zencore_sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES zencore_users(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS zencore_sessions_user_id_idx
        ON zencore_sessions(user_id);
      CREATE INDEX IF NOT EXISTS zencore_sessions_expires_at_idx
        ON zencore_sessions(expires_at);
    `);
    await this.deleteExpiredSessions();
  }

  async resolveReferrer(code, defaultCode = DEFAULT_IB_CODE) {
    const requestedCode = String(code || '').trim().toLowerCase();
    const desiredCode = requestedCode || defaultCode;
    let result = await this.pool.query(
      `SELECT id, code, display_name, active
       FROM zencore_ib_referrers
       WHERE code = $1 AND active = TRUE
       LIMIT 1`,
      [desiredCode]
    );
    if (!result.rows[0] && desiredCode !== defaultCode) {
      result = await this.pool.query(
        `SELECT id, code, display_name, active
         FROM zencore_ib_referrers
         WHERE code = $1 AND active = TRUE
         LIMIT 1`,
        [defaultCode]
      );
    }
    return publicReferrer(result.rows[0], requestedCode);
  }

  async createIbReferrer({ code, displayName, userId = null }) {
    const result = await this.pool.query(
      `INSERT INTO zencore_ib_referrers (id, code, display_name, user_id, active)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (code) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         user_id = COALESCE(EXCLUDED.user_id, zencore_ib_referrers.user_id),
         active = TRUE
       RETURNING id, code, display_name, active`,
      [crypto.randomUUID(), code, displayName, userId]
    );
    return publicReferrer(result.rows[0]);
  }

  async createUser({ displayName, email, passwordHash, icNumber, phone, ibReferrerId }) {
    try {
      const result = await this.pool.query(
        `WITH inserted AS (
           INSERT INTO zencore_users
             (id, display_name, email, password_hash, ic_number, phone, ib_referrer_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *
         )
         SELECT inserted.*,
                ref.code AS ib_code,
                ref.display_name AS ib_name
         FROM inserted
         LEFT JOIN zencore_ib_referrers ref ON ref.id = inserted.ib_referrer_id`,
        [crypto.randomUUID(), displayName, email, passwordHash, icNumber, phone, ibReferrerId]
      );
      return publicUser(result.rows[0]);
    } catch (error) {
      if (error?.code === '23505') {
        const duplicate = new Error('Account data already registered');
        if (String(error.constraint || '').includes('ic_number')) duplicate.code = 'IC_EXISTS';
        else duplicate.code = 'EMAIL_EXISTS';
        throw duplicate;
      }
      throw error;
    }
  }

  async findUserForLogin(email) {
    const result = await this.pool.query(
      `SELECT u.id, u.display_name, u.email, u.password_hash, u.status,
              u.created_at, u.last_login_at, ref.code AS ib_code, ref.display_name AS ib_name
       FROM zencore_users u
       LEFT JOIN zencore_ib_referrers ref ON ref.id = u.ib_referrer_id
       WHERE u.email = $1
       LIMIT 1`,
      [email]
    );
    return result.rows[0] || null;
  }

  async findUserByIdForLogin(userId) {
    const result = await this.pool.query(
      `SELECT u.id, u.display_name, u.email, u.password_hash, u.status,
              u.created_at, u.last_login_at, ref.code AS ib_code, ref.display_name AS ib_name
       FROM zencore_users u
       LEFT JOIN zencore_ib_referrers ref ON ref.id = u.ib_referrer_id
       WHERE u.id = $1
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  async markLogin(userId) {
    await this.pool.query(
      `UPDATE zencore_users SET last_login_at = NOW() WHERE id = $1`,
      [userId]
    );
  }

  async createSession({ userId, tokenHash, expiresAt }) {
    await this.pool.query(
      `INSERT INTO zencore_sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [crypto.randomUUID(), userId, tokenHash, expiresAt]
    );
  }

  async findSession(tokenHash) {
    const result = await this.pool.query(
      `SELECT s.id AS session_id, s.expires_at,
              u.id, u.display_name, u.email, u.status, u.created_at, u.last_login_at,
              ref.code AS ib_code, ref.display_name AS ib_name
       FROM zencore_sessions s
       JOIN zencore_users u ON u.id = s.user_id
       LEFT JOIN zencore_ib_referrers ref ON ref.id = u.ib_referrer_id
       WHERE s.token_hash = $1
         AND s.expires_at > NOW()
         AND u.status = 'active'
       LIMIT 1`,
      [tokenHash]
    );
    const row = result.rows[0];
    if (!row) return null;
    await this.pool.query(
      `UPDATE zencore_sessions SET last_seen_at = NOW() WHERE id = $1`,
      [row.session_id]
    );
    return { sessionId: row.session_id, expiresAt: row.expires_at, user: publicUser(row) };
  }

  async deleteSession(tokenHash) {
    await this.pool.query(`DELETE FROM zencore_sessions WHERE token_hash = $1`, [tokenHash]);
  }

  async deleteExpiredSessions() {
    await this.pool.query(`DELETE FROM zencore_sessions WHERE expires_at <= NOW()`);
  }

  async close() {
    await this.pool.end();
  }
}

class MemoryAuthStore {
  constructor() {
    this.usersByEmail = new Map();
    this.usersById = new Map();
    this.usersByIc = new Map();
    this.sessions = new Map();
    this.referrersByCode = new Map();
    this.referrersByCode.set(DEFAULT_IB_CODE, {
      id: DEFAULT_IB_ID,
      code: DEFAULT_IB_CODE,
      display_name: DEFAULT_IB_NAME,
      active: true
    });
  }

  async init() {}

  async resolveReferrer(code, defaultCode = DEFAULT_IB_CODE) {
    const requestedCode = String(code || '').trim().toLowerCase();
    const desiredCode = requestedCode || defaultCode;
    const row = this.referrersByCode.get(desiredCode);
    const fallback = !row || row.active !== true;
    const selected = fallback ? this.referrersByCode.get(defaultCode) : row;
    if (!selected || selected.active !== true) return null;
    return {
      ...publicReferrer(selected, requestedCode),
      fallback: fallback || (!!requestedCode && requestedCode !== selected.code)
    };
  }

  async createIbReferrer({ code, displayName, userId = null }) {
    const row = {
      id: crypto.randomUUID(),
      code,
      display_name: displayName,
      user_id: userId,
      active: true
    };
    this.referrersByCode.set(code, row);
    return publicReferrer(row);
  }

  async createUser({ displayName, email, passwordHash, icNumber, phone, ibReferrerId }) {
    if (this.usersByEmail.has(email)) {
      const error = new Error('Email already registered');
      error.code = 'EMAIL_EXISTS';
      throw error;
    }
    if (this.usersByIc.has(icNumber)) {
      const error = new Error('IC already registered');
      error.code = 'IC_EXISTS';
      throw error;
    }
    const now = new Date();
    const referrer = [...this.referrersByCode.values()].find(item => item.id === ibReferrerId) || null;
    const row = {
      id: crypto.randomUUID(),
      display_name: displayName,
      email,
      password_hash: passwordHash,
      ic_number: icNumber,
      phone,
      ib_referrer_id: ibReferrerId,
      ib_code: referrer?.code || null,
      ib_name: referrer?.display_name || null,
      status: 'active',
      created_at: now,
      last_login_at: null
    };
    this.usersByEmail.set(email, row);
    this.usersById.set(row.id, row);
    this.usersByIc.set(icNumber, row);
    return publicUser(row);
  }

  async findUserForLogin(email) {
    return this.usersByEmail.get(email) || null;
  }

  async findUserByIdForLogin(userId) {
    return this.usersById.get(userId) || null;
  }

  async markLogin(userId) {
    const user = this.usersById.get(userId);
    if (user) user.last_login_at = new Date();
  }

  async createSession({ userId, tokenHash, expiresAt }) {
    this.sessions.set(tokenHash, {
      sessionId: crypto.randomUUID(),
      userId,
      expiresAt: new Date(expiresAt)
    });
  }

  async findSession(tokenHash) {
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }
    const user = this.usersById.get(session.userId);
    if (!user || user.status !== 'active') return null;
    return {
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      user: publicUser(user)
    };
  }

  async deleteSession(tokenHash) {
    this.sessions.delete(tokenHash);
  }

  async deleteExpiredSessions() {
    for (const [tokenHash, session] of this.sessions) {
      if (session.expiresAt.getTime() <= Date.now()) this.sessions.delete(tokenHash);
    }
  }

  async close() {}
}

function createAuthStore(options = {}) {
  if (options.databaseUrl) return new PostgresAuthStore(options.databaseUrl);
  if (options.allowMemory) return new MemoryAuthStore();
  throw new Error('DATABASE_URL is required when ZenCore authentication is enabled.');
}

module.exports = {
  DEFAULT_IB_CODE,
  DEFAULT_IB_NAME,
  PostgresAuthStore,
  MemoryAuthStore,
  createAuthStore,
  publicUser,
  publicReferrer
};
