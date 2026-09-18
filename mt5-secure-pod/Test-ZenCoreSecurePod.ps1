#Requires -Version 5.1
#Requires -RunAsAdministrator

[CmdletBinding()]
param(
    [string]$InstallRoot = "$env:ProgramFiles\ZenCore Secure Pod",

    [string]$ConfigPath = "$env:ProgramData\ZenCoreSecurePod\pod-config.json",

    [string]$TaskName = 'ZenCore Secure Pod',

    [switch]$RequirePaired
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$checks = New-Object System.Collections.Generic.List[object]

function Add-Check {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][ValidateSet('PASS', 'WARN', 'FAIL')][string]$Status,
        [Parameter(Mandatory = $true)][string]$Detail
    )
    [void]$checks.Add([pscustomobject]@{ Check = $Name; Status = $Status; Detail = $Detail })
}

if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
    Add-Check 'Windows host' 'PASS' ([Environment]::OSVersion.VersionString)
} else {
    Add-Check 'Windows host' 'FAIL' 'Secure Pod requires Windows.'
}

try {
    $secureBoot = Confirm-SecureBootUEFI
    Add-Check 'Secure Boot' ($(if ($secureBoot) { 'PASS' } else { 'FAIL' })) ($(if ($secureBoot) { 'Enabled' } else { 'Disabled' }))
} catch {
    Add-Check 'Secure Boot' 'FAIL' 'Unable to confirm UEFI Secure Boot.'
}

try {
    $tpm = Get-Tpm
    $tpmReady = $tpm.TpmPresent -and $tpm.TpmReady -and $tpm.TpmEnabled -and $tpm.TpmActivated
    Add-Check 'vTPM ready' ($(if ($tpmReady) { 'PASS' } else { 'FAIL' })) ($(if ($tpmReady) { 'TPM is present, enabled, activated and ready.' } else { 'TPM is not fully ready.' }))
} catch {
    Add-Check 'vTPM ready' 'FAIL' 'Unable to read TPM state.'
}

try {
    $tpmInfo = Get-CimInstance -Namespace 'Root\CIMV2\Security\MicrosoftTpm' -ClassName 'Win32_Tpm'
    $spec = [string]$tpmInfo.SpecVersion
    Add-Check 'TPM 2.0' ($(if ($spec -match '2\.0') { 'PASS' } else { 'FAIL' })) "SpecVersion: $spec"
} catch {
    Add-Check 'TPM 2.0' 'FAIL' 'Unable to confirm TPM 2.0.'
}

try {
    $firewallProfiles = @(Get-NetFirewallProfile)
    $firewallReady = $firewallProfiles.Count -gt 0 -and @($firewallProfiles | Where-Object { -not $_.Enabled }).Count -eq 0
    Add-Check 'Windows Firewall' ($(if ($firewallReady) { 'PASS' } else { 'FAIL' })) ($(if ($firewallReady) { 'All firewall profiles are enabled.' } else { 'Enable every Windows Firewall profile.' }))
} catch {
    Add-Check 'Windows Firewall' 'FAIL' 'Unable to verify Windows Firewall profiles.'
}

$config = $null
if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) {
    try {
        $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
        Add-Check 'Pod config' 'PASS' $ConfigPath
    } catch {
        Add-Check 'Pod config' 'FAIL' 'Config is not valid JSON.'
    }
} else {
    Add-Check 'Pod config' 'FAIL' "Missing: $ConfigPath"
}

