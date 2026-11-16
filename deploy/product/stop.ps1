# Stop the PRODUCT instance started by deploy/product/start.ps1.
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$pidFile = Join-Path $root ".product/pids.json"
if (-not (Test-Path $pidFile)) { Write-Host "No product instance recorded."; exit 0 }
$state = Get-Content $pidFile -Raw | ConvertFrom-Json
foreach ($id in $state.api, $state.web) {
  if ($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue)) {
    # /T also stops child processes (ffmpeg, CLIs) started by the server.
    taskkill /PID $id /T /F | Out-Null
  }
}
Remove-Item $pidFile
Write-Host "Product stopped."
