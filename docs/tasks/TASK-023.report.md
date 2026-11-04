# TASK-023 report — Render variants 16:9 / 9:16 from one project

## Investigation findings

### How the renderer uses `aspectRatio`
- Timeline build (`packages/shared/src/timeline/build.ts` → `renderTargetFor`) maps aspect to output size: `16:9` → 1920×1080, `9:16` → 1080×1920, `1:1` → 1080×1080 (fps 30).
- Scene clips (`buildSceneClipPlan` in `packages/shared/src/render/plan.ts`) scale with `force_original_aspect_ratio=increase` (cover), then crop to the supersampled frame, then Ken Burns `zoompan` using `motion.from` / `motion.to` (x/y focus, default centre).
- Final pass burns ASS from the timeline path; voice/music mix are aspect-independent.
- Clip cache hash already includes `timeline.target`, so a different output size rebuilds clips without touching research/script/voice/visuals/music stages.

### Does TIMELINE store aspect-dependent data?
- Yes: `timeline.target` (width/height) and the written ASS (`PlayResX/Y`, font, margins, line wraps via `maxCharsPerLine`).
- Scene timings, voice offsets, music, and selected image paths do **not** depend on aspect.
- Variant path therefore overrides `target` in memory, regenerates ASS in code from the existing SRT (re-wrap + vertical layout), and leaves the stored timeline row unchanged. No LLM.

### Focus / saliency
- No separate saliency or vision crop-centre fields exist (`visionCheck` only has `fit` / `cropOk`).
- Motion `from.x` / `from.y` is the stored focus used for the cover-crop centre (falls back to 0.5).

## What changed

### Shared
- `packages/shared/src/render/variants.ts` — aspect helpers, missing-format picker, job scope encode/decode, `subtitleLayoutForAspect`, `VERTICAL_DURATION_WARN_SEC`
- `packages/shared/src/schemas/render.ts` — `aspectRatio` / `variantOf` on `Render`; `RenderRequestSchema`; `RenderVariantsResultSchema`; issue `VERTICAL_TOO_LONG`
- `packages/shared/src/render/plan.ts` — cover-crop uses motion focus centre
- `packages/shared/src/subtitles/index.ts` — vertical ASS defaults (larger font vs width, margin above 15% safe zone)
- `packages/shared/src/index.ts` — export variants module
- `packages/shared/test/renderVariants.test.ts`

### Server
- `apps/server/src/db/schema.ts` — `renders.aspect_ratio`, `renders.variant_of`
- Migration `apps/server/drizzle/0022_nice_spencer_smythe.sql` (+ snapshot/journal)
- `apps/server/src/services/renderService.ts` — variant render options, ASS rebuild, duration warn, `renderMissingVariants`, store aspect/variant_of
- `apps/server/src/stages/render/renderExecutor.ts` — reads `aspect:*` from job scope
- `apps/server/src/pipeline/orchestrator.ts` — `runRender` (queues RENDER without marking earlier stages stale)
- `apps/server/src/jobs/jobRepository.ts` — `createJob` accepts `scope`
- `apps/server/src/api/render.ts` — `POST /render`, `POST /render-variants`
- `apps/server/src/app.ts` — wire orchestrator into render routes
- `apps/server/test/render.test.ts` — 9:16 ffprobe + job-only RENDER; render-variants selection; vertical duration warn

### Web
- `RenderPanel` — Định dạng select, profile “Render cho mọi tài khoản…”, vertical player frame
- `RenderHistory` — label “Dọc 9:16” / “Ngang 16:9”
- `renderApi.ts` — `startProjectRender`, `startProjectRenderVariants`
- `index.css` — vertical player styles
- `RenderPanel.test.tsx` — format select, vertical frame, profile button

## Test counts

| Workspace | Before (TASK-022) | After |
|---|---|---|
| shared | 190 | **195** |
| mcp | 12 | **12** |
| server | 373 | **376** |
| web | 80 | **81** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”. No `package.json` / lockfile change.

## Live / browser check
- Covered by real-ffmpeg server test: POST `/render` with `aspectRatio: "9:16"` on a throwaway fixture project; ffprobe 1080×1920; job list only `RENDER` with scope `aspect:9:16`.
- Did **not** approve gates or render on `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Deviations from the spec
- `POST /render-variants` runs missing formats sequentially in the request (via `RenderService.renderMissingVariants`) rather than chaining worker jobs; suitable for automation and keeps tests deterministic with fake ffmpeg.
- Explicit same-as-project `aspectRatio` on POST is stored on the row; omitted aspect still stores `null` (= project default).

## Not done
- No commit/push (per rules).
- Publishing / OAuth still TASK-024+.
