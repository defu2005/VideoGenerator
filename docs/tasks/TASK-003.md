# TASK-003 — Pipeline Core: Job Queue, Worker, State Machine, Gates, Modes, SSE

## GOAL
Build the pipeline engine that every later stage plugs into: persistent jobs, an in-process worker with timeout/retry/resume, a pipeline state machine with review gates and autonomy modes (AUTO / ASSISTED / MANUAL), live progress over SSE, and a Pipeline panel in the web Overview tab. Real stages (LLM, images, TTS…) are NOT part of this task: every stage uses a configurable **fake executor** so the engine can be built and tested end to end.

## CONTEXT
- Read `docs/ARCHITECTURE.md` sections 4 (Hybrid modes) and 5 (Pipeline & state machine).
- Existing code: `apps/server` (Fastify, Drizzle + better-sqlite3, `projectService`), `packages/shared` (enums incl. `PipelineStage`, `JobStatus`, `AutonomyMode`, `ProjectStatus`), `apps/web` (React, TanStack Query, Project Detail with tabs).
- Rule: no Redis, no broker, no extra processes. Everything runs inside the server process; state lives in SQLite so a restart resumes work.

## FILES TO INSPECT
- `apps/server/src/app.ts`, `src/services/projectService.ts`, `src/db/schema.ts`, `src/api/*.ts`
- `packages/shared/src/enums.ts`, `src/schemas/*.ts`
- `apps/web/src/features/projects/ProjectDetailPage.tsx`, `src/hooks/useProjects.ts`, `src/services/apiClient.ts`

## FILES TO CREATE/MODIFY (guide; adjust names if justified in the report)
```
packages/shared/src/pipeline.ts          # STAGE_ORDER, GATES, StageState enum, helpers
packages/shared/src/schemas/job.ts       # Job, JobError, JobUsage, StageRecord, PipelineState, PipelineEvent
packages/shared/src/schemas/dashboard.ts # recentErrors typed as JobErrorSummary[]
apps/server/src/db/schema.ts             # + jobs, project_stages tables (FK cascade on project delete)
apps/server/drizzle/0001_*.sql           # generated migration
apps/server/src/jobs/jobRepository.ts
apps/server/src/jobs/worker.ts
apps/server/src/jobs/eventBus.ts
apps/server/src/pipeline/stageExecutor.ts      # StageExecutor interface, StageContext, StageError
apps/server/src/pipeline/executorRegistry.ts
apps/server/src/pipeline/fakeExecutor.ts
apps/server/src/pipeline/orchestrator.ts       # state machine: run, advance, gates, approve, cancel, retry
apps/server/src/pipeline/invalidation.ts       # markStaleFrom(projectId, stage)
apps/server/src/api/pipeline.ts
apps/server/src/lib/config.ts                  # new env vars
apps/server/test/orchestrator.test.ts
apps/server/test/worker.test.ts
apps/server/test/pipelineApi.test.ts
apps/web/src/services/pipelineApi.ts
apps/web/src/hooks/usePipeline.ts              # query + EventSource subscription
apps/web/src/features/pipeline/PipelinePanel.tsx
apps/web/src/features/pipeline/StageRow.tsx
apps/web/src/features/pipeline/*.test.tsx
apps/web/src/features/projects/ProjectDetailPage.tsx  # mount PipelinePanel in Overview
apps/web/src/features/dashboard/DashboardPage.tsx     # render recentErrors
.env.example
```

## REQUIREMENTS

### 1. Shared pipeline definitions (`@vg/shared`)
- `STAGE_ORDER`: `RESEARCH, SCRIPT, SCENE_PLAN, VISUAL_SEARCH, VISUAL_REVIEW, VOICE, SUBTITLE, MUSIC_SEARCH, MUSIC_REVIEW, TIMELINE, FINAL_APPROVAL, RENDER` (TOPIC is the initial project stage, DONE the terminal stage; neither runs a job).
- `GATES`: `VISUAL_REVIEW, MUSIC_REVIEW, FINAL_APPROVAL`. Gates never run a job; they wait for approval.
- `StageState`: `PENDING | QUEUED | RUNNING | DONE | FAILED | STALE | WAITING_USER | SKIPPED`.
- `StageRecord`: `{ stage, state, progress (0–100), message|null, jobId|null, updatedAt, error|null }`.
- `Job`: `{ id, projectId, stage, scope|null, status: JobStatus, progress, message|null, attempt, maxAttempts, error: {code, message, retryable}|null, usage: {llmCalls, inputTokens, outputTokens, costUsd}|null, createdAt, startedAt|null, finishedAt|null, runAfter }`.
- `PipelineState`: `{ projectId, mode, runMode: "ALL"|"SINGLE"|null, currentStage, status, stages: StageRecord[], activeJob: Job|null }`.
- `PipelineEvent` (SSE payload): `{ type: "job.updated"|"stage.updated"|"project.updated"|"heartbeat", projectId, data, at }`.

