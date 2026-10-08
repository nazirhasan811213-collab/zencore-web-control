# Launch readiness repairs — 8 October 2026 MYT

These changes improve readiness. They do not certify production trading or profitability.

## Implemented

- Internal analysis listeners bind to loopback. Only the authenticated public gateway should be exposed. HTTP fixtures use separate internal ports.
- Webhook ingress bounds requests to 160 KB and valid feed bursts to 120/minute. When ZENCORE_WEBHOOK_SECRET is set, JSON requires authToken and emittedAt; timestamps older than 30 seconds or more than 5 seconds ahead are rejected. authToken is removed before forwarding to analysis, storage, logs or streaming.
- Admin monitoring shows whether webhook authentication is actually enabled. With no secret, legacy compatibility remains enabled and explicitly warns; this is not secure launch mode.
- /ready checks an actual database query and a successful dispatcher heartbeat younger than 30 seconds. Failed/hung SQL is bounded. Probes coalesce and cache for one second. HTTP 503 indicates unavailable dependencies. Memory substitutes for SQL only in explicit test mode.
- Auto trade ON rejects an unready Connector/EA before checking strategy upgrade compatibility.
- Current TF2 SOP decisions now honor the existing explicit sideways/CHOP guard. Position protection and close decisions remain available.
- The standard npm test command runs with bounded concurrency so the full suite completes in this constrained environment; the verified totals below come from the complete serial run.
- Regression fixtures now use the current four-green SOP, current HEMA direction modes and XAUUSD execution scope. Historical TF10 research is not registered as a live strategy.

- Database recovery: idle-pool error handlers protect all three pools. Transient startup failures retry; configuration errors do not. No failed SQL operation or broker command is blindly retried by this helper.

## Verification

- JavaScript: 320 tests; 319 pass, 0 fail, 1 PostgreSQL integration test skipped.
- Local Connector: 27 tests; 26 pass, 1 Windows DPAPI test skipped.
- Hosted worker: 39 pass. Secure Pod: 7 pass.
- Total: 393 tests, 391 pass, 0 fail, 2 skipped.
- Local HTTP workload: 200 synthetic users, 1,600 requests at concurrency 1/20/50/100, zero request errors; highest stage p95 77.7 ms. Memory stores and execution disabled; this is not a production capacity claim.
- Eight access/ingress checks pass with the test-only secret enabled. A forged WAIT webhook returns 401 and does not enter chart state. No broker orders or Telegram messages are sent by these checks.

## Required activation and acceptance

1. Generate a private 32–128 character URL-safe secret and store it in Render as ZENCORE_WEBHOOK_SECRET. Do not publish it, place it in Git, or include it in reports.
2. Use the updated TF2 and TF15 Pine sources. Set their hidden-display admin webhook secret input to the same value. Recreate the Execution and Dashboard alert snapshots for each timeframe. Coordinate the server secret activation with alert recreation; old snapshots do not gain new inputs automatically. Do not activate the server secret alone and interrupt the feed.
3. Confirm both timeframes arrive fresh and admin webhook status reports authentication enabled. /ready must report AUTHENTICATED. Repeat a controlled invalid-payload rejection test on staging, not against a live trading feed.
4. Completed: Render health check is configured as /ready and deployed. Public readiness returned 200 with database and dispatcher READY after the database upgrade.
5. Production database dpg-dagv4g2jnfac73fiev3g-a upgraded with user approval to paid 0.1c-256mb compute ($6/month), 1 GB storage, no storage autoscaling. Status available and free expiration removed. A native logical export was requested at 00:51 UTC; export completion and restore rehearsal must be verified separately. This is not HA. The upgrade interrupted SQL connections and exposed an unhandled idle-pool error and one-shot bootstrap; the web service was redeployed and verified ready. New pool guards contain idle connection errors without logging connection objects or messages, and startup retries transient SQL failures with delays capped at 30 seconds. Permanent configuration/credential errors stay unready. Auth and auto-trade reuse their pools, completed auth bootstrap is not repeated, and dispatch starts only after successful initialization. Rotate the previously exposed database credential using a coordinated secure user handoff.
6. Database TLS certificate verification remains a deployment-specific follow-up. Render internal database certificates are self-signed; blindly enabling verification can stop connections. Confirm internal versus external routing before changing SSL options.
7. Perform Windows acceptance: install on a clean client machine, compile/load EA, inspect the specific initialization diagnostic, pair the correct client, confirm InterStellar server/account, simulate offline/reconnect and verify owner isolation. Linux protocol tests do not establish that MT5 loads successfully.
8. Perform demo-only broker acceptance with controlled entry, protection, close and disconnect/restart. Confirm independent TF2/TF15 sizing and no duplicate/opposite-direction orders. Actual MT5 executions were not performed in this repair run.
9. Configure an external outage monitor for /ready and prove alert delivery; an internal watchdog cannot alert after its own process or hosting provider goes down.
10. Sign and verify the Windows installer, rehearse restore and failover, and repeat PostgreSQL persistence/concurrency tests against a staging database. Existing single-instance deployment is not HA.

Launch remains blocked until critical activation and acceptance above are verified. No launch guarantee or profit guarantee is made.
