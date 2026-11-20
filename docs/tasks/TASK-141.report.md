# TASK-141 report (Director continuity pass: one look and pace for the whole video)

For Claude (Opus), the architect. Nothing committed or pushed.

## What changed

- **Shared types and schemas**:
  - `packages/shared/src/schemas/continuity.ts`: Defined `ContinuityPlanSchema` (characters, palette, pacing targets per section, motifs, avoid list), `ContinuityEnvelopeSchema` (versioned envelope on scene 0, `sourceHash`, `weight`, `note`), `ContinuityFindingSchema`, and `ContinuityReportSchema`.
  - Implemented mathematical CIE Lab D65 conversion (`rgbToLab`, `labDistance`), additive query expansion (`continuityQueries`), continuity scoring (`continuityScore`), and code-based findings detection (`continuityFindings`).
- **Server continuity pass & persistence**:
  - `apps/server/src/continuity/store.ts`: SQLite read, write, and reconciliation for scene 0 envelope without requiring database migrations. Implemented fingerprinting for visual search `inputVersion` cache invalidation and wrapped JSON parsing with defensive guards.
  - `apps/server/src/continuity/builder.ts`: LLM director pass builder under task `continuityPlan`. Respects budget modes (`continuityPlan` in QUALITY/MAX or CUSTOM), validates schema, retries once on invalid JSON, and falls back gracefully to an empty plan with an explanatory note without blocking the pipeline.
  - `apps/server/src/continuity/color.ts`: Local image average Lab color extraction using `sharp` (already in dependencies).
  - `apps/server/src/continuity/check.ts`: Code-first continuity checks (color jumps > 35 Lab distance between adjacent scenes, pacing deviations > 40% from section target, missing motif tags) plus optional batched vision character consistency check when a vision model is configured (explicitly marked skipped with reason when absent). Truthful `estimatedPacing` computation based on voice track duration availability.
  - `apps/server/src/continuity/toolDefs.ts`: Read-only tools `get_continuity_plan` and `check_continuity`. Registered in `routePermissions.ts`, `auth/toolActions.ts`, and assistant tool registry.
- **Pipeline and service integration**:
  - `apps/server/src/stages/scenes/scenePlanExecutor.ts`: Automatic continuity plan construction immediately following scene plan generation.
  - `apps/server/src/services/visualService.ts`:
    - Additive search queries for characters and motifs while keeping original queries primary.
    - Continuity-weighted candidate scoring (`continuityRank` / `continuityScore`) that never overrides 077 relevance gates or licensing checks.
    - Guaranteed preservation of user manual visual picks.
    - Maintained continuity envelope on scene 0 during visual description repairs.
  - `apps/server/src/services/sceneService.ts`: Automatic reconciliation of character and motif scene IDs across scene deletions, insertions, merges, splits, and reordering, with `patchContinuity` API.
  - `apps/server/src/api/visuals.ts`: Added `GET /api/projects/:id/visuals/continuity` endpoint for fetching continuity reports.
- **Web UI**:
  - `apps/web/src/features/scenes/ContinuityCard.tsx`: Interactive "Định hướng hình ảnh" card on the Scenes tab for inspecting and modifying palette, characters, pacing, and motifs.
  - `apps/web/src/features/visuals/ContinuityFindings.tsx`: Card on the Visual Review tab highlighting color jumps, pacing issues, missing motifs, and character checks, with "Tìm lại cảnh này" action buttons.
  - Integrated into `SceneBoard.tsx` and `VisualReview.tsx`.
- **Documentation, Features, and Skills**:
  - `packages/shared/src/features/featureMap.ts`: Added `continuity-pass` feature mapping to `/projects/:id/scenes` and `/projects/:id/visuals`.
  - `docs/user-guide/hinh-anh-va-giong-doc.md`: Added section `## Định hướng hình ảnh và nhịp {#dinh-huong-hinh-anh}`.
  - `docs/user-guide/nhat-ky-thay-doi.md`: Added changelog entry for TASK-141.
  - `docs/ARCHITECTURE.md`: Documented the director continuity pass lifecycle, storage envelope, scoring, and check architecture.
  - `.agents/skills/video-stage-phan-canh/SKILL.md` and `.agents/skills/video-hinh-anh-va-giong/SKILL.md`: Added `get_continuity_plan` and `check_continuity` tool definitions and operating instructions.

## Test results

- `npm run typecheck`: Green (0 errors) across all 4 monorepo workspaces (`@vg/shared`, `@vg/mcp`, `@vg/server`, `@vg/web`).
- `npm run build`: Green across all 4 monorepo workspaces.
- `@vg/shared`:
  - `test/continuity.test.ts`: 6/6 passed.
  - `test/userGuide.test.ts`: 4/4 passed.
- `@vg/server` (run with `--maxWorkers=2`):
  - `test/continuity.test.ts`: 13/13 passed (plan builder, empty fallback, invalidation fingerprint, additive search queries, relevance-respecting ranking, color jumps, pacing tolerance, motif checks, vision character check and skip reasons, tool defs).
  - `test/scenePlan.test.ts`: 5/5 passed.
  - `test/visual*.test.ts`: 46/46 passed (`visualSearch.test.ts`, `visualsApi.test.ts`, `visualSharedCache.test.ts`, `visualReuse.test.ts`, `visualRelevance.test.ts`).
- `@vg/web`:
  - `src/features/scenes/ContinuityCard.test.tsx`: 3/3 passed.
  - `src/features/visuals/ContinuityFindings.test.tsx`: 4/4 passed.
  - `src/features/scenes/SceneBoard.test.tsx`: 4/4 passed.
  - `src/features/visuals/VisualReview.test.tsx`: 6/6 passed.
  - `src/features/help/guideCoverage.test.ts`: 5/5 passed.

## Open source attribution

- **OpenReels** (RESEARCH-076): Inspired the concept of a director pass preceding visual asset retrieval.
- **colorthief / node-vibrant**: Algorithmic inspiration for CIE Lab color conversion and Delta-E distance calculation. Implemented in native TypeScript using existing `sharp` dependency with no added third-party packages.
