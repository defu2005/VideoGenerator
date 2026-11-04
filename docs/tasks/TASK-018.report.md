# TASK-018 report — Pre-render review chat

## What changed

### Shared
- `packages/shared/src/schemas/review.ts` — proposal union, assistant output, thread/message/send/estimate/apply schemas; quick-action constants
- `packages/shared/src/schemas/llm.ts` — `reviewChat` task (`FINAL_APPROVAL`, strong, no `budgetFeature`); defaults to script route when unset
- `packages/shared/src/budget/modes.ts` — export `estimateTextTokens` for pre-send estimates
- `packages/shared/src/index.ts` — export review schemas
- Tests: `packages/shared/test/review.test.ts`; `llm.test.ts` updated (length 11, reviewChat default)

### Server
- `apps/server/src/db/schema.ts` — `review_threads`, `review_messages`, `review_proposal_applications`
- Migration: `apps/server/drizzle/0016_breezy_mathemanic.sql` (+ snapshot)
- `apps/server/src/services/sceneService.ts` — optional `staleFrom` on `patch` / `reorder` (default still `SCENE_PLAN`)
- `apps/server/src/services/visualService.ts` — `setSelectionMotion` → `markStaleFrom(..., "MUSIC_REVIEW")`
- `apps/server/src/api/visuals.ts` — `PATCH .../visuals/motion`
- `apps/server/src/review/contextBuilder.ts` — deterministic context + `contextHash`
- `apps/server/src/review/prompt.ts` — system rules, last-12 history, earlier decisions
- `apps/server/src/review/validate.ts` — drop invalid proposals with Vietnamese notes
- `apps/server/src/review/service.ts` — get / send / apply / applyRaw / reset
- `apps/server/src/api/review.ts` — GET/POST/DELETE review routes + estimate + context + raw apply
- `apps/server/src/app.ts` — wiring
- `apps/server/src/providers/llm/mock.ts` — `ReviewAssistant` answers with valid proposals
- Tests: `apps/server/test/review.test.ts`

### MCP
- `apps/mcp/src/apiClient.ts` — `getReviewContext`, `applyReviewProposal`
- `apps/mcp/src/tools.ts` — `get_review_context`, `apply_review_proposal`
- `apps/mcp/test/tools.test.ts` — tool list updated

### Web
- `apps/web/src/services/reviewApi.ts`
- `apps/web/src/features/review/ReviewChatPanel.tsx` (+ test) — collapsed “Góp ý với AI” in Timeline tab
- `apps/web/src/features/timeline/TimelinePanel.tsx` — mounts panel
- CSS for review chat in `apps/web/src/index.css`

## Test counts

| Workspace | After TASK-019 | After TASK-018 |
|---|---|---|
| shared | 166 | **169** |
| mcp | 11 | **11** |
| server | 303 | **310** |
| web | 71 | **72** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”.

## Deviations from the spec

- **Vision `attachImages`:** accepted in the request schema but ignored; no UI toggle. `TODO(TASK-004G)` left in code (per guide).
- **SSE streaming:** skipped; UI shows “Đang trả lời…” while waiting (per guide).
- **Prompt caching:** uses the existing prompt-hash LLM cache only; no provider-specific cache headers (per guide).
- **Usage accounting:** each `send` inserts a `SUCCEEDED` job with `stage: "FINAL_APPROVAL"`, `scope: "reviewChat"`, and usage JSON so UsageService picks it up. There was no prior non-job user-triggered usage pattern.
- **Stale scope:** VISUAL_SEARCH keeps approved selections when only narration/duration change (search hash ignores those fields). Still added `options.staleFrom` so review apply can narrow invalidation: narration → `VISUAL_REVIEW`; duration/reorder → `MUSIC_REVIEW`. Existing scene routes keep default `SCENE_PLAN`.
- **`EDIT_VISUAL_QUERY`:** `searchScene` does not mark TIMELINE stale; apply calls `markStaleFrom(..., "VISUAL_SEARCH")` explicitly.

## Not done

- Live browser check on a throwaway project (dev servers not started in this run). Panel + send/apply/banner are covered by unit tests.
- Vision image attach (TASK-004G).
- No commit/push (per rules).
