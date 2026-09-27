[CmdletBinding()]
param(
    [string]$ConfigPath = "C:\ProgramData\ZenCore\HostedWorker\worker-config.json",
    [string]$ExecutionGatePath = "C:\ProgramData\ZenCore\HostedWorker\DEMO_EXECUTION_ENABLED",
    [string]$ReleaseRoot = "C:\Program Files\ZenCore\HostedWorker"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "ZenCore hosted worker installation requires an elevated PowerShell session."
}

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifestPath = Join-Path $source "release-manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Release manifest is missing."
}
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or
    $manifest.connectorVersion -ne "2.2.5-gcp-multiuser-multipair" -or
    $manifest.executionUnlocked -ne $true -or
    $manifest.connectionOnlyPreflight -ne $true -or
    $manifest.processLifetimeGuardIncluded -ne $true) {
    throw "Release manifest security boundary is invalid."
}
if (-not ($manifest.files -is [System.Array]) -or $manifest.files.Count -lt 1) {
    throw "Release manifest contains no files."
}
foreach ($file in $manifest.files) {
    $name = [string]$file.path
    $expected = ([string]$file.sha256).ToLowerInvariant()
    if ($name -notmatch "^[A-Za-z0-9._-]{1,100}$" -or $expected -notmatch "^[a-f0-9]{64}$") {
        throw "Release manifest file entry is invalid."
    }
    $candidate = Join-Path $source $name
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Release file is missing."
    }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "Release file SHA-256 verification failed."
    }
}

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $ExecutionGatePath -PathType Leaf)) {
    throw "Worker config or DEMO execution gate is missing."
}
if (Test-Path -LiteralPath "C:\ProgramData\ZenCore\HostedWorker\EXECUTION_LOCKED" -PathType Leaf) {
    throw "Legacy execution lock is still present. DEMO execution release will not install."
}
$config = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
$canonicalSymbols = @("XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "US30", "USDCAD", "USDCHF", "EURJPY", "GBPJPY", "EURGBP", "BTCUSD")
$configuredSymbols = @($config.allowedDemoSymbols | ForEach-Object { [string]$_ })
$invalidSymbols = @($configuredSymbols | Where-Object { $_ -notin $canonicalSymbols })
if ($config.demoOnly -ne $true -or $config.executionEnabled -ne $true -or
    $config.privateKeyAvailable -ne $false -or $config.credentialStorage -ne "MEMORY_ONLY" -or
    $config.connectorVersion -ne "2.2.5-gcp-multiuser-multipair" -or
    $configuredSymbols.Count -lt 1 -or $invalidSymbols.Count -gt 0 -or
    @($configuredSymbols | Select-Object -Unique).Count -ne $configuredSymbols.Count -or
    [string]$config.approvedDemoServer -ne "InterStellarFinancial-Demo") {
    throw "Worker configuration failed the DEMO execution boundary."
}

$releasePath = Join-Path $ReleaseRoot $manifest.connectorVersion
New-Item -ItemType Directory -Force -Path $releasePath | Out-Null
foreach ($file in $manifest.files) {
    Copy-Item -Force -LiteralPath (Join-Path $source ([string]$file.path)) -Destination $releasePath
}
Copy-Item -Force -LiteralPath $manifestPath -Destination $releasePath
$workerExe = Join-Path $releasePath "ZenCoreHostedWorker.exe"
if (-not (Test-Path -LiteralPath $workerExe -PathType Leaf)) {
    throw "ZenCore hosted worker executable is missing."
}
Unblock-File -LiteralPath $workerExe -ErrorAction SilentlyContinue

$taskName = "ZenCore Hosted MT5 Demo Worker"
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -ne $existingTask) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}
$arguments = '--config "{0}" --execution-gate "{1}"' -f $ConfigPath, $ExecutionGatePath
$action = New-ScheduledTaskAction -Execute $workerExe -Argument $arguments -WorkingDirectory $releasePath
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = "PT30S"
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew
$taskPrincipal = New-ScheduledTaskPrincipal `
    -UserId "NT AUTHORITY\SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $taskPrincipal `
    -Force | Out-Null

$accountAssigned = [string]$config.hostedAccountId -match `
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
$terminalReady = Test-Path -LiteralPath ([string]$config.mt5TerminalPath) -PathType Leaf
if ($accountAssigned -and $terminalReady) {
    Enable-ScheduledTask -TaskName $taskName | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Host "ZenCore hosted MT5 Demo execution worker installed and started. Orders remain controlled by ZenCore SYSTEM ON."
} else {
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    Write-Host "ZenCore hosted worker installed but disabled until account assignment and MT5 terminal preflight."
}

# No broker login, password, server, Google token or private key is written by this installer.
