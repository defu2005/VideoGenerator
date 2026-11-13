# RESEARCH-075 — Codex research brief (why compose graphics render slowly, and how to make it fast)

**Who:** Codex (desktop thread). **No app code.** You may run benchmarks: put throwaway scripts and outputs in the OS temp folder, never in the repo. The only repo files you write are the output files below.

**Why:** with the TASK-067b directors, a video costs 71–150 s of render per minute of video at 160×90, against 9–15 s for the baseline (`docs/compose/EVAL.md`, `docs/tasks/TASK-067b-part1.report.md`). At full size, one graphic shot (`kinetic_text`, `chart`) costs 16–38 s (`docs/tasks/TASK-067b-part2.report.md`). Almost all of it is HyperFrames. TASK-075 (Cursor) will add render modes and speed fixes. It needs measured numbers, not guesses.

**Run it** now. Read first: `docs/compose/README.md`, the two 067b reports above, `apps/server/src/compose/hyperframes.ts`, `apps/server/src/compose/render/graphic.ts`, `apps/server/assets/compose/common.js`. Never open a file over 300 lines whole.

**Hard rules:** no commit, no push, no `npm install` in the repo (you may install into a temp folder to benchmark an alternative). Do not touch `.env`, `.claude/`, `data/`, `scripts/`. No network in anything that would become an app test. Never render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

**Output (only these files):**
- `docs/research/render-speed/README.md`: the report (§6) and the method (machine: CPU, cores, RAM, OS, Node, HyperFrames and Chromium versions);
- `docs/research/render-speed/profile.md`: §1–§3;
- `docs/research/render-speed/alternatives.md`: §4;
- `docs/research/render-speed/modes.md`: §5;
- `docs/research/render-speed/knowledge.json`: `dependency` entries (TASK-073 §2 shape) for HyperFrames and each alternative you recommend: version, licence, source URL, `checkedAt`;
- then an empty `docs/research/render-speed/RESEARCH-075.done`.

## 1. Where the time goes (profile one shot)

For one `kinetic_text` (style `bold`, variant 0 and variant 1) and one `chart` (`bar`), at 1920×1080 and 1080×1920, 3 s, 30 fps, split the wall time into:
- process and browser start;
- page load, fonts, first layout;
- frame capture (per frame, and the capture method HyperFrames uses);
- encode;
- our own work around it (copying assets, ffmpeg joins).

Use the existing harness (`VG_COMPOSE_SAMPLES=1` in `apps/server/test/compose.eval.test.ts`) or call HyperFrames directly. Repeat each run 3 times and give the median. Also note CPU and RAM use during a run. Other agents may be working on this machine at the same time (Fable runs the compose eval, Cursor runs tests): before each timed run, check CPU load; if another heavy process (ffmpeg, chrome, vitest) is busy, wait and rerun, and write in the report which numbers may be affected.

## 2. HyperFrames options

From its docs, CLI `--help` and source in `node_modules/hyperframes` (read, do not edit):
- Can one browser render several compositions (batch), or keep a warm browser between calls?
- Parallel workers or frame ranges? What does it do with N cores?
- Capture method options (screenshot vs. BeginFrame/other), image format (png/jpeg) and quality, GPU flags, device scale factor.
- Lower fps for graphics (e.g. 15 or 24 fps, then ffmpeg to 30): does it look acceptable? Save one comparison PNG pair per setting.
- Measure the best combination you find against §1.

## 3. Cheap wins we control

Measure each one:
- **Static graphic:** render only the final frame (the template's finished state) once as PNG, then animate it in ffmpeg (fade in, slow zoom). Cost per shot, and how it looks next to the animated version (save PNG frames).
- **Grain:** variant 1's canvas-noise grain costs about 2× (31–38 s vs 16–24 s). Cost without grain, and with a pre-made grain PNG overlay in ffmpeg.
- **Cache:** what share of graphic shots repeat across re-renders of one project (same text, same vars)? Is the current cache key too strict?
- **Concurrency:** how many shots can render in parallel on this machine before the total time stops dropping?

## 4. Other open-source ways to render the same graphics

For each, give licence (copy only from permissive ones; flag any licence that needs a paid licence for companies), maturity, Windows support, CPU-only speed for our `bold` kinetic text and `bar` chart at 1080×1920, and how much of our templates would need rewriting:
- ffmpeg alone (`drawtext`, ASS/libass subtitles with karaoke/`\t` animation) for kinetic text;
- canvas drawing in Node (skia-canvas, @napi-rs/canvas, node-canvas) piping raw frames into ffmpeg;
- Lottie (lottie-web in a browser, or a native player such as rlottie / Skottie);
- Motion Canvas, Remotion (check its company licence terms), and any other you find.
A quick prototype for the top 1–2 is welcome (in the temp folder). Do not recommend switching away from HyperFrames unless the gain is large; say what it would cost us.

## 5. Mode matrix

The app already has budget modes ECO / BALANCED / QUALITY / MAX / CUSTOM (`packages/shared/src/budget/modes.ts`). TASK-075 will add a render setting to them. Propose, from your numbers:
- the graphic options per mode (for example: `off` = no graphic shots; `static` = final frame + ffmpeg motion; `animated` = full HyperFrames, with or without grain, which fps);
- the expected render seconds per minute of video for each mode at 1080×1920, for the three eval fixtures;
- the default per mode. The user's priority is quality first, but a 10-minute video should not take an hour.

## 6. Report (README.md, ≤ 60 lines)

- The machine and versions.
- A table: setting → s per shot (median) → s per minute of video → visual note.
- Your recommendation in order of gain per effort, each with the files TASK-075 would touch.
- What you could not measure and why.
