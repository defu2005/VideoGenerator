# TASK-036 report — Auto thumbnails

## Fix: image route params + blur scale

`GET /api/projects/:id/thumbnail/image/:kind` parsed `request.params` twice. The image route includes `kind`, but `project()` still ran the strict `{id}` schema, so every image request returned 400 `VALIDATION_ERROR` ("Unrecognized key: kind"). Each route now parses its own params, and `project()` only loads that id. The image route is covered by `app.inject` through `registerThumbnailRoutes`.

`parseFrameProbe` treated `lavfi.blur` as 0..1 (`max(0, 1 - blur) * 100`). blurdetect prints higher-is-blurrier values such as `lavfi.blur=3.876687`, so every frame scored 0. Sharpness is now `100 / (1 + blur)`. A single frame has `YDIF` 0, so the no-blurdetect path uses an `edgedetect` YAVG when that filter exists, otherwise `YHIGH - YLOW`.

## Fix: drawtext textfile

Overlay text is no longer placed inside `drawtext=text='...'`. Each part is a UTF-8 file under `render/thumbnails/text/<landscape|cover>/<n>.txt`. The filter references `textfile='<escaped path>'` with `expansion=none`. `buildThumbnailVideoFilter` stays pure (it returns the paths and the text); the service writes the files. `escapeDrawtext` was removed.

## What changed

### Shared (`packages/shared`)
- `src/thumbnails/index.ts` — candidate times (fade skip, hook at +1s, max 8), frame scoring, textfile overlay filter, JPEG qscale loop, upload checks, thumbnail schemas
- `src/index.ts` — export thumbnails
- `src/schemas/llm.ts` — task `thumbnailPick` (RENDER, fast, vision)
- `src/schemas/project.ts` — optional `coverPath`, `thumbnailMeta`
- `src/schemas/publication.ts` — optional `coverTimestampMs`
- `src/budget/modes.ts` — feature `thumbnailPick` (off on ECO/BALANCED/QUALITY, on for MAX)
- Tests: `test/thumbnails.test.ts`, `test/budget.test.ts`, `test/llm.test.ts`

### Server DB
- `src/db/schema.ts` — `projects.cover_path`, `projects.thumbnail_meta`
- Migration `drizzle/0031_absent_lethal_legion.sql` (+ snapshot, journal). Second `drizzle-kit generate` printed “No schema changes, nothing to migrate”.

### Server thumbnail
- `src/services/thumbnailService.ts` — extract, score, optional vision pick, composite landscape + cover, manual recompose/upload, font file for Arial Bold
- `src/api/thumbnails.ts` — GET state, GET image, POST recompose / regenerate / upload
- `src/app.ts` — wire the service into render, automation, and routes
- `src/stages/render/renderExecutor.ts` — `ensureAuto` after a successful render; a thumbnail error does not fail the stage
- `src/services/automationService.ts` — `ensureBeforePublish` before the publish job, no gate
- `src/providers/llm/mock.ts` — `ThumbnailPick` fixture
- `src/services/modelAdvisor.ts` — vision token estimate includes `thumbnailPick`

### Publishing
- `src/publishing/publishService.ts` — pass `coverTimestampMs` from `thumbnail_meta.frameTimeSec`
- `src/publishing/youtubePublisher.ts` — landscape `thumbnails.set`; Shorts skipped with no warning
- `src/publishing/tiktokPublisher.ts` — Direct Post `video_cover_timestamp_ms`
- `src/publishing/instagramReelsPublisher.ts` — `thumb_offset` (no `cover_url`)
- `src/publishing/facebookReelsPublisher.ts` — Graph v26 has no Reels thumbnail upload; one warning line

### Web
- `src/features/render/ThumbnailCard.tsx` + `ThumbnailCard.test.tsx` — card “Thumbnail”
- `src/features/render/PublishPanel.tsx` — card under Đăng
- `src/services/thumbnailApi.ts`
- `src/features/projects/BriefFields.tsx` — CUSTOM toggle “Chọn thumbnail bằng AI nhìn (MAX)”
- Tests updated: `PublishPanel.test.tsx`, `RenderPanel.test.tsx`, `ProjectDetailPage.test.tsx`

