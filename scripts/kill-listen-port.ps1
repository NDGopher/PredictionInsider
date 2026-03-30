param(
  [int]$Port = 5000
)
$ErrorActionPreference = "SilentlyContinue"
Write-Host "[kill-listen-port] Checking port $Port (stale Node keeps wrong DATABASE_URL)..."
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) {
  Write-Host "  (nothing listening on $Port)"
  exit 0
}
$pids = @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($procId in $pids) {
  try {
    Stop-Process -Id $procId -Force -ErrorAction Stop
    Write-Host "  Stopped PID $procId"
  } catch {
    Write-Host "  Could not stop PID $procId : $_"
  }
}
exit 0
