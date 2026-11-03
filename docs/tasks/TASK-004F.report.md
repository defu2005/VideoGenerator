# TASK-004F implementation report

## Result

Implemented task-specific LLM provider/model routing with project and app settings, environment routes, fallback, per-call usage, expanded budget presets/estimates, AI settings UI, project overrides, scene visual descriptions, and the MCP `get_llm_routes` tool.

## Files changed

- `apps/mcp/src/apiClient.ts`, `apps/mcp/src/tools.ts`, `apps/mcp/test/tools.test.ts`
- `apps/server/drizzle/0007_opposite_frightful_four.sql`, `apps/server/drizzle/meta/0007_snapshot.json`, `apps/server/drizzle/meta/_journal.json`
- `apps/server/src/api/budget.ts`, `apps/server/src/api/llm.ts`, `apps/server/src/app.ts`
- `apps/server/src/db/schema.ts`, `apps/server/src/lib/config.ts`, `apps/server/src/pipeline/orchestrator.ts`
- `apps/server/src/providers/llm/mock.ts`, `registry.ts`, `settings.ts`, `structured.ts`, `types.ts`
- `apps/server/src/services/projectService.ts`, `sceneService.ts`, `visualService.ts`
- `apps/server/src/stages/research/prompt.ts`, `researchExecutor.ts`
- `apps/server/src/stages/scenes/scenePlanExecutor.ts`, `sceneQueryPrompt.ts`
- `apps/server/src/stages/script/mergedStoryPrompt.ts`, `reviewPrompt.ts`, `scriptExecutor.ts`
- `apps/server/test/budget.test.ts`, `llmProviders.test.ts`, `llmRouting.test.ts`, `projects.test.ts`, `researchScript.test.ts`, `scenePlan.test.ts`, `structured.test.ts`
- `apps/web/src/App.tsx`, `apps/web/src/components/layout/AppLayout.tsx`
- `apps/web/src/features/pipeline/PipelinePanel.tsx`, `PipelinePanel.test.tsx`
- `apps/web/src/features/projects/BriefFields.tsx`, `EditProjectDialog.tsx`, `ProjectDetailPage.test.tsx`, `ProjectFormFields.tsx`, `ProjectFormFields.test.tsx`, `ProjectListPage.test.tsx`
- `apps/web/src/features/scenes/SceneBoard.test.tsx`, `SceneEditor.tsx`
- `apps/web/src/features/settings/AiSettingsPage.tsx`, `AiSettingsPage.test.tsx`
- `apps/web/src/services/llmApi.ts`
- `docs/ARCHITECTURE.md`
- `packages/shared/src/brief/recommend.ts`, `budget/modes.ts`, `scenes/planScenes.ts`
- `packages/shared/src/schemas/job.ts`, `llm.ts`, `project.ts`, `scene.ts`, `script.ts`
- `packages/shared/test/budget.test.ts`, `llm.test.ts`

## Migration

Generated `apps/server/drizzle/0007_opposite_frightful_four.sql` using `npx drizzle-kit generate` from `apps/server`. Re-running the generator reported: “No schema changes, nothing to migrate.”

## Mock call counts

The estimator’s per-stage call ranges for a fresh Generate All run are:

| Budget | Research | Script (generation + review) | Scene plan | Visual search | Total |
|---|---:|---:|---:|---:|---:|
| ECO | 1 | 0 | 0 | 0 | 1 |
| BALANCED | 1–2 | 2–4 (1 + 1 review) | 1 | 1–2 | 5–9 |
| QUALITY | 1–3 | 3–9 (1 + 2 reviews) | 1 | 1–2 | 6–15 |

Mock provider tests verified research/script execution counts of ECO 1, BALANCED 3, and QUALITY 4 (research plus script generation/review). Scene-query is one batched call for all planned scenes. Visual-search assistance depends on result quality, and repair attempts account for the wider upper bounds. The QUALITY upper estimate is 15, one above the task’s approximate “~14”; the displayed bound is conservative so it does not understate the configured repair/review maximum.

## Fallback demonstration

