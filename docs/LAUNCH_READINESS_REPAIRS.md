# Launch readiness repairs — 8 October 2026 MYT

These changes improve readiness. They do not certify production trading or profitability.

## Implemented

- Internal analysis listeners bind to loopback. Only the authenticated public gateway should be exposed. HTTP fixtures use separate internal ports.
- Webhook ingress bounds requests to 160 KB and valid feed bursts to 120/minute. When ZENCORE_WEBHOOK_SECRET is set, JSON requires authToken and emittedAt; timestamps older than 30 seconds or more than 5 seconds ahead are rejected. authToken is removed before forwarding to analysis, storage, logs or streaming.
- Admin monitoring shows whether webhook authentication is actually enabled. With no secret, legacy compatibility remains enabled and explicitly warns; this is not secure launch mode.
- /ready checks an actual database query and a successful dispatcher heartbeat younger than 30 seconds. Failed/hung SQL is bounded. Probes coalesce and cache for one second. HTTP 503 indicates unavailable dependencies. Memory substitutes for SQL only in explicit test mode.
- Auto trade ON rejects an unready Connector/EA before checking strategy upgrade compatibility.
- Current TF2 SOP decisions now honor the existing explicit sideways/CHOP guard. Position protection and close decisions remain available.
- Regression fixtures now use the current four-green SOP, current HEMA direction modes and XAUUSD execution scope. Historical TF10 research is not registered as a live strategy.

## Verification

- JavaScript: 317 tests; 316 pass, 0 fail, 1 PostgreSQL integration test skipped.
- Local Connector: 27 tests; 26 pass, 1 Windows DPAPI test skipped.
- Hosted worker: 39 pass. Secure Pod: 7 pass.
- Total: 390 tests, 388 pass, 0 fail, 2 skipped.
- Local HTTP workload: 200 synthetic users, 1,600 requests at concurrency 1/20/50/100, zero request errors; highest stage p95 77.7 ms. Memory stores and execution disabled; this is not a production capacity claim.
- Eight access/ingress checks pass with the test-only secret enabled. A forged WAIT webhook returns 401 and does not enter chart state. No broker orders or Telegram messages are sent by these checks.

## Required activation and acceptance

1. Generate a private 32–128 character URL-safe secret and store it in Render as ZENCORE_WEBHOOK_SECRET. Do not publish it, place it in Git, or include it in reports.
2. Use the updated TF2 and TF15 Pine sources. Set their hidden-display admin webhook secret input to the same value. Recreate the Execution and Dashboard alert snapshots for each timeframe. Coordinate the server secret activation with alert recreation; old snapshots do not gain new inputs automatically. Do not activate the server secret alone and interrupt the feed.
3. Confirm both timeframes arrive fresh and admin webhook status reports authentication enabled. /ready must report AUTHENTICATED. Repeat a controlled invalid-payload rejection test on staging, not against a live trading feed.
4. Set the existing Render service health check path to /ready in its dashboard. Publishing an endpoint alone does not configure Render's health checks. A live code deployment does not mean this setting is complete.
5. Identify the exact production database before migration. The free database dpg-dagv4g2jnfac73fiev3g-a is scheduled to expire 9 October 2026 23:56:48 UTC (10 October 07:56:48 MYT). Do not assume a similarly named staging database is production. Upgrade/migrate with a verified backup and restore rehearsal before expiration, after confirming cost and target.
6. Database TLS certificate verification remains a deployment-specific follow-up. Render internal database certificates are self-signed; blindly enabling verification can stop connections. Confirm internal versus external routing before changing SSL options.
7. Perform Windows acceptance: install on a clean client machine, compile/load EA, inspect the specific initialization diagnostic, pair the correct client, confirm InterStellar server/account, simulate offline/reconnect and verify owner isolation. Linux protocol tests do not establish that MT5 loads successfully.
8. Perform demo-only broker acceptance with controlled entry, protection, close and disconnect/restart. Confirm independent TF2/TF15 sizing and no duplicate/opposite-direction orders. Actual MT5 executions were not performed in this repair run.
9. Configure an external outage monitor for /ready and prove alert delivery; an internal watchdog cannot alert after its own process or hosting provider goes down.
10. Sign and verify the Windows installer, rehearse restore and failover, and repeat PostgreSQL persistence/concurrency tests against a staging database. Existing single-instance deployment is not HA.

Launch remains blocked until critical activation and acceptance above are verified. No launch guarantee or profit guarantee is made.
