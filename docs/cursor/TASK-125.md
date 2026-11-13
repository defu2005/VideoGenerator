# TASK-125 — Better stage time estimates, and an overdue stage gets checked instead of killed ⏱️

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). **Size:** M–L. **Migration:** yes, made only with `npx drizzle-kit generate`. **New dependency:** none.

## Why (user request, 2026-11-12)

> "các stage đang estimate thời gian quá tệ, giờ hết time out thì không ngừng tiến trình nữa mà gọi agent kiểm tra"

The user reports two problems:
1. Stage time estimates are bad. The baseline is a fixed formula (`packages/shared/src/pipeline/stageTimeouts.ts`, `baselineStageTimeouts`, `REFERENCE_MS × factor`), and the LLM may adjust it. Nothing learns from how long stages **really** took on this machine.
2. When the limit is hit, the worker kills the work. `apps/server/src/jobs/worker.ts` ~278–330 calls `controller.abort()` and fails the job with `STAGE_TIMEOUT`, after at most one automatic 50 % extension when progress moved in the last 60 s. A slow but healthy render or VISUAL_SEARCH is thrown away and retried from zero.

The user wants this instead: when a stage passes its time, **do not stop it**. An agent checks what is happening and decides.

Two later decisions from the user (2026-11-13) bind the whole design:

> "trần cứng là sao? phải để hermes kiểm tra xem lỗi do đâu và có nên chờ không"

> "những gì không thể estimate chính xác được nên đưa cho agent quyết định"

So:
- **No automatic kill by a clock.** There is no hard ceiling that aborts a job. Only Hermes (or the user) decides to stop an overdue job, after looking at why it is slow. The in-app checker gathers facts and may only extend or escalate.
- **Code estimates only what it can estimate well.** When the history is thin, noisy or from a different setup, an agent picks the expected time and the limit and says why. Code only clamps.

## Current code (read first)

- `packages/shared/src/pipeline/stageTimeouts.ts`:
  - `PLANNED_TIMEOUT_STAGES`, `STAGE_TIMEOUT_FLOOR_MS` (60 s), `STAGE_TIMEOUT_CAP_MS` (30 min), `STAGE_TIMEOUT_LONG_CAP_MS` (2 h for RENDER/CLIP/PUBLISH);
  - `baselineStageTimeouts`, `planFromBaseline`, `planFromModel`, `resolveStageTimeoutMs`, `retryStageTimeoutMs` (×1.5 per earlier timeout), `stageTimeoutPlanIsFresh`.
- `apps/server/src/pipeline/stageTimeoutPlan.ts` (LLM plan, task `stageTimeouts`) and `stageTimeoutOverrides.ts` (user minutes). `api/stageTimeouts.ts`.
- `apps/server/src/jobs/worker.ts` `run()`: the timeout race, the extension, `reportProgress` throttling, `failJob(STAGE_TIMEOUT)`.
- `jobs` table (`db/schema.ts:421`): `started_at`, `finished_at`, `attempt`, `stage`, `progress`, `node_id` and the lease columns from TASK-118.
- `apps/server/src/operator/supervisor.ts` ~113: the `job_stalled` anomaly fires at `timeoutMs × 1.5`.
- The TASK-121 pattern to copy, `operator/qualityRepair.ts`:
  - code owns facts and limits; the agent picks **one action from a fixed list**;
  - there is a default ladder without an LLM;
  - budget comes from `autonomyBudget`;
  - every decision is recorded.
- `operator/events.ts`: operator event kinds (`job_failed`, …).
- Web: `apps/web/src/features/projects/StageTimeoutPanel.tsx` (+ test), and the stage stepper or progress in the project page.

## Design

### Part A — estimates learned from real runs

