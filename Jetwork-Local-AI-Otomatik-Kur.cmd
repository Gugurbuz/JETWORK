@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-jetwork-local-startup.ps1"
set "jetwork_exit_code=%ERRORLEVEL%"
echo.
pause
exit /b %jetwork_exit_code%
