# Local setup for PredictionInsider (Windows PowerShell)
# Usage: from repo root: .\scripts\setup-local.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "== Node dependencies ==" -ForegroundColor Cyan
npm install

Write-Host "== Python pipeline deps (pnl_analysis) ==" -ForegroundColor Cyan
if (Get-Command py -ErrorAction SilentlyContinue) {
  py -3 -m pip install -q -r pnl_analysis/requirements.txt
  if ($LASTEXITCODE -ne 0) { Write-Host "pip install failed (py -3). Install Python 3.11+ or run: py -3 -m pip install -r pnl_analysis/requirements.txt" -ForegroundColor Yellow }
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  python -m pip install -q -r pnl_analysis/requirements.txt
  if ($LASTEXITCODE -ne 0) { Write-Host "pip install failed (python). Try: py -3 -m pip install -r pnl_analysis/requirements.txt" -ForegroundColor Yellow }
} else {
  Write-Host "Python not found in PATH (skipped). Pipeline scripts need Python 3.11+; use py launcher or add python to PATH." -ForegroundColor Yellow
}

if (-not (Test-Path ".env")) {
  Write-Host "Creating .env from .env.example" -ForegroundColor Yellow
  Copy-Item ".env.example" ".env"
}

Write-Host "== PostgreSQL ==" -ForegroundColor Cyan
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  Write-Host "Docker not found in PATH. Install Docker Desktop, then run: npm run db:up" -ForegroundColor Yellow
  Write-Host "Or put a hosted Postgres URL in .env as DATABASE_URL (see docs/DATABASE-SETUP.md)." -ForegroundColor Yellow
  Write-Host "Skipping docker compose. If DATABASE_URL is not reachable, db:init will fail below." -ForegroundColor Yellow
} else {
docker compose up -d
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
  try {
    $r = docker compose exec -T db pg_isready -U predictioninsider -d predictioninsider 2>$null
    if ($LASTEXITCODE -eq 0) { break }
  } catch { }
  Start-Sleep -Seconds 2
}
}

Write-Host "== SQL tables (db:init - safe; do not use db:push until schema.ts has Drizzle pgTables) ==" -ForegroundColor Cyan
npm run db:init

Write-Host "Done. Start the app with: npm run dev" -ForegroundColor Green
Write-Host "Then open http://127.0.0.1:5000" -ForegroundColor Green
