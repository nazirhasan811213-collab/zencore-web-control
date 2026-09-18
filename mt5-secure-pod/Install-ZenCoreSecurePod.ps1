#Requires -Version 5.1
#Requires -RunAsAdministrator

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Mt5TerminalPath,

    [ValidatePattern('^https://')]
    [string]$ControlUrl = 'https://zencore-precision-entry.onrender.com',

    [ValidateSet('WINDOWS_PC', 'AZURE_CONFIDENTIAL_VM')]
    [string]$HostProfile = 'WINDOWS_PC',

    [string]$InstallRoot = "$env:ProgramFiles\ZenCore Secure Pod",

    [string]$DataRoot = "$env:ProgramData\ZenCoreSecurePod",

    [string]$PythonLauncher = 'py.exe',

    [switch]$EnableDemoExecution,

    [string]$SymbolMapJson = '{"XAUUSD":"XAUUSD","EURUSD":"EURUSD","GBPUSD":"GBPUSD","USDJPY":"USDJPY","US30":"US30","USDCAD":"USDCAD","USDCHF":"USDCHF","EURJPY":"EURJPY","GBPJPY":"GBPJPY","EURGBP":"EURGBP","BTCUSD":"BTCUSD"}'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$SupportedMarkets = @(
    'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'US30', 'USDCAD',
    'USDCHF', 'EURJPY', 'GBPJPY', 'EURGBP', 'BTCUSD'
)

function Set-ZenCoreDataAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    $currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $identitySids = @(
        $currentIdentity.User
        [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
        [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    )
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $inheritance = (
        [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    )
    foreach ($sid in $identitySids) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        [void]$acl.AddAccessRule($rule)
    }
    [System.IO.Directory]::SetAccessControl($Path, $acl)
}

$controlOrigin = [System.Uri]$ControlUrl
if ($controlOrigin.Scheme -ne 'https' -or $controlOrigin.Host -ne 'zencore-precision-entry.onrender.com' -or $controlOrigin.Port -ne 443 -or $controlOrigin.UserInfo -or $controlOrigin.AbsolutePath -ne '/' -or $controlOrigin.Query -or $controlOrigin.Fragment) {
    throw 'ControlUrl must be the approved ZenCore HTTPS origin.'
}
if (-not (Test-Path -LiteralPath $Mt5TerminalPath -PathType Leaf)) {
    throw "MT5 terminal was not found at: $Mt5TerminalPath"
}
if ($EnableDemoExecution -and $HostProfile -ne 'WINDOWS_PC') {
    throw 'This reviewed DEMO execution rollout only permits hostProfile WINDOWS_PC.'
}

try {
    $symbolMap = $SymbolMapJson | ConvertFrom-Json
} catch {
    throw 'SymbolMapJson must be valid JSON.'
}
$mapKeys = @($symbolMap.PSObject.Properties.Name)
$unknownMarkets = @($mapKeys | Where-Object { $_ -notin $SupportedMarkets })
$missingMarkets = @($SupportedMarkets | Where-Object { $_ -notin $mapKeys })
$emptyMappings = @($symbolMap.PSObject.Properties | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.Value) })
if ($unknownMarkets.Count -gt 0 -or $missingMarkets.Count -gt 0 -or $emptyMappings.Count -gt 0) {
    throw 'SymbolMapJson must contain exactly the 11 supported ZenCore market keys.'
}

$requiredSourceFiles = @(
    'VERSION',
    'README-PC-WINDOWS.md',
    'ZenCoreSecurePod.py',
    'requirements.txt',
    'Test-ZenCoreSecurePod.ps1',
    'Pair-ZenCoreSecurePod.ps1',
    'Register-ZenCoreSecurePodTask.ps1'
)
foreach ($fileName in $requiredSourceFiles) {
    $sourcePath = Join-Path $PSScriptRoot $fileName
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Installer source file is missing: $sourcePath"
    }
}

$pythonVersion = ([string](& $PythonLauncher -3.12 -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')).Trim()
if ($LASTEXITCODE -ne 0 -or -not $pythonVersion.StartsWith('3.12.')) {
    throw 'Python 3.12 x64 and the Windows py.exe launcher are required.'
}

New-Item -Path $InstallRoot -ItemType Directory -Force | Out-Null
New-Item -Path $DataRoot -ItemType Directory -Force | Out-Null
Set-ZenCoreDataAcl -Path $DataRoot

foreach ($fileName in $requiredSourceFiles) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $fileName) -Destination (Join-Path $InstallRoot $fileName) -Force
}

$venvRoot = Join-Path $InstallRoot '.venv'
& $PythonLauncher -3.12 -m venv $venvRoot
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to create the Secure Pod Python virtual environment.'
}
$pythonPath = Join-Path $venvRoot 'Scripts\python.exe'
& $pythonPath -m pip --isolated install --disable-pip-version-check --no-input --no-cache-dir -r (Join-Path $InstallRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to install the pinned Secure Pod Python dependency.'
}
$mt5PackageVersion = ([string](& $pythonPath -c 'import MetaTrader5 as mt5; print(mt5.__version__)')).Trim()
if ($LASTEXITCODE -ne 0 -or $mt5PackageVersion -ne '5.0.6180') {
    throw "Unexpected MetaTrader5 Python package version: $mt5PackageVersion"
}

$configPath = Join-Path $DataRoot 'pod-config.json'
$config = [ordered]@{
    schemaVersion = 1
    controlUrl = $ControlUrl.TrimEnd('/')
    hostProfile = $HostProfile
    mt5TerminalPath = $Mt5TerminalPath
    symbolMap = $symbolMap
    pollSeconds = 2
    demoExecutionEnabled = [bool]$EnableDemoExecution
    dataRoot = $DataRoot
}
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8

Write-Host ''
Write-Host 'ZenCore Secure Pod files installed.' -ForegroundColor Green
Write-Host "Install root : $InstallRoot"
Write-Host "Data root    : $DataRoot"
Write-Host "Config       : $configPath"
Write-Host "Host profile : $HostProfile"
$executionLabel = if ($EnableDemoExecution) { 'DEMO ENABLED (XAUUSD only)' } else { 'LOCKED (connection/monitoring only)' }
$executionColour = if ($EnableDemoExecution) { 'Green' } else { 'Yellow' }
Write-Host "Execution    : $executionLabel" -ForegroundColor $executionColour
Write-Host ''
Write-Host 'Next: run Test-ZenCoreSecurePod.ps1, pair from the ZenCore page, then register the scheduled task.'
