$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
python -m pip install pyinstaller==6.16.0
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller install failed' }
python -m PyInstaller --noconfirm --clean --onefile --windowed --name ZenCoreConnector --paths ea-local-connector --add-data 'ea-local-connector/ZenCoreExecutor.mq5:.' ea-local-connector/connector.py
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
Get-FileHash dist/ZenCoreSetup-1.27.exe -Algorithm SHA256 | Format-List | Out-File dist/SHA256.txt
Copy-Item ea-local-connector/ZenCoreExecutor.mq5,ea-local-connector/PANDUAN_INSTALL_1.27.txt,packaging-test.json dist/
