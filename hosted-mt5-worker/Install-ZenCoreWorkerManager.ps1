[CmdletBinding()]
param(
    [string]$LegacyConfigPath = "C:\ProgramData\ZenCore\HostedWorker\worker-config.json",
    [string]$ManagerConfigPath = "C:\ProgramData\ZenCore\HostedWorker\manager-config.json",
    [string]$ExecutionGatePath = "C:\ProgramData\ZenCore\HostedWorker\DEMO_EXECUTION_ENABLED",
    [string]$ReleaseRoot = "C:\Program Files\ZenCore\HostedWorker",
    [string]$SlotsRoot = "C:\ProgramData\ZenCore\HostedWorker\slots",
    [string]$TerminalTemplateRoot = "C:\ProgramData\ZenCore\MT5Template",
    [int]$MaxSlots = 10,
    [switch]$PrepareTerminalTemplate,
    [switch]$MigrateLegacyWorker
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "ZenCore worker manager installation requires an elevated PowerShell session."
}
if ($MaxSlots -lt 1 -or $MaxSlots -gt 50) {
    throw "MaxSlots must be between 1 and 50."
}

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifestPath = Join-Path $source "release-manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Release manifest is missing."
}
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or
    $manifest.connectorVersion -ne "2.1.0-gcp-demo-execution" -or
    $manifest.executionUnlocked -ne $true -or
    $manifest.workerManagerIncluded -ne $true) {
    throw "Release manifest does not contain the approved multi-client manager boundary."
}

foreach ($file in $manifest.files) {
    $name = [string]$file.path
    $expected = ([string]$file.sha256).ToLowerInvariant()
    if ($name -notmatch "^[A-Za-z0-9._-]{1,100}$" -or $expected -notmatch "^[a-f0-9]{64}$") {
        throw "Release manifest file entry is invalid."
    }
    $candidate = Join-Path $source $name
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Release file is missing: $name"
    }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "Release file SHA-256 verification failed: $name"
    }
}

if (-not (Test-Path -LiteralPath $LegacyConfigPath -PathType Leaf)) {
    throw "Existing hosted worker config is required to seed non-secret manager settings."
}
$legacy = Get-Content -Raw -LiteralPath $LegacyConfigPath | ConvertFrom-Json
if ($legacy.demoOnly -ne $true -or
    $legacy.privateKeyAvailable -ne $false -or
    $legacy.credentialStorage -ne "MEMORY_ONLY" -or
    [string]$legacy.connectorVersion -ne "2.1.0-gcp-demo-execution" -or
    @($legacy.allowedDemoSymbols).Count -ne 1 -or
    [string]$legacy.allowedDemoSymbols[0] -ne "XAUUSD" -or
    [string]$legacy.approvedDemoServer -ne "InterStellarFinancial-Demo") {
    throw "Existing worker config does not match the reviewed DEMO boundary."
}

$releasePath = Join-Path $ReleaseRoot $manifest.connectorVersion
New-Item -ItemType Directory -Force -Path $releasePath | Out-Null
foreach ($file in $manifest.files) {
    Copy-Item -Force -LiteralPath (Join-Path $source ([string]$file.path)) -Destination $releasePath
}
Copy-Item -Force -LiteralPath $manifestPath -Destination $releasePath

$workerExe = Join-Path $releasePath "ZenCoreHostedWorker.exe"
$managerExe = Join-Path $releasePath "ZenCoreHostedWorkerManager.exe"
if (-not (Test-Path -LiteralPath $workerExe -PathType Leaf) -or
    -not (Test-Path -LiteralPath $managerExe -PathType Leaf)) {
    throw "ZenCore worker or worker manager executable is missing."
}
Unblock-File -LiteralPath $workerExe -ErrorAction SilentlyContinue
Unblock-File -LiteralPath $managerExe -ErrorAction SilentlyContinue

$legacyTerminalPath = [string]$legacy.mt5TerminalPath
if (-not (Test-Path -LiteralPath $legacyTerminalPath -PathType Leaf)) {
    throw "Existing MT5 terminal path is unavailable."
}
$terminalName = Split-Path -Leaf $legacyTerminalPath
$legacyTerminalRoot = Split-Path -Parent $legacyTerminalPath

