# One-click local launch: Docker Postgres, SQL init, free port, browser, Telegram keepalive.
# Called by RUN.bat. Leave the "PredictionInsider Server" window open.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host ""
Write-Host "=== PredictionInsider — starting ===" -ForegroundColor Cyan

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "[ERROR] npm not found. Install Node.js 20+ and open a new terminal." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path ".env")) {
  Write-Host "Creating .env from .env.example" -ForegroundColor Yellow
  Copy-Item ".env.example" ".env"
}

function Get-Runtime {
  $p = "pnl_analysis\output\.runtime.json"
  if (-not (Test-Path $p)) { return $null }
  try { return Get-Content -Raw $p | ConvertFrom-Json } catch { return $null }
}

function Test-Up([string]$url) {
  try {
    $r = Invoke-WebRequest -Uri ($url.TrimEnd("/") + "/api/healthz") -UseBasicParsing -TimeoutSec 3
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch { return $false }
}

$existing = Get-Runtime
if ($existing -and $existing.pid -and $existing.url) {
  $proc = Get-Process -Id ([int]$existing.pid) -ErrorAction SilentlyContinue
  if ($proc -and (Test-Up ([string]$existing.url))) {
    Write-Host "Already running at $($existing.url) — opening browser." -ForegroundColor Green
    Start-Process ([string]$existing.url)
    exit 0
  }
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  Write-Host "[ERROR] Docker not in PATH. Install Docker Desktop, then run this again." -ForegroundColor Red
  Write-Host "https://docs.docker.com/desktop/install/windows-install/"
  exit 1
}

Write-Host "[1/4] Docker engine..."
& (Join-Path $PSScriptRoot "ensure-docker-running.ps1")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "[2/4] Postgres (docker compose up -d)..."
docker compose up -d
if ($LASTEXITCODE -ne 0) {
  Write-Host "[ERROR] docker compose failed." -ForegroundColor Red
  exit 1
}

$ready = $false
for ($i = 0; $i -lt 45; $i++) {
  docker compose exec -T db pg_isready -U predictioninsider -d predictioninsider 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) {
  Write-Host "[ERROR] Postgres did not become ready. docker compose logs db" -ForegroundColor Red
  exit 1
}

Write-Host "[3/4] SQL tables (db:init)..."
npm run db:init
if ($LASTEXITCODE -ne 0) {
  Write-Host "[WARN] db:init failed — check DATABASE_URL in .env" -ForegroundColor Yellow
}

$envText = Get-Content ".env" -Raw -ErrorAction SilentlyContinue
$tgOk = $envText -match '(?m)^TELEGRAM_BOT_TOKEN=.+' -and $envText -match '(?m)^TELEGRAM_CHAT_ID=.+'
if ($tgOk) {
  Write-Host "Telegram: token + chat id found in .env (bot starts with the server)." -ForegroundColor Green
} else {
  Write-Host "Telegram: add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to .env (optional)." -ForegroundColor Yellow
}

Write-Host "[4/4] Starting web server in a new window (picks a free port)..."
$launch = "cd /d `"$pwd`" && title PredictionInsider Server && npm run dev"
Start-Process -FilePath "cmd.exe" -ArgumentList "/k", $launch

Write-Host "Waiting for HTTP..."
& (Join-Path $PSScriptRoot "wait-http.ps1")
if ($LASTEXITCODE -ne 0) {
  Write-Host "[ERROR] Server did not come up. Read the PredictionInsider Server window." -ForegroundColor Red
  exit 1
}

$rt = Get-Runtime
if (-not $rt -or -not $rt.url) {
  Write-Host "[ERROR] Server started but no runtime URL was written." -ForegroundColor Red
  exit 1
}
$url = [string]$rt.url
Write-Host "Opening $url" -ForegroundColor Green
Start-Process $url
Write-Host ""
Write-Host "Leave the PredictionInsider Server window open."
Write-Host "That process is the website, TAKE keepalive, and Telegram bot."
Write-Host "Trader ingest runs in the background on first start if data is stale (can take a while)."
Write-Host "Home page works immediately; live TAKEs appear after the first signals refresh (~1 min)."
exit 0
