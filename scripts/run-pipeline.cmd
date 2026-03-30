@echo off
REM Helper: expects cwd = repo root when called with call; otherwise cds to repo root.
REM Optional 2nd arg "nopause" — for scripted runs from start-prediction-insider.bat
setlocal
cd /d "%~dp0.."

set "MODE=%~1"
if "%MODE%"=="" set "MODE=incremental"

python --version >nul 2>&1
if errorlevel 1 (
  py -3 --version >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.11+ and add to PATH.
    pause
    exit /b 1
  )
  set "PY=py -3"
) else (
  set "PY=python"
)

if /i "%MODE%"=="full" goto run_full
if /i "%MODE%"=="incremental" goto run_inc
echo Unknown mode: %MODE%. Use full or incremental.
pause
exit /b 1

:run_full
echo Running FULL pipeline: fetch + analyze + ingest for all curated traders (can take a long time^)...
%PY% pnl_analysis\run_full_pipeline.py --ingest
set "EC=%errorlevel%"
goto after_py

:run_inc
echo Running INCREMENTAL pipeline: merge recent trades + re-analyze + ingest...
%PY% pnl_analysis\run_full_pipeline.py --incremental --ingest
set "EC=%errorlevel%"

:after_py
echo.
echo Pipeline finished with exit code %EC%
if /i not "%~2"=="nopause" pause
exit /b %EC%
