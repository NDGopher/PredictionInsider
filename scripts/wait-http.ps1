# Wait for PredictionInsider HTTP (port is chosen at runtime, not always 5000).
$ErrorActionPreference = "Continue"
$runtimePath = Join-Path $PSScriptRoot "..\pnl_analysis\output\.runtime.json"

function Get-RuntimeUrl {
  if (-not (Test-Path $runtimePath)) { return $null }
  try {
    $rt = Get-Content -Raw $runtimePath | ConvertFrom-Json
    if ($rt.url) { return [string]$rt.url }
    if ($rt.port) { return "http://127.0.0.1:$($rt.port)" }
  } catch {}
  return $null
}

for ($i = 0; $i -lt 180; $i++) {
  $base = Get-RuntimeUrl
  if ($base) {
    foreach ($path in @("/api/healthz", "/")) {
      try {
        $r = Invoke-WebRequest -Uri ($base.TrimEnd("/") + $path) -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) {
          Write-Host "wait-http: OK $($base.TrimEnd('/'))$path"
          exit 0
        }
      } catch {}
    }
  }
  if (($i % 5) -eq 0) {
    if ($base) { Write-Host "  Waiting for $base ... ($i s)" }
    else { Write-Host "  Waiting for server to pick a port ... ($i s)" }
  }
  Start-Sleep -Seconds 1
}

Write-Host "wait-http: ERROR - no response after 180s. Check the PredictionInsider Server window."
exit 1
