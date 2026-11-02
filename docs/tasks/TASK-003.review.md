# TASK-003 Review (by Architect)

Verdict: **Accepted with fixes.** Independently verified: typecheck, build, 51/51 tests (server 34, web 17), `npm audit --omit=dev` = 0, no dependency changes. Code review: transitions are transactional, events are queued until commit, cancel/abort race handled, resume and graceful shutdown look correct.

Manual browser test (ASSISTED, fake executors): Generate All → progress live via SSE → stops at VISUAL_REVIEW (status Review) → Approve → MUSIC_REVIEW → Approve → FINAL_APPROVAL → Approve All → RENDER → Completed. 

## Required fixes (TASK-003-FIX)

### F1 — MUST: Pipeline panel keeps a stale `activeJob` after a live run
Repro: open a project Overview, click Generate All, wait until it stops at VISUAL_REVIEW (or finishes). Without reloading: **Generate All stays disabled and Cancel stays enabled**, although `GET /pipeline` returns `activeJob: null`. Reloading the page fixes it. Clicking Cancel in that state gets a 409.
Cause (likely): `usePipeline` never applies `job.updated` to `activeJob`, and relies on one full refetch per event; with dozens of progress events the refetches race/overlap and the cache can end on an older snapshot.
Fix:
- Make the SSE reducer deterministic: on `job.updated`, if job status is `QUEUED`/`RUNNING` set `activeJob = job`; if terminal (`SUCCEEDED`/`FAILED`/`CANCELLED`) and it is the current `activeJob.id`, set `activeJob = null`. Also update `runMode`/`status`/`currentStage` from `project.updated` data.
- Replace "invalidate on every event" with a single trailing debounced refetch (~500 ms) as a consistency safety net.
- Regression test: feed the mocked EventSource a realistic sequence (job QUEUED → RUNNING with progress → SUCCEEDED, next stage, …, gate `WAITING_USER`) and assert Generate All is enabled and Cancel is not shown/enabled; assert no more than a couple of GET /pipeline calls for a burst of 50 progress events.

### F2 — MUST: Retry after a failed "Generate All" does not continue the pipeline
`failJob` sets `runMode = null`, so `retry` (which keeps the previous runMode) always runs as a single stage and the pipeline stops after the retried stage. (This came from the spec; the intended behavior is to continue.)
Fix: on final failure keep `runMode` unchanged (still clear it on `cancel` and on completion). `retry` then continues with `ALL` if the failed run was `ALL`.
Test: ASSISTED `runAll`, make VOICE fail non-retryably → project FAILED; `retry(VOICE)` succeeds → SUBTITLE and MUSIC_SEARCH run → stops at MUSIC_REVIEW.

### F3 — SHOULD: Re-entrant `atomic()`
`JobRepository.atomic` overwrites `eventQueue` and resets it to `undefined` in `finally`. If an `atomic` is ever nested (better-sqlite3 turns it into a savepoint), events emitted by the outer transaction after the inner one returns are published before the outer commit. Make it re-entrant: if a queue already exists, run `work()` inside the current transaction and reuse the same queue. Add a unit test with a nested call that throws in the outer scope and assert no events were published.

### F4 — COULD: Clearer actions at a gate / when completed
When a gate is `WAITING_USER`, disable Generate All with the hint "Approve the review gate to continue". When the project is completed, label it "Regenerate All".

## Do not
- Do not change the API shape or DB schema (no new migration needed).
- Do not upgrade dependencies.
- Do not commit.

## Report
Append `## Fix round 1` to `docs/tasks/TASK-003.report.md` (files changed, typecheck/build/test counts). Then create empty `docs/tasks/TASK-003.fix-done`.
