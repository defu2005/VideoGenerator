# OpenCode completion hook

This development-only helper reports a worker exit to the existing Codex supervisor chat. It uses the installed `codex queue --thread ... --message ... --resume` command. No extra npm package, API key, cloud scheduler, or periodic model turn is required. The Codex goal stays paused. Review/dispatch turns still use model tokens when an event arrives.

`Watch-OpencodeCompletion.ps1` holds the original process handle and blocks on native `WaitForExit`. It verifies process name/start time to avoid PID reuse. It does not watch a `.done` file as a substitute for process completion. Success and failure both produce a durable event; fresh marker/report checks are hints for the supervisor, never acceptance.

The local machine configuration is `tmp/opencode-hook/config.json`: development checkout, existing Codex thread UUID, installed CLI executable paths, state directory, `Enabled` and `DryRun`. It contains no credentials. The CLI uses its normal existing sign-in; do not copy or read auth files. The Codex app/local daemon and sign-in must remain usable for wakeups. Queue errors stay in the outbox; there is no infinite retry loop.

## Dispatch every new worker with the hook

From the development checkout, start the wrapper hidden in the background using the supervisor's normal exec tool or Start-Process with WindowStyle Hidden:

```powershell
powershell.exe -NoProfile -File deploy/dev/Run-OpencodeTask.ps1 `
  -Task TASK-143.fix1 `
  -BriefPath tmp/worker143-fix1.md `
  -LogPath tmp/opencode-task143-fix1.log `
  -MarkerPath docs/tasks/TASK-143.fix1.done `
  -ReportPath docs/tasks/TASK-143.fix1.report.md `
  -SessionId ses_e173d7790ffeCGd719Kc7gurce
```

The wrapper preserves the worker's exit code, writes its run record, and sends one completion event in finally. It refuses a fourth simultaneous opencode CLI. The supervisor must additionally enforce file/migration ownership and guide dependencies before dispatch. Do not attach an external watcher to a wrapper that already has the finally hook.

Existing workers can be attached without restarting them using `Watch-OpencodeCompletion.ps1 -ConfigPath <config> -RunPath <run-json>` in a hidden process. Run records include the original PID, process name, exact UTC start time, task/log/marker/report and a unique RunId. Do not use an old run record for a new PID lifetime.

## Evidence and controls

- Events: `tmp/opencode-hook/events/<RunId>.json`.
- Delivery output: the adjacent `.json.queue.txt` file. `queued-resume-requested` means CLI queue accepted the message; it does not prove the model reviewed the task yet.
- Disable future deliveries by setting `Enabled` to false in the config. This does not stop workers. Already queued messages remain queued.
- A failed delivery remains durable. After repairing the daemon/CLI, an explicit retry can call `Publish-OpencodeCompletion` from the common helper with the event data. A previously accepted event is deduplicated by RunId. Do not automatically retry a message already accepted but whose resume merely warned.
- Checks: `powershell.exe -NoProfile -File deploy/dev/Test-OpencodeCompletion.ps1`. Tests use a fake sender and synthetic short-lived PowerShell process; they never call real model CLIs or use the network.

The supported Codex app-server lifecycle is documented in [official OpenAI documentation](https://learn.chatgpt.com/docs/app-server). The exact installed queue/resume flags are verified locally with `codex queue --help`.
