# ZenCore Errante — clone preparation, 20 October 2026

This installation forks production commit `d6dc330cfdf5c1ae1c83ee71f2d01e47675d03ab`. It must be deployed from branch `clone/zencore-errante-20261020`, never by merging this branch into the original production branch.

## Completed

- Full original server/application sources are retained, with Errante page branding and a separate startup entry point.
- Separate Render PostgreSQL 18 database: `zencore-errante-db`, ID `dpg-dbbcrjm7bikc73839od0-a`, Singapore, 0.1 CPU / 256 MB RAM, 1 GB disk. Existing production and staging databases were not reused.
- Bootstrap refuses original/staging database names and known original/staging database hosts.
- Preparation mode forces automatic real/demo/local/hosted execution OFF and pauses entry signals, including scoped execution email overrides. Enabling trading requires a reviewed source change after broker validation.
- Separate Windows install/config/lock directory `%LOCALAPPDATA%\ZenCoreErrante\Connector`, common-files channel `ZenCoreErrante`, Experts folder `ZenCoreErrante`, installer AppId and startup registry entry.
- EA magic IDs: TF2 `42603231`, TF15 `42601545`. Original IDs are `32603231` / `32601545`.
- TF2/TF15 Pine, entry, risk and exit rules are inherited unchanged. This preparation does not validate live broker fills.

## Deployment remaining

The web service has not been created. The Render connector does not expose the database connection URL; do not guess credentials, copy original credentials or open external database access to work around this.

1. Open the new database's Render Dashboard and use **Connect → Internal** to configure its private connection as the new web service's `DATABASE_URL`. Do not put the URL in Git or logs.
2. Create web service `zencore-errante`, repository `nazirhasan811213-collab/zencore-web-control`, branch `clone/zencore-errante-20261020`, Singapore, plan `0.5c-512mb`, build `npm ci`, start `npm start`, health path `/ready`.
3. Set `NODE_ENV=production`, `ZENCORE_REGISTRATION_ENABLED=false`, `ZENCORE_PUBLIC_VIEWER_ENABLED=false`, and the intended administrator email. Generate fresh independent values for `ZENCORE_WEBHOOK_SECRET`, `ZENCORE_POD_PROVISIONING_SECRET`, `ZENCORE_COMMAND_SIGNING_KEY`, and any required session/signing credentials. Never copy production environment variables wholesale.
4. Verify `/ready` reports `product: ZenCore Errante`, `preparationMode: true`, database ready, autoEntry disabled and signals paused. Verify the original service remains healthy.
5. The planned connector URL is `https://zencore-errante.onrender.com`. Confirm the actual allocated URL and update source URLs if Render assigns a different hostname.
6. Confirm the exact Errante MT5 server name, symbol/suffix, contract size, tick size/value, volume limits, stop/freeze distances, filling mode and account mode using the intended terminal. Then build/test the separate Windows installer. No Errante EXE has been compiled in this preparation.
7. Use a separate broker account/terminal for acceptance testing; do not enable manual position management in both products on the same account. Test pairing, signed commands, duplicate rejection, expiry, symbol selection, open/fill confirmation, risk caps, all exit stages, reconnect and emergency close on demo before enabling live execution.

Telegram and TradingView alerts require independent configuration. No original bot credentials, webhooks, user records, sessions, open positions or queued commands have been copied.

## Capacity audit

Observed window: 19 October 2026 01:00 UTC to 20 October 2026 01:50 UTC, 30-minute samples. These are observed aggregates, not a stress test or instantaneous peak guarantee.

| Resource | Allocation | Observed usage |
|---|---|---|
| Original web service | 0.5 CPU, 512 MiB RAM, 1 instance | CPU average buckets about 1.6–3.4% of allocation; memory up to 166 MiB (~32.4%); latest ~115 MiB (~22.4%) |
| Original database | 0.1 CPU, 256 MiB RAM | CPU average buckets about 16.2–25.6%; memory about 125.5–133.4 MiB (~49–52.1%); 9–12 active connections |
| Original successful HTTP responses | p95 by sample | Up to ~127 ms; latest ~75 ms |

Three source pools are capped at 5 auth + 5 auto-trade + 3 analysis connections per instance (13 configured maxima, excluding any ancillary connection source). The current DB plan's documented connection limit is 100. Source queries use shared table names without an installation-wide tenant boundary; pointing both copies at the same database would mix user/order/control state.

**Assessment:** current observed load leaves headroom. A separate web service and separate database provide their own allocations and avoid adding Errante queries to the production database. There is no evidence yet establishing a maximum user count or reliable doubled-load capacity. Database disk utilization, slow-query behavior, query plans, lock contention, broker latency and end-to-end Errante order execution remain unverified. The original database external allowlist remains closed.

Official pricing checked 20 October 2026: web `0.5c-512mb` USD7/month and database `0.1c-256mb` USD6/month, base USD13/month for the new pair, excluding metered extras/taxes and existing workspace charges. Only the USD6/month database has been created at this stage; web charges begin when the web resource is created/running, subject to Render billing. Existing staging was preserved.

References: https://render.com/pricing , https://render.com/docs/compute-plans , https://render.com/docs/private-network .
