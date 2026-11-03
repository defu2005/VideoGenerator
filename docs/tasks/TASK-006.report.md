# TASK-006 Report

## Implementation

Implemented visual search with Wikimedia Commons, Openverse, Pexels, and a deterministic offline mock provider. Added normalized license metadata, deterministic ranking and deduplication, distinct scene assignment, incremental search state, SQLite response caching, and retry/rate-limit handling. Wired the `VISUAL_SEARCH` executor, visual API, minimal Scene Board previews, budget estimates, and read-only MCP tool.

No dependencies were added, no commits were made, no full-size images were downloaded, and no real Copilot prompts were run. The live-provider check used the mock LLM.

## Files changed

- Shared contracts and helpers: `packages/shared/src/schemas/visual.ts`; `packages/shared/src/visuals/{license,rank,dedupe,assign}.ts`; `packages/shared/src/{enums.ts,index.ts,budget/modes.ts}`.
- Shared tests: `packages/shared/test/{license,rank,dedupe,assign,budget}.test.ts`.
- Server provider, persistence, execution, and API: `apps/server/src/providers/images/{types,http,registry,rateLimiter,wikimedia,openverse,pexels,mock}.ts`; `apps/server/src/services/visualService.ts`; `apps/server/src/stages/visuals/{visualSearchExecutor,altQueryPrompt,rerankPrompt}.ts`; `apps/server/src/api/visuals.ts`; `apps/server/src/{app.ts,db/schema.ts,lib/config.ts}`.
- Generated migration: `apps/server/drizzle/0006_visuals.sql`, `apps/server/drizzle/meta/0006_snapshot.json`, `apps/server/drizzle/meta/_journal.json`.
- Server tests and fixtures: `apps/server/test/{imageProviders,visualSearch,visualsApi,budget,projects}.test.ts`; `apps/server/test/fixtures/{wikimedia-search,openverse-search,pexels-search}.json`.
- Web: `apps/web/src/services/visualsApi.ts`; `apps/web/src/hooks/{useVisuals,usePipeline}.ts`; `apps/web/src/features/scenes/{SceneBoard,SceneCard}.tsx`; `apps/web/src/features/scenes/SceneBoard.test.tsx`; `apps/web/src/features/pipeline/{PipelinePanel.tsx,PipelinePanel.test.tsx}`; `apps/web/src/features/projects/BriefFields.tsx`; `apps/web/src/features/projects/{ProjectDetailPage,ProjectListPage}.test.tsx`; `apps/web/src/index.css`.
- MCP: `apps/mcp/src/{apiClient,tools}.ts`; `apps/mcp/test/tools.test.ts`.
- Configuration and related budget expectations: `.env.example`; `apps/server/test/{budget,projects}.test.ts`; `packages/shared/test/budget.test.ts`.

## Migration

Generated (not hand-written) from `apps/server` with:

```text
npx drizzle-kit generate --name visuals
```

The required repeat generation completed with: `No schema changes, nothing to migrate`.

## Acceptance results

### AC2 — live provider run

Ran an isolated live-provider stage execution using real Wikimedia Commons and Openverse, no Pexels key, and the mock LLM. Data was stored in a temporary database and removed after the run. The sample comprised two projects with two scenes each:

| Project | Scenes / duration | Selected | Candidates per scene (min / avg / max) | License kinds across candidates | Provider requests | Cache hits | LLM calls |
|---|---:|---:|---:|---|---:|---:|---:|
| Vietnamese TikTok | 2 / 3 s | 2 (100%) | 8 / 9 / 10 | CC_BY_SA 8, PUBLIC_DOMAIN 6, CC_BY 3, CC0 1 | 12 | 0 | 0 |
| English YouTube | 2 / 7 s | 2 (100%) | 10 / 10 / 10 | CC_BY_SA 16, CC_BY 3, PUBLIC_DOMAIN 1 | 4 | 0 | 0 |
| **Combined** | **4** | **4 (100%)** | **38 candidates total** | **CC_BY_SA 24, PUBLIC_DOMAIN 7, CC_BY 6, CC0 1** | **16** | **0** | **0** |

Every stored candidate had a license kind and evidence. The distinct-assignment check passed: selected dedupe keys were unique or any repeated key was marked `reusedAcrossScenes`. The stage completed for both projects.

The live run used the configured Openverse 20-requests/minute limiter. Its logger was set to `silent`, so this run does not provide log evidence to independently confirm the absence of 429 responses.

### AC3 — incremental reruns

| Project | Unchanged rerun: provider requests / cache hits / LLM calls | Selections unchanged | After changing one scene query: provider requests / cache hits / LLM calls |
|---|---:|---|---:|
| Vietnamese TikTok | 0 / 0 / 0 | Yes | 5 / 1 / 0 |
| English YouTube | 0 / 0 / 0 | Yes | 6 / 0 / 0 |

