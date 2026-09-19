# ZenCore Managed MT5 Worker — staged security boundary

This directory contains the complete connection-only hosted worker and Windows release pipeline. It does **not** place orders in this release. `HOSTED_DEMO_ORDER_EXECUTION_BUILD_UNLOCKED` is hard-coded to `False`, and `MetaTraderConnection` exposes connection/telemetry methods only—there is no `order_send` path.

## Implemented now

- The browser creates a random AES-256-GCM key, encrypts the MT5 login/password/server, then wraps that AES key with RSA-OAEP SHA-256.
- Render/PostgreSQL receive only the envelope, key ID and masked identity. The web application has no private key or decrypt function.
- `security_boundary.py` accepts unwrap capability only through `ExternalKeyUnwrapper`. There is deliberately no file-key or environment-key implementation.
- `gcp_kms_unwrapper.py` implements the Google Cloud adapter through the fixed Compute metadata identity and Cloud KMS REST API. It verifies request and response CRC32C values and never creates a service-account key file.
- `gcp_control_plane.py` requests a full Google-signed instance JWT, calls only the exact ZenCore HTTPS audience, rejects redirects and adds a fresh UUID/timestamp to every lease or heartbeat request.
- `hosted_worker.py` loads a strict non-secret cell assignment, leases one encrypted account, decrypts only through Cloud HSM, initializes the approved InterStellar Demo terminal, wipes the local credential buffers and reports masked telemetry plus broker symbol specifications.
- The worker refuses a missing execution-lock file, a REAL account, a changed MT5 account, an unapproved server, an unassigned cell, an unlocked lease or any pre-existing ZenCore-magic position.
- The worker stops heartbeats at lease expiry and reconnects for a fresh ciphertext lease; the control plane also rejects expired lease IDs.
- `Install-ZenCoreHostedWorker.ps1` verifies the internal release manifest and installs a SYSTEM scheduled task. The task remains disabled until both the hosted-account UUID and MT5 terminal are present.
- `Build-ZenCoreHostedWorker.ps1` runs every worker test, creates a Windows executable with pinned dependencies, writes an execution-locked manifest and emits a ZIP plus SHA-256. The GitHub workflow performs the same build without Google Cloud credentials.
- Decrypted credentials are DEMO-only, short-lived and exposed to the future MT5 adapter only long enough to initialize a terminal session.
- Entry commands must contain `ZENCORE_ANALYSIS_EXECUTION_V1`; every flattened Entry/SL/TP field must exactly equal the signed Analysis snapshot.
- The worker recognizes all 11 canonical ZenCore markets. Broker symbol discovery/mapping remains a preflight requirement.

## Required production boundary

One trader account must run in one isolated Windows execution cell. The selected Google Cloud cell requires:

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

The output is `ZenCore_Hosted_Worker_GCP_v2.0.0-gcp-connect.zip` and its `.sha256` file. Building does not create a VM, HSM key, network or billing charge. The ZIP must still be reviewed and hosted at an approved HTTPS URL before its exact SHA-256 is placed in Terraform.

MetaTrader's [official Python initialize API](https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py) supports initializing a terminal with `login`, `password` and `server`. That API boundary necessarily creates short-lived Python strings even though ZenCore wipes its mutable credential buffers immediately afterward. The Demo certification must inspect the broker terminal profile and disk behavior before any claim that MT5 itself did not persist connection data.
