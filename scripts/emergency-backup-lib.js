'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const MAGIC = Buffer.from('ZCBK1', 'ascii');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(String(passphrase), salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
}

async function encryptFile(inputPath, outputPath, passphrase) {
  if (!passphrase || String(passphrase).length < 16) {
    throw new Error('BACKUP_PASSPHRASE_TOO_SHORT');
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(outputPath, Buffer.concat([MAGIC, salt, iv]), { mode: 0o600 });

  const source = fs.createReadStream(inputPath);
  const target = fs.createWriteStream(outputPath, { flags: 'a', mode: 0o600 });
  await pipeline(source, cipher, target);
  const tag = cipher.getAuthTag();
  await fs.promises.appendFile(outputPath, tag);
}

async function decryptFile(inputPath, outputPath, passphrase) {
  if (!passphrase) throw new Error('BACKUP_PASSPHRASE_REQUIRED');
  const stat = await fs.promises.stat(inputPath);
  if (stat.size <= HEADER_BYTES + TAG_BYTES) throw new Error('BACKUP_FILE_INVALID');

  const fd = await fs.promises.open(inputPath, 'r');
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    await fd.read(header, 0, HEADER_BYTES, 0);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('BACKUP_MAGIC_INVALID');
    }
    const saltStart = MAGIC.length;
    const salt = header.subarray(saltStart, saltStart + SALT_BYTES);
    const iv = header.subarray(saltStart + SALT_BYTES, HEADER_BYTES);
    const tag = Buffer.alloc(TAG_BYTES);
    await fd.read(tag, 0, TAG_BYTES, stat.size - TAG_BYTES);

    const key = deriveKey(passphrase, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    const source = fs.createReadStream(inputPath, {
      start: HEADER_BYTES,
      end: stat.size - TAG_BYTES - 1
    });
    const target = fs.createWriteStream(outputPath, { mode: 0o600 });
    await pipeline(source, decipher, target);
  } catch (error) {
    await fs.promises.rm(outputPath, { force: true }).catch(() => {});
    if (String(error?.message || '').includes('authenticate data')) {
      throw new Error('BACKUP_AUTHENTICATION_FAILED');
    }
    throw error;
  } finally {
    await fd.close();
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

module.exports = {
  MAGIC,
  encryptFile,
  decryptFile,
  sha256File
};
