param(
    [Parameter(Mandatory=$true)][string]$ConfigPath,
    [Parameter(Mandatory=$true)][string]$RunPath
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'OpencodeCompletion.Common.ps1')
$run = Get-Content -LiteralPath $RunPath -Raw -Encoding UTF8 | ConvertFrom-Json
$process = $null
$code = $null
$observation = 'observer-error'
try {
    $process = [Diagnostics.Process]::GetProcessById([int]$run.ProcessId)
    $handle = $process.Handle # Hold the original process handle; do not wait on a reused PID.
    if ($process.ProcessName -ne $run.ProcessName -or
        [Math]::Abs(($process.StartTime.ToUniversalTime() - [DateTimeOffset]::Parse($run.StartedAt).UtcDateTime).TotalMilliseconds) -gt 5) {
        $observation = 'identity-mismatch'
    } else {
        $process.WaitForExit() # Native process-exit wait. No polling, timer, or LLM while waiting.
        try { $code = $process.ExitCode } catch { $code = $null }
        $observation = 'exited'
    }
} catch [ArgumentException] {
    $observation = 'missing-before-attach'
} finally {
    try { Publish-OpencodeCompletion $ConfigPath $run $code $observation }
    finally { if ($process) { $process.Dispose() } }
}
