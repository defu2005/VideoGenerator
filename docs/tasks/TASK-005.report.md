# TASK-005 Report

## Implementation

- Added the deterministic, Unicode-aware sentence splitter and scene planner with packing, timing, query distribution, and text-preservation coverage.
- Added the `scenes` table and generated migration `0005_scenes` using `npx drizzle-kit generate --name scenes` from `apps/server`.
- Replaced the placeholder `SCENE_PLAN` executor; added transactional persistence, input hashing, optional cached QUALITY query assistance, and budget estimation.
- Added scene read/edit/reorder/split/merge/delete APIs with timing recomputation, active-job checks, and downstream invalidation.
- Added the Scene Board, editor, duration indicator, unsaved-change guards, reorder controls, stale-state display, and live stage refresh.
- Added the read-only MCP `get_scenes` tool.

## Live mock-provider runs

| Platform | Language | Target video | Scene target | Result | Scenes | Planned total | SCENE_PLAN LLM calls |
|---|---|---:|---:|---|---:|---:|---:|
| TikTok | Vietnamese | 60 s | 3 s | DONE | 14 | 59.2 s | 0 |
| YouTube | English | 180 s | 7 s | DONE | 18 | 179.2 s | 0 |

Both runs preserved narration in order when concatenated and compared after whitespace normalization. Both used BALANCED mode and the mock provider.

## LLM calls by budget mode

- ECO: 0.
- BALANCED: 0.
- QUALITY: at most 1 batched query-assistance call when a unit has multiple scenes and there is no cached result; failures retain generated queries and do not fail the stage.
- CUSTOM: 1 at most when `sceneQueryAssist` is enabled and assistance is needed; otherwise 0.

## Validation

- `npm run typecheck` — passed.
- `npm run build` — passed.
- `npm test` — passed: shared 75, MCP 7, server 122, web 33 tests.
- `npx drizzle-kit generate --name scenes` from `apps/server` — no schema changes.

The build reports existing dependency-comment and bundle-size warnings. The server test suite logs its expected simulated project-directory cleanup failure; all tests pass.

## Deviations and remaining issues

- Port 3001 was already occupied during live validation, so the isolated mock-provider runs used port 3002. The temporary server and data were cleaned up.
- No other deviations or known remaining issues.

## Fix round 1

### Files

- `packages/shared/src/scenes/planScenes.ts` — continued per-unit query rotation and variants, target-near sentence splitting, and tiny-scene merging/rebalancing.
- `packages/shared/src/schemas/scene.ts`, `apps/server/src/services/sceneService.ts` — persist `queryVariant` in the existing visual-query JSON field; no additional migration was needed.
- `packages/shared/test/planScenes.test.ts` — invariant/property coverage, the 70-second sentence regression, and deterministic real-fixture checks for both targets.
- `apps/server/src/stages/scenes/scenePlanExecutor.ts`, `apps/server/test/scenePlan.test.ts` — report the video target in the success message.
- `apps/web/src/App.tsx`, `apps/web/src/services/queryRetry.ts`, `apps/web/src/services/queryRetry.test.ts`, `apps/web/src/hooks/usePipeline.ts`, `apps/web/src/hooks/pipelinePolling.ts`, `apps/web/src/hooks/pipelinePolling.test.ts` — bounded request retries and SSE fallback polling backoff/reset.

### Validation

- `npm run typecheck` — passed.
- `npm run build` — passed (existing dependency-comment and bundle-size warnings).
- `npm test` — passed: shared 79, MCP 7, server 123, web 36 (245 total).

### Real Vietnamese fixture statistics

| Scene target | Scene count | Min duration | Max duration | Consecutive duplicate primaries |
|---:|---:|---:|---:|---:|
| 3 s | 30 | 2 s | 4.8 s | 0 |
| 7 s | 12 | 4 s | 10.4 s | 0 |
