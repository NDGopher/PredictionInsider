@echo off
REM ============================================================================
REM  Double-click this file.
REM
REM  Starts Docker Postgres, creates tables, starts the website on a FREE port,
REM  opens your browser, and runs Telegram + TAKE keepalive in the server window.
REM  Pipeline ingest runs in the background once the server is up.
REM
REM  Leave the "PredictionInsider Server" window open.
REM ============================================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-app.ps1"
if errorlevel 1 (
  echo.
  echo Launch failed. Read the messages above.
  pause
  exit /b 1
)
echo.
echo Browser should be open. You can close THIS window.
echo Keep the "PredictionInsider Server" window running.
pause
exit /b 0