1. Add a pure shared function `estimateStageMs(history, brief, stage)` in a new `packages/shared/src/pipeline/stageEstimates.ts`.
   - **Input:** past **successful** runs of that stage on this install. Each run has the duration (`finished_at − started_at` of the final successful attempt), scene count, target seconds, budget mode, aspect, `node_id` (null means the main machine) and, where it is cheap to get, the provider or model.
   - **Model:** normalise each run to a rate per unit. The unit depends on the stage:
     - scenes for VISUAL_SEARCH, SCENE_PLAN and RENDER;
     - target seconds for VOICE and SCRIPT;
     - one per run for the rest.

     Then take a robust estimate: the median rate × units for the **expected** time, and p90 × units × 1.3 for the **limit**.
   - **Weighting:** prefer recent runs, for example the last 30 per stage and the same budget mode and machine when there are at least 5 of them, then widen.
   - **Fallback:** with fewer than 5 samples, blend the samples with `baselineStageTimeouts`, weighting by n/5. With 0 samples, use the baseline alone.
   - **Output:** `{ expectedMs, limitMs, samples, basis: "history" | "blend" | "baseline", confidence: "high" | "low", lowReasons: string[], explanation }`. The explanation is Vietnamese, for example "Dựa trên 12 lần render gần đây trên máy này: trung bình 38 giây/cảnh."
   - **Confidence** is `high` only when all hold (constants in the file, tested):
     - at least 8 matching samples (same stage, budget mode and machine);
     - the spread is tight: p90 rate ≤ 2.5 × median rate;
     - the brief is inside the seen range: units ≤ 1.5 × the largest sample's units, and no first-time combination such as a new aspect, a new TTS or visual provider, or a remote node that never ran this stage.

     Otherwise `confidence` is `low` and `lowReasons` lists why in Vietnamese ("chỉ có 3 lần chạy", "độ lệch lớn", "lần đầu chạy trên node X").
   - Clamp to the floor and the caps.
   - Unit tests cover:
     - no history;
     - 3 samples (blend);
     - 20 samples with an outlier, where the median and p90 are not dragged by the outlier;
     - per-scene scaling;
     - a filter by machine.
2. **Server:** `apps/server/src/pipeline/stageHistory.ts` loads the history with **one** indexed query per stage. Add an index on `jobs(stage, status, finished_at)` through the schema plus drizzle-kit if none fits.
   - Cache it in memory for 5 min, and clear the cache when a job completes.
3. **Plan order — code when confident, an agent when not:**
   - a user override wins;
   - then the history estimate when `confidence` is `high`. No LLM call is made for that stage;
   - when `confidence` is `low`, **an agent decides**. Reuse the existing LLM plan (`stageTimeoutPlan.ts`, task `stageTimeouts`), but feed it, per low-confidence stage:
     - the history summary (samples, median, p90, spread);
     - `lowReasons`;
     - the code estimate as a starting point;
     - the brief's facts (scenes, seconds, providers, node).

     The agent returns `expectedMs`, `limitMs` and a short Vietnamese `reason` per stage. Code clamps the numbers to the floor and caps, and records the reason as the explanation (`basis: "agent"`);
   - only when no agent may be called (ECO mode, `autonomyBudget` says no, or the call fails or is invalid), use the code estimate (blend or baseline). Mark it `basis: "rough"` and show "ước lượng thô" in the UI, so the user knows it is a guess.

   Keep `StageTimeoutPlan` and add `expectedMs`, `basis` and `reason` per stage. The fields are optional, so the change is backward compatible.
   - Ask the agent only for the low-confidence stages, in one call per project plan. Never call it per job attempt.
   - `stageTimeoutInputHash` must include a coarse history bucket, such as the sample count rounded to 5 plus the confidence per stage, so the plan refreshes as data grows.
   - Record each agent decision with the plan, as today's LLM plan already is: the reason, the model and the cost.
4. **UI:** `StageTimeoutPanel` shows, per stage, the expected time, the limit, the basis (with a label: "từ lịch sử" / "agent ước lượng" / "ước lượng thô" / "bạn đặt") and the explanation or the agent's reason.
   - The project page progress shows the ETA as "dự kiến còn ~X phút" from `expectedMs` and the progress.
   - Users can still override, and an override still wins.

### Part B — an overdue stage is checked, not killed

1. **Soft limit.** When `limitMs` passes, the worker does **not** abort. It:
   - marks the job overdue: new nullable columns `jobs.overdue_at`, `jobs.next_check_at` and `jobs.overdue_state` (`checking` | `waiting_decision`), via the schema and drizzle-kit;
   - reports progress "Quá thời gian dự kiến — đang kiểm tra";
   - asks the checker.

   The executor keeps running.
2. **Facts.** Code collects them in `apps/server/src/jobs/overdueFacts.ts`. The agent never measures anything itself.
   - elapsed, `expectedMs`, `limitMs`, the attempt number;
   - the progress now, the progress at the limit, the time since the last progress report, and the trend over the last N reports. Keep a small ring buffer in the worker.
   - **Work signals:**
     - the bytes written under the job's work dir in the last 2 min, by stat-walking only that dir with a cap of 2,000 files;
     - whether a child process is still alive, if the executor exposes it through an optional `getActivity()` on the executor context. Add it for RENDER, CLIP, VOICE and VISUAL_SEARCH; other stages may return nothing;
     - an LLM call in flight, and a quota or rate-limit wait if the provider layer knows it.
   - The last 30 lines of the job's log, if they are kept. Redact secrets with the existing redactor.
   - The history estimate and how far over it the job is, for example "đang ở 2.4× mức trung bình".
