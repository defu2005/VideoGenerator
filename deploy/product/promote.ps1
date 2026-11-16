# Promote reviewed code from `dev` to the PRODUCT instance.
# Run from the product worktree root:  powershell -File deploy/product/promote.ps1 [-Ref dev]
# Steps: fast-forward product to the ref, back up the DB, build, restart. See docs/BRANCHES.md.
param(
  [string]$Ref = "dev",
  [string]$MainRoot = (Join-Path (Split-Path -Parent (Resolve-Path "$PSScriptRoot\..\..")) "videoGenerator"),
  [string]$BackupDir = (Join-Path (Split-Path -Parent (Resolve-Path "$PSScriptRoot\..\..")) "videoGenerator-backups")
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $root
if ((git rev-parse --abbrev-ref HEAD).Trim() -ne "product") { throw "Run this from the product worktree (branch 'product')." }
if (git status --porcelain --untracked-files=no) { throw "Product worktree has local changes. Product is never edited by hand." }

$before = (git rev-parse HEAD).Trim()
git merge --ff-only $Ref
if ($LASTEXITCODE -ne 0) { throw "Cannot fast-forward product to '$Ref'. Product only moves forward to reviewed dev commits." }
$after = (git rev-parse HEAD).Trim()
Write-Host "product: $before -> $after"

$dataDir = Join-Path $MainRoot "data"
node deploy/product/backup-db.mjs $dataDir $BackupDir
if ($LASTEXITCODE -ne 0) { throw "DB backup failed; product not restarted. Roll back code with: git reset --hard $before" }

npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed; the running product is untouched. Roll back code with: git reset --hard $before ; npm run build" }

powershell -File deploy/product/stop.ps1
powershell -File deploy/product/start.ps1 -MainRoot $MainRoot
if ($LASTEXITCODE -ne 0) { throw "Product did not start. See .product/api.err.log. Rollback: docs/BRANCHES.md 'Quay lại bản trước'." }
Write-Host "Promoted. Previous commit: $before"
