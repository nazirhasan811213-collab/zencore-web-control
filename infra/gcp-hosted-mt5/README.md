# ZenCore hosted MT5 — Google Cloud staged Demo cell

This module prepares one private Windows Server 2022 worker host. The Worker Manager can create multiple isolated MT5 account slots on that host. It does not enable broker order execution by default and it does not claim compatibility with every broker server.

## Security boundary

- The VM has no public IP. Temporary RDP access is available only through Google IAP TCP forwarding.
- Shielded VM enables Secure Boot, vTPM and integrity monitoring. Windows Server on Google Cloud does **not** support Confidential VM, so this design does not claim protection from a fully privileged Google Cloud project owner.
- The browser encrypts login, password and server with AES-256-GCM and wraps the AES key with the Cloud KMS public RSA key.
- Cloud HSM owns the RSA-OAEP 3072 SHA-256 private key. The key cannot be exported. Only the worker service account has `asymmetricDecrypt` permission on this one key.
- The VM uses its attached service account through the metadata server. No service-account JSON key is created or copied to disk.
- Render accepts a worker only when Google's signed full instance identity exactly matches a host in the configured fleet registry: project, zone, instance name, service account and HTTPS audience. Fresh request IDs are single-use, time-limited and recorded in a short PostgreSQL replay ledger across web-service restarts.
- Decrypted MT5 values are permitted only in short-lived process memory. They are forbidden in environment variables, Terraform state, Render variables, logs and VM metadata.
- The default locked configuration starts with `InterStellarFinancial-Demo` and `XAUUSD`. Connector `2.2.2-gcp-multiuser-multipair` can validate additional canonical pairs in connection-only preflight; execution remains unavailable until the independent server, manager-config and local gates match.

Google Cloud IAM separation of duties is required: the person who administers the KMS policy should not also control frontend releases, the Render database and the worker image. Absolute “admin-proof” auto-login is not possible when one person can replace every layer of the system.

## What Terraform creates

- Private VPC, subnet, Cloud Router and Cloud NAT.
- Ingress only from the Google IAP TCP range to RDP.
- Explicit metadata/KMS/control-plane/broker egress with a final deny-all rule.
- A keyless worker service account with only KMS decrypt, log writer and metric writer roles.
- An HSM-backed asymmetric key using `RSA_DECRYPT_OAEP_3072_SHA256`.
- One deletion-protected, non-preemptible Windows Server 2022 Shielded VM.
- A startup bootstrap that writes only non-secret configuration and refuses unsigned artifacts.

## Prerequisites

1. Create a dedicated Google Cloud project with billing enabled.
2. Create and confirm the separate [project budget alert](billing-budget/README.md) before planning or applying any billable MT5 infrastructure. An alert does not stop spending.
3. Install and authenticate `gcloud` and Terraform on an operator machine.
4. Obtain the official InterStellar MT5 installer URL and independently verify its SHA-256.
5. Build a reviewed ZenCore worker ZIP on Windows using `hosted-mt5-worker/Build-ZenCoreHostedWorker.ps1` (or the code-only GitHub workflow) and record its SHA-256.
6. Keep all Render gates false:
   - `ZENCORE_HOSTED_MT5_ENABLED=false`
   - `ZENCORE_GCP_HOSTED_WORKER_ENABLED=false`
   - `ZENCORE_AUTOTRADE_EXECUTION_ENABLED=false`

## Deploy the locked cell

```powershell
# On this operator workspace, the ignored terraform.tfvars targets
# zencore-total-trade-system with no IAP member and execution disabled.
# On another machine, copy terraform.tfvars.example and edit project_id first.
# Set the operator and approved artifacts only when they are known.
terraform init
terraform fmt -check
terraform validate
terraform plan -out zencore-gcp-demo.tfplan
terraform show zencore-gcp-demo.tfplan
```

Only after the budget alert is active and a human reviews the MT5 plan should `terraform apply zencore-gcp-demo.tfplan` be considered. Apply creates billable Google Cloud resources. The HSM key and VM have `prevent_destroy`; removing them requires a deliberate reviewed code change.

If the goal is code-only preparation, stop before `terraform apply`. `terraform init`, `fmt`, `validate` and a local plan can be run after Terraform and a project ID are available, but no Google resource is required to build or test the worker source.

For a 720-hour reference month, the published Windows Server license price for the 2-vCPU VM is USD 66.24; one active RSA-3072 HSM key version is approximately USD 2.47; one VM using Public NAT and one NAT IP is approximately USD 4.61 before traffic. These are only three components, **not a total estimate**. Add Singapore e2-standard-2 compute, 60 GiB balanced Persistent Disk, network transfer, logs, operations and any taxes or exchange rates using the [Google Cloud Pricing Calculator](https://cloud.google.com/products/calculator). Prices and credit eligibility may change. Budget alerts are denominated in the billing account's own currency.

Export the public key using the `public_key_export_command` Terraform output. The resulting PEM is public material. It becomes `ZENCORE_MT5_CREDENTIAL_PUBLIC_KEY` only after cell preflight passes. Use `credential_key_alias` as `ZENCORE_MT5_CREDENTIAL_KEY_ID`.

Do **not** enable `ZENCORE_HOSTED_MT5_ENABLED` yet. First connect through the `iap_rdp_tunnel_command`, install the verified broker terminal, then run:

```powershell
.\Test-ZenCoreGcpCell.ps1
```

After the base preflight, use this connection-only sequence:

1. Export the HSM public key. Put only its PEM and public alias in Render.
2. Set `ZENCORE_HOSTED_MT5_ENABLED=true`, keep `ZENCORE_GCP_HOSTED_WORKER_ENABLED=false` and keep execution false.
3. The trader enters the Demo login/password/server only in the ZenCore encrypted popup. Copy the resulting non-secret hosted-account UUID into `hosted_account_id` and apply the reviewed Terraform plan again.
4. Copy the non-secret `render_worker_identity_environment` output—including the exact hosted-account UUID—into Render, then set `ZENCORE_GCP_HOSTED_WORKER_ENABLED=true`.
5. Install the verified InterStellar terminal, then rerun the installer and `Test-ZenCoreGcpCell.ps1 -RequireWorker -RequireAssignment`.
6. Confirm the UI reports `CONNECTED • EXECUTION LOCKED`. No order can be sent while this connection-only preflight state is intact.

The Google identity audience is exactly `${control_plane_url}/api/hosted-execution`. One worker cell is assigned one hosted-account UUID; a different account or cell is rejected.

## Demo certification gate

The feature remains locked until all of these pass:

1. No public IP, Secure Boot and TPM preflight.
2. KMS decrypt succeeds only from the worker service account and fails for Render/admin application identities.
3. InterStellar Demo login succeeds without writing plaintext credentials to disk or logs.
4. Exact broker symbol mapping and volume/tick specifications are captured for every configured pair.
5. Analysis snapshot parity, command replay protection and STOP semantics pass.
6. Entry, TP1, TP2, TP3, SL, Close Separuh and opposite confirmed yellow reversal pass on Demo.
7. Recovery, restart, stale-command and duplicate-order tests pass.
8. A separate reviewed rollout changes all three execution gates together; risk warnings still never become order blocks.

Only after certification should the hosted-account envelope gate be enabled. Real-money trading remains outside this phase.
