const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const template = JSON.parse(fs.readFileSync(
  path.join(root, 'infra', 'azure-trader-pod', 'azuredeploy.json'), 'utf8'
));
const exampleParameters = JSON.parse(fs.readFileSync(
  path.join(root, 'infra', 'azure-trader-pod', 'azuredeploy.parameters.example.json'), 'utf8'
));
const podConfig = JSON.parse(fs.readFileSync(
  path.join(root, 'mt5-secure-pod', 'pod-config.example.json'), 'utf8'
));
const worker = fs.readFileSync(path.join(root, 'mt5-secure-pod', 'ZenCoreSecurePod.py'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'mt5-secure-pod', 'Install-ZenCoreSecurePod.ps1'), 'utf8');
const pairScript = fs.readFileSync(path.join(root, 'mt5-secure-pod', 'Pair-ZenCoreSecurePod.ps1'), 'utf8');
const taskScript = fs.readFileSync(path.join(root, 'mt5-secure-pod', 'Register-ZenCoreSecurePodTask.ps1'), 'utf8');
const preflightScript = fs.readFileSync(path.join(root, 'mt5-secure-pod', 'Test-ZenCoreSecurePod.ps1'), 'utf8');
const requirements = fs.readFileSync(path.join(root, 'mt5-secure-pod', 'requirements.txt'), 'utf8');

const markets = [
  'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'US30', 'USDCAD',
  'USDCHF', 'EURJPY', 'GBPJPY', 'EURGBP', 'BTCUSD'
];

function resource(type) {
  return template.resources.find(item => item.type === type);
}

test('Azure template enforces confidential compute and encrypted guest state', () => {
  const vm = resource('Microsoft.Compute/virtualMachines');
  assert.ok(vm);
  assert.equal(vm.apiVersion, '2023-09-01');
  assert.equal(vm.properties.securityProfile.securityType, 'ConfidentialVM');
  assert.equal(vm.properties.securityProfile.uefiSettings.secureBootEnabled, true);
  assert.equal(vm.properties.securityProfile.uefiSettings.vTpmEnabled, true);
  assert.equal(
    vm.properties.storageProfile.osDisk.managedDisk.securityProfile.securityEncryptionType,
    'DiskWithVMGuestState'
  );
  assert.equal(vm.properties.storageProfile.imageReference.sku, '2022-datacenter-g2');
  assert.equal(vm.properties.osProfile.allowExtensionOperations, false);
  assert.equal(vm.properties.diagnosticsProfile.bootDiagnostics.enabled, false);
  assert.equal(template.parameters.vmSize.defaultValue, 'Standard_DC2as_v5');
});

test('VM has no public ingress while NAT provides explicit outbound-only IP', () => {
  const nic = resource('Microsoft.Network/networkInterfaces');
  const nsg = resource('Microsoft.Network/networkSecurityGroups');
  const nat = resource('Microsoft.Network/natGateways');
  const egressIp = resource('Microsoft.Network/publicIPAddresses');
  assert.ok(nic && nsg && nat && egressIp);
  assert.equal('publicIPAddress' in nic.properties.ipConfigurations[0].properties, false);
  assert.deepEqual(nsg.properties.securityRules, []);
  assert.equal(egressIp.sku.name, 'Standard');
  assert.equal(egressIp.tags.purpose, 'OutboundOnly');
  assert.equal(nat.properties.publicIpAddresses.length, 1);
  assert.equal(
    template.resources.some(item => item.type === 'Microsoft.Compute/virtualMachines/extensions'),
    false
  );
});

test('deployment contract accepts no broker credentials or pairing material', () => {
  assert.equal(template.parameters.adminPassword.type, 'secureString');
  assert.equal('adminPassword' in exampleParameters.parameters, false);
  const disallowed = /(broker|mt5|pairing|podToken|signingKey|accountLogin)/i;
  assert.deepEqual(Object.keys(template.parameters).filter(name => disallowed.test(name)), []);
  assert.deepEqual(Object.keys(template.outputs).filter(name => disallowed.test(name)), []);
  assert.equal(JSON.stringify(template).includes('customData'), false);
});

