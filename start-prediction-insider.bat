@echo off
REM ============================================================================
REM  PredictionInsider - one-shot local start (Windows)
REM
REM  Usage:
REM    start-prediction-insider.bat              -> Docker + smart: incremental pipeline if last ingest ^> PI_SMART_REFRESH_HOURS (default 6h)
REM    start-prediction-insider.bat incremental  -> always run incremental pipeline + ingest
REM    start-prediction-insider.bat full         -> Docker + FULL pipeline + dev
REM    start-prediction-insider.bat skip         -> Docker + dev only (no pipeline window)
REM    start-prediction-insider.bat hosted       -> NO Docker; use DATABASE_URL in .env (Neon etc.)
REM    start-prediction-insider.bat hosted skip  -> hosted DB + dev only
REM
REM  Or double-click: refresh-all.bat  (same as this file)
REM
REM  If Docker says "unable to start" or "daemon": open Docker Desktop from Start menu,
REM  wait until it says Engine running, then run this again — or use "hosted" mode.
REM ============================================================================
setlocal EnableDelayedExpansion

cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found in PATH. Install Node.js 20+ and reopen this window.
  pause
  exit /b 1
)

REM Old Node on port 5000 keeps OLD DATABASE_URL - db:push works but ingest returns 500.
call "%~dp0scripts\kill-listen-port.cmd" 5000

echo.
echo  === PredictionInsider local start ===
echo.

REM ---------- Optional: remote Postgres only (no Docker) ----------
set "ARG1=%~1"
set "ARG2=%~2"
if /i "%ARG1%"=="hosted" (
  set "MODE=%ARG2%"
  if "!MODE!"=="" set "MODE=smart"
  if /i "!MODE!"=="server" set "MODE=skip"
  goto hosted_db
)

REM ---------- Normal path: local Docker Postgres ----------
set "MODE=%ARG1%"
if "%MODE%"=="" set "MODE=smart"
if /i "%MODE%"=="server" set "MODE=skip"

where docker >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker not found in PATH.
  echo Install Docker Desktop: https://docs.docker.com/desktop/install/windows-install/
  echo Or use remote Postgres:  start-prediction-insider.bat hosted
  pause
  exit /b 1
)

echo Checking Docker Engine ^(daemon^)...
docker info >nul 2>&1
if errorlevel 1 (
  echo Engine not ready - attempting to start Docker Desktop and wait ^(up to 3 min^)...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-docker-running.ps1"
  if errorlevel 1 (
    echo.
    echo [ERROR] Docker engine still not running after wait.
    echo.
    echo Try in order:
    echo   1. Open "Docker Desktop" from the Start menu — wait until the whale shows "Engine running"
    echo      ^(can take 1–2 minutes after login^).
    echo   2. Quit Docker Desktop completely ^(tray -^> Quit^), then start it again.
    echo   3. Reboot Windows ^(Docker often needs this once after install^).
    echo   4. Admin PowerShell:  wsl --update   then reboot ^(WSL2^).
    echo   5. Task Manager -^> CPU - "Virtualization: Enabled"
    echo   6. Docker Desktop -^> Troubleshoot -^> Restart
    echo.
    echo No Docker? Use cloud Postgres: https://neon.tech  — set DATABASE_URL in .env, then:
    echo   start-prediction-insider.bat hosted
    echo.
    pause
    exit /b 1
  )
)

echo [1/4] Starting PostgreSQL ^(docker compose up -d^)...
docker compose up -d
if errorlevel 1 (
  echo.
  echo [ERROR] docker compose failed. Common causes:
  echo   - Engine still starting: wait 30s, run this again.
  echo   - Corporate firewall blocking registry: try another network or VPN off.
  echo   - Out of disk space.
  echo.
  echo Try:  docker pull postgres:16-alpine
  echo If that fails, see messages above or use:  start-prediction-insider.bat hosted
  echo.
  pause
  exit /b 1
)

