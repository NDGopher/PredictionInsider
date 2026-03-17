@echo off
REM =============================================================================
REM PredictionInsider — Local Trader Refresh (Windows)
REM =============================================================================
REM HOW TO USE:
REM   1. Copy this file + run_full_pipeline.py + analyze_trader.py to a folder
REM      (e.g. C:\pi_refresh\)
REM   2. Set BACKEND_URL below to your deployed app URL
REM   3. Double-click or run from Command Prompt:  refresh_local.bat
REM
REM TO SCHEDULE ON WINDOWS:
REM   Open Task Scheduler → Create Basic Task
REM   Action: Start a Program → C:\pi_refresh\refresh_local.bat
REM   Trigger: Every 3 days at a time you prefer
REM =============================================================================

set BACKEND_URL=https://YOUR-APP-NAME.replit.app
set STALE_DAYS=3
set SCRIPT_DIR=%~dp0

if "%BACKEND_URL%"=="https://YOUR-APP-NAME.replit.app" (
    echo ERROR: Edit refresh_local.bat and set BACKEND_URL to your deployed app URL
    pause
    exit /b 1
)

echo ======================================================================
echo   PredictionInsider Refresh — %DATE% %TIME%
echo   Backend : %BACKEND_URL%
echo   Stale   : ^>%STALE_DAYS% days gets re-fetched
echo ======================================================================

set BACKEND_URL=%BACKEND_URL%
python "%SCRIPT_DIR%run_full_pipeline.py" --stale-days %STALE_DAYS% --ingest

echo.
echo ======================================================================
echo   Done — %DATE% %TIME%
echo ======================================================================
pause
