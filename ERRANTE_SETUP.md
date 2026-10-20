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

## Current deployment — Free installation

- Web: `zencore-errante`, ID `srv-dbbdp8gm7kps73ekdpt0`, Singapore, **Free** 0.1 CPU / 512 MB RAM. URL: https://zencore-errante.onrender.com/ .
- Database used by the web: `zencore-errante-free-db`, ID `dpg-dbbdomfavr4c73dgmcc0-a`, database `zencore_errante_free_db`, PostgreSQL 18, Free. External access remains closed; private connection stored only in Render environment.
- Database expiry shown by Render: **19 November 2026**. Render Free PostgreSQL expires after 30 days, then has a 14-day upgrade grace period before deletion. Do not use this installation for durable production trading.
- Earlier paid `zencore-errante-db` is **manually suspended**. Render confirms suspended services are not billed. Any prorated charge incurred before suspension is not retroactively removed.
- Both new active resources have USD0 base monthly compute cost, subject to workspace bandwidth/build quotas and metered extras. Do not enable paid upgrades or exceed included quotas to assume zero total bill.
- Build `npm ci`, start `npm start`, health `/ready`, `SITE_MODE=precision-entry`. Independent webhook, provisioning and command-signing secrets generated; no original secrets copied.
- Source bootstrap locks the master auto-trade flag and all real/demo/local/hosted execution OFF. Signals are paused. Authentication uses only the separate Free database. Registration and public viewer are disabled.
- Fresh database contains no original users/accounts. Administrator provisioning, Telegram, TradingView feeds, Errante MT5 acceptance testing and Windows installer compilation are still pending. Original login credentials do not automatically work on this independent installation.
- The earlier paid-database details in the preparation history above describe the unused suspended resource, not the current connection.

Free web sleeps after 15 minutes without traffic, may take about a minute to wake and can restart. Do not add artificial keep-alive traffic as a substitute for a production compute plan.

Before trading, confirm exact Errante server, symbol suffix, contract size, tick size/value, volume/stop/freeze limits, filling/account mode; build the distinct connector; test signed command delivery, expiry/duplicates, confirmed fills, risk caps, all exits and reconnect on demo. Use a separate terminal/account; do not enable manual position management in both products on the same account. No live order test has been performed.

## Capacity audit

Observed window: 19 October 2026 01:00 UTC to 20 October 2026 01:50 UTC, 30-minute samples. These are observed aggregates, not a stress test or instantaneous peak guarantee.

| Resource | Allocation | Observed usage |
|---|---|---|
| Original web service | 0.5 CPU, 512 MiB RAM, 1 instance | CPU average buckets about 1.6–3.4% of allocation; memory up to 166 MiB (~32.4%); latest ~115 MiB (~22.4%) |
| Original database | 0.1 CPU, 256 MiB RAM | CPU average buckets about 16.2–25.6%; memory about 125.5–133.4 MiB (~49–52.1%); 9–12 active connections |
| Original successful HTTP responses | p95 by sample | Up to ~127 ms; latest ~75 ms |

Three source pools are capped at 5 auth + 5 auto-trade + 3 analysis connections per instance (13 configured maxima, excluding any ancillary connection source). The current DB plan's documented connection limit is 100. Source queries use shared table names without an installation-wide tenant boundary; pointing both copies at the same database would mix user/order/control state.

**Assessment:** current observed load leaves headroom. A separate web service and separate database provide their own allocations and avoid adding Errante queries to the production database. There is no evidence yet establishing a maximum user count or reliable doubled-load capacity. Database disk utilization, slow-query behavior, query plans, lock contention, broker latency and end-to-end Errante order execution remain unverified. The original database external allowlist remains closed.

Historical paid-plan estimate (not the chosen Free deployment), checked 20 October 2026: web `0.5c-512mb` USD7/month and database `0.1c-256mb` USD6/month, base USD13/month for the new pair, excluding metered extras/taxes and existing workspace charges. The paid database was subsequently suspended and the actual web/database deployment uses Free plans. Existing production and staging were preserved.

References: https://render.com/pricing , https://render.com/docs/compute-plans , https://render.com/docs/private-network .
