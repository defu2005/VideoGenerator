# TASK-081 — One browser for many static graphic frames

**Who:** Cursor, model `grok-4.7-xhigh` (render path + a third-party CLI whose behaviour must be checked first). **Size:** S. **Order:** now, after TASK-070b. It may run beside TASK-084 (originality). **No DB change.**

Read first: `docs/cursor/README.md`, `docs/tasks/TASK-075.report.md` (lines 1–20), `apps/server/src/compose/hyperframes.ts` (158 lines), `apps/server/src/compose/render/graphic.ts` (207 lines).

## Why

In BALANCED mode (`composeGraphics: "static"`), each graphic shot is one frame: `renderGraphic` calls `hyperframes render --start/--end` for a single frame, then ffmpeg loops it with a fade and slow zoom. Each call starts its own headless Chrome, so a video with 8 graphic shots starts Chrome 8 times. TASK-075 measured static at 2–3× its estimate for this reason. Goal: start the browser **once per video** for all static frames, and keep the output identical.

## Mã nguồn mở có sẵn

- HyperFrames 0.9.14 (Apache-2.0, already a dependency). Its `snapshot` command captures PNGs at exact times (`--at 3.0,10.5`, `--no-end`, `--keep`, `--json`) in one browser session. It also supports nested compositions with variables (`npx hyperframes docs compositions`, `docs data-attributes`). Read both docs topics before you design anything.
- `puppeteer-core` is installed only as HyperFrames' own dependency. **Do not import it directly** and do not add it to `package.json`.
- No new dependency. If you find a better open-source way, report it (README rule 11).

## What to do

1. **Spike (≤ 1 hour, write the findings in the report).** In a temp folder under the scratchpad (not the repo), build one HyperFrames project holding 3 of our templates (map, compare, list_full) as sub-compositions placed one after another on the root timeline, each with **its own variables**. Capture with one `snapshot --at … --no-end --keep --json` call. Check:
   - Each PNG matches a single-shot `render --start/--end` frame of the same template. Compare by eye and with a pixel diff; small JPEG-vs-PNG differences are fine.
   - Variables do not leak between sub-compositions (`common.js` and the templates read variables; check how).
   - The time for 3 frames in one call vs 3 separate renders.
2. **If the spike works:** add `renderStaticBatch(shots[])` in `hyperframes.ts`. It builds one batch project, runs one snapshot, and returns one PNG per shot. In the compose render, collect every static graphic shot of the video first, render the batch, then run the existing `staticMotionArgs` ffmpeg step per shot on its PNG (it accepts an image input; check it).
   - Keep the per-shot cache key and cache file per shot, so a re-render reuses frames and only the missing ones go into the batch.
   - If the batch fails, or a shot's PNG is missing, fall back to the current per-shot render for those shots and log a warning. Never fail the video because of the batch.
   - Cancelling kills the one process and removes temp files, as today.
   - Keep `COMPOSE_GRAPHIC_CONCURRENCY` working for animated mode. Static mode now runs one batch (you may split it into chunks of at most 12 shots).
3. **If the spike fails** (variables leak, frames differ, or snapshot is not faster): do not force it. Write why in the report, propose the next option (for example a small long-running render page we own), and stop. That is a valid result.

## Rules

- No commit or push. No new npm dependency. No migration.
- Do not touch `.env`, `.claude/`, `data/`, `scripts/`, `apps/server/assets/compose/**` (templates: if one needs a change for batching, say so in the report), `**/originality/**`, `apps/server/src/publishing/**`, `apps/server/src/guidelines/**`, `apps/server/src/pipeline/**`, `apps/server/src/jobs/**`.
- Tests: no network, no real browser in unit tests. Use the existing `run` injection in `hyperframes.ts`. One opt-in live test behind `VG_COMPOSE_EVAL=1` may render real frames.
- Never render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Done

- Unit: batch builder (time slots, variables per shot, cache hits skipped), fallback on missing PNG, cancel.
- Eval (`VG_COMPOSE_EVAL=1`): BALANCED render of the eval fixtures, before vs after. Report seconds per graphic shot and total, and update `docs/compose/EVAL.md`.
- `npm run typecheck`, `npm test` in `apps/server`. Failures outside your area: list them with the file.
- Write `docs/tasks/TASK-081.report.md` (spike result first), then create the empty `docs/tasks/TASK-081.done`.
