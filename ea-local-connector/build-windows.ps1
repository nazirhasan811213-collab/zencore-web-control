$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
python -m pip install pyinstaller==6.16.0
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller install failed' }
$buildVersion = python -c "import sys; sys.path.insert(0,'ea-local-connector'); from protocol import CONNECTOR_BUILD; print(CONNECTOR_BUILD)"
if ($LASTEXITCODE -ne 0 -or !$buildVersion) { throw 'Connector version unavailable' }
python -m PyInstaller --noconfirm --clean --onefile --windowed --name ZenCoreConnector --paths ea-local-connector --add-data 'ea-local-connector/ZenCoreExecutor.mq5;.' ea-local-connector/connector.py
if ($LASTEXITCODE -ne 0) { throw 'Connector build failed' }
$connector = (Resolve-Path 'dist/ZenCoreConnector.exe').Path
$test = Start-Process $connector -ArgumentList '--self-test', '--output=packaging-test.json' -Wait -PassThru
if ($test.ExitCode -ne 0 -or !(Test-Path packaging-test.json)) { throw 'Connector self-test failed' }
$iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if ($iscc) { $compiler = $iscc.Source }
else { $compiler = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' }
if (!(Test-Path $compiler)) { throw 'Inno Setup 6 is required on the build machine' }
& $compiler ea-local-connector/installer.iss
if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' }
$installer = Join-Path 'dist' "ZenCoreSetup-$buildVersion.exe"
$guide = Join-Path 'ea-local-connector' "PANDUAN_INSTALL_$buildVersion.txt"
if (!(Test-Path $installer) -or !(Test-Path $guide)) { throw 'Installer or guide does not match Connector version' }
Get-FileHash $installer -Algorithm SHA256 | Format-List | Out-File dist/SHA256.txt
Copy-Item ea-local-connector/ZenCoreExecutor.mq5,$guide,packaging-test.json dist/
