#Requires -Version 5.1

[CmdletBinding()]
param(
    [string]$InstallRoot = "$env:ProgramFiles\ZenCore Secure Pod",

    [string]$ConfigPath = "$env:ProgramData\ZenCoreSecurePod\pod-config.json"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Secure Pod config was not found: $ConfigPath"
}
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($config.demoExecutionEnabled -ne $false) {
    throw 'Pairing is blocked because demoExecutionEnabled is not false.'
}
$credentialPath = Join-Path ([string]$config.dataRoot) 'machine-credentials.dpapi'
if (Test-Path -LiteralPath $credentialPath -PathType Leaf) {
    throw 'This Windows user is already paired. Do not delete or replace the pod identity while positions are open.'
}

$pythonPath = Join-Path $InstallRoot '.venv\Scripts\python.exe'
$workerPath = Join-Path $InstallRoot 'ZenCoreSecurePod.py'
if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf) -or -not (Test-Path -LiteralPath $workerPath -PathType Leaf)) {
    throw 'Secure Pod installation is incomplete.'
}

Write-Host 'Generate a one-time code on the ZenCore Auto Trade page.' -ForegroundColor Cyan
Write-Host 'The next prompt is read directly by Python with hidden console input.'
& $pythonPath $workerPath --config $ConfigPath --pair-only
if ($LASTEXITCODE -ne 0) {
    throw 'Secure Pod pairing failed.'
}
if (-not (Test-Path -LiteralPath $credentialPath -PathType Leaf)) {
    throw 'Pairing returned without creating the DPAPI-protected pod identity.'
}
Write-Host 'Pairing complete. Broker login, password and full server were not requested.' -ForegroundColor Green
