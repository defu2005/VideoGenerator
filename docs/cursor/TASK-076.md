# TASK-076 — Render limit + voice/subtitles/music run while images wait for review

**Who:** Cursor, model `grok-4.7-xhigh` (concurrency and pipeline state: hard). **Order:** can run now, next to TASK-070 (Cursor, compose) and TASK-084 (Codex, originality). It does not need a DB change; **do not add one**, Codex holds the migration lock.

Read first: `docs/cursor/README.md`, this file, then grep (never open whole): `apps/server/src/pipeline/orchestrator.ts` (865 lines), `apps/server/src/jobs/worker.ts`, `apps/server/src/jobs/jobRepository.ts`, `apps/server/src/pipeline/invalidation.ts`, `packages/shared/src/pipeline.ts`, `apps/server/src/lib/config.ts`.

## Why

AUTO runs one project as a straight line: RESEARCH → SCRIPT → SCENE_PLAN → VISUAL_SEARCH → VISUAL_REVIEW → VOICE → SUBTITLE → MUSIC_SEARCH → MUSIC_REVIEW → TIMELINE → FINAL_APPROVAL → RENDER. Since TASK-077, VISUAL_REVIEW often stops and waits for the user. Voice, subtitles and music do not need the images, yet they wait too. When the user finally answers, they still wait several more minutes. Second problem: `WORKER_CONCURRENCY` limits all jobs together, so with a higher value two renders (Chrome + ffmpeg) can run at once and starve the machine, while with 1 a long render blocks every light LLM step of other projects.

## What exists today (check before you build)

- `STAGE_ORDER` and `GATES` in `packages/shared/src/pipeline.ts`.
- `runStage` refuses a stage when any earlier stage is not DONE/SKIPPED (`orchestrator.ts` ~line 136).
- `assertNoActiveJob` allows one active job per project.
- `continueAll` picks the next not-done stage in `STAGE_ORDER`.
- `markStaleFrom` (`invalidation.ts`) marks every later DONE stage STALE, linearly.
- Worker `tick` claims jobs while `running.size < WORKER_CONCURRENCY`; `canStartQueuedJob` already holds RENDER when disk is low.

## Mã nguồn mở có sẵn

Nothing to add. A stage dependency graph and a per-kind semaphore are a few dozen lines; do not add a job-queue library (BullMQ, p-limit, etc.). If you find one clearly worth it, report it (README rule 11).

## Rules for this task

- No commit or push. No new npm dependency. **No DB change, no migration.**
- Do not touch `.env`, `.claude/`, `data/`, `scripts/`, `apps/server/src/compose/**`, `apps/server/assets/compose/**`, `packages/shared/src/compose/**` (TASK-070), `apps/server/src/originality/**`, `packages/shared/src/originality/**`, `apps/server/src/publishing/**`, `apps/server/src/guidelines/**` (TASK-084).
- Other agents edit the same checkout. Before editing a shared file (`orchestrator.ts`, `config.ts`, `app.ts`, `docs/user-guide/**`, featureMap), re-read it and make a small edit; never rewrite it whole.
- Tests: no network, no real LLM/TTS. Use `fakeExecutor.ts` and in-memory SQLite.
- Never approve gates or render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## 1. Stage dependencies instead of a straight line

Add `STAGE_DEPENDS: Record<PipelineStage, PipelineStage[]>` in `packages/shared/src/pipeline.ts`, next to `STAGE_ORDER` (which stays as the display order). First confirm each input by reading the executors; expected:

- VOICE ← SCENE_PLAN (narration per scene), SUBTITLE ← VOICE, MUSIC_SEARCH ← SCENE_PLAN (check `musicService.ts` does not read visuals), MUSIC_REVIEW ← MUSIC_SEARCH.
- VISUAL_SEARCH ← SCENE_PLAN, VISUAL_REVIEW ← VISUAL_SEARCH.
- TIMELINE ← VISUAL_REVIEW, SUBTITLE, MUSIC_REVIEW. FINAL_APPROVAL ← TIMELINE. RENDER ← FINAL_APPROVAL.

If an executor reads something the map does not list, fix the map, and say so in the report.

Use the map in:
- `runStage` / `continueAll`: a stage may start when all its dependencies are DONE/SKIPPED.
- `markStaleFrom`: mark stale only the stages that depend, directly or not, on the changed stage. Re-searching images must no longer make the voice stale; editing the script still makes everything after it stale.

## 2. Two lanes per project

- Allow **at most two active jobs per project**: one in the visual lane (VISUAL_SEARCH) and one in the audio lane (VOICE, SUBTITLE, MUSIC_SEARCH). Every other stage keeps one job per project. Replace `assertNoActiveJob` with a check by lane.
- In run mode ALL (and AUTO), when SCENE_PLAN is done, queue VISUAL_SEARCH and VOICE together. When a lane reaches its gate (VISUAL_REVIEW or MUSIC_REVIEW waiting), the other lane keeps going. TIMELINE starts only when both lanes are done.
- AUTO gate behaviour does not change: VISUAL_NEEDS_USER from TASK-077 still stops the visual lane and raises "Cần bạn xử lý"; MUSIC_REVIEW auto-approves as today.
- Project status: `deriveProjectStatus` must still show REVIEW while a gate waits, even when the audio lane is RUNNING. Show both on the stage stepper (the web already lists stages; make sure two RUNNING/WAITING states render right).
- Cancel, retry and resume (including the BUGFIX-VISUAL resume that keeps progress) must handle two jobs of one project. Cancelling one lane does not cancel the other unless the user cancels the project.

## 3. Render limit

- Config `RENDER_CONCURRENCY` (default 1, max 4) in `config.ts` and `.env.example`, separate from `WORKER_CONCURRENCY`.
- In `canStartQueuedJob`, hold a RENDER job while that many renders are running. Keep the disk-low hold.
- Raise the `WORKER_CONCURRENCY` default to 3, so light steps of other projects keep running beside one render. Keep the `max(32)`.
- The jobs page / health shows "render: x/y đang chạy".

## 4. Tests

- Unit: `STAGE_DEPENDS` has no cycle and agrees with `STAGE_ORDER` (each dependency comes earlier). Stale propagation follows the graph.
- Orchestrator with fake executors: after SCENE_PLAN, VISUAL_SEARCH and VOICE both get queued; VISUAL_REVIEW waiting while VOICE → SUBTITLE → MUSIC_SEARCH finish; approve visuals → TIMELINE starts only once.
- Re-run VISUAL_SEARCH: VOICE stays DONE, TIMELINE becomes STALE.
- Worker: with `RENDER_CONCURRENCY=1` and `WORKER_CONCURRENCY=3`, two queued renders run one after the other while an LLM job runs beside them.
- Cancel/resume with two active jobs in one project.
- Existing pipeline tests stay green; change an old test only for a deliberate behaviour change, and list it.

## 5. Done

User guide (Vietnamese): a short paragraph in the pipeline/automation page that voice and music now continue while images wait, and what `RENDER_CONCURRENCY` does. featureMap and changelog. Run the README checklist (typecheck, full tests, build). Some failures may come from TASK-084/TASK-070 work in progress: list them with the file, do not fix files outside your scope. Write `docs/tasks/TASK-076.report.md`, then create the empty `docs/tasks/TASK-076.done`.
