# Wait for Docker Engine; optionally start Docker Desktop on Windows if installed.
# Exit 0 = docker info succeeds. Exit 1 = timeout or docker missing.
param([int]$MaxWaitSeconds = 180)

$ErrorActionPreference = "SilentlyContinue"

function Test-DockerEngine {
    & docker info 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "[ensure-docker] docker CLI not in PATH."
    exit 1
}

if (Test-DockerEngine) {
    exit 0
}

$exe = Join-Path ${env:ProgramFiles} "Docker\Docker\Docker Desktop.exe"
if (-not (Test-Path $exe)) {
    Write-Host "[ensure-docker] Docker Desktop not found at: $exe"
    Write-Host "          Start Docker Desktop manually, or use: start-prediction-insider.bat hosted"
    exit 1
}

$running = Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
if (-not $running) {
    Write-Host "[ensure-docker] Starting Docker Desktop - wait until the engine is ready (up to $MaxWaitSeconds s)..."
    Start-Process -FilePath $exe
} else {
    Write-Host "[ensure-docker] Docker Desktop is open; waiting for engine to respond..."
}

$deadline = [DateTime]::UtcNow.AddSeconds($MaxWaitSeconds)
while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-DockerEngine) {
        Write-Host "[ensure-docker] Docker engine is running."
        exit 0
    }
    Start-Sleep -Seconds 2
}

Write-Host "[ensure-docker] Timed out. Open Docker Desktop, wait for 'Engine running', then run this script again."
exit 1
