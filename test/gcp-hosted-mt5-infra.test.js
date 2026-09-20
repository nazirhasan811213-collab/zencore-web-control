const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..', 'infra', 'gcp-hosted-mt5');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const WORKER = path.join(__dirname, '..', 'hosted-mt5-worker');
const readWorker = file => fs.readFileSync(path.join(WORKER, file), 'utf8');
const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'hosted-worker-build.yml');

test('Google Cloud Demo cell has no public IP and uses Shielded Windows controls', () => {
  const main = read('main.tf');
  const variables = read('variables.tf');
  assert.match(variables, /windows-cloud\/windows-2022/);
  assert.match(main, /image\s*=\s*var\.windows_image/);
  assert.match(main, /enable_secure_boot\s*=\s*true/);
  assert.match(main, /enable_vtpm\s*=\s*true/);
  assert.match(main, /enable_integrity_monitoring\s*=\s*true/);
  assert.match(main, /deletion_protection\s*=\s*true/);
  const networkBlock = main.match(/network_interface\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
  assert.doesNotMatch(networkBlock, /access_config\s*\{/);
  assert.match(main, /35\.235\.240\.0\/20/);
  assert.match(main, /deny_other_egress/);
});

test('Windows activation has a direct Google KMS route and narrow TCP 1688 egress', () => {
  const main = read('main.tf');
  assert.match(main, /dest_range\s*=\s*"35\.190\.247\.13\/32"/);
  assert.match(main, /next_hop_gateway\s*=\s*"default-internet-gateway"/);
  assert.match(main, /destination_ranges\s*=\s*\["35\.190\.247\.13\/32"\]/);
  assert.match(main, /ports\s*=\s*\["1688"\]/);
});

test('Google Cloud credential key is HSM-backed, non-exported and worker identity is keyless', () => {
  const main = read('main.tf');
  assert.match(main, /purpose\s*=\s*"ASYMMETRIC_DECRYPT"/);
  assert.match(main, /RSA_DECRYPT_OAEP_3072_SHA256/);
  assert.match(main, /protection_level\s*=\s*"HSM"/);
  assert.match(main, /roles\/cloudkms\.cryptoKeyDecrypter/);
  assert.doesNotMatch(main, /google_service_account_key/);
  assert.doesNotMatch(main, /BEGIN (?:RSA )?PRIVATE KEY/);
  assert.doesNotMatch(main, /private_key\s*=/i);
  assert.doesNotMatch(main, /mt5[_-]?(login|password|server)\s*=/i);
});

test('one hosted account is pinned to one Google worker identity and exact audience', () => {
  const variables = read('variables.tf');
  const main = read('main.tf');
  const outputs = read('outputs.tf');
  assert.match(variables, /variable "hosted_account_id"/);
  assert.match(variables, /hosted_account_id must be blank or a UUIDv4/);
  assert.match(main, /hostedAccountId\s*=\s*var\.hosted_account_id/);
  assert.match(main, /controlPlaneAudience\s*=\s*"\$\{var\.control_plane_url\}\/api\/hosted-execution"/);
  assert.match(main, /connectorVersion\s*=\s*var\.execution_enabled \? "2\.1\.0-gcp-demo-execution" : "2\.0\.0-gcp-connect"/);
  assert.match(main, /approvedDemoServer\s*=\s*"InterStellarFinancial-Demo"/);
  assert.match(main, /mt5TerminalPath\s*=\s*var\.mt5_terminal_path/);
  assert.match(outputs, /ZENCORE_GCP_WORKER_AUDIENCE/);
  assert.match(outputs, /ZENCORE_GCP_WORKER_SERVICE_ACCOUNT/);
  assert.match(outputs, /ZENCORE_GCP_WORKER_HOSTED_ACCOUNT_ID/);
});

test('Hosted worker config remains operator-readable but not operator-writable', () => {
  const bootstrap = read('bootstrap/Install-ZenCoreGcpHostedWorker.ps1.tftpl');
  assert.match(bootstrap, /BUILTIN\\Administrators/);
  assert.match(bootstrap, /"ReadAndExecute"/);
  assert.match(bootstrap, /"NT AUTHORITY\\SYSTEM", "FullControl"/);
});

test('Default MT5 terminal path matches the deployed MetaTrader 5 terminal', () => {
  const variables = read('variables.tf');
  const example = read('terraform.tfvars.example');
  assert.match(variables, /C:\\\\Program Files\\\\MetaTrader 5\\\\terminal64\.exe/);
  assert.match(example, /C:\\\\Program Files\\\\MetaTrader 5\\\\terminal64\.exe/);
});

test('Terraform and Windows bootstrap require explicit pinned XAUUSD DEMO execution gate', () => {
  const variables = read('variables.tf');
  const main = read('main.tf');
  const bootstrap = read('bootstrap/Install-ZenCoreGcpHostedWorker.ps1.tftpl');
  assert.match(variables, /variable "execution_enabled"/);
  assert.match(variables, /var\.allowed_demo_symbols == toset\(\["XAUUSD"\]\)/);
  assert.match(variables, /worker_release_url != ""/);
  assert.match(variables, /worker_release_sha256/);
  assert.match(main, /execution\s*=\s*var\.execution_enabled \? "demo-enabled" : "locked"/);
  assert.match(bootstrap, /DEMO_EXECUTION_ENABLED/);
  assert.match(bootstrap, /2\.1\.0-gcp-demo-execution/);
  assert.match(bootstrap, /EXECUTION_LOCKED/);
  assert.match(bootstrap, /Get-FileHash -Algorithm SHA256/);
  assert.match(bootstrap, /Expand-Archive/);
  assert.match(bootstrap, /Install-ZenCoreHostedWorker\.ps1/);
});

test('Google Cloud documentation states the honest Windows threat boundary', () => {
  const document = read('README.md');
  assert.match(document, /does \*\*not\*\* support Confidential VM/);
  assert.match(document, /does not claim protection from a fully privileged Google Cloud project owner/);
  assert.match(document, /InterStellarFinancial-Demo/);
  assert.match(document, /ZENCORE_HOSTED_MT5_ENABLED=false/);
  assert.match(document, /ZENCORE_AUTOTRADE_EXECUTION_ENABLED=false/);
});

test('Windows DEMO execution worker is test-built, hash-pinned and scheduled as SYSTEM task', () => {
  const build = readWorker('Build-ZenCoreHostedWorker.ps1');
  const install = readWorker('Install-ZenCoreHostedWorker.ps1');
  assert.match(build, /version_info\.major/);
  assert.match(build, /Python 3\.12/);
  assert.match(build, /unittest discover/);
  assert.match(build, /PyInstaller/);
  assert.match(build, /executionUnlocked = \$true/);
  assert.match(build, /Get-FileHash -Algorithm SHA256/);
  assert.match(install, /release-manifest\.json/);
  assert.match(install, /Get-FileHash -Algorithm SHA256/);
  assert.match(install, /NT AUTHORITY\\SYSTEM/);
  assert.match(install, /executionEnabled -ne \$true/);
  assert.match(install, /DEMO_EXECUTION_ENABLED/);
  assert.match(install, /XAUUSD/);
  assert.match(install, /Disable-ScheduledTask/);
  assert.doesNotMatch(install, /ConvertTo-SecureString|PSCredential|service_account_key/);
});

test('GitHub build workflow creates artifacts only and has no cloud credentials', () => {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /Build-ZenCoreHostedWorker\.ps1/);
  assert.match(workflow, /Get-FileHash -Algorithm SHA256/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(workflow, /google-github-actions|terraform apply|gcloud auth|secrets\./i);
});
