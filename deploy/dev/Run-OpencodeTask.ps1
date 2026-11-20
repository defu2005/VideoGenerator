param(
    [Parameter(Mandatory=$true)][ValidatePattern('^TASK-[a-zA-Z0-9.-]+$')][string]$Task,
    [Parameter(Mandatory=$true)][string]$BriefPath,
    [Parameter(Mandatory=$true)][string]$LogPath,
    [Parameter(Mandatory=$true)][string]$MarkerPath,
    [Parameter(Mandatory=$true)][string]$ReportPath,
    [string]$SessionId,
    [string]$Model = 'agy/gemini-3.8-flash-medium',
    [string]$ConfigPath
)
$ErrorActionPreference = 'Stop'
if (-not $ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot '../../tmp/opencode-hook/config.json' }
. (Join-Path $PSScriptRoot 'OpencodeCompletion.Common.ps1')
$config = Read-CompletionConfig $ConfigPath
Set-Location -LiteralPath $config.RepoRoot
$brief = Get-CompletionRepoPath $config $BriefPath
$log = Get-CompletionRepoPath $config $LogPath
if (-not (Test-Path -LiteralPath $brief -PathType Leaf)) { throw 'Worker brief does not exist' }
$live = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'opencode-cli.exe' -and $_.CommandLine -match ' run ' })
if ($live.Count -ge 3) { throw 'Three opencode workers are already running; dispatch refused' }
$run = [ordered]@{
    RunId = [Guid]::NewGuid().ToString(); Task = $Task; ProcessId = $PID
    ProcessName = (Get-Process -Id $PID).ProcessName
    StartedAt = [DateTimeOffset]::UtcNow.ToString('o')
    BriefPath = $BriefPath; LogPath = $LogPath; MarkerPath = $MarkerPath; ReportPath = $ReportPath
    SessionId = $SessionId; Model = $Model
}
$state = Get-CompletionRepoPath $config $config.StateDir
[IO.Directory]::CreateDirectory((Join-Path $state 'runs')) | Out-Null
Save-CompletionJson (Join-Path $state ('runs/' + $run.RunId + '.json')) $run
$workerArgs = @('run', '-m', $Model, '--file', $brief)
if ($SessionId) { $workerArgs += @('--session', $SessionId) }
$workerArgs += 'Follow the attached brief and current shared rules. Complete the task, checks and report. Stay inside your exclusive file scope.'
$code = 1
try {
    # Windows PowerShell 5 treats native stderr as ErrorRecords. OpenCode writes
    # ordinary progress there; let its exit code determine success.
    $ErrorActionPreference = 'Continue'
    & $config.OpencodeExe @workerArgs *> $log
    $code = $LASTEXITCODE
} finally {
    $ErrorActionPreference = 'Stop'
    try { Publish-OpencodeCompletion $ConfigPath ([pscustomobject]$run) $code 'exited' }
    catch { Write-Warning ('Worker ended, but completion delivery needs retry: ' + $_.Exception.Message) }
}
exit $code
