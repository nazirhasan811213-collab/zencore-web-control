@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0Install-ZenCore20Slots.ps1" -Apply
pause