3. **In-app checker — it watches, it never kills.** Add `apps/server/src/jobs/overdueCheck.ts`, modelled on TASK-121. It returns one action from a fixed list, validated by a zod schema in shared:
   - `wait`: extend by `extendMs`, which code clamps to [2 min, 50 % of `limitMs`];
   - `escalate`: keep running, raise the job to Hermes (see 4), and check again later.

   **The in-app checker has no abort action.** The one exception is the user's own setting "Khi quá thời gian = Dừng như cũ" (`abort`, see 9), which keeps today's behaviour on purpose.

   **Default ladder without an LLM**, used when the budget mode or `autonomyBudget` says no, the LLM fails, or the output is invalid:
   - work signals moving (progress up, or bytes written, or the child alive with CPU): `wait`;
   - anything else: `escalate`.

   **With an LLM:** use `generateRoutedStructured` with a new task id `overdueCheck`, routed like the other operator tasks. The prompt includes the facts (2) and the two actions.
   - Code re-checks the choice. For example, a `wait` with zero work signals for ≥ 10 min is overridden to `escalate`, and the override is recorded.
   - Use the LLM cache key from the facts hash.
   - Cost goes into usage and counts against `autonomyBudget`.
   - Check spacing grows: 2, 5, 10, 20, then every 30 min. There is no limit on how many checks run, because no check can kill the job.
4. **Hermes decides why it is slow and whether to keep waiting.**
   - On `escalate`, the job gets `overdue_state = "waiting_decision"` (a new nullable column) and the `job_overdue` operator event fires (6). Until TASK-122's `agent_escalations` exist, Hermes finds these jobs by polling `list_overdue_jobs`. When TASK-122 lands, it routes this event into an escalation; leave a `TODO(TASK-122)` at the one place that would call it.
   - Add three registry tools, so they appear in MCP, the assistant and the operator at once:
     - `list_overdue_jobs()`, read-only: overdue jobs in the caller's workspace, each with stage, project, elapsed against expected and limit, its state and its last check;
     - `get_overdue_checks(jobId)`, read-only: the facts and every check row for the job;
     - `decide_overdue(jobId, action, reason, extendMs?)`, where `action` is one of:
       - `wait`, with `extendMs` clamped by code to [5 min, 2 × `limitMs`];
       - `abort_retry`: abort now and requeue through the existing retry rules. The next attempt gets `retryStageTimeoutMs` growth;
       - `abort_fail`: abort and fail without retry;
       - `ask_user`: send the user a Telegram or notification message with Hermes's diagnosis, and keep running.

       `reason` is required, in Vietnamese, and must name the cause Hermes found (for example "ffmpeg vẫn ghi file, chỉ chậm do 4K" or "tiến trình con đã chết từ 14:02, log báo OOM").
   - Policy for `decide_overdue`:
     - its risk class is the same as the existing job cancel or retry tool. Read `registry/policy.ts` and copy that class; do not invent a looser one;
     - it is audited like every registry call;
     - on project `56374fb2-54cf-48ff-9441-2e6c653295d4` only `wait` and `ask_user` are allowed. Stopping or retrying there is the user's call;
     - a decision on a job that is no longer overdue (finished, cancelled, or a new attempt) is refused with a clear message.
   - Add a repo skill `.agents/skills/video-kiem-tra-qua-gio/SKILL.md` for Hermes and the operator. It is the diagnosis recipe:
     1. read `get_overdue_checks`;
     2. look at the signals: progress trend, bytes written, child alive, LLM or quota wait, log tail;
     3. compare with the history (how many times the median);
     4. name the likely cause from a short table: slow but alive, waiting on quota, stuck network call, dead child process, disk full, a bad input such as a broken clip, a remote node gone;
     5. pick the action, with "when in doubt and work is still moving, `wait`" and "when you cannot tell, `ask_user`";
     6. write the reason.

     Follow the existing `video-*` skill format, and keep `agentSkillPack.test.ts` passing.
   - **If nobody decides.** When a job has been `waiting_decision` for 30 min with no `decide_overdue`, send the user one notification through the existing notification and Telegram path: what is slow, the facts in two lines, and the three choices. Then keep running and keep checking. Repeat at most once every 2 h per job. The job is never killed for lack of an answer.
   - **The user can decide too.** The stage card gets three buttons: "Chờ thêm", "Dừng và thử lại", "Dừng hẳn". They call the same code path as `decide_overdue`, recorded with `source: "user"`.
