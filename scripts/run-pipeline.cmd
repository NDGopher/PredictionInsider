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
echo Running FULL pipeline: fetch + analyze + ingest, then ranks / copy list...
%PY% pnl_analysis\run_full_pipeline.py --ingest
set "EC=%errorlevel%"
goto refresh_product

:run_inc
echo Scanning Polydata sports boards for new watch names...
%PY% pnl_analysis\discover_polydata_boards.py
echo Running INCREMENTAL pipeline: merge recent trades + re-analyze + ingest...
%PY% pnl_analysis\run_full_pipeline.py --incremental --ingest
set "EC=%errorlevel%"
goto refresh_product

:refresh_product
echo.
echo Rebuilding Insider Ranks, copy universe, and take-book (app stays up)...
%PY% pnl_analysis\refresh_product.py
set "PEC=%errorlevel%"
if not "%PEC%"=="0" if "%EC%"=="0" set "EC=%PEC%"

:after_py
echo.
echo Pipeline finished with exit code %EC%
if /i not "%~2"=="nopause" pause
exit /b %EC%
