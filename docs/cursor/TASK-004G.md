# TASK-004G — Cursor guide

Read `docs/cursor/README.md` first. Spec: `docs/tasks/TASK-004G.md` (read it fully). This guide wins where it differs from the spec.

## What changed since the spec was written
- **MAX does not exist yet.** `BudgetModeSchema` is still `ECO | BALANCED | QUALITY | CUSTOM` (`packages/shared/src/budget/modes.ts`). The `visionCheck` feature and LLM task exist but nothing uses them.
- **TASK-012 is done** and has code checks (`RenderReportSchema` in `packages/shared/src/schemas/render.ts`: duration, size, audio, black frames, thumbnails). It **deferred the vision check of rendered frames to this task** (spec §6, vision part only). Mid-frame thumbnails already exist (`report.thumbnails`, files at `render/thumbs/<sceneId>.jpg`, or the per-version folder if TASK-013 is merged).
- **TASK-018 (review chat)** has an `attachImages` field that it ignores. This task wires it: when true, attach the selected image of each scene (or of the chosen scenes) to the `reviewChat` call. It is on by default in MAX, and the token estimate is shown first.
- **TASK-019** made `musicAssist` and `metadata` real. MAX just turns them on.
- **Live check (acceptance 3):** the copilot and agy quotas are used up. Use **any** vision-capable route the user has configured: the `anthropic` or `gemini` API, or `claude-cli`. Report which one. If none is configured, do the mock-only part and write "live check not run: no vision route" in the report. Do not ask for keys.
- **LLM providers now in the registry:** anthropic, gemini, openai-compatible (incl. OmniRoute, OpenCode Zen, Ollama, remote-ollama), `ollamaNative`, claude-cli, copilot-cli, antigravity-cli, mock. Capabilities:
  - OmniRoute / OpenCode: `vision` from config (`*_VISION=true` env, default false);
  - Ollama / remote-ollama / ollamaNative: default false; allow `OLLAMA_VISION=true` (Ollama's native `/api/chat` accepts `images: [base64]`);
  - antigravity-cli: `false` (no headless attachment verified).

## File map
- **Provider interface:** `apps/server/src/providers/llm/types.ts`.
  - `LlmProvider` has no `capabilities` yet: add `capabilities?: { vision: boolean; maxImagesPerCall: number }`.
  - `LlmRequest.messages[].content` is a string: add `images?: { path: string; label: string }[]` on the request (not per message) to keep the adapters simple.
- **Adapters:** `anthropic.ts`, `gemini.ts` and `openaiCompatible.ts` build base64 parts. `ollamaNative.ts` uses the `images` field. `claudeCli.ts` copies the images to a per-call temp dir, adds `--add-dir <dir> --allowedTools Read`, puts the paths in the prompt and deletes the dir in `finally`. `copilotCli.ts` uses `--attachment` (repeatable).
- **Structured layer:** `apps/server/src/providers/llm/structured.ts` (`generateRoutedStructured`).
  - The cache key (`cache.ts`) must include each image's content hash.
  - The route must refuse a non-vision provider with `VISION_PROVIDER_REQUIRED` when images are passed.
- **Token estimate:** `tokenEstimate.ts`. Add a fixed per-image estimate (e.g. ~1,000 input tokens for a ≤ 768 px image) and document it.
- **Image resize:** `apps/server/src/media/ffmpeg.ts` has the FFmpeg runner. Add `downscaleForVision(src, dst)` (≤ 768 px long side, JPEG q≈80, `-vf scale='min(768,iw)':-2` style, mind portrait). The resized images go in a temp/cache dir under the project data dir.
- **Budget:** `packages/shared/src/budget/modes.ts`:
  - the `MAX` preset and the new knobs `visionRetryRounds`, `visionThreshold`, `renderVerify`, `factCheck`, `visualSearchBreadth`;
  - the estimate with vision calls;
  - the CUSTOM toggles in `apps/web/src/features/projects/BriefFields.tsx`;
  - the MAX label "Không tiết kiệm token — kiểm tra ảnh bằng AI nhìn".

  Adding MAX to the enum changes the exhaustive switches and the budget tests: update those tests on purpose.
- **LLM tasks:** `packages/shared/src/schemas/llm.ts`. Add `factCheck` (stage SCRIPT, feature `factCheck`), `visionResearch` (re-search queries from vision feedback, stage VISUAL_SEARCH), `visionConsistency` (stage VISUAL_SEARCH) and `renderVision` (stage RENDER), or reuse `visionCheck` with a sub-label if you prefer fewer task ids. Document the choice.
- **Visual search:** `apps/server/src/services/visualService.ts` (`executeStage` ~582, ranking, `assignDistinct`) and `apps/server/src/stages/visuals/`. Vision verification runs after code rank + text rerank, per spec §3.
- **Scene status:** `NEEDS_ATTENTION` as a scene `visualStatus`. Check `packages/shared/src/schemas/visual.ts` for the current enum and add it. Then check every `switch` on it (server, web, MCP).
- **AUTO gate:** the orchestrator auto-approve logic (`apps/server/src/pipeline/orchestrator.ts`). TASK-017 already blocks auto-approve on open MUST findings: follow that pattern for `NEEDS_ATTENTION`.
- **Render vision:** `apps/server/src/services/renderService.ts` `check()` (~345). Add the vision step after the code checks, only when `renderVerify` is on.
  - Batch the thumbnails.
  - New issue codes `FRAME_MISMATCH` and `SUBTITLE_ILLEGIBLE` in `RenderIssueCodeSchema`.
  - Any vision fail → `report.ok = false`. Show "Sửa scene này" links in `RenderPanel.tsx`; the links open the scene in the Visuals tab.
  - Vision errors never fail the render; add an issue `RENDER_VISION_FAILED` (WARN) instead.
- **Fact-check:** `apps/server/src/stages/script/scriptExecutor.ts`. It is one extra call after the review passes, when `factCheck` is on, comparing claims against the research notes.
- **Review UI:** `apps/web/src/features/visuals/`. Add the fit badge, depicts text, issue chips, scene banner, re-search history, and the "Kiểm tra lại bằng AI" button (spec §4) plus its route (spec §7).
- **Mock:** `apps/server/src/providers/llm/mock.ts` returns deterministic fits. For example, use a hash of the image label so the tests can force a fit below 7 for one scene and above for the rerun.

## Steps
1. Shared: MAX preset, knobs, estimate, task ids, schemas (`VisionCheckSchema`, the scene status, render issue codes), tests.
2. Server: capabilities + image transport per adapter (unit-test the request bodies with HTTP fixtures; for the CLIs, test the argument list only), resize, cache key, `VISION_PROVIDER_REQUIRED` preflight.
3. Server: vision verification loop, consistency call, `NEEDS_ATTENTION`, AUTO gate, the single-candidate route.
4. Server: fact-check pass, render vision step, review-chat `attachImages`.
5. Web: MAX option + label + estimate, visuals review additions, render issue links, the review chat image toggle.
6. MCP: `get_scene_visuals` includes `visionCheck`.
7. Tests per spec acceptance 2 and 4, then a live check (see above) on a throwaway project with ≥ 10 scenes. **Never use project `56374fb2-54cf-48ff-9441-2e6c653295d4`.**
8. Run the README done checklist, then write the report (include the fit distribution and the re-searched scene count) and the `.done` file.