Offline tests configure Copilot CLI as the primary route while disabled and mock as fallback. The mock succeeds once; usage contains the failed primary route and the successful fallback route (`fallback: true`). A mocked provider 5xx triggers fallback; a mocked 400 does not. No real Copilot or Claude prompt was run.

## Validation

- `npm run typecheck` — passed.
- `npm run build` — passed. Vite emitted existing dependency-comment and bundle-size warnings.
- `npm test` — passed: shared 116, MCP 9, server 147, web 40 tests.
- `npx drizzle-kit generate` from `apps/server` — no schema drift.
- `npm audit --omit=dev --audit-level=low` — 0 vulnerabilities.
- Full `npm audit --audit-level=low` — reports 4 moderate dev-dependency findings through `drizzle-kit@0.31.11` → `@esbuild-kit` → `esbuild@0.18.20`. `npm audit fix --force` proposes a breaking Drizzle Kit downgrade, so dependencies were left unchanged per task constraints.

All new provider/model-list tests use mocks; no external APIs or real provider CLIs were called. The existing suite also includes local Fastify/loopback tests.

## Deviations and remaining issues

- Full audit is not clean due to the pre-existing vulnerable transitive development dependency noted above; production dependencies audit clean.
- The task’s approximate QUALITY maximum is 14; the estimator reports a conservative maximum of 15 after accounting for configured repairs on generation and review calls.
- No dependencies were added and no commit was created.

## Fix round 1 (completed by the architect after the Copilot session hit its monthly quota)

| Item | Status | Where |
|---|---|---|
| F1 fallback on any provider-side failure | done by the interrupted Copilot session (`shouldFallback` = every `LlmError` except `LLM_INVALID_OUTPUT`; Copilot invalid model → `LLM_NOT_CONFIGURED`); verified | `structured.ts`, `copilotCli.ts`, `llmRouting.test.ts` |
| F2 mock answers every task schema | done by Copilot (rerank, alt queries, scene queries, review; topic-dependent output); verified live: all calls `ok` | `mock.ts` |
| F3 context-aware hints | done by Copilot ("Bỏ qua bước AI, giữ kết quả bằng code" for 0-repair tasks; no "Switch to BALANCED") | `structured.ts` |
| F4 cache hits recorded | done by Copilot (`cached: true` call entries; monthly counter skips them) | `structured.ts`, `api/llm.ts` |
| F5 provider list + suggestions | completed now: all providers listed with `configured` + hint (fixed a crash on `provider.limits` for unregistered providers and a syntax error left by the interrupted session); suggestions now start with models that previously succeeded for the provider (from `usage.calls`); Copilot static list trimmed to `gpt-6-luna` | `registry.ts`, `api/llm.ts`, `llmProviders.test.ts` |
| F6 AI settings page | completed now: Vietnamese labels, nav "Mô hình AI", one card per task (4 columns ≥ 1024 px, 2 columns ≤ 1024 px, stacked ≤ 560 px), stage + tier chips, existing form styles; project dialog section translated and styled | `AiSettingsPage.tsx`, `ProjectFormFields.tsx`, `AppLayout.tsx`, `index.css`, tests |
| F7 live evidence | below | — |

### Checks
typecheck ✓ · build ✓ · tests 324/324 (shared 116, MCP 9, server 158, web 41) · drizzle-kit: no schema changes · prod audit 0.

### Live (mock, Generate All to VISUAL_REVIEW)
| Mode | Estimate | Calls (task: provider/model, all ok) |
|---|---|---|
| BALANCED | 5–9 | research 1, script 1, scriptReview 1, sceneQueries 1, visualRerank 1 = **5** |
| QUALITY | 6–15 | research 1, script 1, scriptReview 2, sceneQueries 1, visualRerank 1 = **6** |
| Fallback demo | — | scriptReview primary `custom/x` (not configured) → `ok:false`, fallback `mock/fb-1` → `ok:true, fallback:true`; stage DONE |

Settings page: no horizontal scroll at 375 px (scrollWidth 375) and 1280 px; 9 task cards; unconfigured providers shown disabled with "chưa cấu hình".