echo [2/4] Waiting for Postgres ^(pg_isready^)...
set /a _tries=0
:waitpg
docker compose exec -T db pg_isready -U predictioninsider -d predictioninsider >nul 2>&1
if not errorlevel 1 goto pgok
set /a _tries+=1
if !_tries! GTR 90 (
  echo [ERROR] Postgres did not become ready. Try: docker compose logs db
  pause
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto waitpg
:pgok

REM Do NOT run npm run db:push here: drizzle.config points at shared/schema.ts which is Zod-only
REM (no pgTable definitions). db:push will propose DROPPING elite_* tables to "match" schema.
REM Tables are created/updated safely by db:init (init-db.sql, IF NOT EXISTS).
echo [3/4] Ensuring SQL tables ^(npm run db:init - elite_traders, profiles, etc.^)...
call npm run db:init
if errorlevel 1 (
  echo [WARN] db:init failed - if the DB is new, fix errors above. Continuing.
)
goto pipeline_and_dev

REM ---------- Hosted DB: no Docker ----------
:hosted_db
echo [hosted] Skipping Docker - using DATABASE_URL from .env ^(remote Postgres^).
echo Make sure your Neon/other URL is in .env and has ?sslmode=require if required.
echo.
echo [hosted] Ensuring SQL tables ^(npm run db:init^) - skipping db:push ^(see comments in start-prediction-insider.bat^).
call npm run db:init
if errorlevel 1 (
  echo [WARN] db:init failed. Continuing.
)

:pipeline_and_dev
if /i "%MODE%"=="skip" goto startdev

set "SKIP_PIPELINE="
if /i "%MODE%"=="smart" (
  node "%~dp0scripts\pipeline-should-run.mjs"
  if not errorlevel 1 set "SKIP_PIPELINE=1"
)

echo [4/4] Starting API server in a NEW window, then pipeline HERE ^(ingest needs a fresh server^)...
echo      Mode: %MODE%
start "PredictionInsider Server" "%~dp0scripts\start-server-dev.cmd"
echo Waiting for http://127.0.0.1:5000 ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wait-http-5000.ps1"
if errorlevel 1 (
  echo [ERROR] Dev server did not start. Read errors in the "PredictionInsider Server" window.
  pause
  exit /b 1
)

if defined SKIP_PIPELINE (
  echo.
  echo === Smart refresh: Python pipeline skipped - last ingest within PI_SMART_REFRESH_HOURS ^(default 6h^) ===
  echo - Open http://127.0.0.1:5000
  echo - Canonical PnL in the server still refreshes on its own 24h timer while it runs.
  echo - To force CSV merge + ingest now: start-prediction-insider.bat incremental
  echo   Or: set PI_FORCE_REFRESH=1 then run this script again
  echo.
  pause
  exit /b 0
)

echo.
echo Running analysis + ingest in THIS window. On success you will see grade changes and [OK] traders updated.
echo.
if /i "%MODE%"=="full" (
  call "%~dp0scripts\run-pipeline.cmd" full nopause
) else if /i "%MODE%"=="incremental" (
  call "%~dp0scripts\run-pipeline.cmd" incremental nopause
) else if /i "%MODE%"=="smart" (
  call "%~dp0scripts\run-pipeline.cmd" incremental nopause
) else (
  echo Unknown pipeline mode: %MODE%. Use: full ^| incremental ^| smart ^| skip ^| server
  pause
  exit /b 1
)
if errorlevel 1 (
  echo.
  echo [ERROR] Pipeline failed ^(often ingest 500 - old Node on port 5000 or wrong DATABASE_URL^).
  echo Fix: close stray terminals, run this script again ^(it kills port 5000 first^), or check .env.
  pause
  exit /b 1
)

echo.
echo === Pipeline step finished ===
echo - Leave the "PredictionInsider Server" window open. Open http://127.0.0.1:5000
echo - Grade change reports: pnl_analysis\output\grade_changes_*.json ^(after a successful ingest with a prior _previous_ingest.json^)
echo.
pause
exit /b 0

:startdev
echo Starting dev server in THIS window ^(no pipeline^). Open http://127.0.0.1:5000
call npm run dev
exit /b %errorlevel%
