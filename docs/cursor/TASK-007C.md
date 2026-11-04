# TASK-007C — Cursor guide

Read `docs/cursor/README.md` first. Spec: `docs/tasks/TASK-007C.md` (Vietnamese; read it fully). Only **part 1** (AI web search for image links). Part 2 (AI-generated images) is TASK-007D and is not in scope.

## What changed since the spec was written
- **Do after TASK-004G** if possible: MAX exists then, and the provider `capabilities` object from 004G is where `webSearch` goes. If 004G is not merged, add `capabilities?: { webSearch?: boolean }` to `LlmProvider` yourself (`apps/server/src/providers/llm/types.ts`) in a way 004G can extend.
- **Quotas:** the user's copilot and agy quotas may be used up. The default route stays `claude-cli` / `claude-sonnet-5-5`, as in the spec. The anthropic API route (server tool `web_search`) is the second option. The live check uses whichever works; if none does, write "live check not run" in the report.
- **agy full access:** follow the spec exactly.
  - `--dangerously-skip-permissions` always goes with `--sandbox`;
  - it is used only for task `visualWebSearch`, and only when the setting `visualWebSearch.allowAgyFullAccess` (default off) or the env `AGY_WEB_SEARCH_FULL_ACCESS=true` is on.
  - Every other task keeps `--mode plan` (see `apps/server/src/providers/llm/antigravityCli.ts` ~line 101). Tests must prove both.
- **Usage report:** TASK-004I is done (`usage.calls`). Record the calls like the other tasks.

## File map
- **LLM:** `apps/server/src/providers/llm/`:
  - `claudeCli.ts`: add tool flags only when the request asks for web search, e.g. a new `LlmRequest.tools?: ("webSearch")[]`; it adds `--allowedTools WebSearch WebFetch`;
  - `anthropic.ts`: the server tool `web_search`. Use the current tool type from Anthropic docs, `web_search_20260209` for current models. Handle `pause_turn` by continuing the request, not as an error;
  - `antigravityCli.ts`: the full-access branch;
  - `structured.ts`: pass `tools` through; it is part of the cache key;
  - every CLI call for this task runs in a fresh temp dir with a minimal env (no app API keys). Look at how `cliProvider.ts` spawns, and add a `cwd`/`env` option.
- **Shared:** `packages/shared/src/schemas/llm.ts`. Add the task `visualWebSearch` (stage VISUAL_SEARCH, tier strong, timeout 300 s, default claude-cli). Add a budget feature `aiWebSearch` in `modes.ts`: off in ECO and BALANCED, on in QUALITY and MAX, with a max scenes per video, e.g. 3 in QUALITY and 8 in MAX. Add it to the estimate.
- **Images:**
  - provider list: `apps/server/src/providers/images/` (`registry.ts`, `types.ts`);
  - candidates with provider `ai-web`: do **not** add it as a normal search provider, because it is triggered per scene, not by queries;
  - the download path: the existing image store `apps/server/src/services/imageStore.ts` (SSRF block, magic bytes, size) — reuse it, and check that it rejects private IPs;
  - Commons license check: `apps/server/src/providers/images/wikimedia.ts` probably already has an imageinfo call; reuse it.
- **Candidate fields:** `licenseVerified: boolean`, `why: string`, provider `ai-web`, in `packages/shared/src/schemas/visual.ts`.
  - **Auto-approve must skip `licenseVerified: false`.** Check `approveAll` and the AUTO path in `visualService.ts`.
- **Service:** `VisualService.aiWebSearch(projectId, sceneId, signal)` plus the route `POST /api/projects/:id/scenes/:sceneId/visuals/ai-search`. In QUALITY/MAX the pipeline calls it inside the VISUAL_SEARCH stage for scenes whose best score is under the threshold, up to the budget max.
- **Settings:** the "Cho phép Antigravity toàn quyền khi tìm ảnh" toggle, with the warning text from the spec, on the LLM settings page (`apps/web/src/features/` → find the "Mô hình AI" page).
- **Web:** the "Nhờ AI tìm" button on the scene card in `apps/web/src/features/visuals/`, the "AI tìm" badge, the `why` text, and the "Chưa xác minh license" warning.
- **Fixtures:** store sample JSON outputs in `apps/server/test/fixtures/` (shaped like the spec's real runs; invent URLs on `upload.wikimedia.org` and `example.com`). Never call real CLIs or the network in tests.

## Steps
1. Shared: task, feature, estimate, candidate fields, tests.
2. Server: provider tool plumbing (claude-cli flags, anthropic server tool, agy full-access branch + tests for both modes), temp-dir/env isolation.
3. Server: `aiWebSearch` service, parse + validate output, download via image store, license verify (Commons), cache, usage, route, pipeline hook, tests (spec acceptance 2).
4. Web: button, badge, warning, settings toggle, tests.
5. Live check on a throwaway project, scene "AlphaGo vs Lee Sedol" (spec acceptance 3). **Never use project `56374fb2-54cf-48ff-9441-2e6c653295d4`.**
6. Run the README done checklist, then write the report and the `.done` file.
