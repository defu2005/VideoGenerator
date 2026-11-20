$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'OpencodeCompletion.Common.ps1')
$root = Join-Path ([IO.Path]::GetTempPath()) ('vg-completion-hook-test-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
$configPath = Join-Path $root 'config.json'
$countPath = Join-Path $root 'send-count.txt'
$fakeCli = Join-Path $root 'fake-codex.ps1'
$countLiteral = $countPath.Replace("'", "''")
$stub = @"
`$countFile = '$countLiteral'
`$count = if (Test-Path -LiteralPath `$countFile) { [int](Get-Content -LiteralPath `$countFile) } else { 0 }
[IO.File]::WriteAllText(`$countFile, [string](`$count + 1))
if (`$args -notcontains '--resume') { throw 'Missing resume request' }
if (`$args -notcontains 'queue') { throw 'Missing queue command' }
`$global:LASTEXITCODE = 0
'Queued message fixture for thread fixture.'
"@
[IO.File]::WriteAllText($fakeCli, $stub)
$config = [ordered]@{ RepoRoot=$root; ThreadId='01a1db29-2fd5-7942-ac31-84b52d31472d'; CodexExe=$fakeCli; OpencodeExe=$fakeCli; StateDir='state'; Enabled=$true; DryRun=$true }
Save-CompletionJson $configPath $config
function Assert-Hook($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function New-TestRun {
    [pscustomobject]@{ RunId=[Guid]::NewGuid().ToString(); Task='TASK-HOOK-TEST'; ProcessId=$PID; ProcessName=(Get-Process -Id $PID).ProcessName; StartedAt=[DateTimeOffset]::UtcNow.AddSeconds(-3).ToString('o'); LogPath='worker.log'; MarkerPath='task.done'; ReportPath='task.report.md' }
}
[IO.File]::WriteAllText((Join-Path $root 'task.done'), '')
[IO.File]::WriteAllText((Join-Path $root 'task.report.md'), 'Synthetic report')
$run = New-TestRun
$path = Publish-OpencodeCompletion $configPath $run 0 'exited'
$event = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
Assert-Hook ($event.ReadyForReview -and $event.DeliveryStatus -eq 'dry-run') 'Fresh completion failed'
Assert-Hook (-not (Test-Path -LiteralPath $countPath)) 'Dry run invoked a sender'

$run = New-TestRun
(Get-Item -LiteralPath (Join-Path $root 'task.done')).LastWriteTimeUtc = [DateTime]::UtcNow.AddDays(-1)
$path = Publish-OpencodeCompletion $configPath $run 0 'exited'
$event = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
Assert-Hook (-not $event.ReadyForReview -and -not $event.FreshMarker) 'Old marker accepted'
(Get-Item -LiteralPath (Join-Path $root 'task.done')).LastWriteTimeUtc = [DateTime]::UtcNow

$config.DryRun = $false
Save-CompletionJson $configPath $config
$run = New-TestRun
$path = Publish-OpencodeCompletion $configPath $run 0 'exited'
Publish-OpencodeCompletion $configPath $run 0 'exited' | Out-Null
Assert-Hook ((Get-Content -LiteralPath $countPath) -eq '1') 'Duplicate completion sent twice'
$event = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
Assert-Hook $event.QueueAccepted 'Fake queue success not recorded'

# A failed transport leaves a durable outbox entry; an explicit retry can deliver it.
$failedStub = $stub.Replace('LASTEXITCODE = 0', 'LASTEXITCODE = 9')
[IO.File]::WriteAllText($fakeCli, $failedStub)
$run = New-TestRun
$path = Publish-OpencodeCompletion $configPath $run 0 'exited'
$event = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
Assert-Hook (-not $event.QueueAccepted -and $event.DeliveryStatus -eq 'queue-failed') 'Transport failure lost'
[IO.File]::WriteAllText($fakeCli, $stub)
Publish-OpencodeCompletion $configPath $run 0 'exited' | Out-Null
$event = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
Assert-Hook $event.QueueAccepted 'Explicit outbox retry failed'

$config.DryRun = $true
Save-CompletionJson $configPath $config
$run = New-TestRun
$run.ProcessName = 'identity-does-not-match'
$run.StartedAt = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
$runPath = Join-Path $root 'run.json'
Save-CompletionJson $runPath $run
& (Join-Path $PSScriptRoot 'Watch-OpencodeCompletion.ps1') -ConfigPath $configPath -RunPath $runPath | Out-Null
$event = Get-Content -LiteralPath (Join-Path $root ('state/events/' + $run.RunId + '.json')) -Raw | ConvertFrom-Json
Assert-Hook ($event.Observation -eq 'identity-mismatch' -and -not $event.ReadyForReview) 'PID identity fence failed'

$run = New-TestRun
$run.ProcessId = 2147483647
Save-CompletionJson $runPath $run
& (Join-Path $PSScriptRoot 'Watch-OpencodeCompletion.ps1') -ConfigPath $configPath -RunPath $runPath | Out-Null
$event = Get-Content -LiteralPath (Join-Path $root ('state/events/' + $run.RunId + '.json')) -Raw | ConvertFrom-Json
Assert-Hook ($event.Observation -eq 'missing-before-attach' -and -not $event.ReadyForReview) 'Missing process misreported'

$escapeRefused = $false
try { Get-CompletionRepoPath ([pscustomobject]$config) '../outside' | Out-Null } catch { $escapeRefused = $true }
Assert-Hook $escapeRefused 'Outside-repo path accepted'

$child = Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Milliseconds 1500') -WindowStyle Hidden -PassThru
$run = New-TestRun
$run.ProcessId = $child.Id
$run.ProcessName = $child.ProcessName
$run.StartedAt = $child.StartTime.ToUniversalTime().ToString('o')
Save-CompletionJson $runPath $run
& (Join-Path $PSScriptRoot 'Watch-OpencodeCompletion.ps1') -ConfigPath $configPath -RunPath $runPath | Out-Null
$event = Get-Content -LiteralPath (Join-Path $root ('state/events/' + $run.RunId + '.json')) -Raw | ConvertFrom-Json
Assert-Hook ($event.Observation -eq 'exited') 'Native process-exit wait failed'
Assert-Hook ((Get-Content -LiteralPath $countPath) -eq '3') 'Native dry-run called real transport'
$child.Dispose()

# Run the future-dispatch wrapper in isolated PowerShell processes with fake CLIs.
# Only this fixture shadows process enumeration; no live worker is started or stopped.
$fakeWorker = Join-Path $root 'fake-worker.ps1'
$config.OpencodeExe = $fakeWorker
Save-CompletionJson $configPath $config
[IO.File]::WriteAllText((Join-Path $root 'brief.md'), 'Offline fixture only')
$runnerLiteral = (Join-Path $PSScriptRoot 'Run-OpencodeTask.ps1').Replace("'", "''")
$configLiteral = $configPath.Replace("'", "''")
$shim = @"
function Get-CimInstance { @() }
& '$runnerLiteral' -Task TASK-HOOK-WRAPPER -BriefPath brief.md -LogPath worker.log -MarkerPath task.done -ReportPath task.report.md -ConfigPath '$configLiteral'
exit `$LASTEXITCODE
"@
$shimPath = Join-Path $root 'wrapper-shim.ps1'
[IO.File]::WriteAllText($shimPath, $shim)
foreach ($expectedCode in @(0, 7)) {
    $fakeWorkerText = @"
[IO.File]::WriteAllText((Join-Path (Get-Location) 'task.done'), '')
[IO.File]::WriteAllText((Join-Path (Get-Location) 'task.report.md'), 'Offline synthetic worker result')
`$global:LASTEXITCODE = $expectedCode
'Synthetic worker finished'
"@
    [IO.File]::WriteAllText($fakeWorker, $fakeWorkerText)
    & powershell.exe -NoProfile -File $shimPath | Out-Null
    Assert-Hook ($LASTEXITCODE -eq $expectedCode) 'Wrapper lost worker exit code'
    $wrapperEvents = @(Get-ChildItem -LiteralPath (Join-Path $root 'state/events') -Filter '*.json' | ForEach-Object {
        Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
    } | Where-Object { $_.Task -eq 'TASK-HOOK-WRAPPER' -and $_.ExitCode -eq $expectedCode })
    Assert-Hook ($wrapperEvents.Count -eq 1) 'Wrapper finally did not emit exactly one completion'
    Assert-Hook ($wrapperEvents[0].ReadyForReview -eq ($expectedCode -eq 0)) 'Wrapper reported failure as success'
}
Write-Output 'PASS: fresh marker, stale marker, no-send dry-run, dedupe, durable failed delivery, explicit retry, PID fence, missing process, path fence, native exit wait.'
Write-Output 'PASS: future-dispatch wrapper emits one callback and preserves success/failure exit codes.'
Write-Output ('Synthetic evidence: ' + $root)
