# TASK-075 — Cursor: render modes for compose graphics, and speed fixes

**Who:** Cursor, model **grok-4.7-medium** (not high/xhigh). Difficulty: medium.

**Prerequisite:** `docs/research/render-speed/RESEARCH-075.done` exists **and** Claude has added the "Decisions from RESEARCH-075" section at the end of this file. If either is missing, stop. Read `docs/cursor/README.md`, this file, `docs/compose/README.md`, then `docs/research/render-speed/README.md` and `modes.md`. Never open a file over 300 lines whole.

**Why:** the TASK-067b directors make videos look much better, but graphic shots (`kinetic_text`, `chart`) render through HyperFrames at 16–38 s each. The user must be able to choose speed vs. look per project, with good defaults per budget mode.

## 0. Hard rules

- No commit or push. No new npm dependency unless the Decisions section allows one. No DB change unless the Decisions section says so (then `npx drizzle-kit generate` only).
- Do not touch `.env`, `.claude/`, `data/`, `scripts/`.
- Tests: no network, no LLM, no real HyperFrames (mock the runner), except the opt-in eval (`VG_COMPOSE_EVAL=1` / `VG_COMPOSE_SAMPLES=1`).
- Never render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- Do not change the director rules (`apps/server/src/compose/director/rules.ts`, `labels.ts`, `llm.ts`) beyond what §2 says.

## Mã nguồn mở có sẵn

Use what RESEARCH-075 recommends (see Decisions). The defaults below need nothing new: HyperFrames (already used) and ffmpeg (`zoompan`, `fade`, `overlay`) for the static mode.

## 1. The setting

- New budget feature `composeGraphics` in `packages/shared/src/budget/modes.ts`: `"off" | "static" | "animated"`, plus any sub-options the Decisions section lists (e.g. grain on/off, graphic fps). A default per mode comes from the Decisions section. CUSTOM can set it like any other feature.
- `off`: the director makes no `kinetic_text` or `chart` spans. Pass it as a director option; the rule director converts such spans to footage/still with reason `+mode-off` (reuse the variety pass `convert` behaviour: keep word ranges, drop payload).
- `static`: render the template's final frame once as PNG (HyperFrames, one frame), then make the clip in ffmpeg (short fade in, slow zoom, exact frame count like other shots).
- `animated`: today's path, with the speed fixes from §3.

## 2. Wiring

- `composeBridge.ts` / `renderService.ts`: read `composeGraphics` through the budget resolver and pass it to the director and the graphic renderer. Also pass `projectId` and `language` into `ComposeRenderContext` (067b part 2 said they are missing at `renderService.ts` ~line 725).
- The plan report (TASK-068) records the mode and, per graphic shot, which path rendered it.

## 3. Speed fixes

Implement the items the Decisions section lists, in its order. Each must keep the output frame-exact (same frame count as the plan) and keep the cache correct.

## 4. Render-time estimate

- Pure function in shared: `estimateRenderSeconds(plan, mode, perShotCosts)` using the measured costs from RESEARCH-075 (store them as a small constant table with the date measured).
- Show it on the render screen before the user starts a render ("Ước tính: ~N phút"), and in the assistant/MCP render tools' result.

## 5. Tests

- Budget presets: each mode has a `composeGraphics` value; CUSTOM override works; old settings without the field still parse.
- Director with `off`: no graphic spans, every word still covered, reasons end with `+mode-off`.
- Static path: mocked HyperFrames is called for one frame only; ffmpeg args give the exact frame count.
- Estimate: monotone (`off` ≤ `static` ≤ `animated`) on the three eval fixtures.
- Run the opt-in eval once and add one row per mode to `docs/compose/EVAL.md`.
- `npm test` and `npm run typecheck` at the end.

## 6. Docs

- User guide: the render page section, what each graphic mode does and the trade-off, in Vietnamese. Update featureMap.
- `docs/compose/README.md`: one paragraph on the modes.

## Done checklist

- [ ] §1–§5 done; tests and typecheck pass (or list failures outside your files).
- [ ] `git status` shows only files this guide allows.
- [ ] `docs/tasks/TASK-075.report.md` (≤ 40 lines: files, EVAL rows per mode, what you skipped) and an empty `docs/tasks/TASK-075.done`.

## Decisions from RESEARCH-075

Written by Claude on 2026-11-11 after reviewing `docs/research/render-speed/`. Read its `README.md` and `modes.md` before starting; numbers below come from there.

**No new npm dependency. No DB change.** The setting lives in the budget preset JSON like other features.

### D1. Defaults per mode (`composeGraphics` plus two sub-options)

