# TASK-004C Implementation Report

## Result

Implemented deterministic video-brief recommendations across shared types, REST, web, and MCP. Topic-only project creation now resolves a title and all brief defaults with per-field reasons. The resolver is pure TypeScript and makes no LLM calls.

Create and update requests accept brief values in `settings` and at the request top level. Updates preserve user-set fields, re-recommend unset values when relevant inputs change, and support `resetToRecommended`. `POST /api/recommendations` previews values, reasons, and duration warnings without writing to the database.

The merged-story and script prompts include one compact brief line. Existing merged generation remains one LLM call; prompt changes naturally affect the existing cache key. The web create flow is topic-first with a debounced summary and customization fields; edit and overview surfaces show recommendations and warnings. MCP includes `create_project` and `recommend_brief`.

## Files changed

- Shared: `packages/shared/src/brief/presets.ts`, `detectLanguage.ts`, `recommend.ts`; `packages/shared/src/schemas/project.ts`; `packages/shared/src/index.ts`; `packages/shared/test/recommend.test.ts`; `packages/shared/package.json`.
- Server: `apps/server/src/api/recommendations.ts`, `apps/server/src/api/projects.ts`, `apps/server/src/app.ts`, `apps/server/src/services/projectService.ts`, `apps/server/src/stages/script/mergedStoryPrompt.ts`, `apps/server/src/stages/script/prompt.ts`.
- Web: `apps/web/src/features/projects/BriefFields.tsx`, `CreateProjectDialog.tsx`, `EditProjectDialog.tsx`, `ProjectFormFields.tsx`, `ProjectDetailPage.tsx`, `apps/web/src/index.css`.
- Tests: server project/prompt/cache tests; web create/edit tests and updated project fixtures; MCP tool tests and updated shared project fixtures.

No database migration or new dependency was added. Existing project JSON settings receive schema defaults when read.

## Validation

| Command | Result |
|---|---|
| `npm run typecheck` | PASS — shared, MCP, server, and web |
| `npm run build` | PASS — all workspaces |
| `npm test` | PASS — 24 test files, 153 tests (shared 21, MCP 6, server 100, web 26) |
| `git diff --check` | PASS |

The web build reports non-fatal Rollup annotation warnings in the installed Zod package; the build completed successfully.

## Deviations and remaining issues

- The REST API accepts both nested `settings` values and top-level brief parameters to cover the documented request examples while persisting one normalized settings shape.
- No deviations from the zero-LLM recommendation requirement. No Copilot prompts were run and no commit was created.
- Remaining issues: none known.

## Architect verification
- 155 tests pass (shared 23 incl. architect additions, MCP 6, server 100, web 26); `npm audit --omit=dev` = 0; recommendations contain no LLM calls.
- Live API (UTF-8 bodies): topic-only → title derived, vi, documentary ("lịch sử"), youtube 16:9 180 s; "5 sự thật về mèo"+tiktok → listicle, 9:16, 45 s, scene 3; kids topic → audience kids, wpm 145, illustration; user-set duration kept on platform change; `resetToRecommended` restores 45 s.
- Architect fix: added Vietnamese "vì sao" / "tại sao" to explainer keywords (spec gap) + 2 tests.
- UI: quick create shows live summary "YouTube · 16:9 · 3 phút · Tiếng Việt · Explainer — gợi ý tự động".
