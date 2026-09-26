# ZenCore isolated development

Production baseline (verified 2026-09-26):
- Commit: b11805982c37fffc4f6fb13cc2b0b88a95ca9d39
- Deployment: dep-dar9c9vlot8c73euk8qg
- Service: srv-dajc6g0ae00c739d27qg, main, Singapore, 0.5c-512mb
- Database: dpg-dagv4g2jnfac73fiev3g-a, PostgreSQL 18, Free
- Code backup branch: backup/live-2026-09-26 (do not edit)
- Development branch: staging

## Status — NOT a complete production backup yet
Code is preserved in GitHub. Database export, secret/environment backup,
restore verification and GCP VM/disk snapshots remain pending authorized
Dashboard/internal access. Never describe this checkpoint as a full backup.
Production database external connections are blocked; preserve that isolation.
The attempted second Free database was rejected by Render's one-Free-database limit.
No paid resources have been created.

## Isolation
Only staging receives future edits. Do not merge into main, redeploy production,
change production environment, or migrate production data during development.
Use the separate staging database; never share production DATABASE_URL.
Start with ops/staging/start.cjs. It refuses the production database and enforces
Telegram/MT5 off. Do not copy production bot, GCP, MT5, session or signing secrets.
Do not repoint TradingView's production webhook to staging.
Seed synthetic users/test data; enable test-only ingestion separately as needed.
Staging registration is closed until a test account is provisioned securely.

## Before declaring backup complete
1. Export database with pg_dump 18 (custom format, consistent snapshot).
2. Encrypt export using scripts/emergency-backup.js; keep recovery key separately.
3. Retain encrypted configuration and any persistent files outside the live service.
4. Inventory and snapshot GCP VM disks separately (worker is paused).
5. Restore into an isolated database and verify tables/row counts and login behavior.
6. Record export timestamps, checksums, source commit and successful restore result.

## Promotion
After the user confirms all requested changes are complete: CI, staging functional
checks and migration rehearsal; take fresh database backup; review staging→main
PR; deploy production only on explicit release instruction. Roll back code to the
baseline if necessary; never restore an older database over newer user activity
without a reviewed data recovery plan.

## Proposed extra cost
Free staging web service plus separate 256 MB PostgreSQL compute USD6/month
and 1 GB storage USD0.30/month; USD6.30/month before taxes/usage. Await approval.
Free web service may sleep and does not replicate production latency.
