# TASK-012 report

## Scope delivered
The RENDER stage turns the approved timeline into one MP4 with FFmpeg, using 0 LLM calls. It also writes a `credits.txt` and an SRT next to the video. The Render tab shows a player, the check report, a thumbnail per scene and download links.

## Decisions
1. Render works in two passes:
   - Each scene becomes its own clip (zoompan Ken Burns, in-clip fades, grey placeholder). Each clip is cached by hash at `render/clips/<hash>.mp4`, so a re-render only rebuilds the scenes that changed.
   - The final pass joins the clips (concat demuxer), burns in the ASS subtitles, and places each voice track with `adelay`. Music loops, then ducks under the voice with a fixed `volume` expression rather than sidechain, so the output is reproducible. Audio is mastered with `loudnorm` (I=-14, TP=-1.5).
2. The final filter graph goes through `-filter_complex_script`, run from inside the render folder with the ASS file named relatively. This avoids escaping Windows drive letters in the `ass=` filter.
3. Output is written to `.part.mp4` and renamed only on success, with `+faststart`. A failed or cancelled render leaves no row and no output file. Cancelling kills ffmpeg.
4. The same timeline hash plus the same output file means the render is reused, with no ffmpeg run.
5. Checks run with ffprobe:
   - duration, size, and whether video and audio streams are present;
   - `blackdetect`;
   - one mid-scene thumbnail per scene.
   Problems become report issues (WARN/ERROR) and never delete the video.
6. Credits list every asset with its license, or "chưa rõ" when the license is unknown. A license is metadata only and never blocks a render.
7. All plan building (filters, ducking, concat list, progress and blackdetect parsing, credits) lives as pure functions in `@vg/shared` (`render/plan.ts`), and the server only runs it.

## API
- `GET /api/projects/:id/render`
- `GET /api/projects/:id/render/video`: supports Range; `?download=1` downloads it as a file.
- `GET /api/projects/:id/render/credits`
- `GET /api/projects/:id/render/subtitles`
- `GET /api/projects/:id/render/thumbs/:sceneId`

## Checks
- `npm test --workspaces`: 518 tests pass (shared 150, mcp 10, server 290, web 68). This includes a real ffmpeg smoke render at 160×90 with ASS burn-in and music.
- `npm run typecheck`: passes.
- `npm run build`: passes. The usual chunk-size warning is still there.
- Live: migration 0013 applied, `GET /render` returns `{render:null}`, and the Render tab shows the empty state. No gate was approved on the user's project.

## Not done / next
- Vision-based check of the rendered frames is deferred (an optional LLM step, see the quality-first rule).
- TASK-017 content guideline packs, then TASK-018 pre-render review chat, then TASK-013.