test('local config covers all 11 markets and starts with execution locked', () => {
  assert.equal(podConfig.schemaVersion, 1);
  assert.equal(podConfig.controlUrl.startsWith('https://'), true);
  assert.equal(podConfig.hostProfile, 'WINDOWS_PC');
  assert.equal(podConfig.demoExecutionEnabled, false);
  assert.deepEqual(Object.keys(podConfig.symbolMap), markets);
  const forbiddenKeys = Object.keys(podConfig).filter(name =>
    /(login|password|server|token|secret|signing|pairing)/i.test(name)
  );
  assert.deepEqual(forbiddenKeys, []);
});

test('Windows DEMO execution requires an explicit local switch and keeps machine identity protected', () => {
  assert.match(installer, /\[switch\]\$EnableDemoExecution/);
  assert.match(installer, /demoExecutionEnabled = \[bool\]\$EnableDemoExecution/);
  assert.match(installer, /hostProfile = \$HostProfile/);
  assert.match(installer, /pip --isolated install/);
  assert.match(requirements, /--index-url https:\/\/pypi\.org\/simple/);
  assert.match(requirements, /--only-binary=:all:/);
  assert.match(requirements, /MetaTrader5==5\.0\.6180/);
  assert.match(pairScript, /--pair-only/);
  assert.match(pairScript, /hidden console input/i);
  assert.equal(pairScript.includes('ZENCORE_PAIRING_CODE'), false);
  assert.equal(worker.includes('os.environ.get("ZENCORE_PAIRING_CODE")'), false);
  assert.equal(worker.includes('os.environ.get("ZENCORE_POD_TOKEN")'), false);
  assert.equal(worker.includes('os.environ.get("ZENCORE_COMMAND_SIGNING_KEY")'), false);
  assert.match(worker, /getpass\.getpass/);
  assert.match(worker, /UserCredentialStore/);
  assert.match(worker, /DEMO_ORDER_EXECUTION_BUILD_UNLOCKED = True/);
  assert.match(worker, /DEMO_EXECUTION_MARKETS = \("XAUUSD",\)/);
  assert.match(worker, /INTERSTELLAR_DEMO_SERVER_ID = "INTERSTELLARFINANCIALDEMO"/);
  assert.match(worker, /environment_mode = config_path is None/);
  assert.match(worker, /visible_count = min\(visible, max\(2, len\(safe\) \/\/ 2\)\)/);
  assert.match(worker, /PRODUCTION_CONTROL_HOST = "zencore-precision-entry\.onrender\.com"/);
  assert.match(worker, /NO_REDIRECT_OPENER\.open/);
  assert.match(worker, /ProxyHandler\(\{\}\)/);
  assert.match(worker, /minimum_version = ssl\.TLSVersion\.TLSv1_2/);
  assert.match(worker, /"WINDOWS_PC": "TRADER_OWNED_WINDOWS_PC"/);
  assert.match(worker, /"demoExecutionUnlocked": bool\(/);
  assert.match(worker, /self\.server_id\(account\.server\) == INTERSTELLAR_DEMO_SERVER_ID/);
  assert.match(worker, /claim_command/);
  assert.match(worker, /close_symbol_percent/);
  assert.match(preflightScript, /BitLocker system drive/);
  assert.match(preflightScript, /Windows Firewall/);
  assert.match(preflightScript, /--terminal-preflight/);
});

test('scheduled worker stays bound to the paired Windows identity in explicit DEMO mode', () => {
  assert.match(taskScript, /WindowsIdentity\]::GetCurrent\(\)\.Name/);
  assert.match(taskScript, /-LogonType Password -RunLevel Limited/);
  assert.match(taskScript, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.match(taskScript, /XAUUSD DEMO execution/);
  assert.match(taskScript, /ZeroFreeBSTR/);
  assert.match(worker, /NORMAL_3M_SOP_V32/);
  assert.match(worker, /32\.3-EXIT-STEPLOCK/);
});
