@echo off
REM One-click: Docker + db:init + dev server + ALWAYS incremental pipeline (merge recent CSVs, re-analyze, ingest).
REM For fast start without pipeline: start-prediction-insider.bat skip
REM Smart mode (pipeline only if stale): start-prediction-insider.bat
cd /d "%~dp0"
call start-prediction-insider.bat incremental
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
