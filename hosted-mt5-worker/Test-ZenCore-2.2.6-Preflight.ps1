[CmdletBinding()]
param(
    [string]$ManagerConfigPath = 'C:\ProgramData\ZenCore\HostedWorker\manager-config.json',
    [int]$ExpectedSlots = 3
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$version = '2.2.6-gcp-multiuser-multipair'
$issues = New-Object System.Collections.Generic.List[string]
$root = Split-Path -Parent $ManagerConfigPath
$config = $null
try { $config = Get-Content -Raw -LiteralPath $ManagerConfigPath | ConvertFrom-Json }
catch { $issues.Add('MANAGER_CONFIG_UNAVAILABLE') }

$task = Get-ScheduledTask -TaskName 'ZenCore MT5 Worker Manager' -ErrorAction SilentlyContinue
if (-not $task -or $task.State -ne 'Running') { $issues.Add('MANAGER_TASK_NOT_RUNNING') }
if (-not (Test-Path -LiteralPath (Join-Path $root 'EXECUTION_LOCKED') -PathType Leaf)) {
    $issues.Add('EXECUTION_LOCK_MISSING')
}
if (Test-Path -LiteralPath (Join-Path $root 'DEMO_EXECUTION_ENABLED') -PathType Leaf) {
    $issues.Add('EXECUTION_GATE_PRESENT')
}

$slots = @()
$managerCount = 0
$workerCount = 0
if ($config) {
    if ($config.connectorVersion -ne $version -or $config.executionEnabled -ne $false -or
        $config.demoOnly -ne $true -or $config.approvedDemoServer -ne 'ENVELOPE') {
        $issues.Add('MANAGER_CONFIG_NOT_LOCKED_V226')
    }
    $release = Join-Path 'C:\Program Files\ZenCore\HostedWorker' $version
    $processes = @(Get-CimInstance Win32_Process -Filter "Name='ZenCoreHostedWorkerManager.exe' OR Name='ZenCoreHostedWorker.exe' OR Name='terminal64.exe'")
    $managerCount = @($processes | Where-Object {
        $_.Name -eq 'ZenCoreHostedWorkerManager.exe' -and
        $_.ExecutablePath -eq (Join-Path $release 'ZenCoreHostedWorkerManager.exe')
    }).Count
    $workerCount = @($processes | Where-Object {
        $_.Name -eq 'ZenCoreHostedWorker.exe' -and
        $_.ExecutablePath -eq (Join-Path $release 'ZenCoreHostedWorker.exe')
    }).Count
    if ($managerCount -ne 1) { $issues.Add('MANAGER_PROCESS_COUNT_INVALID') }
    $slotRoot = [string]$config.slotsRoot
    if (-not (Test-Path -LiteralPath $slotRoot -PathType Container)) {
        $issues.Add('SLOTS_ROOT_MISSING')
    } else {
        $slotDirs = @(Get-ChildItem -LiteralPath $slotRoot -Directory | Where-Object {
            $_.Name -match '^zencore-mt5-demo-01-s[0-9]{2}$'
        })
        foreach ($slot in $slotDirs) {
            $workerConfig = Join-Path $slot.FullName 'worker\worker-config.json'
            $terminalPath = Join-Path $slot.FullName 'mt5\terminal64.exe'
            $configOk = $false
            try {
                $child = Get-Content -Raw -LiteralPath $workerConfig | ConvertFrom-Json
                $configOk = $child.cellId -eq $slot.Name -and
                    $child.connectorVersion -eq $version -and
                    $child.executionEnabled -eq $false -and
                    $child.approvedDemoServer -eq 'ENVELOPE'
            } catch { }
            $terminalRunning = @($processes | Where-Object {
                $_.Name -eq 'terminal64.exe' -and $_.ExecutablePath -eq $terminalPath
            }).Count -eq 1
            if (-not $configOk) { $issues.Add("SLOT_CONFIG_INVALID:$($slot.Name)") }
            if (-not $terminalRunning) { $issues.Add("SLOT_TERMINAL_NOT_RUNNING:$($slot.Name)") }
            $slots += [pscustomobject]@{
                slot = $slot.Name
                configValid = [bool]$configOk
                terminalRunning = [bool]$terminalRunning
            }
        }
        if ($ExpectedSlots -gt 0 -and $slots.Count -ne $ExpectedSlots) {
            $issues.Add('SLOT_COUNT_MISMATCH')
        }
        if ($workerCount -ne $slots.Count) { $issues.Add('WORKER_PROCESS_COUNT_MISMATCH') }
    }
}

[pscustomobject]@{
    checkedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    version = $version
    preflightHealthy = $issues.Count -eq 0
    managerProcesses = $managerCount
    workerProcesses = $workerCount
    slots = $slots
    issues = @($issues.ToArray())
    brokerHeartbeatVerified = $false
    note = 'Broker heartbeat must also be verified in ZenCore; local process checks cannot prove MT5 connectivity.'
} | ConvertTo-Json -Depth 5
if ($issues.Count -gt 0) { exit 1 }
