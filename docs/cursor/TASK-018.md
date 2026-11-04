# TASK-018 — Cursor guide

Read `docs/cursor/README.md` first. Spec: `docs/tasks/TASK-018.md` (read it fully). This guide wins where it differs from the spec.

**Depends on:** TASK-017 (done, committed) and TASK-019 (the `video_metadata` table, used by `EDIT_METADATA`). Do TASK-019 first.

## Scope changes vs the spec
- **Vision opt-in (`attachImages`) is out of scope.** It needs image support in the LLM adapters, which TASK-004G adds. Accept the field in the request schema but ignore it, and leave a `TODO(TASK-004G)` comment. Do not show the toggle in the UI.
- **SSE streaming is optional.** Returning the full assistant message from `POST /review/messages` is enough. If you skip streaming, show a "Đang trả lời…" state in the UI.
- **Prompt caching:** the spec's caching is optional, and the existing prompt-hash cache is enough. Do not add provider-specific cache headers.

## Current code you must reuse (do not duplicate logic)

| Proposal | Existing code | Notes |
|---|---|---|
| `EDIT_NARRATION` | `SceneService.patch(projectId, sceneId, { narration })` (`apps/server/src/services/sceneService.ts:108`) | See "Stale scope" below |
| `EDIT_DURATION` | `SceneService.patch(..., { durationOverrideSec })`. `ScenePatchSchema` allows `1..60` or `null` | Scene schema: `packages/shared/src/schemas/scene.ts:54` |
| `EDIT_VISUAL_QUERY` | `VisualService.patchSceneVisualQuery` (line ~398), then `VisualService.searchScene` (line ~174) | Those already mark TIMELINE stale (line ~1271). The scene goes back to review |
| `SET_MOTION` | **No route or method exists.** The selection row has `motion` (`packages/shared/src/schemas/visual.ts:77`, `VisualMotionSchema` at line 63). Add `VisualService.setSelectionMotion(projectId, sceneId, slot, motion)` | It writes the selection row, then `markStaleFrom(repo, id, "MUSIC_REVIEW")` so TIMELINE onward goes stale. Also add `PATCH /api/projects/:id/scenes/:sceneId/visuals/motion` so the web and MCP can use it |
| `MUSIC_MIX` | `MusicService.updateSettings(project, patch)` with `MusicSettingsPatchSchema` (`packages/shared/src/schemas/music.ts:62`) | The route `PATCH /music/settings` calls `markStaleFrom(repo, id, "MUSIC_REVIEW")`. Do the same |
| `MUSIC_QUERY` | `MusicService.updateSettings(project, { query })`, then `MusicService.search(project, { force: true })` | |
| `REORDER_SCENES` | `SceneService.reorder(projectId, sceneIds)` | Must contain exactly the current scene ids |
| `EDIT_METADATA` | The TASK-019 `MetadataService` save-edits method | Never stale anything |
| `NOTE` | none | No apply button |

**Stale helper:** `markStaleFrom(repository, projectId, stage)` in `apps/server/src/pipeline/invalidation.ts` marks every stage **after** `stage` as stale. Order: `TOPIC, RESEARCH, SCRIPT, SCENE_PLAN, VISUAL_SEARCH, VISUAL_REVIEW, VOICE, SUBTITLE, MUSIC_SEARCH, MUSIC_REVIEW, TIMELINE, FINAL_APPROVAL, RENDER, DONE`.

### Stale scope (important)
`SceneService.mutate` (line ~239) always calls `markStaleFrom(..., "SCENE_PLAN")`, which makes VISUAL_SEARCH and VISUAL_REVIEW stale too. For a narration or duration change from the chat, that is too wide: the user would have to redo image review.

1. **First check** what a rerun of VISUAL_SEARCH does when the scenes were only edited (not added). Does it keep existing approved selections, or search again? Read `visualService.executeStage` (line ~582).
2. If it keeps them and the rerun is cheap, reuse `patch` as is, and say so in the report.
3. Otherwise, add an optional argument to `SceneService.patch` / `reorder`, such as `options?: { staleFrom?: PipelineStage }`, defaulting to the current `"SCENE_PLAN"`. The review apply code then passes:
   - narration: `"VISUAL_REVIEW"` (VOICE, SUBTITLE, … become stale);
   - duration: `"MUSIC_REVIEW"` (TIMELINE onward);
   - reorder: `"MUSIC_REVIEW"`.

   The existing scene routes keep the old behaviour. Add tests for both paths.

`mutate` throws `409 INVALID_PIPELINE_STATE` while a job is active. Apply must surface that as a clear message in the UI ("Đang có tiến trình chạy, thử lại sau").

## Files to add

