@echo off
REM Destroys the Docker volume and recreates Postgres with credentials from docker-compose.yml.
REM Use if you see: password authentication failed for user "predictioninsider"
REM (often caused by an old volume or connecting to the wrong Postgres on port 5432).
setlocal
cd /d "%~dp0.."

echo This will STOP the DB and DELETE local Docker data for this project.
echo Afterward: update .env DATABASE_URL to use port 5433 (see .env.example), then run start-prediction-insider.bat
pause

docker compose down -v
docker compose up -d

echo Waiting for Postgres...
timeout /t 5 /nobreak >nul
set /a _t=0
:wait
docker compose exec -T db pg_isready -U predictioninsider -d predictioninsider >nul 2>&1
if not errorlevel 1 goto ok
set /a _t+=1
if !_t! GTR 60 (
  echo Timed out. Check: docker compose logs db
  pause
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto wait
:ok

echo.
echo Done. Run from project root:
echo   npm run db:init
echo   start-prediction-insider.bat hosted skip
echo   ^(or full start-prediction-insider.bat^)
pause
