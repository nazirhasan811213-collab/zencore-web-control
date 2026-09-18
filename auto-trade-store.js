const crypto = require('crypto');
const { Pool } = require('pg');

function timestamp(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function publicProfile(row) {
  if (!row) return null;
  const capital = row.capital_usd ?? row.capitalUsd;
  const lot = row.lot_per_layer ?? row.lotPerLayer;
  return {
    userId: row.user_id || row.userId,
    capitalUsd: capital == null ? null : Number(capital),
    lotPerLayer: lot == null ? null : Number(lot),
    layers: row.layers == null ? null : Number(row.layers),
    symbols: Array.isArray(row.symbols) ? row.symbols : [],
    riskAcknowledgedAt: timestamp(row.risk_acknowledged_at ?? row.riskAcknowledgedAt),
    desiredState: row.desired_state || row.desiredState || 'STOPPED',
    effectiveState: row.effective_state || row.effectiveState || 'STOPPED',
    stateVersion: Number(row.state_version ?? row.stateVersion ?? 0),
    pendingCommandId: row.pending_command_id || row.pendingCommandId || null,
    lastError: row.last_error || row.lastError || null,
    updatedAt: timestamp(row.updated_at ?? row.updatedAt)
  };
}

function publicPod(row, includePrivate = false) {
  if (!row) return null;
  const value = {
    id: row.id,
    userId: row.user_id || row.userId,
    label: row.label,
    ownershipMode: row.ownership_mode || row.ownershipMode || 'INTERNAL_DEMO',
    accountMask: row.account_mask ?? row.accountMask ?? null,
    serverMask: row.server_mask ?? row.serverMask ?? null,
    brokerMask: row.broker_mask ?? row.brokerMask ?? null,
    tradeMode: row.trade_mode ?? row.tradeMode ?? null,
    terminalTradeAllowed: row.terminal_trade_allowed ?? row.terminalTradeAllowed ?? false,
    accountTradeAllowed: row.account_trade_allowed ?? row.accountTradeAllowed ?? false,
    expertTradeAllowed: row.expert_trade_allowed ?? row.expertTradeAllowed ?? false,
    demoExecutionUnlocked: row.demo_execution_unlocked ?? row.demoExecutionUnlocked ?? false,
    symbolSpecs: row.symbol_specs ?? row.symbolSpecs ?? {},
    connectorVersion: row.connector_version ?? row.connectorVersion ?? null,
    terminalBuild: row.terminal_build ?? row.terminalBuild ?? null,
    lastSeenAt: timestamp(row.last_seen_at ?? row.lastSeenAt),
    createdAt: timestamp(row.created_at ?? row.createdAt),
    revokedAt: timestamp(row.revoked_at ?? row.revokedAt)
  };
  if (includePrivate) value.tokenHash = row.token_hash || row.tokenHash;
  return value;
}

function publicPairing(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id || row.userId,
    label: row.label,
    ownershipMode: row.ownership_mode || row.ownershipMode || 'TRADER_OWNED_WINDOWS_PC',
    expiresAt: timestamp(row.expires_at ?? row.expiresAt),
    consumedAt: timestamp(row.consumed_at ?? row.consumedAt),
    createdAt: timestamp(row.created_at ?? row.createdAt)
  };
}

function publicCommand(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id || row.userId,
    podId: row.pod_id || row.podId,
    type: row.command_type || row.type,
    payload: row.payload || {},
    signature: row.signature,
    signedEnvelope: row.signed_envelope || row.signedEnvelope,
    dedupeKey: row.dedupe_key ?? row.dedupeKey ?? null,
    status: row.status,
    createdAt: timestamp(row.created_at ?? row.createdAt),
    expiresAt: timestamp(row.expires_at ?? row.expiresAt),
    deliveredAt: timestamp(row.delivered_at ?? row.deliveredAt),
    acknowledgedAt: timestamp(row.acknowledged_at ?? row.acknowledgedAt),
    result: row.result || null
  };
}

