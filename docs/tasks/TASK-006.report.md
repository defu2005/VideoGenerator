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