if ($null -ne $config) {
    $hostProfile = [string]$config.hostProfile
    if ($hostProfile -notin @('WINDOWS_PC', 'AZURE_CONFIDENTIAL_VM')) {
        Add-Check 'Host profile' 'FAIL' 'hostProfile must be WINDOWS_PC or AZURE_CONFIDENTIAL_VM.'
    } else {
        Add-Check 'Host profile' 'PASS' $hostProfile
    }

    if ($hostProfile -eq 'WINDOWS_PC') {
        try {
            $bitLocker = Get-BitLockerVolume -MountPoint $env:SystemDrive
            $bitLockerReady = $bitLocker.ProtectionStatus -eq 'On' -and $bitLocker.VolumeStatus -in @('FullyEncrypted', 'EncryptionInProgress')
            Add-Check 'BitLocker system drive' ($(if ($bitLockerReady) { 'PASS' } else { 'FAIL' })) ($(if ($bitLockerReady) { 'Protection is on.' } else { 'Enable BitLocker before pairing the PC.' }))
        } catch {
            Add-Check 'BitLocker system drive' 'FAIL' 'Unable to verify BitLocker protection.'
        }
        try {
            $rdpDisabled = (Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections).fDenyTSConnections -eq 1
            Add-Check 'Remote Desktop exposure' ($(if ($rdpDisabled) { 'PASS' } else { 'WARN' })) ($(if ($rdpDisabled) { 'Remote Desktop is disabled.' } else { 'Remote Desktop is enabled; restrict access and require MFA/VPN.' }))
        } catch {
            Add-Check 'Remote Desktop exposure' 'WARN' 'Unable to verify Remote Desktop state.'
        }
    }

    if ($hostProfile -eq 'AZURE_CONFIDENTIAL_VM') {
        try {
            $metadata = Invoke-RestMethod -Headers @{ Metadata = 'true' } -Method Get -TimeoutSec 3 -Uri 'http://169.254.169.254/metadata/instance/compute?api-version=2021-12-13'
            $vmSize = [string]$metadata.vmSize
            Add-Check 'Azure confidential size' ($(if ($vmSize -match '^Standard_DC.*v5$') { 'PASS' } else { 'FAIL' })) $vmSize
        } catch {
            Add-Check 'Azure metadata' 'FAIL' 'Azure Instance Metadata Service was not reachable.'
        }
    }

    try {
        $controlUri = [Uri]$config.controlUrl
        $validOrigin = $controlUri.Scheme -eq 'https' -and $controlUri.Host -eq 'zencore-precision-entry.onrender.com' -and $controlUri.Port -eq 443 -and -not $controlUri.UserInfo -and $controlUri.AbsolutePath -eq '/' -and -not $controlUri.Query -and -not $controlUri.Fragment
        Add-Check 'HTTPS control origin' ($(if ($validOrigin) { 'PASS' } else { 'FAIL' })) ($(if ($validOrigin) { $controlUri.Host } else { 'Invalid or credential-bearing URL.' }))
    } catch {
        Add-Check 'HTTPS control origin' 'FAIL' 'controlUrl is invalid.'
    }

    $executionEnabled = $config.demoExecutionEnabled -eq $true
    Add-Check 'DEMO execution gate' ($(if ($executionEnabled) { 'PASS' } else { 'WARN' })) ($(if ($executionEnabled) { 'Enabled locally; server gate and signed ON command are still required.' } else { 'Locked (connection/monitoring only).' }))

    if (Test-Path -LiteralPath ([string]$config.mt5TerminalPath) -PathType Leaf) {
        $terminalSignature = Get-AuthenticodeSignature -LiteralPath ([string]$config.mt5TerminalPath)
        Add-Check 'MT5 terminal file' 'PASS' ([string]$config.mt5TerminalPath)
        Add-Check 'MT5 signature' ($(if ($terminalSignature.Status -eq 'Valid') { 'PASS' } else { 'WARN' })) ([string]$terminalSignature.Status)
    } else {
        Add-Check 'MT5 terminal file' 'FAIL' 'Configured terminal64.exe was not found.'
    }

    try {
        Invoke-WebRequest -UseBasicParsing -Method Get -TimeoutSec 10 -Uri ($config.controlUrl.TrimEnd('/') + '/health') | Out-Null
        Add-Check 'ZenCore HTTPS reachability' 'PASS' 'Health endpoint reachable.'
    } catch {
        Add-Check 'ZenCore HTTPS reachability' 'FAIL' 'Health endpoint was not reachable over HTTPS.'
    }
}

