# TASK-019 report — Publishing metadata and music assist

## What changed

### Shared
- `packages/shared/src/schemas/metadata.ts` — `MusicAssistOutputSchema`, `VideoMetadataDraftSchema`, `VideoMetadataSchema`, response/edit/generate schemas, `DEFAULT_AI_DISCLOSURE`
- `packages/shared/src/metadata/chapters.ts` — `buildChapters`, `formatChapterTime`, `chaptersText`
- `packages/shared/src/metadata/tags.ts` — `cleanupTagsAndHashtags`
- `packages/shared/src/metadata/draft.ts` — `normalizeMetadataDraft`, `codeMetadataDraft`, `appendDescriptionExtras`
- `packages/shared/src/music/rank.ts` — soft `avoid` penalty on ranking
- `packages/shared/src/schemas/music.ts` — optional `assist` on selection / project music
- `packages/shared/src/budget/modes.ts` — count `musicAssist` under `MUSIC_SEARCH` and `metadata` under `TIMELINE`; `later` is now only `["visionCheck"]`
- `packages/shared/src/schemas/llm.ts` — `metadata` task stage `FINAL` → `TIMELINE` (matches estimate bucket)
- `packages/shared/src/index.ts` — exports
- Tests: `packages/shared/test/metadata.test.ts`, updates to `budget.test.ts`, `musicRank.test.ts`

### Server
- `apps/server/src/db/schema.ts` — `music_selections.assist`, new `video_metadata` table
- Migration: `apps/server/drizzle/0015_overjoyed_steve_rogers.sql` (+ snapshot)
- `apps/server/src/stages/music/musicAssistPrompt.ts`, `musicSearchExecutor.ts` — LLM assist (soft-fail), multi-query search
- `apps/server/src/services/musicService.ts` — assist storage, multi-query merge/dedupe, ranking with `avoid`
- `apps/server/src/services/metadataService.ts` — generate / get / saveEdits / composeDescription (reuses `RenderService.creditsText`)
- `apps/server/src/stages/timeline/metadataPrompt.ts`, `timelineExecutor.ts` — auto-generate after TIMELINE (warn-only)
- `apps/server/src/api/metadata.ts` — GET/PUT/POST routes
- `apps/server/src/app.ts` — wiring
- `apps/server/src/providers/llm/mock.ts` — `MusicAssist` + `VideoMetadataDraft` answers
- Tests: `apps/server/test/metadataMusicAssist.test.ts`; budget/music/projects tests updated for new estimate counts

### MCP
- `apps/mcp/src/apiClient.ts` — `getVideoMetadata`
- `apps/mcp/src/tools.ts` — `get_video_metadata`
- `apps/mcp/test/tools.test.ts` — tool list updated

### Web
- `apps/web/src/services/metadataApi.ts`
- `apps/web/src/features/render/MetadataPanel.tsx` (+ test) — “Thông tin đăng tải” under the player
- `apps/web/src/features/render/RenderPanel.tsx` — mounts metadata panel
- `apps/web/src/features/music/MusicPanel.tsx` — “AI gợi ý: …” line
- `apps/web/src/features/projects/BriefFields.tsx` — metadata CUSTOM toggle; labels/estimates
- CSS for metadata panel; related estimate assertion updates in web tests

## Test counts

| Workspace | Before (TASK-017) | After |
|---|---|---|
| shared | 156 | **166** |
| mcp | 11 | **11** |
| server | 295 | **303** |
| web | 70 | **71** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”.

## Deviations from the spec

- **Estimate stage for metadata:** counted under `TIMELINE` (not a separate `FINAL` bucket). `LLM_TASKS.metadata.stage` was changed from `FINAL` to `TIMELINE` to match.
- **GET `/metadata` extras:** response includes `extras: { chaptersText, creditsText, disclosure }` so the web panel can show read-only appendices without duplicating credits logic.
- **Cache hit usage:** music assist cache hits record `llmCalls: 0` / `musicAssist: 0` with `calls[].cached: true` (same pattern as other cached routed calls).
- **Budget estimate tests** in shared/server/web were updated on purpose for the +1/+1 call counts (ECO unchanged; BALANCED 8–13; QUALITY 9–26).

## Not done

- Live browser check on a throwaway project (dev servers not started in this run). Panel + main actions are covered by unit tests.
- No commit/push (per rules).
- Uncommitted Ollama work left alone; only `llm.ts` `metadata.stage` was changed as required by this task.
