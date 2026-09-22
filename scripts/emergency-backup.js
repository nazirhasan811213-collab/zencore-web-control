#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { encryptFile, sha256File } = require('./emergency-backup-lib');

function pgEnv(databaseUrl) {
  const parsed = new URL(databaseUrl);
  return {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username || ''),
    PGPASSWORD: decodeURIComponent(parsed.password || ''),
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    PGSSLMODE: 'require'
  };
}

function requireEnv(name) {
  const value = String(process.env[name] || '');
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      env,
      windowsHide: true
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command}_EXIT_${code}`));
    });
  });
}

function safeDatabaseName(databaseUrl) {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, '')) || 'zencore';
  } catch (_) {
    return 'zencore';
  }
}

async function main() {
  const databaseUrl = requireEnv('DATABASE_URL');
  const passphrase = requireEnv('ZENCORE_BACKUP_PASSPHRASE');
  const backupDir = requireEnv('ZENCORE_BACKUP_DIR');
  if (passphrase.length < 16) throw new Error('ZENCORE_BACKUP_PASSPHRASE_MIN_16');

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const databaseName = safeDatabaseName(databaseUrl);
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zencore-backup-'));
  const rawDump = path.join(tempDir, 'database.dump');
  const encrypted = path.join(backupDir, `zencore-${databaseName}-${stamp}.dump.zcbk`);
  const manifestPath = `${encrypted}.json`;

  try {
    await fs.promises.mkdir(backupDir, { recursive: true, mode: 0o700 });
    const env = { ...process.env, ...pgEnv(databaseUrl) };
    delete env.ZENCORE_BACKUP_PASSPHRASE;
    await run('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-acl',
      '--file', rawDump
    ], env);

    await encryptFile(rawDump, encrypted, passphrase);
    const sha256 = await sha256File(encrypted);
    const manifest = {
      schemaVersion: 1,
      type: 'ZENCORE_POSTGRES_ENCRYPTED_BACKUP',
      createdAt: now.toISOString(),
      databaseName,
      encryptedFile: path.basename(encrypted),
      sha256,
      encryption: 'AES-256-GCM + scrypt',
      sourceCommit: process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || null,
      restoreRequiresExplicitConfirmation: true
    };
    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify(manifest, null, 2) + '\n',
      { mode: 0o600 }
    );
    process.stdout.write(`BACKUP_OK ${encrypted}\nMANIFEST ${manifestPath}\nSHA256 ${sha256}\n`);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`BACKUP_FAILED ${String(error?.message || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120)}\n`);
  process.exitCode = 1;
});
