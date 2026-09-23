# ZenCore Managed MT5 Worker — staged security boundary

This directory contains the reviewed hosted MT5 Demo worker, the Windows release pipeline, and the multi-client Worker Manager. Connector `2.2.3-gcp-multiuser-multipair` accepts only a configured subset of the 11 canonical markets and supports 1–10 layers. Its default connection-only preflight validates an isolated MT5 slot without polling commands; broker execution still requires matching server, manager-config and local DEMO gates, an approved connector version, an assigned worker slot and all runtime safety checks.

## Implemented now

- The browser creates a random AES-256-GCM key, encrypts the MT5 login/password/server, then wraps that AES key with RSA-OAEP SHA-256.
- Render/PostgreSQL receive only the envelope, key ID and masked identity. The web application has no private key or decrypt function.
- `security_boundary.py` accepts unwrap capability only through `ExternalKeyUnwrapper`. There is deliberately no file-key or environment-key implementation.
- `gcp_kms_unwrapper.py` implements the Google Cloud adapter through the fixed Compute metadata identity and Cloud KMS REST API. It verifies request and response CRC32C values and never creates a service-account key file.
- `gcp_control_plane.py` requests a full Google-signed instance JWT, calls only the exact ZenCore HTTPS audience, rejects redirects and adds a fresh UUID/timestamp to every lease or heartbeat request.
- `hosted_worker.py` loads a strict non-secret cell assignment, leases one encrypted account, decrypts only through Cloud HSM, initializes the approved InterStellar Demo terminal, wipes the local credential buffers and reports masked telemetry plus broker symbol specifications.
- In preflight, the worker requires `executionEnabled=false`, a server-locked lease and an absent local execution gate. If the gate appears unexpectedly, the worker stops. In execution mode all three gates must agree or the worker stops.
- The worker refuses a REAL account, a changed MT5 account, an unapproved server, an unassigned cell or any pre-existing ZenCore-magic position.
- The worker stops heartbeats at lease expiry and reconnects for a fresh ciphertext lease; the control plane also rejects expired lease IDs.
- `Install-ZenCoreHostedWorker.ps1` verifies the internal release manifest and installs a SYSTEM scheduled task. The task remains disabled until both the hosted-account UUID and MT5 terminal are present.
- `Build-ZenCoreHostedWorker.ps1` runs every worker test, creates Windows executables with pinned dependencies, records both preflight and execution capability in the manifest and emits a ZIP plus SHA-256. The GitHub workflow performs the same build without Google Cloud credentials.
- Decrypted credentials are DEMO-only, short-lived and exposed to the future MT5 adapter only long enough to initialize a terminal session.
- Entry commands must contain `ZENCORE_ANALYSIS_EXECUTION_V1`; every flattened Entry/SL/TP field must exactly equal the signed Analysis snapshot.
- The worker recognizes all 11 canonical ZenCore markets. Broker symbol discovery/mapping remains a preflight requirement.
- Frozen manager and worker payloads hold exact Windows handles to their PyInstaller bootloader and manager supervisors. If a Scheduled Task stop, crash or upgrade removes a supervisor, the payload terminates fail-closed instead of surviving as an orphan.

## Required production boundary

One trader account must run in one isolated MT5 execution slot. A managed Windows host may supervise multiple isolated slots. Each selected Google Cloud host requires:

1. Windows Server Shielded VM with Secure Boot, vTPM, integrity monitoring and no public IP. Google Cloud Windows does not support Confidential VM, so this design cannot claim protection against a fully privileged project owner.
2. Attached keyless service-account identity with decrypt permission scoped to one HSM-backed RSA key.
3. No interactive operator login during normal service and no private key in Render, PostgreSQL, VM disk, source, environment variables or logs.
4. Short-lived envelope lease bound to one worker assignment, with replay protection and automatic expiry.
5. MT5 terminal image and broker-server discovery tested for every supported broker/server; no promise of “all servers” is made until this matrix passes.
6. Signed worker builds, rollback image, security monitoring and a two-person production release procedure.

Database encryption alone cannot make a centrally operated website absolutely “admin-proof”: a privileged person able to replace frontend code could attempt to capture future input. The production design therefore also needs deployment separation, signed/reviewed frontend releases, immutable audit and attested key release. The current staged build protects against database dumps and ordinary web-admin access because plaintext and the private key are absent from the web tier.

## Test

```powershell
py -3.12 -m unittest discover -s hosted-mt5-worker -p "test_*.py"
```

Passing these tests proves envelope compatibility, Google metadata/KMS request integrity, pinned control-plane transport, replay-field generation, tamper rejection, DEMO-only credential validation, secret-environment rejection and Analysis snapshot parity. It does not prove live broker execution.

## Build the Windows release without cloud resources

On a clean Windows build host with Python 3.12:

```powershell
.\Build-ZenCoreHostedWorker.ps1 -OutputDirectory .\dist
```

