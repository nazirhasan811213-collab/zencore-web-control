@echo off
powershell.exe -NoProfile -File "%~dp0Upgrade-ZenCore-Automatic.ps1"
if errorlevel 1 pause
