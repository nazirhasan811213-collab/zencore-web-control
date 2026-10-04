# ZenCore EA + Local Connector — phase 1 DEMO

## Client setup

1. Open `ZenCoreConnector.exe` as the same ordinary Windows user that runs MT5. No Administrator shell is required.
2. Login to the broker in the **MT5 desktop terminal**. In MT5 choose **File → Open Data Folder**. Select that folder in the Connector, then click **Pasang EA**. The Connector copies EA source and compiles it with the terminal's MetaEditor. No Python installation is needed for the packaged executable.
3. In MT5 Navigator choose **Refresh**, open **Expert Advisors → ZenCore → ZenCoreExecutor**, attach it to **one chart only**, and enable **Algo Trading**. Leave DLL imports and WebRequest disabled.
4. Click **Cari akaun MT5**, select your DEMO account, and login with your **ZenCore** email/password. Click **Login & pautkan akaun**. No broker password, API key, webhook or pairing code is requested.
5. Open the ZenCore web page, choose approved pairs, capital, lot/layer and layers, save settings, then confirm **AKTIFKAN DEMO**. Confirm the web shows **ON** and the EA shows **ARMED** before relying on execution.

One EA handles all approved pairs. Unambiguous broker suffixes are detected automatically; an ambiguous symbol remains unavailable. Phase 1 never accepts a REAL account. Supported analysis contracts currently cover the nine FX/gold pairs in the source contract; BTCUSD and US30 are not silently added. The server's broker validation rollout decides which are executable.

## Moving from the existing hosted worker

Turn OFF first, finish existing ZenCore positions, close the old worker/Connector, then wait at least two minutes. Pairing is refused while another engine's heartbeat is fresh or ZenCore positions are recorded open. The web routes this user to the EA transport after pairing, rejects old hosted heartbeat/commands for that user and leaves other users unchanged. Never keep an independently modified old trading engine running. Migration of unresolved/open positions is deliberately not automatic.

## How it works

The Connector makes outbound HTTPS to the existing ZenCore execution API. It verifies the pod-bound HMAC signed command envelope, copies the exact Analysis-authorized prices/actions and writes a local TSV mailbox in MT5's `Common/Files/ZenCore/<account>-<server-hash>`. The EA performs synchronous broker operations, persists a command intent before execution, and writes an acknowledgement and position heartbeat locally. The Connector forwards those results to ZenCore.

The machine token and verification key are generated automatically and encrypted using Windows user DPAPI. The client never handles them. Login cookies stay in memory. The broker account and server are used locally to bind the mailbox; only masked identities and trade telemetry go to the web. Passwords and tokens are not logged. DPAPI is not protection against an administrator controlling the same Windows user session.

The app installs itself into the current user's LocalAppData and registers startup for that user after setup. It requires an interactive Windows session; it is not a SYSTEM service. Closing its window stops the Connector after a confirmation. The PC/VM must remain awake, connected and logged into that user, with MT5 and Connector running. The EA restores its armed configuration after restart, but entry still requires a fresh server ON lease and current DEMO account permissions.

## Entry and exits

- Analysis is authoritative: `NORMAL_3M_SOP_V32`, contract `ZENCORE_ANALYSIS_EXECUTION_V1`, exit schema `32.3-EXIT-STEPLOCK`.
- Entry uses configured lot and layers, with initial broker SL. Invalid broker volume is rejected instead of increasing client exposure by rounding.
- TP3 is a StepLock level, not an automatically placed broker take-profit.
- The EA applies the exact MOVE_SL / CLOSE_PERCENT actions supplied by Analysis. It does **not** infer a TP hit, yellow reversal or generate a substitute signal itself.
- SL changes tighten protection only; MOVE_SL_ENTRY uses the actual position entry.
- Close 50% runs once per position identifier. For 3 × 0.01 and lot step 0.01, it closes 0.02 and leaves 0.01. If a partial close is impossible without eliminating the runner it reports failure.
- Only the fixed ZenCore magic number is managed. Manual and other-EA trades are not targeted. A netting symbol must not be shared with manual trades or another EA because the broker combines them into one position; conflicting positions prevent initial entry.
- Partial broker execution or crashes can leave some layers open. The command is reported failed/uncertain, is not automatically replayed, and the actual positions are reconciled by heartbeat. Do not interpret FAILED as proof of zero broker fills.
- An OFF request blocks new dispatch and cancels queued server entries. A command already in flight may complete before the local ON lease is refreshed; the lease lasts at most 12 seconds. OFF is not a close-all command.

