# TASK-003 Implementation Report

## Files created or changed

- Shared pipeline types and schemas: `packages/shared/src/pipeline.ts`, `packages/shared/src/schemas/job.ts`, `packages/shared/src/schemas/dashboard.ts`, and `packages/shared/src/index.ts`.
- Database and migration: `apps/server/src/db/schema.ts`, `apps/server/drizzle/0001_heavy_moonstone.sql`, `apps/server/drizzle/meta/0001_snapshot.json`, and `apps/server/drizzle/meta/_journal.json`.
- Server pipeline and jobs: `apps/server/src/jobs/eventBus.ts`, `jobRepository.ts`, `worker.ts`; `apps/server/src/pipeline/stageExecutor.ts`, `executorRegistry.ts`, `fakeExecutor.ts`, `invalidation.ts`, and `orchestrator.ts`.
- Server integration: `apps/server/src/api/pipeline.ts`, `apps/server/src/app.ts`, `apps/server/src/lib/config.ts`, and `apps/server/src/services/projectService.ts`.
- Server tests: `apps/server/test/orchestrator.test.ts`, `worker.test.ts`, `pipelineApi.test.ts`, and `pipelineFixtures.ts`.
- Web integration: `apps/web/src/services/pipelineApi.ts`, `apps/web/src/hooks/usePipeline.ts`, `apps/web/src/features/pipeline/PipelinePanel.tsx`, `StageRow.tsx`, and `PipelinePanel.test.tsx`.
- Existing web surfaces/tests: `apps/web/src/features/projects/ProjectDetailPage.tsx`, `ProjectDetailPage.test.tsx`, `apps/web/src/features/dashboard/DashboardPage.tsx`, `DashboardPage.test.tsx`, and `apps/web/src/index.css`.
- Configuration: `.env.example`.
- Completion marker: `docs/tasks/TASK-003.done`.

## Migration

Generated with the existing stable Drizzle Kit 0.31.x dependency: `apps/server/drizzle/0001_heavy_moonstone.sql`. It adds `jobs`, `project_stages`, indexes, cascading project foreign keys, and nullable `projects.run_mode`.

## Verification

| Command | Result |
|---|---|
| `npm run typecheck` | Passed for shared, server, and web workspaces. |
| `npm run build` | Passed for all workspaces. Rollup printed non-fatal annotation warnings from the existing Zod dependency. |
| `npm test` | Passed: 51 tests total — server 34/34 and web 17/17. |

Coverage added for status derivation, AUTO/ASSISTED/MANUAL gates, stage ordering, invalidation, retry/backoff/exhaustion, timeout, cancellation, restart resume, API actions, SSE snapshot/update, EventSource cleanup, polling fallback, pipeline row states/actions, and dashboard error links.

## Deviations

- Added an internal `previous_state` column to `jobs` so cancellation can restore the stage state that existed before enqueueing. It is not exposed on the shared `Job` API shape.
- The project deletion check now queries queued/running jobs. The existing project-status guard remains to preserve established TASK-001/002 behavior when status is stale.

## Remaining issues

- Stage executors are intentionally fake; real research, media, and render stages remain out of scope for TASK-003.
- The build retains the existing non-fatal Zod/Rollup annotation warnings.

## Fix round 1

### Files changed

- `apps/web/src/hooks/usePipeline.ts`
- `apps/web/src/features/pipeline/PipelinePanel.tsx`
- `apps/web/src/features/pipeline/PipelinePanel.test.tsx`
- `apps/server/src/pipeline/orchestrator.ts`
- `apps/server/src/jobs/jobRepository.ts`
- `apps/server/test/worker.test.ts`
- `apps/server/test/orchestrator.test.ts`
- `apps/server/test/pipelineFixtures.ts`
- `docs/tasks/TASK-003.report.md`
- `docs/tasks/TASK-003.fix-done` (empty completion marker)

### Verification

| Command | Result |
|---|---|
| `npm run typecheck` | Passed for shared, server, and web workspaces. |
| `npm run build` | Passed for all workspaces. Existing non-fatal Zod/Rollup annotation warnings remain. |
| `npm test` | Passed: 55 tests total — server 36/36 and web 19/19. |

No API or database schema changes, dependency upgrades, or commits were made.

## Architect verification (post fix round 1)
- 55/55 tests (server 36, web 19); no dependency changes.
- Browser: new ASSISTED project, Generate All → stops at VISUAL_REVIEW without reload; Cancel hidden, Generate All disabled with hint, Approve shown. Only 2 GET /pipeline requests during the whole run (debounced).
