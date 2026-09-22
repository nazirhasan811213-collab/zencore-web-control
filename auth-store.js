const crypto = require('crypto');
const { Pool } = require('pg');

const DEFAULT_IB_CODE = 'nazir';
const DEFAULT_IB_NAME = 'Nazir (Admin)';
const DEFAULT_IB_ID = '00000000-0000-4000-8000-000000000001';
const USER_ROLES = Object.freeze(['admin', 'ib', 'client', 'viewer']);

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    role: row.role || 'client',
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
    userId: row.user_id || null,
    active: row.active === true,
    clientCount: Number(row.client_count || 0),
    fallback: !!requestedCode && requestedCode !== row.code
  };
}

function maskedIc(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  if (text.length <= 8) return `${text.slice(0, 1)}${'*'.repeat(Math.max(2, text.length - 2))}${text.slice(-1)}`;
  return `${text.slice(0, 2)}${'*'.repeat(Math.min(8, Math.max(4, text.length - 6)))}${text.slice(-4)}`;
}

function publicClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone || '',
    icMasked: maskedIc(row.ic_number),
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    ibCode: row.ib_code || null,
    ibName: row.ib_name || null
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
        ic_number VARCHAR(64),
        phone VARCHAR(24),
        role VARCHAR(16) NOT NULL DEFAULT 'client',
        ib_referrer_id UUID REFERENCES zencore_ib_referrers(id),
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      );

      ALTER TABLE zencore_users
        ADD COLUMN IF NOT EXISTS ic_number VARCHAR(64),
        ADD COLUMN IF NOT EXISTS phone VARCHAR(24),
        ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'client',
        ADD COLUMN IF NOT EXISTS ib_referrer_id UUID;

      ALTER TABLE zencore_users
        ALTER COLUMN ic_number TYPE VARCHAR(64);

      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'zencore_users_role_check'
            AND pg_get_constraintdef(oid) NOT ILIKE '%viewer%'
        ) THEN
          ALTER TABLE zencore_users DROP CONSTRAINT zencore_users_role_check;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'zencore_users_role_check'
        ) THEN
          ALTER TABLE zencore_users
            ADD CONSTRAINT zencore_users_role_check
            CHECK (role IN ('admin','ib','client','viewer'));
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'zencore_users_ib_referrer_fk'
        ) THEN
          ALTER TABLE zencore_users
            ADD CONSTRAINT zencore_users_ib_referrer_fk
            FOREIGN KEY (ib_referrer_id)
            REFERENCES zencore_ib_referrers(id);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'zencore_ib_referrers_user_fk'
        ) THEN
          ALTER TABLE zencore_ib_referrers
            ADD CONSTRAINT zencore_ib_referrers_user_fk
            FOREIGN KEY (user_id)
            REFERENCES zencore_users(id)
            ON DELETE SET NULL;
        END IF;
      END $$;

      CREATE UNIQUE INDEX IF NOT EXISTS zencore_users_ic_number_idx
        ON zencore_users(ic_number)
        WHERE ic_number IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS zencore_ib_referrers_user_idx
        ON zencore_ib_referrers(user_id)
        WHERE user_id IS NOT NULL;

      CREATE OR REPLACE FUNCTION zencore_lock_ib_assignment()
      RETURNS trigger AS $zencore$
      BEGIN
        IF OLD.ib_referrer_id IS NOT NULL
           AND NEW.ib_referrer_id IS DISTINCT FROM OLD.ib_referrer_id
           AND COALESCE(current_setting('zencore.admin_ib_reassignment', TRUE), '') <> 'on' THEN
          RAISE EXCEPTION 'IB assignment is immutable';
        END IF;
        RETURN NEW;
      END;
      $zencore$ LANGUAGE plpgsql;

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

      CREATE TABLE IF NOT EXISTS zencore_system_settings (
        setting_key VARCHAR(64) PRIMARY KEY,
        setting_value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      INSERT INTO zencore_system_settings (setting_key, setting_value)
      VALUES ('registration_enabled', 'true'::jsonb)
      ON CONFLICT (setting_key) DO NOTHING;
    `);
    await this.deleteExpiredSessions();
  }


  async getSystemSettings() {
    const result = await this.pool.query(
      `SELECT setting_key, setting_value, updated_at
       FROM zencore_system_settings
       WHERE setting_key = 'registration_enabled'
       LIMIT 1`
    );
    const row = result.rows[0];
    return {
      registrationEnabled: row ? row.setting_value === true : true,
      updatedAt: row?.updated_at || null
    };
  }

  async setRegistrationEnabled(enabled) {
    const result = await this.pool.query(
      `INSERT INTO zencore_system_settings (setting_key, setting_value, updated_at)
       VALUES ('registration_enabled', $1::jsonb, NOW())
       ON CONFLICT (setting_key) DO UPDATE SET
         setting_value = EXCLUDED.setting_value,
         updated_at = NOW()
       RETURNING setting_value, updated_at`,
      [JSON.stringify(enabled === true)]
    );
    return {
      registrationEnabled: result.rows[0]?.setting_value === true,
      updatedAt: result.rows[0]?.updated_at || null
    };
  }

  async promoteAdminsByEmail(emails = []) {
    const normalized = [...new Set(emails.map(value => String(value || '').trim().toLowerCase()).filter(Boolean))];
    if (!normalized.length) return 0;
    const result = await this.pool.query(
      `UPDATE zencore_users
       SET role = 'admin'
       WHERE LOWER(email) = ANY($1::text[])
         AND role <> 'admin'
       RETURNING id`,
      [normalized]
    );
    return result.rowCount;
  }

  async setUserRole(userId, role) {
    if (!USER_ROLES.includes(role)) throw new Error('Invalid user role');
    const result = await this.pool.query(
      `UPDATE zencore_users SET role = $2 WHERE id = $1 RETURNING id, role`,
      [userId, role]
    );
    return result.rows[0] || null;
  }


  async upsertPublicViewer({ displayName, email, passwordHash }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const existing = await this.pool.query(
      `SELECT id, role FROM zencore_users WHERE LOWER(email) = $1 LIMIT 1`,
      [normalizedEmail]
    );
    if (existing.rows[0] && existing.rows[0].role !== 'viewer') {
      const error = new Error('Public viewer email belongs to a non-viewer account');
      error.code = 'VIEWER_EMAIL_CONFLICT';
      throw error;
    }
    const result = await this.pool.query(
      `INSERT INTO zencore_users
        (id, display_name, email, password_hash, role, status, ic_number, phone, ib_referrer_id)
       VALUES ($1, $2, $3, $4, 'viewer', 'active', NULL, NULL, NULL)
       ON CONFLICT (email) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         password_hash = EXCLUDED.password_hash,
         role = 'viewer',
         status = 'active',
         ic_number = NULL,
         phone = NULL,
         ib_referrer_id = NULL
       RETURNING *`,
      [crypto.randomUUID(), displayName, normalizedEmail, passwordHash]
    );
    return publicUser(result.rows[0]);
  }

  async resolveReferrer(code, defaultCode = DEFAULT_IB_CODE) {
    const requestedCode = String(code || '').trim().toLowerCase();
    const desiredCode = requestedCode || defaultCode;
    let result = await this.pool.query(
      `SELECT id, code, display_name, user_id, active
       FROM zencore_ib_referrers
       WHERE code = $1 AND active = TRUE
       LIMIT 1`,
      [desiredCode]
    );
    if (!result.rows[0] && desiredCode !== defaultCode) {
      result = await this.pool.query(
        `SELECT id, code, display_name, user_id, active
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
       RETURNING id, code, display_name, user_id, active`,
      [crypto.randomUUID(), code, displayName, userId]
    );
    return publicReferrer(result.rows[0]);
  }

  async createUser({
    displayName, email, passwordHash, icNumber = null, phone = null,
    ibReferrerId = null, role = 'client'
  }) {
    if (!USER_ROLES.includes(role)) throw new Error('Invalid user role');
    try {
      const result = await this.pool.query(
        `WITH inserted AS (
           INSERT INTO zencore_users
             (id, display_name, email, password_hash, ic_number, phone, ib_referrer_id, role)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *
         )
         SELECT inserted.*,
                ref.code AS ib_code,
                ref.display_name AS ib_name
         FROM inserted
         LEFT JOIN zencore_ib_referrers ref ON ref.id = inserted.ib_referrer_id`,
        [
          crypto.randomUUID(), displayName, email, passwordHash,
          icNumber || null, phone || null, ibReferrerId || null, role
        ]
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

  async createIbAccount({ displayName, code, email, passwordHash, phone = null }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const userId = crypto.randomUUID();
      const userResult = await client.query(
        `INSERT INTO zencore_users
          (id, display_name, email, password_hash, phone, role, status)
         VALUES ($1, $2, $3, $4, $5, 'ib', 'active')
         RETURNING id, display_name, email, role, status, created_at, last_login_at`,
        [userId, displayName, email, passwordHash, phone || null]
      );
      const referrerResult = await client.query(
        `INSERT INTO zencore_ib_referrers
          (id, code, display_name, user_id, active)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING id, code, display_name, user_id, active, created_at`,
        [crypto.randomUUID(), code, displayName, userId]
      );
      await client.query('COMMIT');
      return {
        user: publicUser(userResult.rows[0]),
        referrer: publicReferrer(referrerResult.rows[0])
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        const duplicate = new Error('IB account already exists');
        duplicate.code = String(error.constraint || '').includes('zencore_ib_referrers')
          ? 'IB_CODE_EXISTS'
          : 'EMAIL_EXISTS';
        throw duplicate;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async setIbActive(referrerId, active) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE zencore_ib_referrers
         SET active = $2
         WHERE id = $1 AND code <> $3
         RETURNING id, code, display_name, user_id, active`,
        [referrerId, active === true, DEFAULT_IB_CODE]
      );
      const referrer = result.rows[0];
      if (!referrer) {
        await client.query('ROLLBACK');
        return null;
      }
      if (referrer.user_id) {
        await client.query(
          `UPDATE zencore_users SET status = $2 WHERE id = $1 AND role = 'ib'`,
          [referrer.user_id, active === true ? 'active' : 'disabled']
        );
      }
      await client.query('COMMIT');
      return publicReferrer(referrer);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async adminOverview() {
    const [stats, ibs, clients] = await Promise.all([
      this.pool.query(
        `SELECT
          (SELECT COUNT(*)::int FROM zencore_ib_referrers WHERE code <> $1) AS total_ibs,
          (SELECT COUNT(*)::int FROM zencore_ib_referrers WHERE code <> $1 AND active = TRUE) AS active_ibs,
          (SELECT COUNT(*)::int FROM zencore_users WHERE role = 'client') AS total_clients,
          (SELECT COUNT(*)::int FROM zencore_users WHERE role = 'client' AND status = 'active') AS active_clients,
          (SELECT COUNT(*)::int FROM zencore_users WHERE role = 'client' AND created_at >= CURRENT_DATE) AS today_clients`,
        [DEFAULT_IB_CODE]
      ),
      this.listIbReferrersWithCounts(),
      this.listClientsForAdmin({ limit: 12 })
    ]);
    return {
      stats: stats.rows[0] || {
        total_ibs: 0, active_ibs: 0, total_clients: 0, active_clients: 0, today_clients: 0
      },
      ibs,
      latestClients: clients
    };
  }

  async listIbReferrersWithCounts() {
    const result = await this.pool.query(
      `SELECT ref.id, ref.code, ref.display_name, ref.user_id, ref.active, ref.created_at,
              COUNT(u.id)::int AS client_count
       FROM zencore_ib_referrers ref
       LEFT JOIN zencore_users u
         ON u.ib_referrer_id = ref.id AND u.role = 'client'
       GROUP BY ref.id
       ORDER BY CASE WHEN ref.code = $1 THEN 0 ELSE 1 END, ref.created_at ASC`,
      [DEFAULT_IB_CODE]
    );
    return result.rows.map(row => publicReferrer(row));
  }

  async listClientsForAdmin({ ibCode = '', limit = 200 } = {}) {
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
    const values = [];
    let filter = '';
    if (ibCode) {
      values.push(String(ibCode).toLowerCase());
      filter = `AND ref.code = $1`;
    }
    values.push(safeLimit);
    const limitIndex = values.length;
    const result = await this.pool.query(
      `SELECT u.id, u.display_name, u.email, u.phone, u.ic_number, u.status,
              u.created_at, u.last_login_at,
              ref.code AS ib_code, ref.display_name AS ib_name
       FROM zencore_users u
       LEFT JOIN zencore_ib_referrers ref ON ref.id = u.ib_referrer_id
       WHERE u.role = 'client' ${filter}
       ORDER BY u.created_at DESC
       LIMIT $${limitIndex}`,
      values
    );
    return result.rows.map(publicClient);
  }

  async ibOverview(userId) {
    const refResult = await this.pool.query(
      `SELECT id, code, display_name, user_id, active
       FROM zencore_ib_referrers
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );
    const referrer = refResult.rows[0];
    if (!referrer) return null;
    const [stats, clients] = await Promise.all([
      this.pool.query(
        `SELECT
          COUNT(*)::int AS total_clients,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_clients,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today_clients
         FROM zencore_users
         WHERE role = 'client' AND ib_referrer_id = $1`,
        [referrer.id]
      ),
      this.listClientsForIb(userId, { limit: 200 })
    ]);
    return {
      referrer: publicReferrer(referrer),
      stats: stats.rows[0] || { total_clients: 0, active_clients: 0, today_clients: 0 },
      clients
    };
  }

  async listClientsForIb(userId, { limit = 200 } = {}) {
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
    const result = await this.pool.query(
      `SELECT u.id, u.display_name, u.email, u.phone, u.ic_number, u.status,
              u.created_at, u.last_login_at,
              ref.code AS ib_code, ref.display_name AS ib_name
       FROM zencore_ib_referrers ref
       JOIN zencore_users u
         ON u.ib_referrer_id = ref.id AND u.role = 'client'
       WHERE ref.user_id = $1
       ORDER BY u.created_at DESC
       LIMIT $2`,
      [userId, safeLimit]
    );
    return result.rows.map(publicClient);
  }


  async setClientActiveForAdmin(clientId, active) {
    const result = await this.pool.query(
      `UPDATE zencore_users
       SET status = $2
       WHERE id = $1 AND role = 'client'
       RETURNING id, display_name, email, phone, ic_number, status, created_at, last_login_at, ib_referrer_id`,
      [clientId, active === true ? 'active' : 'disabled']
    );
    const row = result.rows[0];
    if (!row) return null;
    const enriched = await this.pool.query(
      `SELECT u.*, ref.code AS ib_code, ref.display_name AS ib_name
       FROM zencore_users u
       LEFT JOIN zencore_ib_referrers ref ON ref.id = u.ib_referrer_id
       WHERE u.id = $1`,
      [clientId]
    );
    return publicClient(enriched.rows[0]);
  }


  async reassignClientForAdmin(clientId, ibCode) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const referrerResult = await client.query(
        `SELECT id, code, display_name, user_id, active
         FROM zencore_ib_referrers
         WHERE code = $1
         LIMIT 1
         FOR UPDATE`,
        [String(ibCode || '').trim().toLowerCase()]
      );
      const referrer = referrerResult.rows[0];
      if (!referrer) {
        await client.query('ROLLBACK');
        return { client: null, referrer: null };
      }
      await client.query(
        `SELECT set_config('zencore.admin_ib_reassignment', 'on', TRUE)`
      );
      const updated = await client.query(
        `UPDATE zencore_users
         SET ib_referrer_id = $2
         WHERE id = $1 AND role = 'client'
         RETURNING id`,
        [clientId, referrer.id]
      );
      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        return { client: null, referrer: publicReferrer(referrer) };
      }
      const enriched = await client.query(
        `SELECT u.id, u.display_name, u.email, u.phone, u.ic_number, u.status,
                u.created_at, u.last_login_at,
                ref.code AS ib_code, ref.display_name AS ib_name
         FROM zencore_users u
         LEFT JOIN zencore_ib_referrers ref ON ref.id = u.ib_referrer_id
         WHERE u.id = $1`,
        [clientId]
      );
      await client.query('COMMIT');
      return {
        client: publicClient(enriched.rows[0]),
        referrer: publicReferrer(referrer)
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async promoteClientToIbForAdmin(clientId, { code, displayName = '' }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const userResult = await client.query(
        `SELECT id, display_name, email, role, status, created_at, last_login_at
         FROM zencore_users
         WHERE id = $1 AND role = 'client'
         LIMIT 1
         FOR UPDATE`,
        [clientId]
      );
      const userRow = userResult.rows[0];
      if (!userRow) {
        await client.query('ROLLBACK');
        return null;
      }

      const existingCode = await client.query(
        `SELECT id FROM zencore_ib_referrers WHERE code = $1 LIMIT 1`,
        [code]
      );
      if (existingCode.rows[0]) {
        const error = new Error('IB code already registered');
        error.code = 'IB_CODE_EXISTS';
        throw error;
      }

      await client.query(
        `SELECT set_config('zencore.admin_ib_reassignment', 'on', TRUE)`
      );
      const promotedResult = await client.query(
        `UPDATE zencore_users
         SET role = 'ib', ib_referrer_id = NULL, status = 'active'
         WHERE id = $1 AND role = 'client'
         RETURNING id, display_name, email, role, status, created_at, last_login_at`,
        [clientId]
      );
      const promoted = promotedResult.rows[0];
      const referrerResult = await client.query(
        `INSERT INTO zencore_ib_referrers
          (id, code, display_name, user_id, active)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING id, code, display_name, user_id, active, created_at`,
        [crypto.randomUUID(), code, displayName || userRow.display_name, clientId]
      );
      await client.query('COMMIT');
      return {
        user: publicUser(promoted),
        referrer: publicReferrer(referrerResult.rows[0])
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        const duplicate = new Error('IB code already registered');
        duplicate.code = 'IB_CODE_EXISTS';
        throw duplicate;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async setClientActiveForIb(ibUserId, clientId, active) {
    const result = await this.pool.query(
      `UPDATE zencore_users u
       SET status = $3
       FROM zencore_ib_referrers ref
       WHERE u.id = $2
         AND u.role = 'client'
         AND u.ib_referrer_id = ref.id
         AND ref.user_id = $1
       RETURNING u.id`,
      [ibUserId, clientId, active === true ? 'active' : 'disabled']
    );
    if (!result.rows[0]) return null;
    const rows = await this.listClientsForIb(ibUserId, { limit: 500 });
    return rows.find(item => item.id === clientId) || null;
  }


  async getIbDetailForAdmin(code) {
    const result = await this.pool.query(
      `SELECT ref.id, ref.code, ref.display_name, ref.user_id, ref.active, ref.created_at,
              COUNT(u.id)::int AS client_count
       FROM zencore_ib_referrers ref
       LEFT JOIN zencore_users u
         ON u.ib_referrer_id = ref.id AND u.role = 'client'
       WHERE ref.code = $1
       GROUP BY ref.id
       LIMIT 1`,
      [String(code || '').trim().toLowerCase()]
    );
    const referrer = result.rows[0];
    if (!referrer) return null;
    const clients = await this.listClientsForAdmin({ ibCode: referrer.code, limit: 500 });
    return { referrer: publicReferrer(referrer), clients };
  }

  async getClientForAdmin(clientId) {
    const result = await this.pool.query(
      `SELECT u.id, u.display_name, u.email, u.phone, u.ic_number, u.status,
              u.created_at, u.last_login_at,
              ref.code AS ib_code, ref.display_name AS ib_name
       FROM zencore_users u
       LEFT JOIN zencore_ib_referrers ref ON ref.id = u.ib_referrer_id
       WHERE u.id = $1 AND u.role = 'client'
       LIMIT 1`,
      [clientId]
    );
    return publicClient(result.rows[0]);
  }

  async getClientForIb(ibUserId, clientId) {
    const result = await this.pool.query(
      `SELECT u.id, u.display_name, u.email, u.phone, u.ic_number, u.status,
              u.created_at, u.last_login_at,
              ref.code AS ib_code, ref.display_name AS ib_name
       FROM zencore_ib_referrers ref
       JOIN zencore_users u
         ON u.ib_referrer_id = ref.id AND u.role = 'client'
       WHERE ref.user_id = $1 AND u.id = $2
       LIMIT 1`,
      [ibUserId, clientId]
    );
    return publicClient(result.rows[0]);
  }

  async getOwnClientProfile(userId) {
    return this.getClientForAdmin(userId);
  }

  async updateOwnClientProfile(userId, { displayName, phone }) {
    const result = await this.pool.query(
      `UPDATE zencore_users
       SET display_name = $2, phone = $3
       WHERE id = $1 AND role = 'client' AND status = 'active'
       RETURNING id`,
      [userId, displayName, phone]
    );
    if (!result.rows[0]) return null;
    return this.getClientForAdmin(userId);
  }

  async findUserForLogin(email) {
    const result = await this.pool.query(
      `SELECT u.id, u.display_name, u.email, u.password_hash, u.role, u.status,
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
      `SELECT u.id, u.display_name, u.email, u.password_hash, u.role, u.status,
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
              u.id, u.display_name, u.email, u.role, u.status, u.created_at, u.last_login_at,
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
      user_id: null,
      active: true,
      created_at: new Date()
    });
  }

  async init() {}


  async getSystemSettings() {
    return {
      registrationEnabled: this.registrationEnabled !== false,
      updatedAt: this.registrationUpdatedAt || null
    };
  }

  async setRegistrationEnabled(enabled) {
    this.registrationEnabled = enabled === true;
    this.registrationUpdatedAt = new Date();
    return {
      registrationEnabled: this.registrationEnabled,
      updatedAt: this.registrationUpdatedAt
    };
  }

  async promoteAdminsByEmail(emails = []) {
    const normalized = new Set(emails.map(value => String(value || '').trim().toLowerCase()).filter(Boolean));
    let changed = 0;
    for (const row of this.usersById.values()) {
      if (normalized.has(String(row.email || '').toLowerCase()) && row.role !== 'admin') {
        row.role = 'admin';
        changed += 1;
      }
    }
    return changed;
  }

  async setUserRole(userId, role) {
    if (!USER_ROLES.includes(role)) throw new Error('Invalid user role');
    const row = this.usersById.get(userId);
    if (!row) return null;
    row.role = role;
    return { id: row.id, role };
  }


  async upsertPublicViewer({ displayName, email, passwordHash }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const existing = this.usersByEmail.get(normalizedEmail);
    if (existing && existing.role !== 'viewer') {
      const error = new Error('Public viewer email belongs to a non-viewer account');
      error.code = 'VIEWER_EMAIL_CONFLICT';
      throw error;
    }
    if (existing) {
      existing.display_name = displayName;
      existing.password_hash = passwordHash;
      existing.role = 'viewer';
      existing.status = 'active';
      existing.ic_number = null;
      existing.phone = null;
      existing.ib_referrer_id = null;
      existing.ib_code = null;
      existing.ib_name = null;
      return publicUser(existing);
    }
    return this.createUser({
      displayName,
      email: normalizedEmail,
      passwordHash,
      role: 'viewer'
    });
  }

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
    const existing = this.referrersByCode.get(code);
    const row = existing || {
      id: crypto.randomUUID(),
      code,
      created_at: new Date()
    };
    row.display_name = displayName;
    row.user_id = userId || row.user_id || null;
    row.active = true;
    this.referrersByCode.set(code, row);
    return publicReferrer(row);
  }

  async createUser({
    displayName, email, passwordHash, icNumber = null, phone = null,
    ibReferrerId = null, role = 'client'
  }) {
    if (this.usersByEmail.has(email)) {
      const error = new Error('Email already registered');
      error.code = 'EMAIL_EXISTS';
      throw error;
    }
    if (icNumber && this.usersByIc.has(icNumber)) {
      const error = new Error('IC already registered');
      error.code = 'IC_EXISTS';
      throw error;
    }
    if (!USER_ROLES.includes(role)) throw new Error('Invalid user role');
    const now = new Date();
    const referrer = [...this.referrersByCode.values()].find(item => item.id === ibReferrerId) || null;
    const row = {
      id: crypto.randomUUID(),
      display_name: displayName,
      email,
      password_hash: passwordHash,
      ic_number: icNumber || null,
      phone: phone || null,
      role,
      ib_referrer_id: ibReferrerId || null,
      ib_code: referrer?.code || null,
      ib_name: referrer?.display_name || null,
      status: 'active',
      created_at: now,
      last_login_at: null
    };
    this.usersByEmail.set(email, row);
    this.usersById.set(row.id, row);
    if (icNumber) this.usersByIc.set(icNumber, row);
    return publicUser(row);
  }

  async createIbAccount({ displayName, code, email, passwordHash, phone = null }) {
    if (this.usersByEmail.has(email)) {
      const error = new Error('Email already registered');
      error.code = 'EMAIL_EXISTS';
      throw error;
    }
    if (this.referrersByCode.has(code)) {
      const error = new Error('IB code already registered');
      error.code = 'IB_CODE_EXISTS';
      throw error;
    }
    const user = await this.createUser({
      displayName, email, passwordHash, phone, role: 'ib'
    });
    const referrer = await this.createIbReferrer({
      code, displayName, userId: user.id
    });
    return { user, referrer };
  }

  async setIbActive(referrerId, active) {
    const referrer = [...this.referrersByCode.values()].find(item => item.id === referrerId);
    if (!referrer || referrer.code === DEFAULT_IB_CODE) return null;
    referrer.active = active === true;
    if (referrer.user_id) {
      const user = this.usersById.get(referrer.user_id);
      if (user && user.role === 'ib') user.status = referrer.active ? 'active' : 'disabled';
    }
    return publicReferrer(referrer);
  }

  async adminOverview() {
    const ibs = await this.listIbReferrersWithCounts();
    const clients = await this.listClientsForAdmin({ limit: 12 });
    const allClients = [...this.usersById.values()].filter(row => row.role === 'client');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
      stats: {
        total_ibs: ibs.filter(item => item.code !== DEFAULT_IB_CODE).length,
        active_ibs: ibs.filter(item => item.code !== DEFAULT_IB_CODE && item.active).length,
        total_clients: allClients.length,
        active_clients: allClients.filter(item => item.status === 'active').length,
        today_clients: allClients.filter(item => new Date(item.created_at).getTime() >= today.getTime()).length
      },
      ibs,
      latestClients: clients
    };
  }

  async listIbReferrersWithCounts() {
    return [...this.referrersByCode.values()]
      .map(referrer => {
        const clientCount = [...this.usersById.values()]
          .filter(user => user.role === 'client' && user.ib_referrer_id === referrer.id).length;
        return publicReferrer({ ...referrer, client_count: clientCount });
      })
      .sort((a, b) => {
        if (a.code === DEFAULT_IB_CODE) return -1;
        if (b.code === DEFAULT_IB_CODE) return 1;
        return a.displayName.localeCompare(b.displayName);
      });
  }

  async listClientsForAdmin({ ibCode = '', limit = 200 } = {}) {
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
    return [...this.usersById.values()]
      .filter(row => row.role === 'client' && (!ibCode || row.ib_code === ibCode))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, safeLimit)
      .map(publicClient);
  }

  async ibOverview(userId) {
    const referrer = [...this.referrersByCode.values()].find(item => item.user_id === userId);
    if (!referrer) return null;
    const clients = await this.listClientsForIb(userId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
      referrer: publicReferrer(referrer),
      stats: {
        total_clients: clients.length,
        active_clients: clients.filter(item => item.status === 'active').length,
        today_clients: clients.filter(item => new Date(item.createdAt).getTime() >= today.getTime()).length
      },
      clients
    };
  }

  async listClientsForIb(userId, { limit = 200 } = {}) {
    const referrer = [...this.referrersByCode.values()].find(item => item.user_id === userId);
    if (!referrer) return [];
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
    return [...this.usersById.values()]
      .filter(row => row.role === 'client' && row.ib_referrer_id === referrer.id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, safeLimit)
      .map(publicClient);
  }


  async setClientActiveForAdmin(clientId, active) {
    const row = this.usersById.get(clientId);
    if (!row || row.role !== 'client') return null;
    row.status = active === true ? 'active' : 'disabled';
    return publicClient(row);
  }


  async reassignClientForAdmin(clientId, ibCode) {
    const row = this.usersById.get(clientId);
    const referrer = this.referrersByCode.get(String(ibCode || '').trim().toLowerCase());
    if (!row || row.role !== 'client' || !referrer) {
      return { client: null, referrer: referrer ? publicReferrer(referrer) : null };
    }
    row.ib_referrer_id = referrer.id;
    row.ib_code = referrer.code;
    row.ib_name = referrer.display_name;
    return {
      client: publicClient(row),
      referrer: publicReferrer(referrer)
    };
  }

  async promoteClientToIbForAdmin(clientId, { code, displayName = '' }) {
    const row = this.usersById.get(clientId);
    if (!row || row.role !== 'client') return null;
    if (this.referrersByCode.has(code)) {
      const error = new Error('IB code already registered');
      error.code = 'IB_CODE_EXISTS';
      throw error;
    }
    row.role = 'ib';
    row.status = 'active';
    row.ib_referrer_id = null;
    row.ib_code = null;
    row.ib_name = null;
    const referrer = {
      id: crypto.randomUUID(),
      code,
      display_name: displayName || row.display_name,
      user_id: row.id,
      active: true,
      created_at: new Date()
    };
    this.referrersByCode.set(code, referrer);
    return {
      user: publicUser(row),
      referrer: publicReferrer(referrer)
    };
  }

  async setClientActiveForIb(ibUserId, clientId, active) {
    const referrer = [...this.referrersByCode.values()].find(item => item.user_id === ibUserId);
    const row = this.usersById.get(clientId);
    if (!referrer || !row || row.role !== 'client' || row.ib_referrer_id !== referrer.id) return null;
    row.status = active === true ? 'active' : 'disabled';
    return publicClient(row);
  }


  async getIbDetailForAdmin(code) {
    const referrer = this.referrersByCode.get(String(code || '').trim().toLowerCase());
    if (!referrer) return null;
    const clients = await this.listClientsForAdmin({ ibCode: referrer.code, limit: 500 });
    return {
      referrer: publicReferrer({
        ...referrer,
        client_count: clients.length
      }),
      clients
    };
  }

  async getClientForAdmin(clientId) {
    const row = this.usersById.get(clientId);
    if (!row || row.role !== 'client') return null;
    return publicClient(row);
  }

  async getClientForIb(ibUserId, clientId) {
    const referrer = [...this.referrersByCode.values()].find(item => item.user_id === ibUserId);
    const row = this.usersById.get(clientId);
    if (!referrer || !row || row.role !== 'client' || row.ib_referrer_id !== referrer.id) return null;
    return publicClient(row);
  }

  async getOwnClientProfile(userId) {
    return this.getClientForAdmin(userId);
  }

  async updateOwnClientProfile(userId, { displayName, phone }) {
    const row = this.usersById.get(userId);
    if (!row || row.role !== 'client' || row.status !== 'active') return null;
    row.display_name = displayName;
    row.phone = phone;
    return publicClient(row);
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
  USER_ROLES,
  PostgresAuthStore,
  MemoryAuthStore,
  createAuthStore,
  publicUser,
  publicReferrer,
  publicClient
};
