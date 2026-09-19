# ZenCore Web Control — Deploy Ready

## Local test
1. Install Node.js 20+.
2. In this folder run:
   `npm start`
3. Open http://localhost:8080

## Render
Create a Render **Web Service** from a GitHub repository containing these files.

Recommended fields:
- Runtime: Node
- Build Command: `npm ci`
- Start Command: `npm start`
- Health Check Path: `/health`
- Environment variable:
  - Key: `ZENCORE_SECRET`
  - Value: choose your own long random secret

After deploy, Render gives you an HTTPS address such as:
`https://YOUR-SERVICE.onrender.com`

Dashboard:
`https://YOUR-SERVICE.onrender.com/`

TradingView webhook:
`https://YOUR-SERVICE.onrender.com/webhook`

## Pine
In `ZenCore_AI_Dashboard_Pro_WebBridge.pine`:
1. Add script to chart.
2. Settings > WEB DASHBOARD BRIDGE.
3. Put the SAME value used for `ZENCORE_SECRET` into `Webhook Secret`.
4. Enable Web Dashboard Feed.

## TradingView alert
1. Create Alert.
2. Condition: ZenCore indicator > Any alert() function call.
3. Enable Webhook URL.
4. Paste your `/webhook` HTTPS URL.
5. No custom alert message is required for the bridge payload; the Pine `alert()` call supplies JSON.

## Important for live trading
TradingView webhook receivers need to respond quickly. An always-on web service is safer than a service that sleeps after inactivity.

## Auto Trade XAUUSD Demo rollout

After the account layer and PostgreSQL are ready, the MT5 pairing/monitoring control plane requires:

- `ZENCORE_AUTOTRADE_ENABLED=true`
- `ZENCORE_AUTOTRADE_EXECUTION_ENABLED=false` during installation, pairing and preflight
- `ZENCORE_AUTOTRADE_DEMO_SYMBOLS=XAUUSD`
- `ZENCORE_AUTOTRADE_DEMO_CONNECTOR_VERSION=1.4.0-demo-execution`
- `ZENCORE_COMMAND_SIGNING_KEY` with at least 32 random bytes
- `ZENCORE_POD_PROVISIONING_SECRET` with at least 32 random bytes

Keep `ZENCORE_AUTOTRADE_EXECUTION_ENABLED=false` during Windows-PC installation, pairing and preflight. After the reviewed worker reports the correct version and the local terminal preflight passes, change only this flag to `true` and perform the XAUUSD Demo smoke test. Broker login, password and full server must never be configured on Render.

## Hosted MT5 staged rollout

Keep both execution gates false when deploying the hosted UI/API foundation:

```text
ZENCORE_AUTOTRADE_EXECUTION_ENABLED=false
ZENCORE_HOSTED_MT5_ENABLED=false
ZENCORE_GCP_HOSTED_WORKER_ENABLED=false
```

Do not enable `ZENCORE_HOSTED_MT5_ENABLED` until the Google Cloud RSA/HSM key and managed Shielded Windows Demo worker defined in `infra/gcp-hosted-mt5/` have been provisioned and certified. Google Cloud Windows does not support Confidential VM; follow the documented role-separation boundary. Render may receive only the public key and short key alias:

```text
ZENCORE_MT5_CREDENTIAL_KEY_ID=<gcp public key alias>
ZENCORE_MT5_CREDENTIAL_PUBLIC_KEY=<RSA public key PEM>
```

The matching private key is prohibited from Render, PostgreSQL, source files, environment variables and VM disk. Enabling the hosted popup does not enable orders; the hosted worker build gate is separately hard-coded `False` in this release.

After the locked Google cell and HSM public key pass preflight, enable only the encrypted popup first. Keep the worker and execution gates false until a hosted-account UUID is assigned to the cell. The Terraform output `render_worker_identity_environment` provides these non-secret, exact pins:

```text
ZENCORE_GCP_WORKER_AUDIENCE=https://zencore-precision-entry.onrender.com/api/hosted-execution
ZENCORE_GCP_WORKER_PROJECT_ID=<dedicated project ID>
ZENCORE_GCP_WORKER_ZONE=asia-southeast1-b
ZENCORE_GCP_WORKER_INSTANCE=zencore-mt5-demo-01
ZENCORE_GCP_WORKER_SERVICE_ACCOUNT=<attached worker service account email>
ZENCORE_GCP_WORKER_HOSTED_ACCOUNT_ID=<assigned hosted-account UUIDv4>
```

Only after those values match the deployed VM may `ZENCORE_GCP_HOSTED_WORKER_ENABLED=true`. Google-signed instance identity enables envelope lease and heartbeat only; `ZENCORE_AUTOTRADE_EXECUTION_ENABLED` remains false and the hosted worker build itself remains order-locked.

### Code-only worker release

The Windows connection worker can be built without a Google Cloud project or billing:

```powershell
.\hosted-mt5-worker\Build-ZenCoreHostedWorker.ps1 -OutputDirectory .\artifacts
```

The build runs the hosted-worker test suite, creates an execution-locked EXE, release manifest, ZIP and SHA-256. `.github/workflows/hosted-worker-build.yml` provides the same reviewable Windows build. Neither path runs `terraform apply`, creates cloud resources nor enables MT5 orders.
