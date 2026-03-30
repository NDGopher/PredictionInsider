@echo off
REM Kills any process listening on the given TCP port (Windows).
REM Usage: kill-listen-port.cmd [5000]
setlocal
set "PORT=%~1"
if "%PORT%"=="" set "PORT=5000"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kill-listen-port.ps1" -Port %PORT%
set "K=%errorlevel%"
if not "%K%"=="0" (
  echo [kill-listen-port] PowerShell reported exit %K%. Continuing anyway.
)
exit /b 0
