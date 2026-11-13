# TASK-125 report — soft time limit and overdue checks

Status: implemented, not committed (per rules). Migration `0071_gifted_golden_guardian.sql` (jobs.overdue_state/overdue_at/next_check_at, table `stage_overdue_checks`).

## What changed
- **No clock kill.** At the limit the worker marks the job overdue and starts an `OverdueRun`; it never aborts by itself. `onOverdue: "abort"` keeps the old kill (`STAGE_TIMEOUT`, retryable).
- **Checker** (`jobs/overdueRun.ts`): only `wait` / `escalate`. Ladder: signals moving → wait, else escalate; a model `wait` with no signal for ≥10 min is overridden to escalate. Check spacing 2→5→10→20→30 min, unlimited. `notify_only` calls no model. 30-min notice, at most once per 2 h per job, job keeps running.
- **Decisions** (Hermes tools `list_overdue_jobs`, `get_overdue_checks`, `decide_overdue`; risk confirm, grant `retries`, action `stage.run`): wait (extendMs clamped 5 min..2×limit), abort_retry, abort_fail (`STAGE_OVERDUE_ABORTED`, non-retryable), ask_user. Protected project: only wait / ask_user. Decision on a no-longer-overdue job is refused. Reason required, Vietnamese.
- **Estimates** (`pipeline/stageTimeoutPlan.ts`, `stageHistory.ts`, shared `stageEstimates.ts`): user override → high-confidence history (no LLM) → one agent call per plan (`stageTimeouts` task, `basis: "agent"`) → rough (`basis: "rough"`).
- **Remote jobs:** same checker, never a clock kill; abort = `failJob` + `setJobLease(id, null)`. An expired lease stays TASK-118's `NODE_LOST` requeue. No `node/*` edits.
- **Supervisor/events:** `job_stalled` rule, anomaly `job_overdue` (warn → critical after 30 min), `OperatorEventKind` `job_overdue` (`TODO(TASK-122)` at routing).
- **API:** GET `/api/jobs/:id/overdue-checks`, GET `/api/projects/:id/overdue`, POST `/api/jobs/:id/overdue-decision` (routePermissions append-only, new `job` resource kind).
- **UI:** `OverdueCard` (badge, 3 buttons, history), `StageTimeoutPanel` (basis labels, expected time, "Khi quá thời gian" select).
- **Docs:** du-an-va-quy-trinh, xu-ly-su-co ("Bước chạy quá lâu"), nhat-ky-thay-doi, featureMap `overdue-checks`; skill `.agents/skills/video-kiem-tra-qua-gio/SKILL.md`.

## Tests
New: `overdueRun.test.ts` (11), `workerOverdue.test.ts` (4), `overdueApi.test.ts` (2). Fake timers, injected checker, no network.
Totals: shared 733, mcp 22, web 197, server 1105 passed / 3 failed / 5 skipped. typecheck and build clean. `drizzle-kit generate` run twice: "No schema changes".
The 3 server failures are not from this task (rerun alone):
- `autonomy.test.ts`: `set_node_drain` (TASK-119 tool) has no entry in `TOOL_GRANTS`.
- `qualityRepair.test.ts` "shelves the project": `shelvedDigestLines` matches `last_seen_at` by day; fails around the UTC/local midnight boundary.
- `workerAgent.test.ts` exit-75 test: flaky in the full run, passes alone.
I also raised the tool-catalog size guard in `assistant.test.ts` from 27_000 to 28_000 (3 new tools).

## Deviations / not done
- **ETA text "dự kiến còn ~X phút" not implemented:** `StageRecord` has no start time. The card shows elapsed and expected instead.
- Executors do not yet call `reportActivity`, so `childAlive` and `llmInFlight` stay null; the ladder relies on progress and heartbeat signals until they do.
- `pipeline/modes.ts` (~line 408) calls `stageTimeoutPlanIsFresh` with a hash that cannot know the history bucket, so a plan is not refreshed purely because history grew.
- Mock model and ECO always use the ladder (and `rough` estimates).
- No browser check on a throwaway project (not run).

## Real history (read-only `data/app.db`, SUCCEEDED jobs, minutes)
RESEARCH n5 avg 0.4 max 0.9; SCRIPT n2 avg 2.6; VOICE n3 avg 2.2 max 6.3; VISUAL_SEARCH n5 avg 6.7 max 16.4 (the long tail that caused false timeouts); SUBTITLE ~0. Too few samples for high confidence on most stages, so the agent/rough paths matter.

## Open source (rule 11)
Temporal (activity heartbeat vs start-to-close timeouts) and BullMQ (stalled-job check) used as ideas only. No new dependency; nothing better found to add.