5. **Code-owned limits (never the agent):**
   - No clock-based abort. A job stops only on a user's cancel or stop, which always wins at once (the existing abort handler is unchanged); on a `decide_overdue` abort; or under the user's `abort` setting.
   - Checks at least 2 min apart; `extendMs` clamps as above.
   - The worker's slot stays held while waiting. Check that an overdue job does not starve the queue silently: the supervisor (6) reports held slots, and `list_overdue_jobs` shows how many jobs are queued behind them.
6. **Supervisor and events:**
   - `job_stalled` in `operator/supervisor.ts` gets the new rule. Stalled means overdue with no check in 2 × the current check interval, because the checker itself is dead. A slow job that is still being checked is **not** stalled.
   - Add an anomaly `job_overdue` (severity `warning`, rising to `error` after the 30-min no-decision notice) carrying the last check, the state and how many jobs wait behind it. Both the supervision snapshot and Hermes see it.
   - Add `job_overdue` to `OperatorEventKind`, so operator event rules and Hermes can react. It fires on the first overdue mark and on each `escalate`.
7. **Record:** add a table `stage_overdue_checks`, with columns:
   - id, job_id, attempt, project_id, workspace_id, stage, check_no, at;
   - facts JSON (redacted), action, extend_ms, source (`ladder` | `llm` | `override` | `hermes` | `user`), actor (the API key or user id for `hermes` and `user`), reason (Vietnamese), cost_usd.
   - Hermes's and the user's decisions are rows here too, so the job's history reads as one timeline.

   Index it on `(job_id, attempt)`. Workspace-scope the reads with `scopeSql`, like other tables since TASK-115.
   - These rows also feed Part A: a run that finished after N extensions is still a real duration sample.
8. **Remote jobs (TASK-118 leases).** Do **not** edit `node/*` or `api/nodes.ts` in this task; TASK-119 owns those files.
   - For a leased job, the control plane runs the same checker. Its facts come from the lease heartbeat's progress and message, plus `leaseUntil`.
   - A Hermes or user abort means adding the job id to the heartbeat `cancel` list through the **existing** lease service API. If no such API exists, record the needed hook in the report for TASK-119/120. Until then a remote job can only be waited on or escalated, and `decide_overdue` abort on it returns a clear "chưa hỗ trợ dừng job ở node từ xa" message. Never fall back to a clock kill.
   - An expired lease (the node is gone) is TASK-118's existing requeue path, not an overdue decision. Leave it as it is.
9. **UI:**
   - The project stage card shows an "Quá dự kiến" badge, the elapsed time against the expected time, the last check's action and reason, and the time of the next check.
   - Add a small history list of the checks: GET `/api/jobs/:id/overdue-checks`, permission-mapped like the other job reads in `routePermissions.ts` (append only).
   - The "Dừng" button stays. While the job waits for a decision, the three decision buttons from 4 show too.
   - Add a project or app setting "Khi quá thời gian" with three choices:
     - `check` (the default): the checker plus Hermes, as above;
     - `abort`: the old behaviour, a kill at the limit after one extension. It is the only clock-based abort, and only because the user chose it;
     - `notify_only`: no LLM checks and no Hermes; the ladder only waits or escalates, and an escalation goes straight to the user's notification.

     Store it in the existing project settings and app settings pattern.

## Mã nguồn mở có sẵn (open source)

- **Temporal** (MIT): use its heartbeat timeout vs start-to-close timeout split as the conceptual model. A job is unhealthy when its heartbeat or progress stops, not when the wall clock passes a guess. We copy the idea, not code: our "work signals" are the heartbeat. Docs: activity timeouts.
- **BullMQ** (MIT): stalled-job detection with `stalledInterval` and `maxStalledCount` is the usual way to tell a dead worker from a slow one. We take only the detection idea. BullMQ retries a stalled job on its own, and we do not: here the retry is Hermes's decision.
- **Estimating from history:** robust median and p90 per unit is standard practice (CI systems such as GitLab and Buildkite show ETAs from recent durations). No library is needed; percentiles are a few lines. If you know a tiny permissive percentile or EWMA helper already in `node_modules`, you may use it. Do not add one.
- If you find an open-source project that clearly does "LLM-assisted stuck-job triage" better, report it (README rule 11). Do not add it.

## Rules

- AGENTS.md:
  - no commit or push;
  - do not touch `.env`, `.claude/`, `data/` or `scripts/`;
  - no `npm install`;
  - migrations only through `npx drizzle-kit generate` in `apps/server` (a second run must print "No schema changes");
  - tests never use the network or a real LLM. Inject the checker's LLM call and use fake timers.
