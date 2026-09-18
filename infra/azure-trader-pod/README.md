# ZenCore trader-owned Azure Secure Pod

This package creates the **infrastructure foundation only** for one trader-owned ZenCore MT5 Secure Pod. The deployment runs in the trader's Azure subscription. ZenCore operators must not be granted subscription RBAC, VM login, Windows administrator access, Bastion access or disk-key access.

The template does not install MT5, accept a broker login/password/server, accept a ZenCore pairing code or unlock order execution.

## What the template enforces

- Windows Server 2022 Generation 2 on an Azure `ConfidentialVM` size.
- Secure Boot and vTPM enabled.
- Confidential OS disk encryption with `DiskWithVMGuestState` and a platform-managed key.
- No public IP on the VM network interface.
- No custom inbound NSG allow rule. Azure's default NSG rule denies Internet inbound traffic.
- Explicit outbound connectivity through a Standard NAT Gateway and a dedicated static egress IP.
- Boot diagnostics disabled and Azure VM extension operations disabled.
- Automatic Windows assessment and platform patching enabled.
- A dedicated Windows administrator secret accepted as an ARM `secureString`; it is unrelated to MT5 and is not included in the example parameter file.

The NAT egress IP is public by design but is attached to the NAT Gateway, **not** to the VM. It cannot be used to initiate an inbound connection to the VM.

## Prerequisites

- A paid Azure subscription that supports confidential VMs. Azure free trials do not support the VM family used by the Microsoft confidential-VM quickstart.
- Confidential VM quota in a region that offers `Standard_DC2as_v5` (or another allowed size).
- Azure PowerShell or the Azure portal's custom-template deployment flow.
- A private administration path such as Azure Bastion, point-to-site VPN or another trader-controlled private connection. Do not attach a public IP or expose TCP 3389.
- InterStellar MT5 and official 64-bit Python 3.12 installation media obtained by the trader from their trusted sources.

## Deploy without putting the Windows password in a file

Run these commands from a trader-controlled PowerShell session. The Windows password is collected as a `SecureString` and is not stored in `azuredeploy.parameters.example.json`.

```powershell
Connect-AzAccount
$resourceGroup = 'zencore-trader-pod-rg'
$location = 'southeastasia'
$windowsPassword = Read-Host 'Dedicated Windows administrator password' -AsSecureString

New-AzResourceGroup -Name $resourceGroup -Location $location
New-AzResourceGroupDeployment `
  -Name 'zencore-secure-pod-foundation' `
  -ResourceGroupName $resourceGroup `
  -TemplateFile '.\azuredeploy.json' `
  -TemplateParameterFile '.\azuredeploy.parameters.example.json' `
  -location $location `
  -adminPassword $windowsPassword
```

Before deployment, confirm that the selected VM size is available in the selected region and that the deployment preview contains no public IP association on the VM NIC.

## Private first login and local enrolment

1. Create or use a trader-owned Azure Bastion/private access path. Keep public inbound ports closed.
2. Sign in as the dedicated Windows account created by the template.
3. Install all Windows updates and restart until no critical update remains.
4. Install InterStellar MT5 inside the VM.
5. Enter the InterStellar **DEMO** login, password and full server directly in the MT5 terminal. Do not paste them into ZenCore, Azure deployment parameters, PowerShell variables or environment variables.
6. Install official 64-bit Python 3.12 for all users, including the `py.exe` launcher. The installer uses isolated pip mode, the official PyPI index, binary wheels only and the pinned MetaTrader5 package version.
7. Copy the `mt5-secure-pod` release folder into the VM and run:

```powershell
Set-Location '.\mt5-secure-pod'
.\Install-ZenCoreSecurePod.ps1 `
  -HostProfile AZURE_CONFIDENTIAL_VM `
  -Mt5TerminalPath 'C:\Program Files\InterStellar MT5\terminal64.exe'
```

If InterStellar uses symbol suffixes, pass a complete `SymbolMapJson` with all 11 canonical keys during installation.

## Preflight, pair and register

Run these steps as the same dedicated Windows user. The per-pod identity is DPAPI-bound to this user, so changing the task account will make it unreadable.

```powershell
& 'C:\Program Files\ZenCore Secure Pod\Test-ZenCoreSecurePod.ps1'
& 'C:\Program Files\ZenCore Secure Pod\Pair-ZenCoreSecurePod.ps1'
& 'C:\Program Files\ZenCore Secure Pod\Test-ZenCoreSecurePod.ps1' -RequirePaired
& 'C:\Program Files\ZenCore Secure Pod\Register-ZenCoreSecurePodTask.ps1' -StartNow
```

Generate the one-time pairing code from the signed-in ZenCore Auto Trade page only when `Pair-ZenCoreSecurePod.ps1` asks for it. Python reads the code with hidden console input; it is not placed in process arguments or environment variables.

The task-registration script asks for the dedicated **Windows** account password. That value is handed only to Windows Task Scheduler so the worker can run after a restart while preserving the same DPAPI user scope. It is never sent to ZenCore and is not written by the scripts.

Do not force-reset that Windows account password or delete `machine-credentials.dpapi` while ZenCore positions are open. A forced administrative reset can make user-scope DPAPI material unreadable. Stop new entries, manage any open MT5 positions locally, and perform a controlled re-pair only after positions are resolved.

## Hard stop before broker testing

`pod-config.json` is created with:

```json
"demoExecutionEnabled": false
```

Keep this value false. Pairing and heartbeats can be tested, but `PLACE_SETUP` cannot create a broker order while the gate is false. Unlocking it is a separate, explicit phase after the confidential-VM deployment, all 11 broker symbol mappings, three-layer order behavior, partial close, StepLock, restart, replay and disconnection tests have passed on InterStellar DEMO.

This source release also has an immutable build gate, `DEMO_ORDER_EXECUTION_BUILD_UNLOCKED = False`. Changing only JSON or an environment variable therefore cannot enable an order. A later reviewed release must deliberately change the build gate as part of the broker-test phase. The scheduled worker runs with a limited Windows token, even though task registration requires elevation.

## Security limits

No design can make a trading account impossible to compromise. A person who controls the trader's Windows administrator account can tamper with MT5 or the worker. The control is that **ZenCore administrators receive no such access** and the control plane never receives raw broker credentials. The trader must protect their Azure owner account with phishing-resistant MFA, keep recovery methods current and review Azure sign-in/activity logs.

Customer-managed confidential disk keys and measured-boot attested secret release are intentionally not claimed by this foundation. They remain production gates.

## Microsoft reference baseline

- [Deploy a confidential VM with an ARM template](https://learn.microsoft.com/en-us/azure/confidential-computing/quick-create-confidential-vm-arm)
- [Create a confidential VM in the Azure portal](https://learn.microsoft.com/en-us/azure/confidential-computing/quick-create-confidential-vm-portal)
- [Virtual machine ARM resource reference](https://learn.microsoft.com/en-us/azure/templates/microsoft.compute/virtualmachines)
- [Register-ScheduledTask reference](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/register-scheduledtask)
