@echo off
REM ============================================================================
REM  RUN.bat — Simple local start (double-click)
REM
REM  Does: free port 5000 → Docker Postgres → SQL tables → dev server
REM  Open: http://127.0.0.1:5000  (use this host on Windows; "localhost" can fail)
REM
REM  For Docker + pipeline + ingest (smart 24h):  refresh-all.bat
REM  For more options read the header in:     start-prediction-insider.bat
REM ============================================================================
cd /d "%~dp0"
call "%~dp0start-prediction-insider.bat" skip
exit /b %errorlevel%