- File boundaries: TASK-119 may run at the same time, so:
  - do not edit `apps/server/src/node/*`, `api/nodes.ts`, `packages/shared/src/schemas/node.ts` or `apps/web/src/features/nodes/`;
  - in `routePermissions.ts`, `featureMap`, `OperatorEventKind`, the tool registry and `db/schema.ts`, **append only**.
  - If you both need a migration, run `npx drizzle-kit generate` right after your schema edit. If the journal changed under you, regenerate; never hand-merge SQL.
- Do not loosen `registry/policy.ts`, the guard or the TASK-059 hard limits. The check spacing, the `extendMs` clamps and the confidence thresholds are code constants, not settings an agent can change.
- Registry tools:
  - `list_overdue_jobs`, `get_overdue_checks` and `decide_overdue`, as in Part B.4;
  - add **no** tool that changes the thresholds or the clamps.

  Keep the skill pack coverage test (`agentSkillPack.test.ts`) passing. The new `video-kiem-tra-qua-gio` skill covers the three tools.
- Run:
  - the root typecheck;
  - the server suite (rerun any file that fails alone, with fewer workers, before calling it a failure);
  - the web suite;
  - the shared tests.

## Tests (at least)

- **Shared:** `estimateStageMs` cases (Part A.1), including `confidence` and `lowReasons` (few samples, wide spread, units outside the seen range, a new node); the action schemas; the ladder decision table.
- **Server, plan:** a high-confidence stage makes no LLM call; low-confidence stages go to the agent in one call and get `basis: "agent"` with the reason; an agent failure or ECO mode gives `basis: "rough"`; out-of-range agent numbers are clamped.
- **Server, worker** (fake timers, fake executor that keeps running):
  - past the limit, the job is **not** aborted; a check row is written; progress says it is being checked;
  - work moving → `wait` extends; the job finishes; its status is done; the duration counts as history;
  - no signals at all → the checker escalates and **never** aborts, even after many checks and hours of fake time; check spacing grows 2→5→10→20→30 min;
  - `decide_overdue` `abort_retry` aborts and requeues; the attempt goes up; the next limit grows. `abort_fail` fails with Hermes's reason. `wait` extends within the clamps. `ask_user` notifies and keeps running;
  - `decide_overdue` is refused on a job that is no longer overdue, and on the protected project for abort actions;
  - no decision for 30 min → one user notification, the job keeps running, and the next notice is not before 2 h;
  - the user's three buttons go through the same path with `source: "user"`;
  - a user cancel during an overdue wait aborts at once;
  - setting `abort` keeps the old behaviour; `notify_only` makes no LLM call;
  - an invalid LLM output falls back to the ladder, and an override is recorded;
  - the supervisor `job_overdue` and the new `job_stalled` rule;
  - the `job_overdue` operator event fires.
- **Web:** the overdue badge and the check list; the panel shows expected, limit and basis; the ETA text.

## Docs

- In `docs/user-guide/du-an-va-quy-trinh.md` (or the page that explains "Thời gian chờ"), explain:
  - estimates from history;
  - when the agent estimates instead of the history, and what "ước lượng thô" means;
  - what happens when a stage runs over: checking, Hermes's diagnosis, the 30-min notice, the three buttons. Say plainly that nothing is killed by the clock unless the user picks `abort`;
  - the three "Khi quá thời gian" choices.
- Add a `xu-ly-su-co.md` entry: "Bước chạy quá lâu".
- Add a changelog bullet in `nhat-ky-thay-doi.md`.

## Done

- [ ] `estimateStageMs` with confidence + history loader + plan order (agent decides low-confidence stages) + hash bucket; panel and ETA
- [ ] soft limit: no abort at the limit; facts; in-app checker (wait/escalate only) with ladder + LLM + code override
- [ ] Hermes: `list_overdue_jobs`, `get_overdue_checks`, `decide_overdue` + policy; skill `video-kiem-tra-qua-gio`; 30-min user notice; user decision buttons
- [ ] `jobs.overdue_at`/`next_check_at`/`overdue_state`, `stage_overdue_checks` table, history index: drizzle-kit migrations, "No schema changes" after
- [ ] supervisor `job_overdue` + new `job_stalled` rule; `job_overdue` operator event
- [ ] remote jobs handled via the existing lease API, or a documented fallback and hook for TASK-119/120
- [ ] UI badge, check history, "Khi quá thời gian" setting (`check` / `abort` / `notify_only`); skill coverage
- [ ] tests above; typecheck, server, web and shared suites
- [ ] user guide + changelog
- [ ] report `docs/tasks/TASK-125.report.md` (including real numbers: what the history estimate gives for the last projects in the dev DB vs the old baseline, read-only), then `docs/tasks/TASK-125.done`
