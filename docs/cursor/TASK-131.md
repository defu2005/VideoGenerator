# TASK-131 — Finish the loose wiring from TASK-120 and TASK-125 🔌

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-medium`). **Size:** M. **Migration:** none. **New dependency:** none.
**Depends on:** 120 and 125 (both done). Run it **after 129b** finishes: both tasks touch the job and stage path. Do not run it beside a task that edits `services/composeBridge.ts` or `pipeline/stageExecutor.ts`.
**Source:** the "not done" lists in `docs/tasks/TASK-120.report.md` and `docs/tasks/TASK-125.report.md`.

## Why

Two finished tasks left pieces unconnected.

- **TASK-120:** `node/mediaFetch.ts` has `MediaFetchService.enqueue`, the node runner and placement. Nothing in the render-prepare path creates MEDIA_FETCH side jobs, so footage is always downloaded by the control server inside RENDER, never by a node and never in advance.
- **TASK-125:**
  - **No activity reports.** Executors never call `context.reportActivity` (`pipeline/stageExecutor.ts:11`), so the overdue ladder never sees `childAlive` or `llmInFlight` and relies only on progress and heartbeat.
  - **No ETA.** The overdue card has no "dự kiến còn ~X phút" text.
  - **Stale timeout plan.** `packages/shared/src/budget/modes.ts` ~line 407 calls `stageTimeoutPlanIsFresh` with a hash that does not include the history bucket. `pipeline/stageTimeoutPlan.ts:29` does include it, so the two disagree, and a plan is never refreshed just because history grew.
  - **Flaky test.** `test/qualityRepair.test.ts` has a "shelve" test that fails around UTC midnight.

## Read first

- `apps/server/src/node/mediaFetch.ts`: `MediaFetchService` and `MediaFetchExecutor`. Also `node/placement.ts`, `node/remoteRunners.ts` and `node/leaseService.ts`.
- `apps/server/src/services/composeBridge.ts`: `searchFootage`, `ensureFootage` and `pickFootageFile`, i.e. where RENDER downloads footage today.
- `apps/server/src/pipeline/stageExecutor.ts` (`reportActivity`) and `jobs/worker.ts` ~line 436, where the worker turns reports into overdue signals.
- The executors that run child processes or LLM calls: `stages/voice/*`, `stages/script/scriptExecutor.ts`, the visual search executor, the render executor and the ffmpeg helpers. Also `providers/llm/structured.ts`, the single place where LLM calls start and end.
- `packages/shared/src/pipeline/stageTimeouts.ts` (`stageTimeoutInputHash`, `stageTimeoutPlanIsFresh`, `historyBucket`) and `packages/shared/src/budget/modes.ts` ~line 400.
- `apps/web/src/features/pipeline/OverdueCard.tsx` and the overdue API shape.

## Build

1. **MEDIA_FETCH ahead of render.**
   - When the compose plan is ready (the point where footage shots are known, before RENDER is queued), collect the footage items that the cache does not hold (`MediaFetchService.missing`).
   - Enqueue one MEDIA_FETCH side job for them.
   - Placement then decides: a capable node, or the local executor.
   - RENDER does not wait on it. If the side job has not finished when RENDER starts, RENDER downloads what is still missing, exactly as today. The side job is a head start, never a new blocker.
   - Create no job when nothing is missing, when the project has no footage shots, or when a MEDIA_FETCH job for the same project is already queued or running.
   - A setting `media.prefetch` (default on) turns it off.
2. **Activity reports.**
   - Call `context.reportActivity` from these places:
     - the ffmpeg and child-process helpers: `childAlive: true` plus a short `childNote` (the command name) while the child runs, and `false` when it exits;
     - the LLM call path in `structured.ts` / `generateText`: `llmInFlight` true or false around each call, threaded through the execution context and not through a global;
     - quota waits from the quota controller (`quotaWait`).
   - Keep the calls cheap: throttle to one report per 5 s per kind.
   - If no context is available, as in tests or tools, the call is a no-op.
3. **ETA text.**
   - Use `job.startedAt` (the job row has it, even though `StageRecord` does not) together with the expected time from the timeout plan.
   - Show "dự kiến còn ~X phút" on the overdue card and the stage stepper while the stage runs under its expected time.
   - Once past it, show "quá dự kiến X phút".
   - No migration.
4. **One hash.**
   - Make `modes.ts` build the timeout hash the same way `stageTimeoutPlan.ts` does, including the history bucket.
   - Move the hash construction into one shared helper so the two callers cannot drift apart again.
5. **The flaky shelve test.**
   - Find the date math that crosses UTC midnight: the "today" bucket and the attempt window.
   - Make the code use one injected clock throughout, and pin the test clock.
   - Add a test at 23:59:59Z and at 00:00:01Z.

## Mã nguồn mở có sẵn (open source)

- **Temporal** activity heartbeats and **BullMQ** stalled-job checks: the ideas behind `reportActivity`, already cited in TASK-125. No new code to take.
- Nothing to add for prefetch; it reuses the TASK-120 node runner.

## Rules

- README rules 1–11. No network in tests: use fake fetchers and fake child processes.
- Never approve gates or render on project `56374fb2-…`.
- Prefetch must never change what RENDER produces; it only fills the cache earlier.

## Tests

- **Prefetch:**
  - a plan with uncached footage → one MEDIA_FETCH job holding exactly the missing items;
  - everything cached → no job;
  - a second trigger while one is queued → no duplicate;
  - `media.prefetch` off → no job;
  - RENDER still downloads what is missing.
- **Activity:**
  - a fake child process reports `childAlive` true, then false;
  - an LLM call reports `llmInFlight`;
  - the throttle holds;
  - the worker passes these signals to the overdue ladder.
- **ETA:** under the expected time → "còn ~X phút"; over it → "quá dự kiến".
- **Hash:** `modes.ts` and `stageTimeoutPlan.ts` give the same hash for the same input, and a plan is stale after the history bucket changes.
- **Shelve:** the test passes with the clock at 23:59:59Z and at 00:00:01Z.

## Done

- [ ] prefetch, activity reports, ETA, one hash, shelve fix
- [ ] tests; shared + server + web suites; typecheck; build
- [ ] user guide line for "dự kiến còn" and prefetch; changelog
- [ ] report → `docs/tasks/TASK-131.done`
