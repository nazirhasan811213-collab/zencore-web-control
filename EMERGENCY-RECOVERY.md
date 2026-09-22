# ZenCore Emergency Recovery

This repository contains the recovery procedure for the ZenCore production control system.

## Recovery layers

1. **Code snapshot** — keep an immutable emergency branch pinned to a known-good production commit.
2. **Database backup** — run `scripts/emergency-backup.js` against PostgreSQL and store the resulting encrypted `.zcbk` file **off the application server**.
3. **Backup verification** — run `scripts/emergency-verify.js <backup.zcbk>` after every backup.
4. **Restore** — only during a real recovery, run `scripts/emergency-restore.js <backup.zcbk>` with an explicit restore confirmation.
5. **MT5 worker recovery** — rebuild Windows Worker Manager from the reviewed GitHub release and reconnect only after the web control plane and database are healthy.

## Required environment variables for backup

- `DATABASE_URL` — source PostgreSQL connection string.
- `ZENCORE_BACKUP_PASSPHRASE` — at least 16 characters. Never commit it to GitHub.
- `ZENCORE_BACKUP_DIR` — secure **off-host** destination mounted on the machine running the backup.

The backup script never writes the database password into the backup file or manifest. The PostgreSQL dump is encrypted using AES-256-GCM with a key derived by scrypt.

## Create a backup

```bash
export DATABASE_URL='postgresql://...'
export ZENCORE_BACKUP_PASSPHRASE='use-a-long-private-passphrase'
export ZENCORE_BACKUP_DIR='/secure/offsite/zencore'
node scripts/emergency-backup.js
```

Store both the `.dump.zcbk` and matching `.json` manifest offsite. Do **not** keep the only copy on Render's ephemeral filesystem.

## Verify a backup

```bash
export ZENCORE_BACKUP_PASSPHRASE='same-passphrase'
node scripts/emergency-verify.js /secure/offsite/zencore/<backup>.dump.zcbk
```

A backup is not considered valid until verification returns `VERIFY_OK`.

## Restore

Restore is destructive. Use a new/replacement PostgreSQL instance when possible, validate it, then point ZenCore to the restored database.

```bash
export DATABASE_URL='postgresql://replacement-database'
export ZENCORE_BACKUP_PASSPHRASE='same-passphrase'
export ZENCORE_RESTORE_CONFIRM='RESTORE_ZENCORE_DATABASE'
node scripts/emergency-restore.js /secure/offsite/zencore/<backup>.dump.zcbk
```

After restore:

- start ZenCore with Auto Trade execution still locked;
- verify Admin/IB/Client authentication;
- verify client ownership and MT5 account mapping;
- verify worker-host/slot registry;
- verify Market Radar / Analysis / Results;
- only then resume controlled DEMO worker rollout.

## Production emergency rule

If the system is damaged or data integrity is uncertain, **do not unlock Auto Trade during recovery**. Recover the web control plane and database first, confirm account/worker mappings, and only then continue the normal controlled execution rollout.

## Current production references

- Web service: `zencore-precision-entry`
- Render service ID: `srv-dajc6g0ae00c739d27qg`
- Render PostgreSQL ID: `dpg-dagv4g2jnfac73fiev3g-a`
- GCP project: `zencore-total-trade-system`
- Primary Windows worker host: `zencore-mt5-demo-01`

Do not commit passwords, database URLs, broker credentials, MT5 credentials, private keys, backup passphrases, or credential envelopes to this repository.
