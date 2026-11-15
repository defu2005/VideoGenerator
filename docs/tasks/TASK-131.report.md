# TASK-131 report: Loose wiring from TASK-120 and TASK-125

## What was done
1. **MEDIA_FETCH ahead of render:**
   - Added `mediaPrefetchEnabled` and `maybePrefetch` in `apps/server/src/node/mediaFetch.ts`.
   - Added `collectPlanFootageItems` and `prefetchPlanFootage` in `apps/server/src/services/composeBridge.ts`.
   - When the compose plan is ready, checks `MediaFetchService.missing` and enqueues a side job for uncached footage items if prefetch is enabled (`media.prefetch`, default true) and no MEDIA_FETCH job for the project is queued/running.
   - Tested in `apps/server/test/mediaPrefetch.test.ts` (5/5 passed).
2. **Activity reports:**
   - Created `apps/server/src/pipeline/stageActivity.ts` using `AsyncLocalStorage` to thread `StageContext` cleanly.
   - Created `createThrottledActivityReporter` throttled to 5 s per kind.
   - Wired child process tracking (`childAlive`, `childNote`) in `apps/server/src/media/ffmpeg.ts`.
   - Wired LLM call tracking (`llmInFlight`) and quota waits (`quotaWait`) in `apps/server/src/providers/llm/structured.ts`.
   - Worker passes activity reports to the overdue tracker.
   - Tested in `apps/server/test/activityReports.test.ts` (5/5 passed).
3. **ETA text display:**
   - Added `formatEtaText` in `@vg/shared`: "dự kiến còn ~X phút" when running under expected time, and "quá dự kiến X phút" once exceeded.
   - Updated `apps/web/src/features/pipeline/OverdueCard.tsx`, `StageRow.tsx`, and `PipelinePanel.tsx`.
   - Tested in `packages/shared/test/stageTimeouts.test.ts` and `apps/web/src/features/pipeline/OverdueCard.test.tsx` (3/3 passed).
4. **Unified timeout hash:**
   - Unified timeout planning hash logic across `packages/shared/src/budget/modes.ts` and `apps/server/src/pipeline/stageTimeoutPlan.ts` with `stageTimeoutHash`.
   - Verified that history bucket changes properly mark plans as stale.
5. **Fixed flaky shelve test:**
   - Fixed `apps/server/src/operator/repairDigest.ts` and `autopilot.ts` (`buildDigest`) around UTC midnight date boundaries.
   - Injected clock into `reopenShelved` in `qualityRepair.test.ts`. Tested at `23:59:59Z` and `00:00:01Z` (18/18 passed).

## Deviations / notes
- No DB migration required.
- Settings `media.prefetch` stored in `app_settings` and project settings overrides.

## Verification
- `npm run typecheck`: clean across all 4 workspaces (`@vg/shared`, `@vg/mcp`, `@vg/server`, `@vg/web`).
- `drizzle-kit generate`: No schema changes.
- Tests passed:
  - `apps/server/test/mediaPrefetch.test.ts`: 5/5
  - `apps/server/test/activityReports.test.ts`: 5/5
  - `apps/server/test/stageTimeoutPlan.test.ts`: 4/4
  - `apps/server/test/qualityRepair.test.ts`: 18/18
  - `packages/shared/test/stageTimeouts.test.ts`: 10/10
  - `apps/web/src/features/pipeline/OverdueCard.test.tsx`: 3/3
  - `apps/web/src/features/help/guideCoverage.test.ts`: 5/5
- User guide updated in `docs/user-guide/du-an-va-quy-trinh.md`, `may-worker.md`, and `nhat-ky-thay-doi.md`.
