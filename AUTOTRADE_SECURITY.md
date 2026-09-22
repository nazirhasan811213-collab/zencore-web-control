# ZenCore Total Trade System — DEMO security and execution contract

This phase adds the hosted-MT5 control-plane foundation while keeping all broker execution outside Render. Hosted order execution remains locked.

## Trust boundaries

1. **Render control plane**
   - Authenticates the ZenCore user.
   - Stores capital, lot, layers, the server-managed pair scope, desired control state, masked pod identity, positions and audit events.
   - Dispatches Normal 3M SOP V32 entry commands and EXIT 32.3 StepLock management commands.
   - Accepts only a validated hybrid-encryption envelope for the optional hosted account flow; it has no credential private key or decrypt function.
   - Rejects plaintext broker credential keys recursively.
2. **Google Cloud managed Windows execution cell (defined; not yet provisioned)**
   - One isolated MT5 execution slot per active trader account; a registered worker fleet can provide many slots across multiple hosts.
   - Runs Windows Server 2022 as a Shielded VM with Secure Boot, vTPM, integrity monitoring, no public IP and IAP-only temporary RDP.
   - Receives a short-lived encrypted envelope lease and unwraps the AES key only through an attached keyless service account and an HSM-backed Cloud KMS asymmetric key.
   - Runs MT5 and verifies every command against `ZENCORE_ANALYSIS_EXECUTION_V1` before broker translation.
   - `hosted-mt5-worker/security_boundary.py`, `gcp_kms_unwrapper.py`, `gcp_control_plane.py`, `hosted_worker.py` and `infra/gcp-hosted-mt5/` are implemented, tested and build-locked; the billable GCP cell is not provisioned.
   - The control plane verifies a Google-signed full instance JWT against an exact registered project, zone, instance, service account and audience. Each request ID is fresh, instance-bound, time-limited and accepted once; the short replay ledger is persisted in PostgreSQL across Render restarts.
   - Google Cloud Windows does not support Confidential VM. Application admins remain outside the credential path, but the system does not claim protection from a fully privileged GCP project owner.
3. **Legacy trader-owned Windows Secure Pod (rollback)**
   - Runs the MetaTrader 5 terminal and `mt5-secure-pod/ZenCoreSecurePod.py` on the trader's secured PC for the XAUUSD Demo execution rollout, or inside a trader-owned Azure Confidential VM for future phases.
   - The trader retains host ownership, Windows administrator access and encryption keys.
   - ZenCore administrators are not granted Azure RBAC, RDP, Windows admin or disk-key access.
   - Owns the enrolled terminal session.
   - Never returns the broker login, password or full server to Render.
   - Rejects a non-DEMO MT5 account.
   - Uses outbound HTTPS only. The Azure profile additionally uses a NIC with no public IP and a trader-owned NAT Gateway.
   - Loads only a strict non-secret JSON config. Broker credential environment variables and long-lived pod-secret environment variables are rejected by preflight.
   - Pins the production control origin and rejects redirects for pairing and authenticated pod requests.
4. **Cloud KMS / HSM (defined; must be provisioned before hosted execution)**
   - Keeps the asymmetric private key non-exportable and grants decrypt only to the dedicated worker service account.
   - Uses request/response CRC32C integrity checks. Render receives only the public key and short alias.
   - Requires separation of duties because a Google Cloud project owner can change IAM or replace the Windows worker image.

The hosted popup contains MT5 login, password and server fields, but WebCrypto encrypts them before the request is created. The API receives ciphertext only. This protects database dumps and ordinary web-tier access; it does not make a centrally operated website absolutely administrator-proof because a privileged operator able to replace frontend code could attempt to capture future input. Production therefore also requires deployment separation, signed/reviewed frontend releases, immutable audit and attested key release.

## Analysis execution contract

- Analysis remains the only owner of entry and exit decisions.
- `READY` means Analysis has already completed its Normal 3M gates and Entry Line rule. Execution never infers readiness.
- The command carries `decision=ENTRY_AUTHORIZED`, `decisionOwner=ZENCORE_ANALYSIS`, schema `32.3-EXIT-STEPLOCK`, exact Entry/SL/TP1/TP2/TP3 and source time.
- The worker rejects any flattened field that differs from the embedded Analysis snapshot.
- StepLock moves, Close Separuh and remaining/full exits are accepted only as explicit Analysis position actions.

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

The hosted popup remains locked unless all three values are deliberately configured:

```text
ZENCORE_HOSTED_MT5_ENABLED=false
ZENCORE_GCP_HOSTED_WORKER_ENABLED=false
ZENCORE_GCP_WORKER_FLEET_JSON=[{"projectId":"...","zone":"...","instanceName":"...","serviceAccountEmail":"...","capacity":10}]
ZENCORE_MT5_CREDENTIAL_KEY_ID=<external HSM RSA key version>
ZENCORE_MT5_CREDENTIAL_PUBLIC_KEY=<public RSA key only>
```

`ZENCORE_MT5_CREDENTIAL_PUBLIC_KEY` is public material. The matching private key must never be present in Render, PostgreSQL, repository files or Windows disk.

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

Live-money execution remains locked. The legacy worker stays XAUUSD/InterStellar Demo only. Hosted connector `2.2.1-gcp-multiuser-multipair` accepts a reviewed subset of the 11 canonical symbols and 1–10 layers. Its default connection-only preflight requires both the manager and child config to declare execution disabled and rejects a present local execution gate; it leases only a server-locked envelope, reports telemetry and never polls commands. Order execution remains unavailable until the server gate, manager config and local gate are all explicitly changed together and the HSM, network, broker and independent security checks pass.

The legacy `2.0.0-gcp-connect` worker is connection-only and remains the rollback path. Connector `2.2.1-gcp-multiuser-multipair` can replace it first in connection-only preflight, where a present local execution gate is treated as a fatal configuration mismatch. Its guarded Demo order adapter stays inert unless the reviewed server rollout gate, execution-enabled manager config, pinned artifact, local execution gate, assigned slot and runtime checks all pass. REAL accounts remain blocked.
