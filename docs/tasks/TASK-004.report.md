# TASK-004 Implementation Report

## Files created or changed

- Shared contracts: `packages/shared/src/schemas/llm.ts`, `script.ts`, updates to `project.ts` and `index.ts`.
- LLM providers: `apps/server/src/providers/llm/{types,http,anthropic,gemini,openaiCompatible,mock,registry,structured,cache,pricing}.ts`.
- Research and script stages: `apps/server/src/stages/research/{prompt,researchExecutor}.ts`, `apps/server/src/stages/script/{prompt,scriptExecutor,scriptUtils}.ts`.
- Persistence and pipeline: `apps/server/src/db/schema.ts`, `apps/server/src/jobs/jobRepository.ts`, `apps/server/src/pipeline/{executorRegistry,orchestrator}.ts`, `apps/server/src/lib/config.ts`, and `apps/server/src/services/{projectService,scriptService}.ts`.
- API: `apps/server/src/api/{llm,script}.ts` and `apps/server/src/app.ts`.
- Migration: `apps/server/drizzle/0002_llm_script.sql`, `apps/server/drizzle/meta/0002_snapshot.json`, and `apps/server/drizzle/meta/_journal.json`.
- Server tests: `apps/server/test/{llmProviders,structured,researchScript,scriptApi}.test.ts`.
- Web UI and API: `apps/web/src/features/script/{ScriptTab,ScriptEditor,ResearchPanel}.tsx`, their tests, `apps/web/src/services/{scriptApi,llmApi}.ts`, `apps/web/src/hooks/useScript.ts`, `usePipeline.ts`, and project settings/detail UI files.
- Documentation/configuration: `.env.example`, `README.md`, and the LLM row in `docs/ARCHITECTURE.md` §7.

## Migration

Generated with the existing Drizzle Kit dependency: `apps/server/drizzle/0002_llm_script.sql`. It adds `research_notes`, `scripts`, and `llm_cache`.

## Verification

| Command | Result |
|---|---|
| `npm run typecheck` | Passed for shared, server, and web workspaces. |
| `npm run build` | Passed for all workspaces. Vite printed the existing non-fatal Zod/Rollup annotation warnings. |
| `npm test` | Passed: 79 tests total — server 57/57 and web 22/22. |

Coverage includes mocked provider request/response and error mapping, structured validation/repair/cache behavior, provider resolution, real-stage orchestration with the mock provider through `VISUAL_REVIEW`, zero-token USER flow, script API versioning and stale propagation, and Script editor/UI behavior.

## Deviations

- Added `scripts.edited` to retain the required distinction between an unedited AGENT script and a user-edited AGENT-origin script.
- Added `research_notes.cached` so the Script tab can display whether research came from cache.
- No dependencies or vendor SDKs were added.

## Remaining issues

- No real provider credentials were available, so no external provider was exercised. Adapter tests use mocked `fetch`; stage and end-to-end tests use the mock provider.
- Build output retains the non-fatal dependency annotation warnings noted above.
- No commit was created.

## Worktree note

The shared worktree also contains `docs/tasks/TASK-004.review.md`, `docs/tasks/TASK-004B.md`, and architecture edits outside §7. These unrelated changes were left untouched.

## Fix round 1

### Files changed

- LLM and script contracts: `packages/shared/src/schemas/{script,project,llm}.ts`.
- Server configuration, persistence, and pipeline: `apps/server/src/{app.ts,lib/config.ts,db/{schema,migrate}.ts,pipeline/orchestrator.ts,services/{projectService,scriptService}.ts}`.
- LLM providers and stages: `apps/server/src/providers/llm/{types,structured,anthropic,gemini,openaiCompatible,mock,registry}.ts`; `apps/server/src/stages/research/{prompt,researchExecutor}.ts`; `apps/server/src/stages/script/{prompt,mergedStoryPrompt,scriptExecutor,scriptUtils}.ts`.
- Web UI: `apps/web/src/features/projects/{EditProjectDialog,ProjectFormFields}.tsx`; `apps/web/src/features/script/{ScriptTab,ScriptEditor}.tsx`; `apps/web/src/index.css`.
- Tests: `apps/server/test/{config,llmProviders,researchScript,scriptApi,structured}.test.ts`; `apps/web/src/features/script/{ScriptTab,ScriptEditor}.test.tsx`.
- Documentation/configuration: `.env.example`, `README.md`, and the LLM provider row in `docs/ARCHITECTURE.md` §7. The §4 “Quy tắc LLM” section was not changed.

### Migration

Generated `apps/server/drizzle/0003_known_namorita.sql` with the existing Drizzle Kit; it adds `scripts.merged_call` to identify script output from a merged call. Updated the generated `0003` snapshot and journal. Migrations `0000`–`0002` were not edited or regenerated, and no dependency was added or upgraded.

### LLM calls per Generate All

Verified by orchestration tests: `merged` = 1 provider call; `separate` = 2; `off` = 1 script-only call. A cached merged rerun performs 0 additional provider calls through SCRIPT. Explicit script regeneration after the research hash changes uses one script-only call.

### Verification

| Command | Result |
|---|---|
| `npm run typecheck` | Passed for shared, server, and web. |
| `npm run build` | Passed for all workspaces. Vite emitted only the existing non-fatal Zod/Rollup annotation warnings. |
| `npm test` | Passed: 94 tests total — server 71/71 and web 23/23. |

Coverage includes one-call/multi-mode orchestration, cached reruns, legacy script-row normalization, editable visual/music fields, token accounting after failed and truncated calls, provider finish reasons/configuration metadata, and repository-root-relative environment paths.

## Architect verification (post fix round 1)
- 94/94 tests (server 71, web 23); `npm audit --omit=dev` = 0; no new dependencies; committed migrations 0000–0001 untouched.
- Runtime with root `.env` (`LLM_DEFAULT_PROVIDER=mock`): Generate All → RESEARCH+SCRIPT = **1 LLM call**; same input again (duplicate project) = **0 calls** (cache). DB and project dirs now under repo-root `data/`.