The output is `ZenCore_Hosted_Worker_GCP_v2.2.3-gcp-multiuser-multipair.zip` and its `.sha256` file. Building does not create a VM, HSM key, network or billing charge. The ZIP must still be reviewed and hosted at an approved HTTPS URL before its exact SHA-256 is placed in Terraform.

MetaTrader's [official Python initialize API](https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py) supports initializing a terminal with `login`, `password` and `server`. That API boundary necessarily creates short-lived Python strings even though ZenCore wipes its mutable credential buffers immediately afterward. The Demo certification must inspect the broker terminal profile and disk behavior before any claim that MT5 itself did not persist connection data.


## Multi-client worker pool

ZenCore now supports a control-plane worker pool while keeping execution isolation one-account-per-slot.

- One Windows worker host can expose multiple logical execution slots.
- Each hosted MT5 account is assigned exactly one slot before a lease can be issued.
- Slot codes are deterministic per host, for example `zencore-mt5-demo-01-s01`.
- A Google Cloud instance identity may lease only an account assigned to a slot on that same configured host.
- One slot cannot be assigned to two hosted accounts.
- If all configured slots are occupied, the account remains queued with `WAITING_FOR_SLOT`.
- Legacy single-account pinning remains supported during migration.
- The web tier still stores only the encrypted credential envelope; slot allocation does not expose MT5 plaintext credentials.

Production slot capacity is seeded by:

```text
ZENCORE_GCP_WORKER_SLOT_CAPACITY=10
```

Additional hosts are registered centrally through `ZENCORE_GCP_WORKER_FLEET_JSON`. Every entry pins project, zone, instance name, service-account email and capacity. Unknown Google instance identities remain rejected.

Phase 1 covers the central allocation and lease boundary.

## Phase 2 — Windows Worker Manager

`worker_manager.py` is the host-level supervisor for multi-client operation. It uses the Google-attested `/api/hosted-execution/assignments` route to discover **masked, non-secret** assignments for the current VM only. For each assigned slot it:

1. creates a dedicated slot directory under `C:\ProgramData\ZenCore\HostedWorker\slots\<slot-code>`,
2. materializes a clean MT5 terminal copy from an approved local template,
3. writes a non-secret child `worker-config.json` containing only slot/account IDs, filesystem paths and reviewed control-plane settings,
4. starts exactly one `ZenCoreHostedWorker.exe` child for that slot,
5. restarts a failed child without moving it to another account,
6. stops and removes the isolated slot directory when the assignment is removed or replaced.

The manager never receives the encrypted credential envelope and never receives MT5 login/password/server plaintext. Each child worker leases its own envelope directly from ZenCore and decrypts it through Cloud KMS/HSM.

The release also includes `ZenCoreHostedWorkerManager.exe` and `Install-ZenCoreWorkerManager.ps1`. Installation is fail-closed: without `-MigrateLegacyWorker`, the new Manager task is registered but disabled and the legacy worker is untouched. With `-MigrateLegacyWorker`, the legacy worker is disabled before the Manager starts.

During a controlled migration the installer stops both scheduled tasks, then terminates only `ZenCoreHostedWorker.exe` and `ZenCoreHostedWorkerManager.exe` processes whose executable paths are beneath the configured ZenCore release root. This bounded cleanup removes pre-`2.2.2` orphan processes without targeting unrelated Windows processes.

A local terminal template can be prepared from the reviewed legacy MT5 installation with:

```powershell
.\Install-ZenCoreWorkerManager.ps1 -PrepareTerminalTemplate
```

If the template already exists, the installer refuses to replace it unless `-ReplaceTerminalTemplate` is also supplied after reviewing the exact target.

The default Manager config sets `executionEnabled=false`. In this mode the local `DEMO_EXECUTION_ENABLED` file must be absent, child workers accept only a server-locked lease, report telemetry with `demoExecutionUnlocked=false`, and never poll commands. This permits slot and broker preflight without order capability.

`-EnableDemoExecution` is a separate controlled-rollout action. It is rejected unless the legacy seed config is already execution-enabled, the local execution gate exists and `EXECUTION_LOCKED` is absent. Render's server gate must independently agree before the child accepts its lease.

Before enabling multi-client DEMO execution, verify on the Windows VM that each copied terminal keeps independent account/profile state and that no broker credential persists outside its assigned slot boundary.

### Initialize diagnostics (2.2.3)

Failed MT5 initialization now reports `MT5_INITIALIZE_FAILED_<negative-code>`
when the MT5 module supplies a bounded integer error code. Vendor error text is
never logged or returned. Missing or invalid codes retain the generic failure.
An exception from initialize reports `MT5_INITIALIZE_EXCEPTION`. This release
does not change credentials, server approval, timeout, portable mode or execution
gates. Diagnose the slot assigned in the account API, not a hard-coded slot.
