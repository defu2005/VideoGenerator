TASK-067b PART 2 REPORT
status: done
files:
- created: apps/server/assets/compose/common.js, apps/server/src/compose/render/graphicVars.ts, apps/server/test/composeGraphic.test.ts, docs/compose/samples/ (24 PNG + timings.json)
- edited: apps/server/assets/compose/{kinetic_text,chart}/index.html (rewritten), apps/server/src/compose/{hyperframes.ts, render/graphic.ts, render/context.ts, eval/runEval.ts}, apps/server/test/compose.eval.test.ts, packages/shared/src/compose/schema.ts
tests: 20 new, all pass | full npm test ok (shared 507, mcp 19, server 847 + 3 skipped, web 180) | typecheck ok
eval: EVAL.md not changed. Samples via `VG_COMPOSE_SAMPLES=1` (real HyperFrames, 1920×1080 and 1080×1920, 3–4 s shots).
  Render seconds per shot: variant 0 and 2 = 16–24 s; variant 1 (grain) = 31–38 s. That is about 300–600 s per minute of graphic video.
decisions:
- Shared runtime `common.js` (colours, safe box, 3 backgrounds, fitText); it is in the cache key and copied to the work dir.
- Colours are computed in TS (`graphicColors`): always white text; a light brandColor is darkened (hue kept) until white reads ≥ 5.2:1 on the lightest tone (target 4.5:1 plus room for glows); accent is lightened to ≥ 4.5:1.
- Safe zone: top/left 6 %, right 6 % (12 % on 9:16), bottom 22 % / 30 %. Max lines 2 (16:9) / 3 (9:16). Line-height 1.3, no hidden overflow on text.
- `variant = FNV-1a(projectId + shotId) % 3`: 0 radial glow, 1 diagonal gradient + grain + left rule, 2 shapes + underline. Backgrounds drift slowly until durationSec − 0.2, so a held graphic is not a frozen frame.
- Optional `wordTimes` added to the kinetic_text schema (old plans still validate). With it, words start on their time (first word at 0); without it, words spread over 60 % of the shot. All tweens end by durationSec − 0.2; the timeline spans the shot.
- Charts: bar = columns on 16:9 with ≤ 8 values, rows on 9:16; line = draws in 0.8 s, points pop as the line reaches them, a word unit is written once above the plot; pie = donut, largest share counted up in the centre, legend beside (16:9) or below (9:16). Numbers use `Intl.NumberFormat(language)`.
- Changed after looking at the PNGs: (1) `bold` wrapped to 3 lines on 16:9 because the block width was measured while words were mid-transform, now measured from layout boxes; (2) `stack` with too many lines now joins the two shortest neighbours instead of re-splitting words; (3) line-chart value labels overlapped and left the safe margin, now numbers only, sized to the step and clamped inside the plot; (4) variant 2 circles made smaller and fainter; (5) the SVG-turbulence grain with a blend mode took 83–107 s per shot, replaced by a seeded canvas noise tile (31–38 s).
- Layout re-runs when text metrics change (checked on every timeline update), so a late web font cannot leave a wrong fit.
067a issues:
- `hyperframes.ts` copied only the `vietnamese` subset of Be Vietnam Pro, so plain Latin letters fell back to a system font. Fixed here (latin + latin-ext are copied too); `apps/server/src/media/motion.ts` has the same pattern and was not touched.
- The 120 s template timeout is tight at full resolution: two chart samples hit it once before the grain fix.
- Baseline render numbers in EVAL.md were measured at 160×90, so they say nothing about full-size graphic shots.
for TASK-068/070:
- `ComposeRenderContext` has new optional `projectId` and `language`. `renderService.ts` (line ~725) does not pass them yet; without them the variant uses the shot id only and numbers format as `vi`.
- The director may fill `wordTimes` (shot-relative seconds, one per word of `lines` joined) for exact word sync.
- Part 3 stop rule: graphic shots cost 16–38 s each at full size. Measure the baseline at full size before applying "> 1.5× baseline".
- First frame of a kinetic shot is background only (first word fades in over 0.24 s); on the default dark brand colour the render gate's blackdetect may need a look.
- New kinds (map/compare/quote_full/list_full) can reuse `window.VGInit()` from common.js: safe box, colours, `fitText`, `layout`, `at`, `finish`.
- `docs/compose/README.md` was not updated (not in the allowed files): add common.js, graphicVars.ts and `renderTemplateSamples`.