### 2. Database
- `jobs` table matching `Job` (JSON text for error/usage). Index `(status, run_after)`, `(project_id, created_at)`.
- `project_stages` table: PK `(project_id, stage)`, columns of `StageRecord`.
- Add to `projects`: `run_mode` text nullable (`ALL`/`SINGLE`). Do not drop/rename existing columns.
- Both new tables cascade-delete with the project. Generate the migration with drizzle-kit (stable 0.31.x; do NOT upgrade drizzle packages).
- Stage rows are created lazily (all `PENDING`) the first time a pipeline action happens on a project; existing projects keep working.

### 3. Executor contract
```ts
interface StageExecutor {
  stage: PipelineStage;
  run(ctx: StageContext): Promise<StageResult>;
}
interface StageContext {
  project: Project; job: Job;
  signal: AbortSignal;                       // aborted on timeout or cancel
  reportProgress(pct: number, message?: string): void;  // throttled persist + event
  recordUsage(u: Partial<JobUsage>): void;
  logger: FastifyBaseLogger-like;            // child logger with jobId/stage
}
type StageResult = { outputHash?: string; message?: string };
class StageError extends Error { code: string; retryable: boolean; }
```
- `executorRegistry` maps stage → executor. In this task every non-gate stage gets `FakeExecutor` (steps through progress 0→100 in N ticks; delay from `FAKE_STAGE_DELAY_MS`; can be told in tests to fail once/always, fail non-retryable, or hang).
- Later tasks replace entries in the registry only; nothing else in the engine should need changes.

### 4. Worker
- Single in-process loop started in `buildApp` (can be disabled with `WORKER_ENABLED=false` for tests that drive it manually via `worker.tick()`).
- Picks `QUEUED` jobs with `runAfter <= now`, oldest first; concurrency `WORKER_CONCURRENCY` (default 1). Wakes immediately on enqueue (no busy-wait; idle poll ≤ 1 s).
- Timeout per job `STAGE_TIMEOUT_MS` (default 600000) via AbortController → error `STAGE_TIMEOUT` (retryable).
- Retry: on retryable `StageError` or unknown error, if `attempt < maxAttempts` (default `JOB_MAX_ATTEMPTS`=3) re-queue with exponential backoff (`runAfter = now + JOB_RETRY_BASE_MS * 2^(attempt-1)`, default base 2000). Non-retryable → FAILED immediately.
- Startup resume: jobs left `RUNNING` become `QUEUED` (same attempt) and their stage `QUEUED`.
- Graceful shutdown on Fastify `onClose`: stop picking jobs, abort running ones, mark them `QUEUED` so they resume next start.
- Every state change is persisted first, then emitted on the event bus.
- Structured logs: job start/finish/fail/retry with jobId, projectId, stage, attempt, durationMs.

### 5. Orchestrator (state machine)
Operations (all validate state and throw `AppError` 409 `INVALID_PIPELINE_STATE` with a clear message when not allowed):
- `runAll(projectId)`: set `runMode=ALL`; enqueue the first stage in `STAGE_ORDER` whose state is not `DONE`/`SKIPPED`. Allowed when no job is active.
- `runStage(projectId, stage)`: set `runMode=SINGLE`; enqueue only that stage. Allowed when no job is active and every earlier non-gate stage is `DONE` (gates before it must be `DONE` too). Re-running a `DONE` stage is allowed and marks all later stages `STALE`.
- On job success: stage `DONE`, `project.stage` = that stage. If `runMode=ALL`, continue to the next stage:
  - next is a gate → apply gate policy (below);
  - next is a normal stage → enqueue it;
  - none left → `project.stage=DONE`, `status=COMPLETED`, `runMode=null`.
  - If `runMode=SINGLE` → stop after this stage (`runMode=null`).
