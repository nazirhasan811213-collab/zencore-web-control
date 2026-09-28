[CmdletBinding()]
param(
    [string]$ManagerConfigPath = 'C:\ProgramData\ZenCore\HostedWorker\manager-config.json',
    [string]$ReleaseRoot = 'C:\Program Files\ZenCore\HostedWorker',
    [string]$ExecutionGatePath = 'C:\ProgramData\ZenCore\HostedWorker\DEMO_EXECUTION_ENABLED',
    [string]$ExecutionLockPath = 'C:\ProgramData\ZenCore\HostedWorker\EXECUTION_LOCKED'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$version = '2.2.6-gcp-multiuser-multipair'
$taskName = 'ZenCore MT5 Worker Manager'
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Get-Content -Raw -LiteralPath (Join-Path $source 'release-manifest.json') | ConvertFrom-Json
if ($manifest.connectorVersion -ne $version -or $manifest.schemaVersion -ne 1) {
    throw 'RELEASE_MANIFEST_INVALID'
}
foreach ($item in $manifest.files) {
    $name = [string]$item.path
    if ($name -notmatch '^[A-Za-z0-9._-]{1,100}$') { throw 'RELEASE_FILE_INVALID' }
    $file = Join-Path $source $name
    if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or
        (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant() -ne ([string]$item.sha256).ToLowerInvariant()) {
        throw 'RELEASE_HASH_MISMATCH'
    }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ADMIN_REQUIRED' }
if (Test-Path -LiteralPath $ExecutionGatePath -PathType Leaf) { throw 'EXECUTION_GATE_PRESENT' }
if (-not (Test-Path -LiteralPath $ExecutionLockPath -PathType Leaf)) { throw 'EXECUTION_LOCK_MISSING' }
if (-not (Test-Path -LiteralPath $ManagerConfigPath -PathType Leaf)) { throw 'MANAGER_CONFIG_MISSING' }
$old = Get-Content -Raw -LiteralPath $ManagerConfigPath | ConvertFrom-Json
if ($old.executionEnabled -ne $false -or
    $old.connectorVersion -notin @('2.2.5-gcp-multiuser-multipair', $version) -or
    $old.demoOnly -ne $true) { throw 'MANAGER_NOT_LOCKED_V225' }
$oldTask = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$oldAction = $oldTask.Actions | Select-Object -First 1
if ($oldTask.State -ne 'Running' -or $oldTask.Actions.Count -ne 1) { throw 'MANAGER_TASK_UNEXPECTED' }
$destination = Join-Path $ReleaseRoot $version
New-Item -ItemType Directory -Force -Path $destination | Out-Null
foreach ($item in $manifest.files) {
    Copy-Item -Force -LiteralPath (Join-Path $source ([string]$item.path)) -Destination $destination
}
Copy-Item -Force -LiteralPath (Join-Path $source 'release-manifest.json') -Destination $destination
$worker = Join-Path $destination 'ZenCoreHostedWorker.exe'
$manager = Join-Path $destination 'ZenCoreHostedWorkerManager.exe'
if (-not (Test-Path $worker) -or -not (Test-Path $manager)) { throw 'RELEASE_BINARY_MISSING' }
$backup = "$ManagerConfigPath.before-2.2.6"
Copy-Item -Force -LiteralPath $ManagerConfigPath -Destination $backup
$new = Get-Content -Raw -LiteralPath $ManagerConfigPath | ConvertFrom-Json
$new.connectorVersion = $version
$new.childWorkerPath = $worker
$new.approvedDemoServer = 'ENVELOPE'
$new.allowedDemoSymbols = @('XAUUSD','EURUSD','GBPUSD','USDJPY','US30','USDCAD','USDCHF','EURJPY','GBPJPY','EURGBP','BTCUSD')
$new.executionEnabled = $false
$newAction = New-ScheduledTaskAction -Execute $manager -Argument ('--config "{0}"' -f $ManagerConfigPath) -WorkingDirectory $destination
try {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    $oldReleaseRoot = Join-Path $ReleaseRoot ([string]$old.connectorVersion)
    $oldProcesses = @()
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        $oldProcesses = @(Get-CimInstance Win32_Process | Where-Object {
            $_.ExecutablePath -and $_.ExecutablePath.StartsWith(
                ($oldReleaseRoot + '\'), [StringComparison]::OrdinalIgnoreCase)
        })
        if ($oldProcesses.Count -eq 0) { break }
        Start-Sleep -Seconds 1
    }
    if ($oldProcesses.Count -gt 0) { throw 'OLD_RELEASE_PROCESSES_RUNNING' }
    $new | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ManagerConfigPath -Encoding UTF8
    Set-ScheduledTask -TaskName $taskName -Action $newAction | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Start-Sleep -Seconds 8
    if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Running') { throw 'MANAGER_START_FAILED' }
    if (Test-Path -LiteralPath $ExecutionGatePath) { throw 'EXECUTION_GATE_PRESENT' }
    Write-Host "ZenCore $version manager running in CONNECTION-ONLY mode."
    Write-Host 'Inspect slot heartbeat and broker symbol mapping before any execution rollout.'
} catch {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Copy-Item -Force -LiteralPath $backup -Destination $ManagerConfigPath
    $restore = New-ScheduledTaskAction -Execute ([string]$oldAction.Execute) -Argument ([string]$oldAction.Arguments) -WorkingDirectory ([string]$oldAction.WorkingDirectory)
    Set-ScheduledTask -TaskName $taskName -Action $restore | Out-Null
    Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    throw
}
