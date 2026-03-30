# Wait until the dev server answers on port 5000 (fresh process loads current .env).
# Use single quotes for messages containing [brackets] — PowerShell parses "[]" in double quotes as indexing.
$uri = "http://127.0.0.1:5000/"
for ($i = 0; $i -lt 120; $i++) {
  try {
    $r = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) {
      Write-Host 'wait-http-5000: OK - server is responding.'
      exit 0
    }
  } catch {}
  if (($i % 5) -eq 0) {
    Write-Host "  Waiting for http://127.0.0.1:5000/ ... ($i s)"
  }
  Start-Sleep -Seconds 1
}
Write-Host 'wait-http-5000: ERROR - no response after 120s. Check the Server window for crashes.'
exit 1
