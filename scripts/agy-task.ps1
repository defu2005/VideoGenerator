# Run one task with Antigravity CLI (agy), non-interactively, in this repo.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/agy-task.ps1 docs/tasks/TASK-XXX.agy-prompt.md [-Model claude-sonnet-4-6]
#
# Safety:
# - agy runs with --dangerously-skip-permissions (headless agy stops at the first denied shell command,
#   and per-command allow rules do not match compound commands such as "cd X && npm test").
# - AGY_TASK=1 is set for the agent; the local git hooks (.git/hooks/pre-commit, pre-push) refuse
#   commits and pushes while it is set.
# - Before the run, uncommitted work is snapshotted: tracked changes as refs/agy-backup/<stamp>
#   (git stash create, working tree untouched) and untracked files as a zip in data/agy-logs/.
param(
  [Parameter(Mandatory = $true)][string]$PromptFile,
  [string]$Model = "claude-sonnet-4-6",
  [string]$Effort = ""
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
$stamp = Get-Date -Format yyyyMMdd-HHmmss
$name = [IO.Path]::GetFileNameWithoutExtension($PromptFile)
$log = Join-Path $logDir "$name-$stamp.jsonl"

# Snapshot uncommitted work.
$stash = (git stash create "agy-backup $stamp") 2>$null
if ($stash) { git update-ref "refs/agy-backup/$stamp" $stash; Write-Host "backup: refs/agy-backup/$stamp ($stash)" }
$untracked = @(git ls-files -o --exclude-standard)
if ($untracked.Count -gt 0) {
  $zip = Join-Path $logDir "untracked-$stamp.zip"
  Compress-Archive -Path $untracked -DestinationPath $zip -Force
  Write-Host "backup: $zip ($($untracked.Count) untracked files)"
}

# agy self-updates in the background; the exe can briefly disappear, so wait up to 60 s.
$agy = Join-Path $env:LOCALAPPDATA "agy\bin\agy.exe"
for ($i = 0; $i -lt 30 -and -not (Test-Path $agy); $i++) { Start-Sleep -Seconds 2 }
if (-not (Test-Path $agy)) {
  $cmd = Get-Command agy -ErrorAction SilentlyContinue
  if ($cmd) { $agy = $cmd.Source } else { throw "agy.exe not found. Install it: irm https://antigravity.google/cli/install.ps1 | iex" }
}
Write-Host "agy: $agy model=$Model effort=$Effort log=$log"

# PowerShell 5.1 does not escape embedded quotes for native programs: escape them (and the
# backslashes before them) by hand, and attach the prompt to the flag as --print=<prompt>.
$arg = ($text -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1'
$env:AGY_TASK = "1"
$ErrorActionPreference = "Continue"
$effortArgs = @(); if ($Effort) { $effortArgs = @("--effort", $Effort) }
& $agy "--print=$arg" --model $Model @effortArgs --dangerously-skip-permissions --output-format stream-json --print-timeout 0s 2>&1 |
  ForEach-Object { $_; Add-Content -Path $log -Value $_ -Encoding UTF8 }
Write-Host "agy exit code: $LASTEXITCODE"