## Connection loss

New entry requires a local server lease no older than 12 seconds. An offline Connector/EA is shown offline by the server. Broker-side accepted SL remains active. **New Analysis-based close and StepLock actions cannot arrive while the Connector/network is down.** This version does not promise full offline exit management. Queued, unexpired management actions already received can execute. Keep the computer online.

The local folder must be writable only by the paired Windows user and trusted system administrators. Another process controlling that user's account can alter local files; local mailboxes are not a security boundary against same-user malware.

## Build and validation status

The repository includes the EA `.mq5` source, desktop Connector source, server integration and tests. `.github/workflows/ea-connector-build.yml` builds a self-contained Windows EXE using PyInstaller. The installer compiles the EA on the client using the installed MetaEditor; it refuses to report installation successful unless a new `.ex5` exists.

Automated transport and backend tests are not a broker execution certification. Before enabling accounts, perform a Windows MetaEditor compile and DEMO acceptance test: one genuine authorized Analysis signal, broker order/SL confirmation, each supported exit action, restart/replay, OFF, network loss, and account switch. Never enable REAL trading from this phase-1 artifact.

## Server rollout

Deploy the branch's `auto-trade-service.js`, `auto-trade-core.js`, `server-analysis.js`, `auto-trade.html` and `auto-trade.js` together. Existing PostgreSQL tables accept the new ownership mode; no broker credential migration is needed. Existing `ZENCORE_AUTOTRADE_EXECUTION_ENABLED` and approved symbol configuration remain authoritative (see the exact environment names in server initialization). This work does not silently unlock a production execution gate.

## Validation record — 2026-10-01

- Eight local transport/Connector tests passed on Linux; Windows DPAPI roundtrip test is included but skipped here because it requires Windows.
- Eight new service/HTTP tests passed, including actual login/session/origin protection, automatic pairing, signed Analysis entry, duplicate suppression, OFF, Analysis close and rejection of retired hosted commands.
- Full Node suite at base commit `024dc03`: 13 existing failures. The changed branch had the same 13 failure names, with no newly introduced failure names. The failing baseline covers existing Analysis/SOP fixtures and old 11-pair expectations. It is not a green production acceptance run.
- EA has not yet been compiled by MetaEditor or tested against a broker in this workspace. Windows EXE has not yet been built.
- Remote push/build was blocked by automatic approval review: publication to the GitHub remote requires explicit authorization. No branch was published, no production service was changed and no account was activated.


## TF2 rule upgrade 1.1

Package carries EA source 1.10. Stop new entries, update Connector, use Pasang EA to compile with MetaEditor, reload EA on one chart, then save TF2 web settings. Verify new EX5 and DEMO heartbeat 1.1. Hosted Python worker does not support this preset. Windows compilation and installation cannot be verified from this Linux workspace.


## TF2 / TF15 / Both release
Connector 1.2 + EA source 1.20. Entry pairs: XAUUSD, GBPUSD, GBPJPY. Web selects TF2 Scalping, TF15 Intra, or Both. TF15 uses SOLID TF15 and confirmed HEMA TF45, exactly two layers. Both keeps one active setup per pair; management is scoped by broker magic to the owning strategy.

Install EA using the Connector button (MetaEditor compilation), reload the EA on a chart, then verify the web reports Connector 1.2 before enabling TF15/Both. Install the corresponding realtime feed script on a TradingView TF2 and/or TF15 chart and create an Any alert() function call alert to the existing ZenCore webhook; old alerts retain the old script snapshot and must be recreated. Never expose webhook secrets. Pine source must compile and its actual alert must be verified in TradingView.

The Windows CI compiles the Python Connector executable and tests the packaged EXE. It does not compile MQ5 or Pine, or place broker trades.
