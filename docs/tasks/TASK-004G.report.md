# TASK-004G report — MAX mode: vision-checked images + render vision

## What changed

### Shared
- `packages/shared/src/budget/modes.ts` — `MAX` preset; knobs `visionRetryRounds`, `visionThreshold`, `visualSearchBreadth`, `renderVerify`, `factCheck`; estimate includes vision / fact-check / render vision; removed `later: ["visionCheck"]`
- `packages/shared/src/schemas/llm.ts` — tasks `factCheck`, `visionResearch`, `visionConsistency`, `renderVision` (kept distinct ids; `visionCheck` stays the main vision score call)
- `packages/shared/src/schemas/vision.ts` — VisionCheck / batch / research / consistency / render / fact-check schemas, scoring helpers, `VISION_IMAGE_TOKEN_ESTIMATE` (=1000)
- `packages/shared/src/schemas/visual.ts` — optional `visionCheck` on candidates, `visionMeta` on scene visuals, `deriveSceneVisualStatus(..., visionNeedsAttention)`
- `packages/shared/src/enums.ts` — `NEEDS_ATTENTION` scene visual status
- `packages/shared/src/schemas/render.ts` — issue codes `FRAME_MISMATCH`, `SUBTITLE_ILLEGIBLE`, `RENDER_VISION_FAILED`
- `packages/shared/src/visuals/rank.ts` — optional `llmRank` / `visionFit` on `ScoreBreakdown`
- Tests: `budget.test.ts`, `vision.test.ts`, `llm.test.ts` length 15

### Server
- LLM types: `capabilities`, request-level `images`, `VISION_PROVIDER_REQUIRED` / `FFMPEG_MISSING`
- Adapters: anthropic / gemini / openai-compatible / ollamaNative multimodal; claude-cli `--add-dir` + Read; copilot-cli `--attachment`; mock deterministic fits (`lowfit`/`highfit` labels)
- `structured.ts` — prepare/resize images, cache key includes image content hash, vision preflight
- `media/ffmpeg.ts` — `downscaleForVision` (≤768 px JPEG)
- `tokenEstimate.ts` — per-image ~1000 token estimate (documented)
- `services/visionVerify.ts` + `stages/visuals/visionPrompts.ts` — verification loop, re-search, consistency
- `services/visualService.ts` — MAX vision after rank/rerank, breadth 8/16, `NEEDS_ATTENTION`, single-candidate `visionCheckCandidate`, skip AUTO approve for attention scenes
- `api/visuals.ts` — `POST .../visuals/:candidateId/vision-check`
- `app.ts` — AUTO gate blocks on `NEEDS_ATTENTION` (same pattern as MUST findings); wires LLM into visuals + render
- `stages/script/factCheckPrompt.ts` + `scriptExecutor.ts` — fact-check pass when `factCheck` on
- `services/renderService.ts` — post-render vision on mid-frame thumbs when `renderVerify` on; vision errors → `RENDER_VISION_FAILED` WARN
- `review/service.ts` — `attachImages` attaches selected scene images when route is vision-capable
- Migration: `apps/server/drizzle/0018_parallel_starjammers.sql` (`vision_check`, `vision_meta`)
- Tests: `test/visionMax.test.ts`

### Web
- `BriefFields.tsx` — MAX option + label, CUSTOM toggles for new knobs, estimate hints
- `VisualReview.tsx` — fit badge, depicts, issue chips, attention banner, re-search history, “Kiểm tra lại bằng AI”
- `RenderPanel.tsx` — “Sửa scene này” links for vision/frame issues
- `ReviewChatPanel.tsx` — attach-images toggle (default on for MAX)
- Related test fixture updates

### MCP
- `get_scene_visuals` already returns `SceneVisuals`; now includes `visionCheck` / `visionMeta` via shared schema (no MCP code change required)

## Test counts

| Workspace | Before (README / TASK-017 baseline) | After |
|---|---|---|
| shared | 156 | **176** |
| mcp | 11 | **12** |
| server | 295 | **323** |
| web | 70 | **74** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”. No `package.json` / lockfile changes.

## Live check

**live check not run: no vision route** — no `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `CLAUDE_CLI_ENABLED` / `COPILOT_CLI_ENABLED` in the environment. Mock-only acceptance covered in `visionMax.test.ts` (re-search history on forced low-fit scene, `VISION_PROVIDER_REQUIRED`, estimate, single-candidate route). Fit distribution / re-searched scene counts from a live ≥10-scene run are therefore N/A.

## Deviations from the spec

- **Task ids:** added `factCheck`, `visionResearch`, `visionConsistency`, `renderVision` instead of overloading `visionCheck` with sub-labels (documented in guide).
- **Render AUTO / NEEDS_ATTENTION on the render itself:** vision frame fails set `report.ok = false` via ERROR issues; scene-level visual `NEEDS_ATTENTION` is the VISUAL_SEARCH path. Render UI links back to the Visuals tab.
- **Custom URL / upload informational vision** in MAX is covered by the explicit per-candidate button (not auto-replaced).
- **Browser live UI** on a throwaway project not started in this run (unit/API coverage instead). Never touched project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Not done

- Live vision run with a configured provider (quotas/keys unavailable here).
- No commit/push (per rules).
