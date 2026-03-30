@echo off
REM One-click: Docker + db:init + NEW dev server + SMART pipeline (incremental+ingest only if last ingest ^>24h).
REM Double-click this file. Force refresh anytime: start-prediction-insider.bat incremental
cd /d "%~dp0"
call start-prediction-insider.bat
set "RC=%errorlevel%"
if not "%RC%"=="0" (
  echo.
  echo [refresh-all] Finished with errors (code %RC%). Read messages above.
  pause
  exit /b %RC%
)
echo.
echo [refresh-all] All steps completed OK.
pause
exit /b 0