Unchanged scene hashes short-circuited provider lookup entirely, so the incremental reruns had zero cache reads as well as zero network requests. Changing one scene query caused only that scene to be re-searched; the other scene remained unchanged. Provider-cache reuse on repeated manual searches is covered by the offline API tests.

## Commands

| Command | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test` | Passed: shared 107, MCP 8, server 134, web 37 tests (286 total) |
| `npm run build` | Passed; existing Rollup dependency-annotation and large-chunk warnings were emitted |
| `npm audit --omit=dev` | Passed: 0 vulnerabilities |
| `npx drizzle-kit generate --name visuals` from `apps/server` | Passed; repeat reported no changes |
| `git diff --check` | Passed |

## Deviations and remaining limitations

- The live sample used two scenes per project rather than a larger production-length video. The live result is a smoke/acceptance sample, not a broad relevance-quality evaluation.
- The live stage was run with an isolated temporary database and in-process service execution; API behavior is separately covered with offline Fastify injection tests. It was not a publicly bound development server.
- Unchanged reruns bypass provider-cache lookup through the per-scene search-hash state, so their cache-hit count is zero (while provider requests and LLM calls are also zero).
- The silent live-run logger did not retain evidence for a 429-log check. Provider rate limiting and retry behavior have offline tests.
- No live browser session was used; Scene Board behavior is covered by the web test suite.

## Fix round 1

### Files changed

- Shared ranking and assignment: `packages/shared/src/visuals/rank.ts`, `packages/shared/src/visuals/assign.ts`, `packages/shared/src/visuals/dedupe.ts`, `packages/shared/src/schemas/visual.ts`.
- Shared tests: `packages/shared/test/rank.test.ts`, `packages/shared/test/assign.test.ts`.
- Server search, providers, and configuration: `.env.example`, `apps/server/src/lib/config.ts`, `apps/server/src/services/visualService.ts`, `apps/server/src/providers/images/{types,wikimedia,openverse,pexels,mock}.ts`.
- Server tests and fixture: `apps/server/test/visualSearch.test.ts`, `apps/server/test/visualsApi.test.ts`, `apps/server/test/imageProviders.test.ts`, `apps/server/test/fixtures/wikimedia-irrelevant-search.json`.
- Scene Board: `apps/web/src/features/scenes/SceneCard.tsx`, `apps/web/src/features/scenes/SceneBoard.test.tsx`, `apps/web/src/index.css`.
- This report and empty marker: `docs/tasks/TASK-006.report.md`, `docs/tasks/TASK-006.fix-done`.

No schema column or migration was needed. No dependencies were added.

### F6 live regression

Loaded `packages/shared/test/fixtures/copilot-merged-story-vi.json` via `PUT /api/projects/:id/script`, then ran `SCENE_PLAN` and `VISUAL_SEARCH` through the API. Setup used real Wikimedia Commons and Openverse, mock LLM, BALANCED budget, Vietnamese TikTok, and 3-second scenes. The stage produced 28 selections from 355 candidates; all 28 had keyword matches (100%), so no selected image was low relevance. The 2 duplicate-image groups had all repeated selections flagged `reusedAcrossScenes` (7 repeats; 0 unflagged duplicate groups).

| Metric | Result |
|---|---:|
| Visual-search stage time | 88.7 s (≤ 180 s) |
| Provider network requests | Wikimedia 17; Openverse 11 |
| Cache hits | 123 |
| Visual-search LLM calls | 0 |
| Selected scenes | 28 / 28 |
| Keyword-positive selections | 28 / 28 (100%) |
| Keyword-zero selections | 0 |
| Duplicate-image groups / unflagged groups | 2 / 0 |
| Unchanged rerun | 0 Wikimedia / 0 Openverse requests; 0 LLM calls; selections unchanged |
| HTTP 429 log entries | 0 |

Per-scene results (keyword scores rounded to three decimals):

| Order | Primary | Base query used | Selected title | Provider | Keyword | lowRelevance |
|---:|---|---|---|---|---:|---|
| 0 | Lee Sedol AlphaGo match Seoul 2016 | Go board stones | Go (13×13) -- 2021 -- 6741.jpg | wikimedia | 0.222 | false |
| 1 | Four Seasons Hotel Seoul 2016 exterior | Go board stones | Go (13×13) -- 2021 -- 6737.jpg | wikimedia | 0.222 | false |
| 2 | Go board stones close up | Go board stones | Go -- 2021 -- 6732.jpg | wikimedia | 0.400 | false |
| 3 | Lee Sedol AlphaGo match Seoul 2016 close-up | Go board stones | Go -- 2021 -- 6748.jpg | wikimedia | 0.182 | false |
| 4 | Lee Sedol AlphaGo match Seoul 2016 wide shot | Go board stones | Go (13×13) -- 2021 -- 6733.jpg | wikimedia | 0.182 | false |
| 5 | Lee Sedol AlphaGo match Seoul 2016 archival photo | Go board stones | Go | openverse | 0.091 | false |
| 6 | Lee Sedol AlphaGo match Seoul 2016 detail | Go board stones | Go -- 2021 -- 6746.jpg | wikimedia | 0.200 | false |
| 7 | Lee Sedol AlphaGo match Seoul 2016 portrait | Go board stones | Go -- 2021 -- 6757.jpg | wikimedia | 0.200 | false |
| 8 | AlphaGo Lee Sedol game 2 move 37 Go board | AlphaGo Lee Sedol | Lee Sedol (B) vs AlphaGo (W) - Game 4.jpg | wikimedia | 0.500 | false |
| 9 | AlphaGo match 2016 game analysis | AlphaGo Lee Sedol | Lee Sedol (B) vs AlphaGo (W) - Game 5.svg | wikimedia | 0.571 | false |
| 10 | AlphaGo Lee Sedol game 2 move 37 Go board close-up | AlphaGo Lee Sedol | Lee Sedol (W) vs AlphaGo (B) - Game 2.svg | wikimedia | 0.400 | false |
| 11 | AlphaGo Lee Sedol game 2 move 37 Go board wide shot | AlphaGo Lee Sedol | Lee Sedol (B) vs AlphaGo (W) - Game 1.svg | wikimedia | 0.400 | false |
| 12 | AlphaGo Lee Sedol game 2 move 37 Go board archival photo | AlphaGo Lee Sedol | Lee Sedol (B) vs AlphaGo (W) - Game 5 - BW.svg | wikimedia | 0.400 | false |
| 13 | Lee Sedol game 4 AlphaGo move 78 | Lee Sedol AlphaGo | Lee Sedol (B) vs AlphaGo (W) - Game 3 - BW.svg | wikimedia | 0.667 | false |
| 14 | Lee Sedol Go match 2016 | Lee Sedol Go match 2016 | Lee Se-Dol.jpg | wikimedia | 0.200 | false |
| 15 | Lee Sedol game 4 AlphaGo move 78 close-up | Lee Sedol Go match 2016 | FHvAG5.jpg | wikimedia | 0.182 | false |
| 16 | Lee Sedol game 4 AlphaGo move 78 wide shot | Lee Sedol AlphaGo | Lee Sedol (W) vs AlphaGo (B) - Game 4.svg | wikimedia | 0.500 | false |
| 17 | Lee Sedol game 4 AlphaGo move 78 archival photo | Lee Sedol AlphaGo | Lee Sedol (B) vs AlphaGo (W) - Game 1 - BW.svg | wikimedia | 0.500 | false |
| 18 | AlphaGo Lee Sedol final game 2016 | AlphaGo Lee Sedol | Lee Sedol (B) vs AlphaGo (W) - Game 3.svg | wikimedia | 0.667 | false |
| 19 | DeepMind AlphaGo 2016 press conference | DeepMind AlphaGo | AlphaGo computer rack.jpg | wikimedia | 0.200 | false |
| 20 | AlphaGo Lee Sedol final game 2016 close-up | AlphaGo Lee Sedol | Lee Sedol (B) vs AlphaGo (W) - Game 4 - BW.svg | wikimedia | 0.500 | false |
| 21 | AlphaGo Lee Sedol final game 2016 wide shot | AlphaGo Lee Sedol | Lee Sedol (B) vs AlphaGo (W) - Game 4.jpg | wikimedia | 0.500 | false |
| 22 | AlphaGo Lee Sedol final game 2016 archival photo | AlphaGo Lee Sedol | Lee Sedol (B) vs AlphaGo (W) - Game 5.svg | wikimedia | 0.500 | false |
| 23 | AlphaGo Lee Sedol final game 2016 detail | AlphaGo Lee Sedol | Lee Sedol (B) vs AlphaGo (W) - Game 4.jpg | wikimedia | 0.571 | false |
| 24 | AlphaGo Lee Sedol final game 2016 portrait | AlphaGo Lee Sedol | Lee Sedol (B) vs AlphaGo (W) - Game 5.svg | wikimedia | 0.571 | false |
| 25 | AlphaGo Lee Sedol final game 2016 illustration | AlphaGo Lee Sedol | Lee Sedol (B) vs AlphaGo (W) - Game 4.jpg | wikimedia | 0.571 | false |
| 26 | AlphaGo Lee Sedol final game 2016 close-up | AlphaGo Lee Sedol | Lee Sedol (B) vs AlphaGo (W) - Game 5.svg | wikimedia | 0.500 | false |
| 27 | AlphaGo Lee Sedol final game 2016 wide shot | AlphaGo Lee Sedol | Lee Sedol (B) vs AlphaGo (W) - Game 4.jpg | wikimedia | 0.500 | false |

### Validation

| Command | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test` | Passed: shared 109, MCP 8, server 139, web 37 tests (293 total); all tests use offline fixtures/mocks |
| `git diff --check` | Passed |

No real Copilot prompts were run. The live server and its temporary database were isolated from the workspace.