class PostgresAutoTradeStore {
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
      CREATE TABLE IF NOT EXISTS zencore_autotrade_profiles (
        user_id UUID PRIMARY KEY REFERENCES zencore_users(id) ON DELETE CASCADE,
        capital_usd NUMERIC(14,2),
        lot_per_layer NUMERIC(12,5),
        layers SMALLINT,
        symbols JSONB NOT NULL DEFAULT '[]'::jsonb,
        risk_acknowledged_at TIMESTAMPTZ,
        desired_state VARCHAR(32) NOT NULL DEFAULT 'STOPPED',
        effective_state VARCHAR(32) NOT NULL DEFAULT 'STOPPED',
        state_version BIGINT NOT NULL DEFAULT 0,
        pending_command_id UUID,
        last_error VARCHAR(240),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS zencore_mt5_secure_pods (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL UNIQUE REFERENCES zencore_users(id) ON DELETE CASCADE,
        label VARCHAR(60) NOT NULL,
        ownership_mode VARCHAR(32) NOT NULL DEFAULT 'INTERNAL_DEMO',
        token_hash CHAR(64) NOT NULL UNIQUE,
        account_mask VARCHAR(20),
        server_mask VARCHAR(32),
        broker_mask VARCHAR(40),
        trade_mode VARCHAR(12),
        terminal_trade_allowed BOOLEAN NOT NULL DEFAULT FALSE,
        account_trade_allowed BOOLEAN NOT NULL DEFAULT FALSE,
        expert_trade_allowed BOOLEAN NOT NULL DEFAULT FALSE,
        demo_execution_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
        symbol_specs JSONB NOT NULL DEFAULT '{}'::jsonb,
        connector_version VARCHAR(32),
        terminal_build VARCHAR(24),
        last_seen_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      );

      ALTER TABLE zencore_mt5_secure_pods
        ADD COLUMN IF NOT EXISTS ownership_mode VARCHAR(32) NOT NULL DEFAULT 'INTERNAL_DEMO';

      ALTER TABLE zencore_mt5_secure_pods
        ADD COLUMN IF NOT EXISTS demo_execution_unlocked BOOLEAN NOT NULL DEFAULT FALSE;

      CREATE TABLE IF NOT EXISTS zencore_mt5_pairing_sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES zencore_users(id) ON DELETE CASCADE,
        label VARCHAR(60) NOT NULL,
        ownership_mode VARCHAR(32) NOT NULL,
        code_hash CHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS zencore_mt5_pairing_user_idx
        ON zencore_mt5_pairing_sessions(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS zencore_mt5_positions (
        user_id UUID NOT NULL REFERENCES zencore_users(id) ON DELETE CASCADE,
        ticket VARCHAR(32) NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, ticket)
      );

      CREATE TABLE IF NOT EXISTS zencore_autotrade_commands (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES zencore_users(id) ON DELETE CASCADE,
        pod_id UUID NOT NULL REFERENCES zencore_mt5_secure_pods(id) ON DELETE CASCADE,
        command_type VARCHAR(40) NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        signature CHAR(64) NOT NULL,
        signed_envelope TEXT NOT NULL,
        dedupe_key VARCHAR(220),
        status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        delivered_at TIMESTAMPTZ,
        acknowledged_at TIMESTAMPTZ,
        result JSONB
      );
      CREATE UNIQUE INDEX IF NOT EXISTS zencore_autotrade_command_dedupe_idx
        ON zencore_autotrade_commands(user_id, dedupe_key)
        WHERE dedupe_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS zencore_autotrade_command_queue_idx
        ON zencore_autotrade_commands(pod_id, status, created_at);

      ALTER TABLE zencore_autotrade_commands
        ADD COLUMN IF NOT EXISTS signed_envelope TEXT;

      CREATE TABLE IF NOT EXISTS zencore_autotrade_audit (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES zencore_users(id) ON DELETE CASCADE,
        event_type VARCHAR(60) NOT NULL,
        detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS zencore_autotrade_audit_user_idx
        ON zencore_autotrade_audit(user_id, created_at DESC);
    `);
  }

  async getProfile(userId) {
    const result = await this.pool.query(
      `SELECT * FROM zencore_autotrade_profiles WHERE user_id = $1`, [userId]
    );
    return publicProfile(result.rows[0]);
  }

  async saveSettings(userId, settings) {
    const result = await this.pool.query(
      `INSERT INTO zencore_autotrade_profiles
        (user_id, capital_usd, lot_per_layer, layers, symbols, risk_acknowledged_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         capital_usd = EXCLUDED.capital_usd,
         lot_per_layer = EXCLUDED.lot_per_layer,
         layers = EXCLUDED.layers,
         symbols = EXCLUDED.symbols,
         risk_acknowledged_at = EXCLUDED.risk_acknowledged_at,
         state_version = zencore_autotrade_profiles.state_version + 1,
         updated_at = NOW()
       RETURNING *`,
      [userId, settings.capitalUsd, settings.lotPerLayer, settings.layers,
        JSON.stringify(settings.symbols), settings.riskAcknowledgedAt ? new Date(settings.riskAcknowledgedAt) : null]
    );
    return publicProfile(result.rows[0]);
  }

  async setControl(userId, update) {
    const result = await this.pool.query(
      `INSERT INTO zencore_autotrade_profiles
        (user_id, desired_state, effective_state, pending_command_id, last_error)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         desired_state = EXCLUDED.desired_state,
         effective_state = EXCLUDED.effective_state,
         pending_command_id = EXCLUDED.pending_command_id,
         last_error = EXCLUDED.last_error,
         state_version = zencore_autotrade_profiles.state_version + 1,
         updated_at = NOW()
       RETURNING *`,
      [userId, update.desiredState, update.effectiveState,
        update.pendingCommandId || null, update.lastError || null]
    );
    return publicProfile(result.rows[0]);
  }

  async listOnProfiles() {
    const result = await this.pool.query(
      `SELECT * FROM zencore_autotrade_profiles
       WHERE desired_state = 'ON' AND effective_state = 'ON'`
    );
    return result.rows.map(publicProfile);
  }

  async listManagedProfiles() {
    const result = await this.pool.query(
      `SELECT DISTINCT p.* FROM zencore_autotrade_profiles p
       JOIN zencore_mt5_positions x ON x.user_id = p.user_id`
    );
    return result.rows.map(publicProfile);
  }

  async provisionPod({ id, userId, label, tokenHash, ownershipMode = 'INTERNAL_DEMO' }) {
    const result = await this.pool.query(
      `INSERT INTO zencore_mt5_secure_pods (id, user_id, label, ownership_mode, token_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         label = EXCLUDED.label, ownership_mode = EXCLUDED.ownership_mode,
         token_hash = EXCLUDED.token_hash,
         account_mask = NULL, server_mask = NULL, broker_mask = NULL, trade_mode = NULL,
         terminal_trade_allowed = FALSE, account_trade_allowed = FALSE,
         expert_trade_allowed = FALSE, demo_execution_unlocked = FALSE, symbol_specs = '{}'::jsonb,
         connector_version = NULL, terminal_build = NULL, last_seen_at = NULL,
         created_at = NOW(), revoked_at = NULL
       RETURNING *`,
      [id, userId, label, ownershipMode, tokenHash]
    );
    return publicPod(result.rows[0], true);
  }

  async createPairingSession({ id, userId, label, ownershipMode, codeHash, expiresAt, createdAt }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE zencore_mt5_pairing_sessions SET consumed_at = $2
         WHERE user_id = $1 AND consumed_at IS NULL`,
        [userId, new Date(createdAt)]
      );
      const result = await client.query(
        `INSERT INTO zencore_mt5_pairing_sessions
          (id, user_id, label, ownership_mode, code_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [id, userId, label, ownershipMode, codeHash, new Date(expiresAt), new Date(createdAt)]
      );
      await client.query('COMMIT');
      return publicPairing(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getActivePairingForUser(userId, now) {
    const result = await this.pool.query(
      `SELECT * FROM zencore_mt5_pairing_sessions
       WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > $2
       ORDER BY created_at DESC LIMIT 1`,
      [userId, new Date(now)]
    );
    return publicPairing(result.rows[0]);
  }

  async consumePairingSession(codeHash, now) {
    const result = await this.pool.query(
      `UPDATE zencore_mt5_pairing_sessions SET consumed_at = $2
       WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > $2
       RETURNING *`,
      [codeHash, new Date(now)]
    );
    return publicPairing(result.rows[0]);
  }

  async findPodByTokenHash(tokenHash) {
    const result = await this.pool.query(
      `SELECT * FROM zencore_mt5_secure_pods
       WHERE token_hash = $1 AND revoked_at IS NULL LIMIT 1`, [tokenHash]
    );
    return publicPod(result.rows[0], true);
  }

  async getPodForUser(userId) {
    const result = await this.pool.query(
      `SELECT * FROM zencore_mt5_secure_pods
       WHERE user_id = $1 AND revoked_at IS NULL LIMIT 1`, [userId]
    );
    return publicPod(result.rows[0]);
  }

  async updatePodHeartbeat(podId, heartbeat, now) {
    const result = await this.pool.query(
      `UPDATE zencore_mt5_secure_pods SET
        account_mask = $2, server_mask = $3, broker_mask = $4, trade_mode = $5,
        terminal_trade_allowed = $6, account_trade_allowed = $7,
        expert_trade_allowed = $8, demo_execution_unlocked = $9, symbol_specs = $10::jsonb,
        connector_version = $11, terminal_build = $12, last_seen_at = $13
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING *`,
      [podId, heartbeat.accountMask, heartbeat.serverMask, heartbeat.brokerMask,
        heartbeat.tradeMode, heartbeat.terminalTradeAllowed, heartbeat.accountTradeAllowed,
        heartbeat.expertTradeAllowed, heartbeat.demoExecutionUnlocked === true,
        JSON.stringify(heartbeat.symbolSpecs || {}), heartbeat.connectorVersion || null,
        heartbeat.terminalBuild || null, new Date(now)]
    );
    return publicPod(result.rows[0]);
  }

  async replacePositions(userId, positions, now) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM zencore_mt5_positions WHERE user_id = $1`, [userId]);
      for (const position of positions) {
        await client.query(
          `INSERT INTO zencore_mt5_positions (user_id, ticket, data, updated_at)
           VALUES ($1, $2, $3::jsonb, $4)`,
          [userId, position.ticket, JSON.stringify(position), new Date(now)]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listPositions(userId) {
    const result = await this.pool.query(
      `SELECT data, updated_at FROM zencore_mt5_positions
       WHERE user_id = $1 ORDER BY updated_at DESC, ticket`, [userId]
    );
    return result.rows.map(row => ({ ...row.data, updatedAt: timestamp(row.updated_at) }));
  }

  async createCommand(command) {
    try {
      const result = await this.pool.query(
        `INSERT INTO zencore_autotrade_commands
          (id, user_id, pod_id, command_type, payload, signature, signed_envelope, dedupe_key, expires_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
         RETURNING *`,
        [command.id, command.userId, command.podId, command.type,
          JSON.stringify(command.payload || {}), command.signature, command.signedEnvelope,
          command.dedupeKey || null, new Date(command.expiresAt)]
      );
      return { created: true, command: publicCommand(result.rows[0]) };
    } catch (error) {
      if (error?.code !== '23505' || !command.dedupeKey) throw error;
      const result = await this.pool.query(
        `SELECT * FROM zencore_autotrade_commands
         WHERE user_id = $1 AND dedupe_key = $2 LIMIT 1`,
        [command.userId, command.dedupeKey]
      );
      return { created: false, command: publicCommand(result.rows[0]) };
    }
  }

  async hasRecentEntryCommand(userId, symbol, since) {
    const result = await this.pool.query(
      `SELECT 1 FROM zencore_autotrade_commands
       WHERE user_id = $1 AND command_type = 'PLACE_SETUP'
         AND payload->>'symbol' = $2 AND created_at >= $3
         AND status NOT IN ('FAILED','REJECTED','EXPIRED','CANCELLED')
       LIMIT 1`,
      [userId, symbol, new Date(since)]
    );
    return result.rowCount > 0;
  }

  async cancelPendingEntryCommands(userId, reason) {
    const safeReason = String(reason || 'CANCELLED').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40);
    const result = await this.pool.query(
      `UPDATE zencore_autotrade_commands SET
         status = 'CANCELLED', acknowledged_at = NOW(),
         result = jsonb_build_object('code', $2::text, 'message', 'Cancelled before broker execution')
       WHERE user_id = $1 AND command_type IN ('PLACE_SETUP','SYSTEM_ON')
         AND status = 'PENDING'
       RETURNING id`,
      [userId, safeReason]
    );
    return result.rowCount;
  }

  async nextCommandForPod(podId, now) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE zencore_autotrade_commands SET status = 'EXPIRED'
         WHERE pod_id = $1 AND status IN ('PENDING','DELIVERED') AND expires_at <= $2`,
        [podId, new Date(now)]
      );
      const result = await client.query(
        `SELECT * FROM zencore_autotrade_commands
         WHERE pod_id = $1 AND status IN ('PENDING','DELIVERED') AND expires_at > $2
         ORDER BY CASE command_type
           WHEN 'EMERGENCY_CLOSE_ALL' THEN 0
           WHEN 'SYSTEM_STOP' THEN 1
           WHEN 'MANAGE_POSITION' THEN 2
           WHEN 'SYSTEM_ON' THEN 3
           WHEN 'PLACE_SETUP' THEN 4
           ELSE 5 END,
           created_at ASC
         LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [podId, new Date(now)]
      );
      if (!result.rows[0]) {
        await client.query('COMMIT');
        return null;
      }
      const updated = await client.query(
        `UPDATE zencore_autotrade_commands SET status = 'DELIVERED', delivered_at = NOW()
         WHERE id = $1 RETURNING *`, [result.rows[0].id]
      );
      await client.query('COMMIT');
      return publicCommand(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ackCommand(podId, commandId, status, result) {
    const query = await this.pool.query(
      `UPDATE zencore_autotrade_commands SET
        status = $3, acknowledged_at = NOW(), result = $4::jsonb
       WHERE id = $1 AND pod_id = $2 AND status IN ('PENDING','DELIVERED')
       RETURNING *`,
      [commandId, podId, status, JSON.stringify(result || {})]
    );
    return publicCommand(query.rows[0]);
  }

  async appendAudit(userId, eventType, detail = {}) {
    await this.pool.query(
      `INSERT INTO zencore_autotrade_audit (user_id, event_type, detail)
       VALUES ($1, $2, $3::jsonb)`, [userId, eventType, JSON.stringify(detail)]
    );
  }

  async listAudit(userId, limit = 30) {
    const result = await this.pool.query(
      `SELECT id, event_type, detail, created_at FROM zencore_autotrade_audit
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.max(1, Math.min(100, Number(limit) || 30))]
    );
    return result.rows.map(row => ({
      id: String(row.id), type: row.event_type, detail: row.detail || {},
      createdAt: timestamp(row.created_at)
    }));
  }

  async close() { await this.pool.end(); }
}

class MemoryAutoTradeStore {
  constructor() {
    this.profiles = new Map();
    this.podsByUser = new Map();
    this.podsByToken = new Map();
    this.pairingsByUser = new Map();
    this.pairingsByCode = new Map();
    this.positions = new Map();
    this.commands = new Map();
    this.audit = new Map();
  }

  async init() {}

  async getProfile(userId) { return publicProfile(this.profiles.get(userId)); }

  async saveSettings(userId, settings) {
    const current = this.profiles.get(userId) || {
      userId, desiredState: 'STOPPED', effectiveState: 'STOPPED', stateVersion: 0
    };
    const next = {
      ...current, ...settings,
      stateVersion: (current.stateVersion || 0) + 1,
      updatedAt: Date.now()
    };
    this.profiles.set(userId, next);
    return publicProfile(next);
  }

  async setControl(userId, update) {
    const current = this.profiles.get(userId) || {
      userId, symbols: [], desiredState: 'STOPPED', effectiveState: 'STOPPED', stateVersion: 0
    };
    const next = {
      ...current,
      ...update,
      stateVersion: (current.stateVersion || 0) + 1,
      updatedAt: Date.now()
    };
    this.profiles.set(userId, next);
    return publicProfile(next);
  }

  async listOnProfiles() {
    return [...this.profiles.values()]
      .filter(row => row.desiredState === 'ON' && row.effectiveState === 'ON')
      .map(publicProfile);
  }

  async listManagedProfiles() {
    return [...this.profiles.values()]
      .filter(row => (this.positions.get(row.userId) || []).length > 0)
      .map(publicProfile);
  }

  async provisionPod({ id, userId, label, tokenHash, ownershipMode = 'INTERNAL_DEMO' }) {
    const old = this.podsByUser.get(userId);
    if (old) this.podsByToken.delete(old.tokenHash);
    const row = {
      id: old?.id || id, userId, label, ownershipMode, tokenHash,
      accountMask: null, serverMask: null,
      brokerMask: null, tradeMode: null, terminalTradeAllowed: false,
      accountTradeAllowed: false, expertTradeAllowed: false,
      demoExecutionUnlocked: false, symbolSpecs: {},
      connectorVersion: null, terminalBuild: null, lastSeenAt: null,
      createdAt: Date.now(), revokedAt: null
    };
    this.podsByUser.set(userId, row);
    this.podsByToken.set(tokenHash, row);
    return publicPod(row, true);
  }

  async createPairingSession({ id, userId, label, ownershipMode, codeHash, expiresAt, createdAt }) {
    const old = this.pairingsByUser.get(userId);
    if (old && !old.consumedAt) old.consumedAt = createdAt;
    const row = {
      id, userId, label, ownershipMode, codeHash,
      expiresAt, consumedAt: null, createdAt
    };
    this.pairingsByUser.set(userId, row);
    this.pairingsByCode.set(codeHash, row);
    return publicPairing(row);
  }

  async getActivePairingForUser(userId, now) {
    const row = this.pairingsByUser.get(userId);
    if (!row || row.consumedAt || row.expiresAt <= now) return null;
    return publicPairing(row);
  }

  async consumePairingSession(codeHash, now) {
    const row = this.pairingsByCode.get(codeHash);
    if (!row || row.consumedAt || row.expiresAt <= now) return null;
    row.consumedAt = now;
    return publicPairing(row);
  }

  async findPodByTokenHash(tokenHash) {
    return publicPod(this.podsByToken.get(tokenHash), true);
  }

  async getPodForUser(userId) { return publicPod(this.podsByUser.get(userId)); }

  async updatePodHeartbeat(podId, heartbeat, now) {
    const row = [...this.podsByUser.values()].find(item => item.id === podId && !item.revokedAt);
    if (!row) return null;
    Object.assign(row, heartbeat, { lastSeenAt: now });
    return publicPod(row);
  }

  async replacePositions(userId, positions, now) {
    this.positions.set(userId, positions.map(position => ({ ...position, updatedAt: now })));
  }

  async listPositions(userId) { return (this.positions.get(userId) || []).map(item => ({ ...item })); }

  async createCommand(command) {
    const rows = this.commands.get(command.podId) || [];
    if (command.dedupeKey) {
      const existing = rows.find(item => item.userId === command.userId && item.dedupeKey === command.dedupeKey);
      if (existing) return { created: false, command: publicCommand(existing) };
    }
    const row = { ...command, status: 'PENDING', createdAt: Date.now(), deliveredAt: null, acknowledgedAt: null, result: null };
    rows.push(row);
    this.commands.set(command.podId, rows);
    return { created: true, command: publicCommand(row) };
  }

  async hasRecentEntryCommand(userId, symbol, since) {
    for (const rows of this.commands.values()) {
      const existing = rows.find(item =>
        item.userId === userId &&
        item.type === 'PLACE_SETUP' &&
        item.payload?.symbol === symbol &&
        item.createdAt >= since &&
        !['FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(item.status)
      );
      if (existing) return true;
    }
    return false;
  }

  async cancelPendingEntryCommands(userId, reason) {
    let cancelled = 0;
    for (const rows of this.commands.values()) {
      for (const item of rows) {
        if (item.userId !== userId || !['PLACE_SETUP', 'SYSTEM_ON'].includes(item.type) ||
            item.status !== 'PENDING') continue;
        item.status = 'CANCELLED';
        item.acknowledgedAt = Date.now();
        item.result = {
          code: String(reason || 'CANCELLED').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40),
          message: 'Cancelled before broker execution'
        };
        cancelled += 1;
      }
    }
    return cancelled;
  }

  async nextCommandForPod(podId, now) {
    const rows = this.commands.get(podId) || [];
    for (const row of rows) {
      if (['PENDING', 'DELIVERED'].includes(row.status) && row.expiresAt <= now) row.status = 'EXPIRED';
    }
    const priority = {
      EMERGENCY_CLOSE_ALL: 0,
      SYSTEM_STOP: 1,
      MANAGE_POSITION: 2,
      SYSTEM_ON: 3,
      PLACE_SETUP: 4
    };
    const row = rows
      .filter(item => ['PENDING', 'DELIVERED'].includes(item.status) && item.expiresAt > now)
      .sort((left, right) =>
        (priority[left.type] ?? 5) - (priority[right.type] ?? 5) || left.createdAt - right.createdAt
      )[0];
    if (!row) return null;
    row.status = 'DELIVERED';
    row.deliveredAt = now;
    return publicCommand(row);
  }

  async ackCommand(podId, commandId, status, result) {
    const row = (this.commands.get(podId) || [])
      .find(item => item.id === commandId && ['PENDING', 'DELIVERED'].includes(item.status));
    if (!row) return null;
    row.status = status;
    row.result = result || {};
    row.acknowledgedAt = Date.now();
    return publicCommand(row);
  }

  async appendAudit(userId, eventType, detail = {}) {
    const rows = this.audit.get(userId) || [];
    rows.unshift({ id: crypto.randomUUID(), type: eventType, detail, createdAt: Date.now() });
    this.audit.set(userId, rows.slice(0, 200));
  }

  async listAudit(userId, limit = 30) {
    return (this.audit.get(userId) || []).slice(0, limit).map(item => ({ ...item }));
  }

  async close() {}
}

function createAutoTradeStore(options = {}) {
  if (options.databaseUrl) return new PostgresAutoTradeStore(options.databaseUrl);
  if (options.allowMemory) return new MemoryAutoTradeStore();
  throw new Error('DATABASE_URL is required when ZenCore Auto Trade is enabled.');
}

module.exports = {
  PostgresAutoTradeStore,
  MemoryAutoTradeStore,
  createAutoTradeStore,
  publicProfile,
  publicPod,
  publicPairing,
  publicCommand
};
