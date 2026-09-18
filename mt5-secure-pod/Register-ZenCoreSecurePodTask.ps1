#Requires -Version 5.1
#Requires -RunAsAdministrator

[CmdletBinding()]
param(
    [string]$InstallRoot = "$env:ProgramFiles\ZenCore Secure Pod",

    [string]$ConfigPath = "$env:ProgramData\ZenCoreSecurePod\pod-config.json",

    [string]$TaskName = 'ZenCore Secure Pod',

    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Secure Pod config was not found: $ConfigPath"
}
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($config.demoExecutionEnabled -ne $false) {
    throw 'Task registration is blocked because demoExecutionEnabled is not false.'
}
$credentialPath = Join-Path ([string]$config.dataRoot) 'machine-credentials.dpapi'
if (-not (Test-Path -LiteralPath $credentialPath -PathType Leaf)) {
    throw 'Pair this Windows user before registering the worker task.'
}

$pythonPath = Join-Path $InstallRoot '.venv\Scripts\python.exe'
$workerPath = Join-Path $InstallRoot 'ZenCoreSecurePod.py'
if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf) -or -not (Test-Path -LiteralPath $workerPath -PathType Leaf)) {
    throw 'Secure Pod installation is incomplete.'
}

$windowsIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
Write-Host "The task must run as the same dedicated Windows user that performed pairing: $windowsIdentity"
Write-Host 'Enter this Windows user password. It is passed only to Windows Task Scheduler and never sent to ZenCore.' -ForegroundColor Yellow
$securePassword = Read-Host 'Dedicated Windows user password' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = $null
try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $argument = '"' + $workerPath + '" --config "' + $ConfigPath + '"'
    $action = New-ScheduledTaskAction -Execute $pythonPath -Argument $argument -WorkingDirectory $InstallRoot
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId $windowsIdentity -LogonType Password -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -RestartCount 20 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew
    $task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
        -Description 'Trader-owned ZenCore MT5 Secure Pod (DEMO locked until broker validation).'
    Register-ScheduledTask -TaskName $TaskName -InputObject $task -User $windowsIdentity -Password $plainPassword -Force | Out-Null
} finally {
    $plainPassword = $null
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $securePassword.Dispose()
}

if ($StartNow) {
    Start-ScheduledTask -TaskName $TaskName
}
Write-Host 'Secure Pod scheduled task registered under the paired Windows identity.' -ForegroundColor Green
Write-Host 'DEMO order execution remains locked by pod-config.json.' -ForegroundColor Yellow
