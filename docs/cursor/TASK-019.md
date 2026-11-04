# TASK-019 — Cursor guide

Read `docs/cursor/README.md` first. Spec: `docs/tasks/TASK-019.md` (read it fully).

## File map
- **Budget and LLM tasks:**
  - `packages/shared/src/budget/modes.ts` has the features `musicAssist`, `metadata` and `later: [...]` in `budgetEstimate`;
  - `packages/shared/src/schemas/llm.ts` has `LLM_TASKS`. Change the `metadata` task's `stage: "FINAL"` to match what you choose for the estimate.
- **Music:**
  - query: `packages/shared/src/music/rank.ts` (`musicQueryFor`, ranking);
  - `apps/server/src/services/musicService.ts`;
  - `apps/server/src/stages/music/musicSearchExecutor.ts`;
  - web: `apps/web/src/features/music/`.
- **Timeline / render:**
  - `apps/server/src/services/timelineService.ts`;
  - `apps/server/src/stages/timeline/`;
  - `apps/server/src/services/renderService.ts`, which builds the credits text: reuse it, don't duplicate it;
  - web: `apps/web/src/features/render/RenderPanel.tsx`.
- **LLM calls:** follow `apps/server/src/stages/script/scriptExecutor.ts` (`generateRoutedStructured`, usage accounting) and the mock provider `apps/server/src/providers/llm/mock.ts`.
- **Guideline text:** `GuidelineService.guidanceFor(project, ["music"])` / `["metadata"]` in `apps/server/src/guidelines/service.ts`, appended with `appendGuidelineGuidance` (`apps/server/src/guidelines/promptText.ts`), the same way `stages/script/prompt.ts` does it.
- **MCP:** `apps/mcp/src/tools.ts`.

## Steps
1. **Shared:** add `MusicAssistOutputSchema`, `VideoMetadataDraftSchema`, `VideoMetadataSchema` (draft + edited + source + stale), a pure `buildChapters(timeline, sections)` and tag cleanup, with tests. Then change the budget estimate and update its tests.
2. **Server:**
   - add `assist` to the music selection table and a new `video_metadata` table, then run `npx drizzle-kit generate`;
   - implement music assist inside the music search flow;
   - add a `MetadataService` (generate after TIMELINE success, get, save edits);
   - add the routes and the MCP tool;
   - make the mock provider answer both tasks;
   - write the tests.
3. **Web:** show the music assist line in the Music panel; add the "Thông tin đăng tải" panel in the Render tab; write the tests.
4. Run the README done checklist, then write the report and the `.done` file.
