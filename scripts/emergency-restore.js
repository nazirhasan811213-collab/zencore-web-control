#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { decryptFile } = require('./emergency-backup-lib');

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
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command}_EXIT_${code}`)));
  });
}

async function main() {
  const backupFile = process.argv[2];
  if (!backupFile) throw new Error('BACKUP_FILE_REQUIRED');
  if (process.env.ZENCORE_RESTORE_CONFIRM !== 'RESTORE_ZENCORE_DATABASE') {
    throw new Error('RESTORE_CONFIRMATION_REQUIRED');
  }

  const databaseUrl = requireEnv('DATABASE_URL');
  const passphrase = requireEnv('ZENCORE_BACKUP_PASSPHRASE');
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zencore-restore-'));
  const rawDump = path.join(tempDir, 'database.dump');

  try {
    await decryptFile(backupFile, rawDump, passphrase);
    const env = { ...process.env, PGDATABASE: databaseUrl };
    delete env.ZENCORE_BACKUP_PASSPHRASE;
    await run('pg_restore', [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-acl',
      '--exit-on-error',
      '--dbname', databaseUrl,
      rawDump
    ], env);
    process.stdout.write('RESTORE_OK\n');
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`RESTORE_FAILED ${String(error?.message || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120)}\n`);
  process.exitCode = 1;
});
