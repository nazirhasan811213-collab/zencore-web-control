# ZenCore Total Trade System — DEMO security and execution contract

This phase adds the Auto Trade control plane and a DEMO-only Windows Secure Pod worker. It does not place MT5 inside the existing Render process.

## Trust boundaries

1. **Render control plane**
   - Authenticates the ZenCore user.
   - Stores capital, lot, layers, allowed symbols, desired control state, masked pod identity, positions and audit events.
   - Dispatches Normal 3M SOP V32 entry commands and EXIT 32.3 StepLock management commands.
   - Rejects broker credential keys recursively.
2. **Trader-owned confidential Windows Secure Pod**
   - Runs the MetaTrader 5 terminal and `mt5-secure-pod/ZenCoreSecurePod.py`.
   - Exists in the trader's Azure subscription; the trader retains cloud ownership, Windows administrator access and encryption keys.
   - ZenCore administrators are not granted Azure RBAC, RDP, Windows admin or disk-key access.
   - Owns the enrolled terminal session.
   - Never returns the broker login, password or full server to Render.
   - Rejects a non-DEMO MT5 account.
3. **Attested key service / HSM (required before production execution)**
   - Releases machine secrets only to an approved measured worker image.
   - Is not implemented by the current Render repository and must be provisioned separately.

The current web UI intentionally contains no MT5 login, broker-password or full-server input. A malicious operator that controls both a web page and a guest operating system could capture typed credentials; therefore broker credentials are enrolled only in MT5 inside the trader-owned VM. Do not add broker credential fields to ZenCore.

## BYOC pairing contract

- The authenticated trader creates a cryptographically random `zcpair_...` code. Only its SHA-256 hash is stored.
- The code expires after 10 minutes, is single-use, and cannot replace a pod while ZenCore positions remain open.
- The Azure worker exchanges it directly at `/api/execution/pair`.
- The long-lived pod token and per-pod command verification key are returned only to that worker and protected locally by Windows user-scope DPAPI. The worker and MT5 run under the same dedicated trader-owned Windows account.
- Public user state exposes neither the pairing code, pod token, verification key nor their hashes.
- Re-pairing revokes the previous pod token and forces control state to `STOPPED`.

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

Production uses the same PostgreSQL `DATABASE_URL` as the account layer. Memory mode is test/development only:

```text
ZENCORE_AUTOTRADE_MEMORY=true
```

Never configure broker login, password or full server as a Render environment variable.

## Deployment gate

The control plane, UI and worker contract can be tested locally now. Broker execution must stay locked with `ZENCORE_DEMO_EXECUTION=false` until all of the following exist:

- trader-owned isolated Azure Windows confidential VM per account;
- direct terminal enrolment inside that trader-owned VM;
- attested secret release/vTPM;
- outbound-only private worker networking;
- InterStellar demo symbol mapping;
- three-layer and partial-close broker tests;
- restart/replay/disconnection tests;
- independent security review and audit-log review.