### Tests
- `apps/server/test/thumbnails.test.ts` — fade/black skip, LLM pick, budget and blind-provider fallback, text files instead of inlined drawtext, JPEG ≤ 2 MB, manual survives regen, upload type/size, `app.inject` on `/thumbnail/image/landscape` and a candidate id (unknown kind is 404), real ffmpeg “Bí ẩn đại dương”, ffmpeg-static ranking of a sharp `testsrc2` frame above `gblur=sigma=20` (skipped only when the binary is missing), and ffmpeg-static on `Don't miss it`, `Bí ẩn: 100% thật, đúng không?`, `a\b` (skipped only when the binary is missing)
- `apps/server/test/youtubePublisher.test.ts`, `tiktokPublisher.test.ts`, `metaPublishers.test.ts`

## Test counts

| Workspace | Tests |
|---|---|
| shared | 218 |
| mcp | 12 |
| server | 556 |
| web | 107 |

Above the TASK-017 floors (shared 156, mcp 11, server 295, web 70).

`npm run typecheck` and `npm run build -w packages/shared` pass. After the image-route and blur-scale fix: shared 218, server 556, web 107. mcp was not re-run for this fix (still 12 from the task run). No `package.json` or lockfile change. No NUL bytes in the changed files. Vietnamese text is UTF-8.

## Deviations from the guide

1. **Both aspects always.** Landscape 1280×720 and vertical 1080×1920 are written for every generation, not only the aspects of linked accounts.
2. **`thumbnailPick` is on for MAX only.** ECO, BALANCED, and QUALITY stay off so their call-count snapshots do not move. CUSTOM can turn the feature on.
3. **All frames rejected.** If every candidate is black or flat, the brightest frame is kept (score 0) so publishing still has an image.
4. **drawtext textfile.** Overlay text is not inlined. `\'` inside single quotes does not escape a quote in this ffmpeg, so copy with `'`, `:`, `%`, `,`, or `\` was clipped (`Don't miss it` → `miss it`, stray `%`). `buildThumbnailVideoFilter` stays pure and returns UTF-8 parts; the service writes `render/thumbnails/text/<landscape|cover>/<n>.txt` and the filter uses `textfile` plus `expansion=none`. Paths still go through `escapeDrawtextPath`. The highlighted word drops trailing punctuation so the brand colour does not paint `:` or `%`.
5. **Facebook.** Graph v26.0 `video_reels` finish does not accept a thumbnail upload. The warning is `Facebook Reels (Graph v26) không nhận ảnh thumbnail qua API; bỏ qua ảnh bìa.` It is recorded only when a thumbnail path or cover time is present.
6. **YouTube Shorts** skip `thumbnails.set` with no warning. Landscape still uploads.
7. **TikTok** sets `video_cover_timestamp_ms` on Direct Post only, not the inbox path.
8. **Vision size.** The service scales the four frames to 512 px. `prepareVisionImages` still uses the existing vision cache. Tests seed that cache so the fake ffmpeg runner is not asked to encode it again.
9. **Meta extras.** `subjectX` / `subjectY` are optional and drive the crop. `thumbnail_meta` also stores `videoPath` and `frameId`. The public state strips `videoPath`.
10. **Same video.** Automatic generation skips when the files already exist for that video, or when source is `manual`, unless the user presses “Tạo lại tự động”.
11. **Upload** sets source `manual`, keeps the previous frame time when there is one, and scales/crops with no overlay text.
12. **Hook placement.** Thumbnail generation is not inside `RenderService.render()`, so existing fake-ffmpeg render tests stay unchanged. `RenderExecutor` calls it after a successful render.
13. **Font.** Subtitles name the font Arial. The file is resolved from `VG_SUBTITLE_FONT`, then `C:\Windows\Fonts\arialbd.ttf` / `arial.ttf`, then DejaVu / Liberation / FreeSans.

## Not done

- Live browser pass on a throwaway project. This session had no browser tools. Web tests cover frame select (`POST /thumbnail/recompose`), upload type/size, and the card inside Publish and Render. Project `56374fb2-54cf-48ff-9441-2e6c653295d4` was not opened, approved, or rendered.
