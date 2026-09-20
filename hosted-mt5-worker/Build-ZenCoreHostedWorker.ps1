[CmdletBinding()]
param(
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$version = (Get-Content -Raw -LiteralPath (Join-Path $source "VERSION")).Trim()
if ($version -ne "2.0.0-gcp-connect") {
    throw "Unexpected hosted worker version."
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $source "dist"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("zencore-hosted-build-" + [Guid]::NewGuid().ToString("N"))
$venv = Join-Path $temporaryRoot "venv"
$release = Join-Path $temporaryRoot "release"
$pyinstallerWork = Join-Path $temporaryRoot "pyinstaller"
New-Item -ItemType Directory -Force -Path $temporaryRoot, $release, $pyinstallerWork | Out-Null

try {
    $bootstrapPython = (Get-Command python -ErrorAction Stop).Source
    $pythonVersion = (& $bootstrapPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')").Trim()
    if ($pythonVersion -ne "3.12") {
        throw "Hosted worker build requires Python 3.12; found $pythonVersion."
    }
    & $bootstrapPython -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw "Python 3.12 virtual environment creation failed." }
    $python = Join-Path $venv "Scripts\python.exe"
    & $python -m pip install --disable-pip-version-check `
        -r (Join-Path $source "requirements.txt") `
        -r (Join-Path $source "requirements-build.txt")
    if ($LASTEXITCODE -ne 0) { throw "Pinned worker build dependencies failed to install." }

    $oldPythonPath = $env:PYTHONPATH
    try {
        $env:PYTHONPATH = $source
        & $python -m unittest discover -s $source -p "test_*.py"
        if ($LASTEXITCODE -ne 0) { throw "Hosted worker tests failed." }
    } finally {
        $env:PYTHONPATH = $oldPythonPath
    }

    & $python -m PyInstaller `
        --noconfirm `
        --clean `
        --onefile `
        --name "ZenCoreHostedWorker" `
        --paths $source `
        --collect-all MetaTrader5 `
        --collect-all numpy `
        --hidden-import numpy `
        --distpath $release `
        --workpath $pyinstallerWork `
        --specpath $pyinstallerWork `
        (Join-Path $source "hosted_worker.py")
    if ($LASTEXITCODE -ne 0) { throw "Hosted worker executable build failed." }

    Copy-Item -Force -LiteralPath (Join-Path $source "Install-ZenCoreHostedWorker.ps1") -Destination $release
    Copy-Item -Force -LiteralPath (Join-Path $source "README.md") -Destination $release
    Copy-Item -Force -LiteralPath (Join-Path $source "VERSION") -Destination $release

    $files = @("ZenCoreHostedWorker.exe", "README.md", "VERSION") | ForEach-Object {
        $itemPath = Join-Path $release $_
        [ordered]@{
            path = $_
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $itemPath).Hash.ToLowerInvariant()
        }
    }
    $manifest = [ordered]@{
        schemaVersion = 1
        connectorVersion = $version
        executionUnlocked = $false
        createdAt = (Get-Date).ToUniversalTime().ToString("o")
        files = @($files)
    }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content `
        -LiteralPath (Join-Path $release "release-manifest.json") -Encoding UTF8

    $zipName = "ZenCore_Hosted_Worker_GCP_v$version.zip"
    $zipPath = Join-Path $OutputDirectory $zipName
    Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $zipPath
    Compress-Archive -Path (Join-Path $release "*") -DestinationPath $zipPath -CompressionLevel Optimal
    $sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$zipPath.sha256" -Value "$sha  $zipName" -Encoding ASCII
    Write-Host "Built $zipPath"
    Write-Host "SHA-256 $sha"
} finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -Recurse -Force -LiteralPath $temporaryRoot
    }
}
