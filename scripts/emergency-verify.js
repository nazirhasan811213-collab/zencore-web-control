#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { decryptFile, sha256File } = require('./emergency-backup-lib');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`${command}_EXIT_${code}`)));
  });
}

async function main() {
  const backupFile = process.argv[2];
  const passphrase = String(process.env.ZENCORE_BACKUP_PASSPHRASE || '');
  if (!backupFile) throw new Error('BACKUP_FILE_REQUIRED');
  if (!passphrase) throw new Error('ZENCORE_BACKUP_PASSPHRASE_REQUIRED');

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zencore-verify-'));
  const rawDump = path.join(tempDir, 'database.dump');
  try {
    await decryptFile(backupFile, rawDump, passphrase);
    const list = await run('pg_restore', ['--list', rawDump]);
    if (!/TABLE|SCHEMA|SEQUENCE/i.test(list)) throw new Error('BACKUP_CONTENT_EMPTY');
    const sha256 = await sha256File(backupFile);
    process.stdout.write(`VERIFY_OK ${path.basename(backupFile)}\nSHA256 ${sha256}\n`);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`VERIFY_FAILED ${String(error?.message || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120)}\n`);
  process.exitCode = 1;
});