| Mode | composeGraphics | graphicGrain | Notes |
|---|---|---|---|
| ECO | `off` | false | graphic spans become footage/still with reason `+mode-off` |
| BALANCED | `static` | false | final frame PNG + ffmpeg fade 0.2 s and slow zoom, 30 fps |
| QUALITY | `animated` | false | 30 fps, MP4 opaque, HyperFrames quality `standard` (CRF18), JPEG 95 |
| MAX | `animated` | true | as QUALITY, grain follows the template variant |
| CUSTOM | starts from QUALITY | user choice | user may pick off/static/animated and grain |

- Graphic fps stays 30 in every mode. Do **not** add a lower-fps option in this task (the research found no stable gain).
- Do not use HyperFrames `draft` quality for QUALITY/MAX.
- Expected compose cost at 1080×1920 (cold cache, one shot at a time): ECO ~33–35 s per minute of video, BALANCED ~34–40, QUALITY ~71–115, MAX ~83–139. The old path was ~103–177.

### D2. Speed fixes, in this order (§3)

1. **MP4 opaque output for full-scene graphics, and drop the extra re-encode.** Full-scene graphic shots have a solid background, so ask HyperFrames for MP4 (standard, JPEG 95) instead of WebM with alpha, and skip the second ffmpeg pass in `render/graphic.ts` when the clip already has the right size, fps, frame count, pix_fmt and codec (check with ffprobe; keep the pass as a fallback when anything differs). Overlays that need alpha keep today's format. Files: `compose/hyperframes.ts`, `compose/render/graphic.ts`.
2. **Static mode.** Render one PNG of the **finished state**: wait for fonts, layout and the GSAP timeline to be ready, then seek to the end of the animation before any fade-out (duration minus hold), not the last frame. Then build the clip in ffmpeg (`loop` + `fade` + `zoompan` or `scale`/`crop`), exact frame count. Line breaks may differ slightly from animated; test Vietnamese diacritics, safe zone, chart values and frame count.
3. **Fix the cache key** (correctness bug). `compose/render/sceneClip.ts` leaves out `brandColor`, `accentColor`, `language` and `projectId`, so a changed context can return an old clip. The key must include: shot payload, template id and variant, colours, language, `composeGraphics` mode, grain, fps, output format and quality, width/height, and a `COMPOSE_RENDER_VERSION` constant (bump it when templates, fonts or `common.js` change). Do not change it to a text-only key.
4. **Graphic render concurrency.** Default 1 graphic shot at a time; allow 2 through a config value (`COMPOSE_GRAPHIC_CONCURRENCY`, max 2 unless set higher by hand). Never `auto`/one per core. Always close the browser/page and temp files on error, timeout or cancel. Reusing one browser between shots is optional: the research saw no stable median gain, so only do it if it is simple and tested.
5. **Grain as an option** (`graphicGrain`): when false, `assets/compose/common.js` skips the canvas-noise grain. Then the estimate (§4).

### D3. Estimate (§4)

Store the measured per-shot costs (seconds for a 3 s shot, measured 2026-11-11 on i5-13500H) as a constant table in shared:

| Shot | s per 3 s shot |
|---|---|
| kinetic_text animated, no grain | 17.1 |
| chart animated, no grain | 17.0 |
| kinetic_text animated, grain | 22.2 |
| chart animated, grain | 22.3 |
| static graphic (PNG + motion) | 2.1 (PNG 0.8 + motion 1.2) |
| still | 1.5 |
| footage | 0.8 |
| scene concat | 0.6 per 3 s of video |

Scale by duration with the formulas in `modes.md` ("Hệ số và công thức tái lập"): animated `2.5 + (C3 − 2.5) × d/3`; still/footage `0.15 + (C3 − 0.15) × d/3`; static `PNG + 0.10 + (motion3 − 0.10) × d/3`; concat `0.10 per scene + (concat3 − 0.10) × videoSec/3`. Clamp at 0. Cached shots cost 0.

Show a range of **±40 %** ("Ước tính: ~N–M phút cho phần dựng cảnh") and say it excludes voice, music, subtitles and the final mux. Never present it as a promise.

### D4. Acceptance

- Unit tests per §5, plus: cache key changes when colour, language, mode, grain or version changes; static mode seeks the finished state (mock the runner and assert the seek time); the extra encode is skipped only when the probe matches.
- Opt-in eval (`VG_COMPOSE_EVAL=1`) at 1080×1920 for ECO, BALANCED and QUALITY on the three fixtures: put measured s per minute in `docs/compose/EVAL.md` next to the predicted numbers above. If QUALITY is more than 40 % above the prediction, say so in the report.
