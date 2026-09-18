const crypto = require('crypto');
const { Pool } = require('pg');

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at
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
      CREATE TABLE IF NOT EXISTS zencore_users (
        id UUID PRIMARY KEY,
        display_name VARCHAR(60) NOT NULL,
        email VARCHAR(254) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      );

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

  async createUser({ displayName, email, passwordHash }) {
    try {
      const result = await this.pool.query(
        `INSERT INTO zencore_users (id, display_name, email, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, display_name, email, status, created_at, last_login_at`,
        [crypto.randomUUID(), displayName, email, passwordHash]
      );
      return publicUser(result.rows[0]);
    } catch (error) {
      if (error?.code === '23505') {
        const duplicate = new Error('Email already registered');
        duplicate.code = 'EMAIL_EXISTS';
        throw duplicate;
      }
      throw error;
    }
  }

  async findUserForLogin(email) {
    const result = await this.pool.query(
      `SELECT id, display_name, email, password_hash, status, created_at, last_login_at
       FROM zencore_users
       WHERE email = $1
       LIMIT 1`,
      [email]
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
              u.id, u.display_name, u.email, u.status, u.created_at, u.last_login_at
       FROM zencore_sessions s
       JOIN zencore_users u ON u.id = s.user_id
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
    this.sessions = new Map();
  }

  async init() {}

  async createUser({ displayName, email, passwordHash }) {
    if (this.usersByEmail.has(email)) {
      const error = new Error('Email already registered');
      error.code = 'EMAIL_EXISTS';
      throw error;
    }
    const now = new Date();
    const row = {
      id: crypto.randomUUID(),
      display_name: displayName,
      email,
      password_hash: passwordHash,
      status: 'active',
      created_at: now,
      last_login_at: null
    };
    this.usersByEmail.set(email, row);
    this.usersById.set(row.id, row);
    return publicUser(row);
  }

  async findUserForLogin(email) {
    return this.usersByEmail.get(email) || null;
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
  PostgresAuthStore,
  MemoryAuthStore,
  createAuthStore,
  publicUser
};
