@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-jetwork-local.ps1"
set "jetwork_exit_code=%ERRORLEVEL%"
if not "%jetwork_exit_code%"=="0" pause
exit /b %jetwork_exit_code%
