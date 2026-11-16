# Start the PRODUCT instance (branch `product`) on the real data.
# Run from the product worktree root:  powershell -File deploy/product/start.ps1
# See docs/BRANCHES.md. Never run this from the dev checkout.
param(
  [string]$MainRoot = (Join-Path (Split-Path -Parent (Resolve-Path "$PSScriptRoot\..\..")) "videoGenerator"),
  [int]$ApiPort = 3100,
  [int]$WebPort = 5100,
  [string]$DataDir = "",
  [switch]$NoWorker,
  [switch]$AllowNonProductBranch
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $root

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "product" -and -not $AllowNonProductBranch) {
  throw "This checkout is on '$branch'. The product instance only runs from branch 'product' (docs/BRANCHES.md)."
}
if (-not $DataDir) { $DataDir = Join-Path $MainRoot "data" }
$envFile = Join-Path $MainRoot ".env"
if (-not (Test-Path "apps/server/dist/index.js") -or -not (Test-Path "apps/web/dist/index.html")) {
  throw "Build missing. Run: npm run build (in $root)"
}
foreach ($port in $ApiPort, $WebPort) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $port is already in use. Stop it first: powershell -File deploy/product/stop.ps1"
  }
}

$stateDir = Join-Path $root ".product"
New-Item -ItemType Directory -Force $stateDir | Out-Null
$web = "http://localhost:$WebPort"
$env:NODE_ENV = "production"
$env:PORT = "$ApiPort"
$env:DATA_DIR = $DataDir
$env:CORS_ORIGIN = $web
$env:WEB_BASE_URL = $web
$env:AUTH_TRUSTED_ORIGINS = "$web,http://127.0.0.1:$WebPort"
$env:VITE_API_PROXY_TARGET = "http://127.0.0.1:$ApiPort"
if ($NoWorker) { $env:WORKER_ENABLED = "false" }

$nodeArgs = @()
if (Test-Path $envFile) { $nodeArgs += "--env-file-if-exists=$envFile" }
$nodeArgs += "apps/server/dist/index.js"
$api = Start-Process node -ArgumentList $nodeArgs -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $stateDir "api.log") -RedirectStandardError (Join-Path $stateDir "api.err.log")
$viteBin = Join-Path $root "node_modules/vite/bin/vite.js"
$webProc = Start-Process node -ArgumentList @($viteBin, "preview", "--host", "127.0.0.1", "--port", "$WebPort", "--strictPort") `
  -WorkingDirectory (Join-Path $root "apps/web") -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $stateDir "web.log") -RedirectStandardError (Join-Path $stateDir "web.err.log")
@{ api = $api.Id; web = $webProc.Id; apiPort = $ApiPort; webPort = $WebPort; dataDir = $DataDir; startedAt = (Get-Date).ToString("o") } |
  ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $stateDir "pids.json")

$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  try { $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$ApiPort/api/health" -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch {}
  if ($api.HasExited) { break }
}
if (-not $ok) { Write-Host "API did not become healthy. See .product/api.err.log"; exit 1 }
Write-Host "Product running: web $web  api http://127.0.0.1:$ApiPort  data $DataDir"
