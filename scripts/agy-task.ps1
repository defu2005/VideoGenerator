# Run one task with Antigravity CLI (agy), non-interactively, in this repo.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/agy-task.ps1 docs/tasks/TASK-004F.antigravity-prompt.md
param(
  [Parameter(Mandatory = $true)][string]$PromptFile,
  [string]$Model = "claude-sonnet-4-6",
  [string]$Mode = "accept-edits"
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$text = Get-Content -Raw -Encoding UTF8 $PromptFile
# Use only the prompt after the first '---' line (if any).
$idx = $text.IndexOf("`n---")
if ($idx -ge 0) { $text = $text.Substring($idx + 4).Trim() }
$logDir = Join-Path $repo "data\agy-logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$name = [IO.Path]::GetFileNameWithoutExtension($PromptFile)
$log = Join-Path $logDir "$name-$(Get-Date -Format yyyyMMdd-HHmmss).jsonl"
# agy self-updates in the background; the exe can briefly disappear, so wait up to 60 s.
$agy = Join-Path $env:LOCALAPPDATA "agy\bin\agy.exe"
for ($i = 0; $i -lt 30 -and -not (Test-Path $agy); $i++) { Start-Sleep -Seconds 2 }
if (-not (Test-Path $agy)) {
  $cmd = Get-Command agy -ErrorAction SilentlyContinue
  if ($cmd) { $agy = $cmd.Source } else { throw "agy.exe not found. Install it in this PowerShell: irm https://antigravity.google/cli/install.ps1 | iex" }
}
Write-Host "agy: $agy model=$Model mode=$Mode log=$log"
# PowerShell 5.1 does not escape embedded quotes for native programs: escape them (and the
# backslashes before them) by hand, and attach the prompt to the flag as --print=<prompt>.
$arg = ($text -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1'
# Headless agy auto-denies shell commands unless allowed; the settings file allows only npm/npx/node
# and read-only git, and denies commit/push/reset/checkout/clean.
$settings = Join-Path $PSScriptRoot "agy-settings.json"
$ErrorActionPreference = "Continue"
& $agy "--print=$arg" --model $Model --mode $Mode --settings $settings --output-format stream-json --print-timeout 0s 2>&1 | ForEach-Object { $_; Add-Content -Path $log -Value $_ -Encoding UTF8 }
Write-Host "agy exit code: $LASTEXITCODE"