**Shared** (`packages/shared/src/schemas/review.ts`, export it from `index.ts`):
- `ReviewProposalSchema` is a discriminated union on `type`, matching spec §3. Use the existing `VisualMotionSchema` and `MusicMixSettingsSchema` pieces where possible.
- `ReviewAssistantOutputSchema { reply, proposals }`.
- `ReviewThreadSchema`, `ReviewMessageSchema` (role `user|assistant`, content, proposals, appliedIndexes, usage, createdAt), and `ReviewSendSchema { text (1..4000), attachImages? }`.
- `LlmTaskIdSchema` gets `reviewChat`. Its `LLM_TASKS` entry has stage `FINAL_APPROVAL` and tier strong, **no `budgetFeature`** (user-triggered in every mode), and defaults to the script route. Check how `llm.test.ts` lists tasks and update it on purpose.
- Tests: proposal parsing, invalid proposals.

**Server:**
- `src/db/schema.ts`: tables `review_threads`, `review_messages` and `review_proposal_applications` (spec §6), all cascading on project delete. Then run `npx drizzle-kit generate`.
- `src/review/contextBuilder.ts` (0 LLM): builds the context from the spec §2.
  - Get data from the existing services: timeline, scenes, visuals, music, subtitles, guideline findings via `GuidelineService.responseFor(project)`, and guideline text via `GuidelineService.guidanceFor(project, targets)` (`apps/server/src/guidelines/service.ts`).
  - Output: stable key order, deterministic, plus `sha256` as `contextHash`.
  - Keep it compact. Cut narration per scene to ~400 chars when the total is over ~12k chars.
- `src/review/prompt.ts`: system rules plus context plus history.
  - **History:** the last 12 messages, plus a code-built "earlier decisions" list made from the applied proposals.
  - **Rules:**
    - answer in the project language;
    - propose only the types listed;
    - use only scene ids from the context;
    - `NOTE` for advice;
    - never claim a change was applied.
- `src/review/validate.ts`: drop proposals with an unknown sceneId, an out-of-range value, or a reorder that is not a permutation. Append a short Vietnamese note to the reply for each dropped one.
- `src/review/service.ts` (`ReviewService`): `get`, `send`, `apply` and `reset`.
  - `send` calls `generateRoutedStructured` with task `reviewChat`. Copy the usage accounting from `apps/server/src/stages/script/scriptExecutor.ts`. There is no stage job here, so record the usage like other user-triggered calls; look at how the per-candidate or alt-query user actions record usage, if any. Otherwise add a usage row with `stage: "FINAL_APPROVAL"`. Note the choice in the report.
  - `apply` dispatches by type to the table above. It records `review_proposal_applications` and returns `{ result, staleStages }`. Applying the same proposal twice returns `409 ALREADY_APPLIED`.
- `src/api/review.ts`: the routes in spec §6, registered in `src/app.ts`. Also add a `GET /api/projects/:id/review/estimate?text=` route, or include the token estimate in `GET /review`, for "estimated tokens before sending". Use the existing estimate helper in the budget code; check `apps/server/src/api/budget.ts`.
- `src/providers/llm/mock.ts`: answer `reviewChat` with a deterministic reply plus one proposal of each kind that is valid for the fixture project, so the tests can apply them.
- MCP (`apps/mcp/src/tools.ts`, `apiClient.ts`): `get_review_context {projectId}` returns the context document. `apply_review_proposal {projectId, proposal}` validates and applies one proposal directly, without a stored message: add a `POST /api/projects/:id/review/apply` route that takes a raw proposal. Add MCP tests.

**Web** (`apps/web/src/features/review/`):
- `ReviewChatPanel.tsx`: the "Góp ý với AI" section, collapsed by default, inside the Timeline tab. Find where the Timeline tab renders in `apps/web/src/features/timeline/`.
- It contains:
  - the message list;
  - an input showing the estimated tokens;
  - the "AI xem lại toàn bộ" button and the 4 chips from spec §4;
  - the proposal cards, each with a "Áp dụng" button, plus an "Áp dụng tất cả" button.
- After apply, show the banner "Chạy lại các bước bị ảnh hưởng: …". Its button calls the existing pipeline run. Find how `PipelinePanel` starts a run.
- "Bắt đầu cuộc trò chuyện mới" calls DELETE.
- The "Duyệt & render" flow is not changed.
- `services/reviewApi.ts` holds the react-query hooks.
- Tests: render, send (mocked API), apply, banner.

## Tests (server, mock provider, no network)
- Context builder: same input gives the same hash; changing a narration changes it.
- Validation drops bad proposals and keeps good ones.
- Apply for each type marks the expected stages stale. Assert the exact stage states.
- Send stores both messages plus usage. The history window is 12.
- Render and gate approval still work with no thread.
- `SET_MOTION` route + method.

## Steps
1. Shared schemas, LLM task, tests. Then `npm run build -w packages/shared`.
2. Server: tables + migration, then the context builder, prompt, validate, service, routes, the motion method, the mock, and the tests.
3. MCP tools + tests.
4. Web panel + tests.
5. Browser check on a throwaway project that has a timeline: send "AI xem lại toàn bộ" with the mock or any configured route, apply one `MUSIC_MIX` proposal, and see the rerun banner. **Never use project `56374fb2-54cf-48ff-9441-2e6c653295d4`.**
6. Run the README done checklist, then write the report and the `.done` file.
