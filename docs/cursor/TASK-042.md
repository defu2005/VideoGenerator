# TASK-042 — Cursor guide (motion graphics layer with HyperFrames)

Read `docs/cursor/README.md`, `TASK-040.md` and `TASK-041.md` first. TASK-041 is committed: there are xfade transitions, emphasis points with word times, ASS callouts, the `editPlan` LLM task, and edit presets.

The videos are still mostly "image + Ken Burns + subtitles". This task adds a **motion graphics layer**: animated title cards, kinetic keywords, number counters, lower thirds, list items, quotes, simple charts and an end card. They are authored as HTML/CSS/GSAP templates and rendered to **transparent clips** by [HyperFrames](https://github.com/heygen-com/hyperframes) (HeyGen, Apache-2.0). ffmpeg then overlays them in the final render.

## 0. Allowed new dependencies (exact versions, `apps/server` only)
- `hyperframes@0.9.14` (Apache-2.0). It is the CLI; we call it as a child process. It pulls `puppeteer-core` and `@puppeteer/browsers`.
- `gsap@3.15.1` (GSAP standard "no charge" license, free for commercial use). We copy `gsap/dist/gsap.min.js` into each render folder, so templates never load from a CDN.
- `@fontsource/be-vietnam-pro@5.3.0` (OFL-1.1). It is a local font with full Vietnamese diacritics; copy the woff2 files we use.

Nothing else. Record the three licenses in `docs/THIRD_PARTY.md` (create it if missing).

## 1. Hard rules for this task
- **No network at render time.**
  - Templates may reference only files in their own folder plus the copied `gsap.min.js` and fonts.
  - A unit test scans every template for `http://`, `https://`, `//cdn`, `@import url(` and fails if it finds any.
- **Telemetry off.** Every spawn of hyperframes sets `HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1` and `HYPERFRAMES_NO_UPDATE_CHECK=1`. Test the env builder.
- **Chrome.** HyperFrames uses `chrome-headless-shell`, downloaded by Puppeteer from Google's official Chrome-for-Testing storage.
  - Add a server function `ensureMotionBrowser()` that runs `hyperframes browser ensure` (with the env above). It is called only from a button "Cài trình render đồ họa" in Settings, or from the setup command in §9. It is never called automatically during a render.
  - Respect `HYPERFRAMES_BROWSER_PATH` if the user set it.
  - Use `hyperframes doctor` (or `browser path`) for the status check.
- **Render never fails because of graphics.** If HyperFrames is missing, times out or errors, that graphic is skipped. When the graphic is a keyword, fall back to the TASK-041 ASS callout. Add a warning to the render log and the render result (`warnings[]`).
- **Voice sync.** Overlays never change the audio or scene start times. Keep the TASK-041 1-frame sync test passing, and add the overlays to it.
- **Verify the CLI flags.** Check them against `npx hyperframes render --help` and `npx hyperframes --help` before coding the arg builder. The docs we read may differ; trust `--help`. Write the real flags you used in the report.

## 2. Templates (`apps/server/assets/motion/<templateId>/`)
Each template is a folder with:
- `index.html`: a HyperFrames composition. The root `<div id="root" data-composition-id="main" data-start="0" data-duration=… data-width=… data-height=…>`. Size, fps and duration are written by our code per render (see §3), not hard-coded.
- `meta.json`: `{ id, version, nameVi, descriptionVi, kinds: ("overlay"|"fullscreen")[], minDurationSec, maxDurationSec, defaultDurationSec, safeArea: "top"|"center"|"lower"|"full", variables: [...] }`.
  - Variables use HyperFrames `data-composition-variables` types: string (with `maxLength`), number, color, enum.
  - The same list is mirrored by a **zod schema** in `packages/shared/src/motion/templates.ts`. A test checks that `meta.json` and the zod schema agree.
- **The GSAP timeline:**
  - one finite `gsap.timeline({ paused: true })`, registered as `window.__timelines.main`;
  - no `Math.random`, no `Date`, no infinite repeats;
  - transparent background (no full-frame fill on `overlay` kinds).
- The brand colours, font and text come only from variables.

Starter set (all must look good in 9:16, 16:9 and 1:1, and with long Vietnamese words with diacritics):
1. `title_card`: hook title, 2 lines max, with a mask-reveal or slide-up per line.
2. `kinetic_word`: 1–3 big words, scale/blur-in plus an underline sweep. This replaces the ASS callout when available.
3. `number_counter`: counts up to a value with prefix/suffix ("1,2 tỷ", "73%") and a small label.
4. `lower_third`: name/source plus a sub line, a slide-in bar.
5. `list_item`: "#3" badge plus an item title, for listicles.
6. `quote_card`: quote text plus an author, typewriter or fade per line.
7. `bar_chart`: 2–5 labelled values that grow from zero; values are normalized in code.
8. `progress_bar`: a thin top bar over the whole video (shorts); duration = video length.
9. `end_card`: "Theo dõi để xem thêm" plus a channel name. This is the last 3 s.

You may start from HyperFrames catalog blocks (`npx hyperframes add …`) only if that block's source is Apache-2.0 in the HyperFrames repo. Copy and adapt it into our folder, strip any remote URLs, and note the origin in `meta.json` (`origin`). Otherwise write them yourself.

## 3. Render of a graphic (`apps/server/src/media/motion.ts`)
- `buildMotionRenderArgs({ templateDir, workDir, variables, width, height, fps, durationSec, format })`:
  - copy the template plus `gsap.min.js` plus fonts into a temp work dir;
  - write the size, fps and duration attributes into `index.html`;
  - write `variables.json`;
  - return the CLI args for `hyperframes render`, using `--variables-file`, `--format mov` (ProRes 4444 with alpha) and `--workers` from config.
  - If `--help` shows `mov` alpha does not work on Windows, use `webm` (VP9 alpha) and say so in the report.
- **Size:** use the project's output size. For speed, overlays may be rendered at the full output size with alpha; no scaling games.
- **Cache:** the key is sha256 of (templateId, template version, variables, width, height, fps, durationSec, hyperframes version). The cached file lives at `data/cache/motion/<key>.mov` (the app's existing data dir resolver, not a hard-coded path).
  - A hit skips the render.
  - LRU cleanup is folded into the existing cache cleanup if there is one; otherwise cap at 2 GB.
- **Limits:**
  - config `MOTION_WORKERS` (default 2);
  - `MOTION_TIMEOUT_SEC` (default 120 per graphic);
  - at most 2 graphics render in parallel (a simple queue).
  - Kill the process tree on timeout or abort; reuse the existing process helper used for ffmpeg/TTS CLIs.
- **Metrics:** store the render seconds per graphic in the render log. The report must give a table with the real times for each template at 1080×1920, 30 fps.

## 4. Data model
- A timeline field `graphics: TimelineGraphic[]` (zod in shared, json column or a table; follow how TASK-041 stored `edit_plan`):
  ```ts
  { id: string; templateId: MotionTemplateId; sceneId: string | null; // null = whole video (progress_bar)
    startSec: number; durationSec: number; // absolute timeline seconds
    anchor?: { wordIndexStart: number; wordIndexEnd: number } // if tied to narration words
    variables: Record<string, string | number>;
    layer: "overlay" | "fullscreen"; source: "llm" | "fallback" | "user" }
  ```
- Validation in code:
  - clamp the duration to the template's min/max;
  - inside the video length;
  - the variables pass the template zod (text truncated to `maxLength`);
  - unknown templates dropped;
  - **no two overlays in the same safe area at the same time**;
  - `fullscreen` graphics only on scenes whose visual is a placeholder or that the plan marks as `graphicScene`.
- When narration words move (re-TTS), graphics with an `anchor` re-time from the words. Without an anchor they keep their offset from the scene start.

## 5. Planning (extend TASK-041 `editPlan`)
- Add `graphics` to the `editPlan` output: `{ sceneId, templateId, wordIndexStart?, wordIndexEnd?, durationSec?, variables }[]`.
  - The prompt gets the template list (id, short description, variables with max lengths), the profile brand colours and the edit preset.
  - **The LLM only picks templates and fills text.** It never writes HTML.
- **Code fallback** (budget economy, LLM failure, or "Không dùng AI"):
  - the hook scene → `title_card` from the video title;
  - numbers in the narration (regex for digits, %, "triệu/tỷ/nghìn") → `number_counter`, at most 1 per 15 s;
  - a listicle-shaped script (scenes starting with "Thứ nhất/Số 1/#1…") → `list_item`;
  - shorts (9:16) → `progress_bar`;
  - every video ≥ 30 s → `end_card` (if the profile enables it).
- **Preset frequency** (TASK-041 presets): `calm` max 1 graphic per 20 s; `energetic` per 8 s; `news` per 10 s and prefers `lower_third`/`number_counter`/`bar_chart`; `story` per 15 s and prefers `quote_card`/`title_card`.
- `kinetic_word` and the TASK-041 `callout` must not both fire on the same emphasis point. When motion graphics are enabled and available, `callout` → `kinetic_word`.

## 6. Final composite (`packages/shared/src/render/plan.ts`)
- After the xfade chain and before burning subtitles (subtitles stay on top): for each graphic, add an input `-itsoffset`, or use `setpts=PTS-STARTPTS+<start>/TB` with `overlay=…:enable='between(t,start,end)':format=auto`. Choose whichever keeps the 1-frame sync; test it as strings.
- `fullscreen` graphics are drawn over the scene clip (they hide it) but keep the scene audio and voice untouched.
- More than ~12 overlays: chain in groups, as TASK-041 did for xfade.
- Profile/project `motionGraphics: { enabled: boolean, templates: MotionTemplateId[] (allowed), brandColor, accentColor, font: "be-vietnam-pro"|"system" , endCard: boolean, channelName?: string }`.
  - The default is enabled = **false** until the browser check passes, then true for new profiles.
  - Existing profiles keep false until the user turns it on.

## 7. UI (Vietnamese)
- **Settings → "Đồ họa động":** status (HyperFrames version, Chrome found yes/no, last test render time), the "Cài trình render đồ họa" button (§1), and "Render thử" (renders `title_card` 3 s at low size and shows the time).
- **Profile → "Phong cách dựng":** the motion graphics toggle, allowed templates (checkbox grid with a thumbnail), colours, font, end card.
- **Timeline page:**
  - a "Đồ họa" track under the scenes, with chips at their times;
  - click → edit the template, time, duration and variables (a form from the zod schema);
  - add or delete;
  - **"Xem trước":** a live preview in a sandboxed `<iframe sandbox="allow-scripts">` served by a server route that inlines the template with the variables and seeks the GSAP timeline with a slider/play button. No render is needed for the preview. The route serves only files under `assets/motion` and the copied libs (path traversal test).
- The TASK-041 "Xem nhanh 10 giây" includes graphics.

## 8. Tests (no network, no real Chrome, no real hyperframes in unit tests)
- The template lint: no remote URLs; a timeline registered as `main`; `paused: true`; no `Math.random`/`Date.now`; `meta.json` ↔ zod agreement.
- The arg/env builder strings (including the telemetry env vars).
- The cache key changes when any input changes; a hit skips the spawn (mock runner).
- Validation: clamping, safe-area collision, unknown template dropped, truncation of Vietnamese text without breaking a combining diacritic (normalize NFC first).
- Fallback picking: the hook title, numbers, listicle, progress bar, end card; the frequency per preset.
- The overlay filter strings: enable windows; grouping over 12; sync within 1 frame with transitions plus overlays.
- Failure path: the mock runner throws or times out → the render continues with a warning, and `kinetic_word` falls back to the ASS callout.
- The preview route: serves an inlined template; rejects `../`.
- Web: the graphics track renders the chips; the edit form validates `maxLength`; the iframe has `sandbox`.
- Optional real smoke test, only when `HYPERFRAMES_SMOKE=1` (skipped by default): render `title_card` 2 s and check with ffprobe that the output has an alpha pixel format.

## 9. Live check (after tests pass)
1. `cd apps/server; npx hyperframes browser ensure` with the telemetry env vars set. This is the Chrome download; it is allowed for this task only.
2. Render every template once at 1080×1920 30 fps with realistic Vietnamese text. Grab a middle frame of each over a checkerboard (ffmpeg) into `docs/tasks/TASK-042-frames/`.
3. Render the test project `eb02c679-26a3-4a42-8ea9-bb4e1a25288d` (allowed) with presets `energetic` and `news`, motion graphics on, and attach frame grabs.
   - Report the total render time with and without graphics.
   - **Never render project `56374fb2-54cf-48ff-9441-2e6c653295d4`.**

## Done
Done checklist from the README. Write `docs/tasks/TASK-042.report.md` (include the real CLI flags, the time table, the cache size and any Windows issue) and `docs/tasks/TASK-042.done`.
