[CmdletBinding()]
param([switch]$SystemRun)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$base = 'C:\ProgramData\ZenCore\HostedWorker'
$version = '2.2.5-gcp-multiuser-multipair'
$reportPath = Join-Path $base 'upgrade-2.2.5-report.json'
$logPath = Join-Path $base 'upgrade-2.2.5.log'
$taskName = 'ZenCore Upgrade Manager 2.2.5'

if (-not $SystemRun) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $quotedScript = '"' + $MyInvocation.MyCommand.Path + '"'
        Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @('-NoProfile', '-File', $quotedScript) -Verb RunAs -Wait
        exit
    }
    # Use a SYSTEM task; DPAPI/profile/KMS context stays identical to the worker.
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -ne $existing -and $existing.State -eq 'Running') { throw 'Upgrade already running.' }
    $arguments = '-NoProfile -NonInteractive -File "{0}" -SystemRun' -f $MyInvocation.MyCommand.Path
    $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $arguments -WorkingDirectory $source
    $owner = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $taskName -Action $action -Principal $owner -Settings $settings -Force | Out-Null
    Remove-Item -LiteralPath $reportPath -Force -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $taskName
    Write-Host 'Installing and checking ZenCore. This can take up to 8 minutes.'
    $deadline = (Get-Date).AddMinutes(9)
    do {
        Start-Sleep -Seconds 3
        $task = Get-ScheduledTask -TaskName $taskName
        if ($task.State -ne 'Running') { break }
    } while ((Get-Date) -lt $deadline)
    if (Test-Path -LiteralPath $reportPath) {
        Get-Content -LiteralPath $reportPath
        Write-Host "Report: $reportPath"
        Write-Host "Log: $logPath"
    } else {
        $result = (Get-ScheduledTaskInfo -TaskName $taskName).LastTaskResult
        Write-Host "Upgrade report unavailable. Task result: $result. Log: $logPath"
    }
    Read-Host 'Press Enter to close'
    exit
}

if ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-18') {
    throw 'SystemRun requires the existing SYSTEM execution context.'
}
New-Item -ItemType Directory -Force -Path $base | Out-Null
Start-Transcript -Path $logPath -Append | Out-Null
$report = [ordered]@{version=$version; installed=$false; restartPassed=$false; allSlotsConnected=$false; executionEnabled=$false; slots=@(); error=$null}
function Get-SlotHealth {
    param([long]$Since)
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    foreach ($file in Get-ChildItem "$base\slots\*\worker\worker-config.json") {
        $cfg = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
        $healthFile = Join-Path $file.DirectoryName 'worker-health.json'
        $state = 'NO_FRESH_HEARTBEAT'
        $fresh = $false
        if (Test-Path -LiteralPath $healthFile) {
            try {
                $health = Get-Content -LiteralPath $healthFile -Raw | ConvertFrom-Json
                $state = [string]$health.state
                $fresh = ($health.updatedAt -gt $Since -and ($now - $health.updatedAt) -lt 45000 -and $health.connectorVersion -eq $version)
            } catch { $state = 'HEALTH_READ_PENDING' }
        }
        [pscustomobject]@{slot=[string]$cfg.cellId; state=$state; fresh=$fresh; connected=($fresh -and $state -eq 'CONNECTED')}
    }
}
function Wait-SlotHealth {
    param([long]$Since)
    $deadline = (Get-Date).AddSeconds(180)
    do {
        Start-Sleep -Seconds 5
        $states = @(Get-SlotHealth -Since $Since)
        if ($states.Count -gt 0 -and @($states | Where-Object { -not $_.connected }).Count -eq 0) { return $states }
    } while ((Get-Date) -lt $deadline)
    return $states
}
try {
    $since = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    & (Join-Path $source 'Install-ZenCoreWorkerManager.ps1') -MaxSlots 10 -MigrateLegacyWorker
    $cfg = Get-Content "$base\manager-config.json" -Raw | ConvertFrom-Json
    if ($cfg.connectorVersion -ne $version -or $cfg.executionEnabled -ne $false) { throw 'UPGRADE_CONFIG_VERIFICATION_FAILED' }
    $report.installed = $true
    $report.slots = @(Wait-SlotHealth -Since $since)
    # Exercise the same Task Scheduler stop/start that exposed the old defect.
    Stop-ScheduledTask -TaskName 'ZenCore MT5 Worker Manager'
    $stopDeadline = (Get-Date).AddSeconds(20)
    do {
        Start-Sleep -Seconds 1
        $remaining = @(Get-CimInstance Win32_Process | Where-Object {
            $path = [string]$_.ExecutablePath
            ($_.Name -in @('ZenCoreHostedWorker.exe','ZenCoreHostedWorkerManager.exe') -and $path.StartsWith('C:\Program Files\ZenCore\HostedWorker\',[StringComparison]::OrdinalIgnoreCase)) -or
            ($_.Name -eq 'terminal64.exe' -and $path.StartsWith("$base\slots\",[StringComparison]::OrdinalIgnoreCase))
        })
    } while ($remaining.Count -gt 0 -and (Get-Date) -lt $stopDeadline)
    if ($remaining.Count -gt 0) { throw 'RESTART_LEFT_MANAGED_PROCESSES' }
    $since = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    Start-ScheduledTask -TaskName 'ZenCore MT5 Worker Manager'
    $report.slots = @(Wait-SlotHealth -Since $since)
    $report.allSlotsConnected = ($report.slots.Count -gt 0 -and @($report.slots | Where-Object { -not $_.connected }).Count -eq 0)
    $report.restartPassed = $report.allSlotsConnected
    if (-not $report.allSlotsConnected) { $report.error = 'SLOT_CONNECTION_REQUIRES_ATTENTION' }
} catch {
    $report.error = 'UPGRADE_OR_VERIFICATION_FAILED'
    Write-Host $_.Exception.Message
    # Restore manager availability even when a verification stage fails.
    Start-ScheduledTask -TaskName 'ZenCore MT5 Worker Manager' -ErrorAction SilentlyContinue
} finally {
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    if (Test-Path "$base\manager-state.log") { Get-Content "$base\manager-state.log" -Tail 30 }
    Stop-Transcript | Out-Null
}
if ($null -ne $report.error) { exit 1 }
