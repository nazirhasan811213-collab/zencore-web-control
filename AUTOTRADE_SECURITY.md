# ZenCore Total Trade System — DEMO security and execution contract

This phase adds the Auto Trade control plane and a DEMO-only Windows Secure Pod worker. It does not place MT5 inside the existing Render process.

## Trust boundaries

1. **Render control plane**
   - Authenticates the ZenCore user.
   - Stores capital, lot, layers, allowed symbols, desired control state, masked pod identity, positions and audit events.
   - Dispatches Normal 3M SOP V32 entry commands and EXIT 32.3 StepLock management commands.
   - Rejects broker credential keys recursively.
2. **Trader-owned Windows Secure Pod**
   - Runs the MetaTrader 5 terminal and `mt5-secure-pod/ZenCoreSecurePod.py` on the trader's secured PC for the XAUUSD Demo execution rollout, or inside a trader-owned Azure Confidential VM for future phases.
   - The trader retains host ownership, Windows administrator access and encryption keys.
   - ZenCore administrators are not granted Azure RBAC, RDP, Windows admin or disk-key access.
   - Owns the enrolled terminal session.
   - Never returns the broker login, password or full server to Render.
   - Rejects a non-DEMO MT5 account.
   - Uses outbound HTTPS only. The Azure profile additionally uses a NIC with no public IP and a trader-owned NAT Gateway.
   - Loads only a strict non-secret JSON config. Broker credential environment variables and long-lived pod-secret environment variables are rejected by preflight.
   - Pins the production control origin and rejects redirects for pairing and authenticated pod requests.
3. **Attested key service / HSM (required before production execution)**
   - Releases machine secrets only to an approved measured worker image.
   - Is not implemented by the current Render repository and must be provisioned separately.

The current web UI intentionally contains no MT5 login, broker-password or full-server input. A malicious operator that controls both a web page and a guest operating system could capture typed credentials; therefore broker credentials are enrolled only in MT5 inside the trader-owned VM. Do not add broker credential fields to ZenCore.

## BYOC pairing contract

- The authenticated trader creates a cryptographically random `zcpair_...` code. Only its SHA-256 hash is stored.
- The code expires after 10 minutes, is single-use, and cannot replace a pod while ZenCore positions remain open.
- The Azure worker exchanges it directly at `/api/execution/pair`.
- The long-lived pod token and per-pod command verification key are returned only to that worker and protected locally by Windows user-scope DPAPI. The worker and MT5 run under the same dedicated trader-owned Windows account. Pairing input is hidden and is not passed through the command line or environment.
- Public user state exposes neither the pairing code, pod token, verification key nor their hashes.
- Re-pairing revokes the previous pod token and forces control state to `STOPPED`.
- Pairing is bound to the selected host type. A Windows-PC code cannot be consumed by an Azure-profile worker or vice versa.

## User controls

| Control | Control-plane action | Secure Pod action |
|---|---|---|
| ON | Desired state becomes `ON`; UI shows `ARMING` | Verify DEMO terminal, acknowledge, then allow new entries |
| STOP | New entries are blocked immediately; UI shows `STOPPING` | Disarm new entries while continuing local position management |
| Emergency Close All | Requires current ZenCore password and exact phrase `TUTUP SEMUA` | Disarm and attempt to close every ZenCore position |

The UI never reports `ON` or `STOPPED` merely because a button was clicked. Effective state changes only after the worker acknowledges the signed command.

## Risk policy

- Capital, lot and layer validation prevents malformed or technically invalid values.
- Risk is calculated from Entry/SL plus the broker tick size and tick value reported by the Secure Pod.
- More than 1% is `CAUTION`; more than 2% is `HIGH`.
- `HIGH` is warning-only and has `blocksOrder=false`.
- A trader must acknowledge risk before the configuration can be saved.
- Authentication failure, invalid command signature, expired command, duplicate command, non-DEMO account, offline pod or disabled Algo Trading are technical/security failures and may block execution.

## Execution commands

- `SYSTEM_ON`
- `SYSTEM_STOP`
- `PLACE_SETUP`
- `MANAGE_POSITION`
- `EMERGENCY_CLOSE_ALL`

Every command has a UUID, creation time, expiry, signature and signed envelope. The control plane derives a separate HMAC verification key for each pod from its server-side master key; the master key is never sent to a trader VM. Setup and management commands also have a per-user deduplication key. The worker maintains an encrypted-disk SQLite ledger to avoid replaying a broker action if an acknowledgement is lost.

`MANAGE_POSITION` carries only explicit actions derived from the existing feed:

- `MOVE_SL_ENTRY`
- `MOVE_SL_TP1`
- `MOVE_SL_TP2`
- `CLOSE_PERCENT 50` for Close Separuh
- `CLOSE_PERCENT 100` for remaining/full exits

## Environment flags

Auto Trade is disabled by default. The control plane requires:

```text
ZENCORE_AUTOTRADE_ENABLED=true
ZENCORE_COMMAND_SIGNING_KEY=<minimum 32 random bytes>
ZENCORE_POD_PROVISIONING_SECRET=<minimum 32 random bytes>
```

Installation, pairing and preflight keep the independent server execution gate disabled:

```text
ZENCORE_AUTOTRADE_EXECUTION_ENABLED=false
```

The ON command and new setup dispatch require both this server gate and the worker build/config gate. Changing the trader PC alone cannot unlock the control plane.

Production uses the same PostgreSQL `DATABASE_URL` as the account layer. Memory mode is test/development only:

```text
ZENCORE_AUTOTRADE_MEMORY=true
```

Never configure broker login, password or full server as a Render environment variable.

## Deployment gate

Release `1.4.0-demo-execution` opens a deliberately narrow broker-test lane:

- trader-owned Windows PC only;
- MetaTrader account type must be DEMO;
- normalized server identity must equal `InterStellarFinancial-Demo`;
- XAUUSD only;
- reviewed connector version must match the control-plane requirement;
- local `demoExecutionEnabled=true` and server `ZENCORE_AUTOTRADE_EXECUTION_ENABLED=true` are both required;
- a user must save risk settings and explicitly type `AKTIFKAN DEMO`;
- STOP cancels queued entries and disarms the worker from the next heartbeat;
- the local SQLite ledger claims a command before broker execution to block crash/retry duplication;
- 3 × 0.01 partial close is rounded to 0.02, leaving one 0.01 runner when the broker volume step is 0.01.

Live-money execution, non-XAUUSD symbols and administrator-hosted shared execution remain locked. A trader-owned Azure Confidential VM, attested secret release, outbound-only private networking, broader broker tests and an independent security review remain prerequisites for any future live-account release. The infrastructure foundation remains in `infra/azure-trader-pod`.
