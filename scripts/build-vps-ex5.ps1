$ErrorActionPreference = 'Stop'
$mt5 = Join-Path $env:RUNNER_TEMP 'ZenCore-MT5-Build'
$setup = Join-Path $env:RUNNER_TEMP 'mt5setup.exe'
Invoke-WebRequest -Uri 'https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe' -OutFile $setup
$sig = Get-AuthenticodeSignature $setup
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'MetaQuotes') { throw 'MetaQuotes installer signature invalid' }
$p = Start-Process $setup -ArgumentList '/auto', "/path:`"$mt5`"" -PassThru
$editor = $null
for ($i=0; $i -lt 45 -and -not $editor; $i++) {
    $editor = @("$mt5\metaeditor64.exe", "$env:ProgramFiles\MetaTrader 5\metaeditor64.exe") |
        Where-Object { (Test-Path $_) -and (Test-Path (Join-Path (Split-Path $_) 'terminal64.exe')) } | Select-Object -First 1
    if (-not $editor) { Start-Sleep -Seconds 4 }
}
if (-not $editor) { throw 'MetaEditor not installed by MetaQuotes setup' }
$program = Split-Path $editor
$terminal = Start-Process (Join-Path $program 'terminal64.exe') -ArgumentList '/portable' -PassThru
try {
    $include = Join-Path $program 'MQL5'
    for ($i=0; $i -lt 25 -and -not (Test-Path "$include\Include\Trade\Trade.mqh"); $i++) { Start-Sleep -Seconds 2 }
    if (-not (Test-Path "$include\Include\Trade\Trade.mqh")) { throw 'MT5 standard library missing' }
    $work = Join-Path $env:RUNNER_TEMP 'ZenCore-EA-Compile'
    New-Item -ItemType Directory -Force $work,dist | Out-Null
    Copy-Item ea-local-connector/ZenCoreExecutor*.mq5 $work
    foreach ($name in 'ZenCoreExecutor', 'ZenCoreExecutor_XAUUSD', 'ZenCoreExecutor_BTCUSD') {
        $src = Join-Path $work "$name.mq5"
        $log = Join-Path $work "$name.log"
        $compiled = Join-Path $work "$name.ex5"
        $build = Start-Process $editor -ArgumentList '/portable',"/compile:`"$src`"","/include:`"$include`"","/log:`"$log`"" -PassThru
        if (-not $build.WaitForExit(90000)) { $build.Kill(); throw "$name compile timed out" }
        if (Test-Path $log) { Get-Content $log }
        if (-not (Test-Path $compiled) -or -not (Test-Path $log) -or (Get-Content $log -Raw) -notmatch 'Result:\s*0 errors') {
            throw "$name compilation did not succeed"
        }
        Copy-Item $compiled dist/
    }
} finally {
    if (-not $terminal.HasExited) { Stop-Process -Id $terminal.Id -ErrorAction SilentlyContinue }
}
