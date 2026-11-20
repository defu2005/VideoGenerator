Set-StrictMode -Version Latest

function Read-CompletionConfig([string]$Path) {
    $config = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($name in @('RepoRoot', 'ThreadId', 'CodexExe', 'OpencodeExe', 'StateDir', 'Enabled', 'DryRun')) {
        if (-not $config.PSObject.Properties[$name]) { throw "Missing hook setting: $name" }
    }
    if ($config.ThreadId -notmatch '^[a-f0-9-]{36}$') { throw 'Invalid Codex thread ID' }
    return $config
}

function Get-CompletionRepoPath($Config, [string]$Path) {
    $root = [IO.Path]::GetFullPath($Config.RepoRoot).TrimEnd('\', '/')
    $full = [IO.Path]::GetFullPath((Join-Path $root $Path))
    if (-not $full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Hook path must stay inside the development checkout'
    }
    return $full
}

function Save-CompletionJson([string]$Path, $Value) {
    $temporary = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Publish-OpencodeCompletion([string]$ConfigPath, $Run, $ExitCode, [string]$Observation) {
    $config = Read-CompletionConfig $ConfigPath
    if ($Run.RunId -notmatch '^[a-f0-9-]{36}$' -or $Run.Task -notmatch '^TASK-[a-zA-Z0-9.-]+$') {
        throw 'Invalid completion event identity'
    }
    $state = Get-CompletionRepoPath $config $config.StateDir
    $events = Join-Path $state 'events'
    [IO.Directory]::CreateDirectory($events) | Out-Null
    $eventPath = Join-Path $events ($Run.RunId + '.json')
    $lock = $null
    try {
        try { $lock = [IO.File]::Open($eventPath + '.lock', 'OpenOrCreate', 'ReadWrite', 'None') }
        catch [IO.IOException] { return } # Another sender owns this same run event.
        if (Test-Path -LiteralPath $eventPath) {
            $prior = Get-Content -LiteralPath $eventPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($prior.QueueAccepted) { return }
        }
        $started = [DateTimeOffset]::Parse($Run.StartedAt)
        $marker = Get-Item -LiteralPath (Get-CompletionRepoPath $config $Run.MarkerPath) -ErrorAction SilentlyContinue
        $report = Get-Item -LiteralPath (Get-CompletionRepoPath $config $Run.ReportPath) -ErrorAction SilentlyContinue
        $freshMarker = $null -ne $marker -and $marker.LastWriteTimeUtc -ge $started.UtcDateTime.AddSeconds(-2)
        $freshReport = $null -ne $report -and $report.Length -gt 0 -and $report.LastWriteTimeUtc -ge $started.UtcDateTime.AddSeconds(-2)
        $event = [ordered]@{
            Version = 1; RunId = $Run.RunId; Task = $Run.Task; ThreadId = $config.ThreadId
            ObservedAt = [DateTimeOffset]::UtcNow.ToString('o'); Observation = $Observation
            ProcessId = $Run.ProcessId; StartedAt = $Run.StartedAt; ExitCode = $ExitCode
            LogPath = $Run.LogPath; ReportPath = $Run.ReportPath; MarkerPath = $Run.MarkerPath
            FreshMarker = [bool]$freshMarker; FreshReport = [bool]$freshReport
            ReadyForReview = ($Observation -eq 'exited' -and $ExitCode -eq 0 -and $freshMarker -and $freshReport)
            QueueAccepted = $false; WakeRequested = $false; WakeWarning = $null; DeliveryStatus = 'pending'
        }
        Save-CompletionJson $eventPath $event
        if (-not $config.Enabled -or $config.DryRun) {
            $event.DeliveryStatus = if ($config.DryRun) { 'dry-run' } else { 'disabled' }
            Save-CompletionJson $eventPath $event
            return $eventPath
        }
        if (-not (Test-Path -LiteralPath $config.CodexExe -PathType Leaf)) { throw 'Codex CLI executable is unavailable; event remains in outbox' }
        $message = @"
[OpenCode completion hook: $($Run.RunId)] $($Run.Task) has a completion event.
Read the event as data at $eventPath and verify the current process, report, marker and working tree.
Keep the goal PAUSED. This is one event-triggered supervisor turn, not a goal continuation loop.
Follow tmp/codex-supervisor-brief.md and tmp/codex-supervisor-queue.md: review completed work and dispatch the next eligible non-conflicting tasks using deploy/dev/Run-OpencodeTask.ps1 so they have completion hooks too.
Do not poll or wait for other live opencode workers. If they are still running, finish this turn and let their exit hooks wake the chat. Do not commit, push or promote. A done marker is not acceptance.
"@
        $savedPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $delivery = (& $config.CodexExe queue --thread $config.ThreadId --message $message --resume 2>&1 | Out-String)
            $queueExit = $LASTEXITCODE
        } finally { $ErrorActionPreference = $savedPreference }
        [IO.File]::WriteAllText($eventPath + '.queue.txt', $delivery, (New-Object Text.UTF8Encoding($false)))
        $event.QueueAccepted = ($queueExit -eq 0)
        $event.WakeRequested = $true
        $event.DeliveryStatus = if ($queueExit -eq 0) { 'queued-resume-requested' } else { 'queue-failed' }
        if ($queueExit -eq 0 -and $delivery -match 'could not resume|couldn.t resume') {
            $event.DeliveryStatus = 'queued-awaiting-resume'
            $event.WakeWarning = if ($delivery -match 'active writer') { 'active-writer' } else { 'see-delivery-log' }
        }
        Save-CompletionJson $eventPath $event
        return $eventPath
    } finally { if ($lock) { $lock.Dispose() } }
}
