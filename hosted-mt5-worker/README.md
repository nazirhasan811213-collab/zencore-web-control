# ZenCore Managed MT5 Worker — staged security boundary

This directory is the new hosted-worker foundation. It does **not** place orders in this release. `HOSTED_DEMO_ORDER_EXECUTION_BUILD_UNLOCKED` is hard-coded to `False`.

## Implemented now

- The browser creates a random AES-256-GCM key, encrypts the MT5 login/password/server, then wraps that AES key with RSA-OAEP SHA-256.
- Render/PostgreSQL receive only the envelope, key ID and masked identity. The web application has no private key or decrypt function.
- `security_boundary.py` accepts unwrap capability only through `ExternalKeyUnwrapper`. There is deliberately no file-key or environment-key implementation.
- Decrypted credentials are DEMO-only, short-lived and exposed to the future MT5 adapter only long enough to initialize a terminal session.
- Entry commands must contain `ZENCORE_ANALYSIS_EXECUTION_V1`; every flattened Entry/SL/TP field must exactly equal the signed Analysis snapshot.
- The worker recognizes all 11 canonical ZenCore markets. Broker symbol discovery/mapping remains a preflight requirement.

## Required production boundary

One trader account must run in one isolated Windows execution cell. A production cell requires:

1. Windows confidential-compute host with no public inbound network path.
2. Workload identity plus measured/attested release policy for the external RSA unwrap operation.
3. No interactive operator login during normal service and no private key in Render, PostgreSQL, VM disk, source, environment variables or logs.
4. Short-lived envelope lease bound to one worker assignment, with replay protection and automatic expiry.
5. MT5 terminal image and broker-server discovery tested for every supported broker/server; no promise of “all servers” is made until this matrix passes.
6. Signed worker builds, rollback image, security monitoring and a two-person production release procedure.

Database encryption alone cannot make a centrally operated website absolutely “admin-proof”: a privileged person able to replace frontend code could attempt to capture future input. The production design therefore also needs deployment separation, signed/reviewed frontend releases, immutable audit and attested key release. The current staged build protects against database dumps and ordinary web-admin access because plaintext and the private key are absent from the web tier.

## Test

```powershell
py -3.12 -m unittest hosted-mt5-worker\test_security_boundary.py
```

Passing these tests proves envelope compatibility, tamper rejection, DEMO-only credential validation, secret-environment rejection and Analysis snapshot parity. It does not prove live broker execution.

