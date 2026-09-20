[CmdletBinding()]
param(
    [switch]$RequireWorker,
    [switch]$RequireAssignment
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = "C:\ProgramData\ZenCore\HostedWorker"
$configPath = Join-Path $root "worker-config.json"
$lockPath = Join-Path $root "EXECUTION_LOCKED"
$results = [ordered]@{}

$results.WindowsServer = (Get-CimInstance Win32_OperatingSystem).Caption -match "Windows Server"
$results.SecureBoot = Confirm-SecureBootUEFI
$tpm = Get-Tpm
$results.TpmPresent = $tpm.TpmPresent -eq $true
$results.TpmReady = $tpm.TpmReady -eq $true
$results.ConfigPresent = Test-Path -LiteralPath $configPath
$results.ExecutionLockPresent = Test-Path -LiteralPath $lockPath

if ($results.ConfigPresent) {
    $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    $results.DemoOnly = $config.demoOnly -eq $true
    $results.ExecutionLocked = $config.executionEnabled -eq $false
    $results.MemoryOnlyCredentials = $config.credentialStorage -eq "MEMORY_ONLY"
    $results.NoPrivateKey = $config.privateKeyAvailable -eq $false
    $results.ControlPlaneAudiencePinned = $config.controlPlaneAudience -eq `
        "$($config.controlPlaneUrl)/api/hosted-execution"
    $results.ConnectorLocked = $config.connectorVersion -eq "2.0.0-gcp-connect"
    $results.ApprovedDemoServer = $config.approvedDemoServer -eq "InterStellarFinancial-Demo"
    if ($RequireAssignment) {
        $results.HostedAccountAssigned = [string]$config.hostedAccountId -match `
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
        $results.Mt5TerminalPresent = Test-Path -LiteralPath ([string]$config.mt5TerminalPath) -PathType Leaf
    }
}

if ($RequireWorker) {
    $task = Get-ScheduledTask -TaskName "ZenCore Hosted MT5 Demo Worker" -ErrorAction SilentlyContinue
    $results.WorkerTaskPresent = $null -ne $task
    if ($RequireAssignment -and $null -ne $task) {
        $results.WorkerTaskEnabled = $task.State -ne "Disabled"
    }
}

$metadataHeaders = @{ "Metadata-Flavor" = "Google" }
try {
    $externalIp = Invoke-RestMethod -Headers $metadataHeaders -TimeoutSec 3 `
        -Uri "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip"
    $results.NoPublicIp = [string]::IsNullOrWhiteSpace([string]$externalIp)
} catch {
    $results.NoPublicIp = $true
}

$forbidden = @(
    "MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER", "MT5_PRIVATE_KEY",
    "ZENCORE_MT5_PRIVATE_KEY", "ZENCORE_BROKER_PASSWORD"
)
$results.NoBrokerSecretsInEnvironment = -not ($forbidden | Where-Object {
    -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_))
})

$failed = @($results.GetEnumerator() | Where-Object { $_.Value -ne $true })
$results | Format-Table -AutoSize
if ($failed.Count -gt 0) {
    throw "Google Cloud Demo cell preflight failed: $($failed.Name -join ', ')"
}
Write-Host "ZenCore Google Cloud Demo cell preflight PASS. Order execution remains LOCKED." -ForegroundColor Green