if ($PrepareTerminalTemplate) {
    if (Test-Path -LiteralPath $TerminalTemplateRoot) {
        Remove-Item -Recurse -Force -LiteralPath $TerminalTemplateRoot
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TerminalTemplateRoot) | Out-Null
    Copy-Item -Recurse -Force -LiteralPath $legacyTerminalRoot -Destination $TerminalTemplateRoot
}
$templateTerminal = Join-Path $TerminalTemplateRoot $terminalName
if (-not (Test-Path -LiteralPath $templateTerminal -PathType Leaf)) {
    throw "MT5 terminal template is not ready. Re-run with -PrepareTerminalTemplate after confirming the source terminal directory."
}

$managerDir = Split-Path -Parent $ManagerConfigPath
New-Item -ItemType Directory -Force -Path $managerDir, $SlotsRoot | Out-Null

$managerConfig = [ordered]@{
    schemaVersion = 1
    provider = "GOOGLE_CLOUD"
    controlPlaneUrl = [string]$legacy.controlPlaneUrl
    keyAlias = [string]$legacy.keyAlias
    keyVersionResource = [string]$legacy.keyVersionResource
    childWorkerPath = $workerExe
    terminalTemplateRoot = $TerminalTemplateRoot
    terminalExecutableName = $terminalName
    slotsRoot = $SlotsRoot
    executionGatePath = $ExecutionGatePath
    approvedDemoServer = [string]$legacy.approvedDemoServer
    allowedDemoSymbols = @([string]$legacy.allowedDemoSymbols[0])
    heartbeatIntervalSeconds = [double]$legacy.heartbeatIntervalSeconds
    pollIntervalSeconds = 10
    connectorVersion = [string]$legacy.connectorVersion
    demoOnly = $true
    credentialStorage = "CHILD_WORKER_MEMORY_ONLY"
    privateKeyAvailable = $false
    maxSlots = $MaxSlots
}
$managerConfig | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ManagerConfigPath -Encoding UTF8

$legacyTaskName = "ZenCore Hosted MT5 Demo Worker"
if ($MigrateLegacyWorker) {
    $legacyTask = Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
    if ($null -ne $legacyTask) {
        Stop-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
        Disable-ScheduledTask -TaskName $legacyTaskName | Out-Null
    }
}

$taskName = "ZenCore MT5 Worker Manager"
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -ne $existingTask) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}
$arguments = '--config "{0}"' -f $ManagerConfigPath
$action = New-ScheduledTaskAction -Execute $managerExe -Argument $arguments -WorkingDirectory $releasePath
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = "PT20S"
$settingsParams = @{
    StartWhenAvailable = $true
    RestartCount = 20
    RestartInterval = (New-TimeSpan -Minutes 1)
    ExecutionTimeLimit = (New-TimeSpan -Seconds 0)
    MultipleInstances = "IgnoreNew"
}
$settings = New-ScheduledTaskSettingsSet @settingsParams
$principalParams = @{
    UserId = "NT AUTHORITY\SYSTEM"
    LogonType = "ServiceAccount"
    RunLevel = "Highest"
}
$taskPrincipal = New-ScheduledTaskPrincipal @principalParams
$taskParams = @{
    TaskName = $taskName
    Action = $action
    Trigger = $trigger
    Settings = $settings
    Principal = $taskPrincipal
    Force = $true
}
Register-ScheduledTask @taskParams | Out-Null
Enable-ScheduledTask -TaskName $taskName | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "ZenCore multi-client worker manager installed and started."
Write-Host "Manager config: $ManagerConfigPath"
Write-Host "MT5 template: $TerminalTemplateRoot"
Write-Host "Slot root: $SlotsRoot"
if (-not (Test-Path -LiteralPath $ExecutionGatePath -PathType Leaf)) {
    Write-Warning "DEMO execution gate is absent. The manager will stay fail-closed and will not start slot workers."
}
if (-not $MigrateLegacyWorker) {
    Write-Host "Legacy one-to-one worker was left unchanged for staged migration."
}

# Manager config contains only non-secret control-plane and filesystem assignment data.
# Broker login/password/server plaintext are never written by this installer or manager.