- Gate policy:
  - `ASSISTED`: gate `WAITING_USER`, `project.status=REVIEW`, `project.stage=<gate>`; stop.
  - `AUTO`: auto-approve `VISUAL_REVIEW` and `MUSIC_REVIEW` (state `DONE`, message "Auto-approved (AUTO mode)") and continue. `FINAL_APPROVAL` is auto-approved only when `settings.autoRender=true`; otherwise wait like ASSISTED.
  - `MANUAL`: same as ASSISTED, and `runAll` is still allowed (user explicitly asked), but approving a gate does NOT auto-continue: the user triggers the next stage.
- `approveGate(projectId, gate)`: only when that gate is `WAITING_USER`. Marks `DONE`; in AUTO/ASSISTED continue with `runMode=ALL`; in MANUAL stop. (Real review validation, e.g. "every scene has an approved visual", will be added by the gate's owning task through a `canApprove` hook — define the hook now, default returns ok.)
- `cancel(projectId)`: cancel the active job (abort if running), stage back to its previous state (`PENDING` or `STALE`), `runMode=null`, project status recalculated.
- `retry(projectId, stage)`: only when the stage is `FAILED`; enqueue a fresh job (attempt 1), keeps the previous `runMode`.
- On final failure: stage `FAILED` with error, `project.status=FAILED`, `runMode=null`. Outputs of other stages are untouched.
- Project status derivation (single function, unit tested): active job on `RENDER` → `RENDERING`; any other active job → `GENERATING`; any gate `WAITING_USER` → `REVIEW`; any stage `FAILED` → `FAILED`; `project.stage=DONE` → `COMPLETED`; else `DRAFT`.
- `markStaleFrom(projectId, stage)`: marks every later stage that is `DONE` (including gates) as `STALE`. Exported for later tasks (e.g. editing narration). Not exposed as an API yet.
- Concurrency safety: wrap each orchestrator transition in a SQLite transaction; never allow two active jobs for the same project.

### 6. API
| Method | Path | Behavior |
|---|---|---|
| GET | `/api/projects/:id/pipeline` | `PipelineState` (polling fallback) |
| POST | `/api/projects/:id/pipeline/run` | body `{ stage?: PipelineStage }`; no stage → `runAll`, else `runStage`; 202 + `PipelineState` |
| POST | `/api/projects/:id/pipeline/gates/:gate/approve` | `approveGate`; 200 + state |
| POST | `/api/projects/:id/pipeline/cancel` | `cancel`; 200 + state |
| POST | `/api/projects/:id/pipeline/stages/:stage/retry` | `retry`; 202 + state |
| GET | `/api/projects/:id/jobs?limit=20` | recent jobs, newest first |
| GET | `/api/projects/:id/events` | SSE stream |
| GET | `/api/dashboard/stats` | `recentErrors`: last 10 failed jobs `{ jobId, projectId, projectTitle, stage, code, message, at }` |

- SSE: `content-type: text/event-stream`, `cache-control: no-cache`; send `event: <type>` + `data: <json>`; first message is a full `pipeline.snapshot` with the current `PipelineState`; heartbeat every 15 s; unsubscribe on client disconnect (no listener leaks). Works through the Vite proxy.
- Deleting a project with an active job still returns 409 (already in projectService; make it use the real job state).

### 7. Web UI — Pipeline panel (Overview tab)
- Replace the static stage list with `PipelinePanel`:
  - one row per stage: name, state badge (gate rows visually distinct), progress bar while running, message, error reason when failed;
  - top actions: **Generate All** (runAll), **Cancel** (when active); per row: **Run** (allowed stages), **Retry** (failed), **Approve** (gate `WAITING_USER`; label "Approve All" on FINAL_APPROVAL);
  - a mode hint line: e.g. "ASSISTED: the agent pauses at review gates".
- `usePipeline(projectId)`: fetch `PipelineState`, open `EventSource('/api/projects/:id/events')`, apply events to the query cache; on SSE error fall back to polling every 3 s until reconnected; close on unmount.
- Project header status/stage update live (invalidate `['project', id]` and `['dashboard']` on `project.updated`).
- Dashboard shows `recentErrors` (project title link, stage, message, time).
- Disable buttons while a mutation is pending; show API 409 messages inline.

### 8. Config (`.env.example`)
`WORKER_ENABLED=true`, `WORKER_CONCURRENCY=1`, `STAGE_TIMEOUT_MS=600000`, `JOB_MAX_ATTEMPTS=3`, `JOB_RETRY_BASE_MS=2000`, `FAKE_STAGE_DELAY_MS=300`.

## IMPLEMENTATION NOTES
- Keep orchestrator logic pure where possible: a `decideNext(state, event)` style function is easy to unit test; the service applies the decision inside a transaction.
- Use an injectable clock (`now()`) in worker/orchestrator for deterministic tests.
- Throttle `reportProgress` persistence (e.g. at most every 250 ms or on +5%) but always emit the final 100%.
- Event bus: a simple typed `EventEmitter` keyed by projectId; set max listeners sensibly.

## DO NOT
- Do not implement real stages (LLM, search, TTS, FFmpeg) or provider interfaces.
- Do not add Redis, BullMQ, worker threads, child processes, or WebSockets.
- Do not change existing API shapes from TASK-001/002 except `recentErrors` typing.
- Do not upgrade drizzle-orm/drizzle-kit.
- Do not commit.

## ACCEPTANCE CRITERIA
1. Root `npm run typecheck`, `npm run build`, `npm test` pass; existing 32 tests still pass.
2. With fake executors in ASSISTED mode, clicking **Generate All** in the UI runs RESEARCH→SCENE_PLAN→VISUAL_SEARCH live (progress bars move without reload), then stops at VISUAL_REVIEW with project status REVIEW; Approve continues to MUSIC_REVIEW, then FINAL_APPROVAL; Approve All runs RENDER; project ends COMPLETED.
3. AUTO mode runs straight to FINAL_APPROVAL (or to COMPLETED when `autoRender=true`).
4. MANUAL mode: approving a gate does not start the next stage.
5. A failing stage shows the reason and Retry in the UI; retrying succeeds; other stages keep their state.
6. Killing the server mid-stage and restarting resumes the job automatically.
7. Cancel stops the running stage within 1 s.
8. No SSE listener leak: opening/closing the page 20 times leaves 0 listeners for the project.

## TESTS
Server (Vitest, temp DB, `WORKER_ENABLED=false`, manual `tick()`, fake clock):
- status derivation table test (all branches)
- ASSISTED runAll → stops at VISUAL_REVIEW, status REVIEW; approve → continues; full run → COMPLETED
- AUTO: skips first two gates; FINAL_APPROVAL waits unless autoRender
- MANUAL: approve does not continue; runStage requires earlier stages DONE (409 otherwise)
- retryable failure → re-queued with backoff `runAfter`, succeeds on attempt 2; non-retryable → FAILED immediately; exhausted attempts → FAILED, project FAILED
- timeout → STAGE_TIMEOUT, retried
- cancel running job → aborted, stage reset, no active job
- resume: a RUNNING job in DB at startup becomes QUEUED and completes
- re-running a DONE stage marks later stages STALE; `markStaleFrom` unit test
- only one active job per project (second runAll → 409)
- API: run/approve/cancel/retry/jobs status codes; dashboard `recentErrors`
- SSE: real listen on port 0, connect, receive snapshot then a `job.updated` after `runAll`; disconnect removes listener
Web (Vitest + Testing Library, mock fetch + mock EventSource):
- PipelinePanel renders states, buttons per state; Approve calls the right endpoint
- usePipeline applies an incoming `stage.updated` event to the UI; falls back to polling on SSE error

## EXPECTED RESULT
A working, observable, resumable pipeline engine with review gates and autonomy modes, driven entirely from the UI, ready for real stages (TASK-004+) to be dropped into the executor registry.

## DEPENDENCIES
TASK-001, TASK-002 (done).

## REPORT BACK
Write `docs/tasks/TASK-003.report.md`: files created/changed, migration name, command results with test counts, deviations and why, remaining issues. Then create empty `docs/tasks/TASK-003.done`.
