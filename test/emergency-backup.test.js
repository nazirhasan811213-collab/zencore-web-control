const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { encryptFile, decryptFile, MAGIC } = require('../scripts/emergency-backup-lib');

test('emergency backup encryption round-trips and rejects the wrong passphrase', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zencore-backup-test-'));
  const source = path.join(root, 'source.dump');
  const encrypted = path.join(root, 'backup.dump.zcbk');
  const restored = path.join(root, 'restored.dump');
  const wrong = path.join(root, 'wrong.dump');
  try {
    const content = Buffer.from('ZenCore emergency database backup test\n'.repeat(2048));
    await fs.promises.writeFile(source, content);
    await encryptFile(source, encrypted, 'ThisIsAStrongBackupPassphrase2026!');
    const header = await fs.promises.readFile(encrypted);
    assert.equal(header.subarray(0, MAGIC.length).equals(MAGIC), true);
    assert.equal(header.includes(Buffer.from('ZenCore emergency database backup test')), false);

    await decryptFile(encrypted, restored, 'ThisIsAStrongBackupPassphrase2026!');
    assert.deepEqual(await fs.promises.readFile(restored), content);

    await assert.rejects(
      () => decryptFile(encrypted, wrong, 'WrongBackupPassphrase2026!'),
      /BACKUP_AUTHENTICATION_FAILED/
    );
    assert.equal(fs.existsSync(wrong), false);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