$pythonPath = Join-Path $InstallRoot '.venv\Scripts\python.exe'
if (Test-Path -LiteralPath $pythonPath -PathType Leaf) {
    $packageVersion = ([string](& $pythonPath -c 'import MetaTrader5 as mt5; print(mt5.__version__)' 2>$null)).Trim()
    if ($LASTEXITCODE -eq 0 -and $packageVersion -eq '5.0.6180') {
        Add-Check 'MetaTrader5 package' 'PASS' $packageVersion
    } else {
        Add-Check 'MetaTrader5 package' 'FAIL' "Expected 5.0.6180; found $packageVersion"
    }
    if ($null -ne $config -and $config.demoExecutionEnabled -eq $true) {
        $workerPath = Join-Path $InstallRoot 'ZenCoreSecurePod.py'
        try {
            $terminalProbeText = ([string](& $pythonPath $workerPath --config $ConfigPath --terminal-preflight 2>$null)).Trim()
            $terminalProbeExit = $LASTEXITCODE
            $terminalProbe = $terminalProbeText | ConvertFrom-Json
            $terminalReady = $terminalProbeExit -eq 0 -and $terminalProbe.ok -eq $true
            $probeDetail = "mode=$($terminalProbe.tradeMode); serverAllowed=$($terminalProbe.serverAllowed); algo=$($terminalProbe.tradingAllowed); XAUUSD=$($terminalProbe.xauusdReady); $($terminalProbe.serverMask)"
            Add-Check 'InterStellar MT5 Demo execution' ($(if ($terminalReady) { 'PASS' } else { 'FAIL' })) $probeDetail
        } catch {
            Add-Check 'InterStellar MT5 Demo execution' 'FAIL' 'Unable to validate the running MT5 Demo terminal.'
        }
    }
} else {
    Add-Check 'Secure Pod Python' 'FAIL' "Missing: $pythonPath"
}

$forbiddenEnvironmentNames = @(
    'MT5_LOGIN', 'MT5_PASSWORD', 'MT5_SERVER',
    'ZENCORE_BROKER_LOGIN', 'ZENCORE_BROKER_PASSWORD', 'ZENCORE_BROKER_SERVER',
    'ZENCORE_PAIRING_CODE', 'ZENCORE_POD_TOKEN', 'ZENCORE_COMMAND_SIGNING_KEY'
)
$credentialEnvironmentFound = New-Object System.Collections.Generic.List[string]
foreach ($name in $forbiddenEnvironmentNames) {
    foreach ($target in @('Process', 'User', 'Machine')) {
        if ([Environment]::GetEnvironmentVariable($name, $target)) {
            [void]$credentialEnvironmentFound.Add("$target/$name")
        }
    }
}
if ($credentialEnvironmentFound.Count -eq 0) {
    Add-Check 'Credential environment' 'PASS' 'No broker or long-lived pod secrets found in environment variables.'
} else {
    Add-Check 'Credential environment' 'FAIL' ('Remove: ' + ($credentialEnvironmentFound -join ', '))
}

$credentialPath = "$env:ProgramData\ZenCoreSecurePod\machine-credentials.dpapi"
if ($null -ne $config -and $config.dataRoot) {
    $credentialPath = Join-Path ([string]$config.dataRoot) 'machine-credentials.dpapi'
}
if (Test-Path -LiteralPath $credentialPath -PathType Leaf) {
    Add-Check 'Pod pairing' 'PASS' 'DPAPI-protected pod identity exists.'
} elseif ($RequirePaired) {
    Add-Check 'Pod pairing' 'FAIL' 'Pair this pod before registering or starting the worker.'
} else {
    Add-Check 'Pod pairing' 'WARN' 'Not paired yet; this is expected before the pairing step.'
}

try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    Add-Check 'Scheduled worker' 'PASS' ([string]$task.State)
} catch {
    Add-Check 'Scheduled worker' 'WARN' 'Not registered yet.'
}

Write-Host ''
$checks | Format-Table -AutoSize
$failed = @($checks | Where-Object { $_.Status -eq 'FAIL' })
if ($failed.Count -gt 0) {
    Write-Host "Preflight failed: $($failed.Count) blocking check(s)." -ForegroundColor Red
    exit 1
}
Write-Host 'Preflight passed. Warnings still require trader review.' -ForegroundColor Green
exit 0
