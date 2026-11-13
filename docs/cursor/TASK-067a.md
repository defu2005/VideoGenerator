# TASK-067a — Cursor guide (compose engine, part 1: the foundation)

**Scope:** build the plumbing of the new compose engine.
- Today every scene is one still image with Ken Burns motion. The compose engine turns each scene into a short series of **shots** of different **kinds** (`still`, `footage`, `kinetic_text`, `chart`), cut on word gaps and music beats.
- This part builds everything that **objective tests can check**: the schema, word timings, beat detection, the pacing algorithm, the footage provider, the renderers, the service and the evaluation metrics.
- The "creative" parts (which kind fits which sentence, good-looking templates, footage relevance) are TASK-067b for Fable. Here you build them only as a **simple baseline behind a fixed interface**, so that Fable can replace them later.

Read `docs/cursor/README.md` first (rules). The overall plan is in `docs/cursor/TASK-067.md`.

**Order:**
- runs in parallel with TASK-069, because this task only creates new folders;
- TASK-067b (Fable) and TASK-068 (integration) start after this one.

**Cursor model:** grok-4.7-medium.

**Hard rules:**
- **Allowed files.** Create files only in:
  - `packages/shared/src/compose/**` (tests next to the files, as in `packages/shared/src/render/*.test.ts`);
  - `apps/server/src/compose/**`, `apps/server/src/providers/footage/**`, `apps/server/assets/compose/**`;
  - `apps/server/test/compose*.test.ts` (the server tests are flat in `apps/server/test/`);
  - `docs/compose/**`.

  **The only edit to an existing file:** one line in `packages/shared/src/index.ts`: `export * from "./compose/index.js";`.
- **Do not edit** `renderService.ts`, `timelineService.ts`, `render/plan.ts`, `media/motion.ts`, `visuals/*`, `providers/images/*`, `db/schema.ts`, `assistant/*`, `registry/*` or `stages/*`. Import from them only. Integration is TASK-068.
- **No new npm dependency.** No DB schema change.
- **Tests:**
  - no network, no real LLM;
  - no real HyperFrames or Chrome: inject a fake `run`, the way `renderMotionGraphic` accepts `run`;
  - ffmpeg may run only on tiny generated inputs (≤ 2 s, 160×90).
- **Rules:** do not commit or push. Do not touch `.env`, `.claude/`, `data/` or `scripts/`. Never render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- **Secrets:** read keys only through `AppConfig` (`PEXELS_API_KEY`, `PIXABAY_API_KEY`). Never log them.
- **Media licences** (TASK-060 rules): every footage clip stores provider, id, author, licence and page URL. Never use a clip whose licence is unknown.

---

## Mã nguồn mở có sẵn

| Project | Licence | Use |
|---|---|---|
| HyperFrames 0.9.14 (installed) | Apache-2.0 | renders `kinetic_text` and `chart` (HTML+GSAP → video on the CPU) |
| GSAP 3.15 (installed) | free standard licence | animation inside templates |
| FFmpeg (`ffmpeg-static`, `ffprobe-static`) | binary called as a process | trim, scale and crop footage; concat; decode PCM; `freezedetect`, `blackdetect` |
| editly | MIT | **reference only** for the clip/layer JSON shape; do not install |
| Remotion | restrictive licence once the channel earns money | **do not use** |

**Beat detection:** write it yourself (energy flux + autocorrelation, about 120 lines). If you copy code from anywhere, it must have a permissive licence, and you keep the attribution in a header comment. If you find a clearly better project, name it in the report; do not add it.

---

## Facts (verified 2026-11-10)

- **Scene clip today:** `apps/server/src/services/renderService.ts` lines 676–700.
  - For each scene: `clipsDir/<clipHash>.mp4`, built from `buildSceneClipPlan(scene, timeline.target, resolvePath, { croppedPaths })` (`packages/shared/src/render/plan.ts:82`).
  - ffmpeg runs with `-filter_complex_script` and `-frames:v plan.frames`, plus `CLIP_OUTPUT_ARGS` (`plan.ts:135`: `-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -an`).
  - **Contract for your output:** an mp4 with exactly `scene.durationFrames` frames at `target.fps`, written with `CLIP_OUTPUT_ARGS`.
- **Other `plan.ts` exports:** `ClipInput` (line 76), `zoompanExprs` (56), `splitFrames` (22), `parseBlackdetect` (311).
- **Timeline** (`packages/shared/src/schemas/timeline.ts`):
  - `TimelineScene = { sceneId, order, label, startSec, endSec, durationSec, durationFrames, voice:{trackId,path,startSec,durationSec}, visuals: TimelineVisual[], fadeInSec, fadeOutSec, transitionOut }`.
  - `TIMELINE_FPS = 30`.
  - `Timeline.music = { candidateId, title, path, sourceDurationSec, loop, startOffsetSec, volume, fadeInSec, fadeOutSec, duckingDb }`.
  - The voice starts at `scene.startSec + VOICE_LEAD_SEC` (`timeline/build.ts:17`, `VOICE_LEAD_SEC = 0.1`).
- **Voice** (`schemas/voice.ts`):
  - `VoiceTrack.words?: {startSec,endSec,text}[]` (relative to the track);
  - `cues: {startSec,endSec,text}[]`;
  - `timingSource?: "provider"|"aligned"|"estimated"`.
- **Edit settings** (`packages/shared/src/edit/plan.ts`): `EditPresetId` = `calm|energetic|news|story`, `MotionPreset`, `TRANSITION_GUARD_SEC = 0.8`.
- **Other types:**
  - `AspectRatio` comes from `enums.ts:112`;
  - `renderTargetFor(aspect)` gives the render target;
  - `Scene.visualQueries = { primary, alternatives[] }` (`schemas/scene.ts:27`) holds the existing image search queries. Use them as footage queries.
- **Motion helpers** (`apps/server/src/media/motion.ts`):
  - `hyperframesEntry()`, `gsapFile()`, `motionAssetRoot()`, `writeCompositionHtml`, `prepareMotionFolder`, `killProcessTree`;
  - `renderMotionGraphic({..., run?})` (line 119) is the pattern to copy for full-screen templates.
  - The templates in `assets/motion/<id>/index.html` read variables through `window.__hyperframes.getVariables()`; fonts and GSAP are linked by `build-templates.mjs`.
- **Brand colours:** `brandColor` and `accentColor` (`packages/shared/src/motion/templates.ts:128`).
- **Image providers** (`apps/server/src/providers/images/`): `pexels.ts`, `pixabay.ts`, `http.ts`, `retry.ts`, `rateLimiter.ts`. Import the helpers; do not edit them.

---

## Phase A: pure shared code (`packages/shared/src/compose/`)

Finish Phase A with green tests before Phase B.

### A1. `schema.ts`: write it exactly like this (zod, with exported types)

```ts
export const COMPOSE_VERSION = 1;
export const SHOT_KINDS = ["still", "footage", "kinetic_text", "chart"] as const;
export const MIN_SHOT_SEC = 0.8;
export const MIN_GRAPHIC_SHOT_SEC = 1.5;      // kinetic_text and chart
export const MAX_GRAPHIC_SHOT_SEC = 6;

FootageLicense = { provider: "pexels"|"pixabay"; clipId: string; author: string; licenseName: string; pageUrl: string }
ShotSource =
  | { kind: "still"; candidateId: string | null; path: string | null; motion: MotionPreset }
  | { kind: "footage"; clipId: string; path: string | null; inSec: number; license: FootageLicense }
  | { kind: "kinetic_text"; lines: string[]; emphasis: number[]; style: "bold" | "typewriter" | "stack" }
  | { kind: "chart"; chart: "bar" | "line" | "pie"; title: string; labels: string[]; values: number[]; unit?: string }
Shot = { id: string; kind: ShotKind; startSec: number; endSec: number;   // relative to the scene clip start
         wordRange?: { start: number; end: number };                     // indexes into scene words, end exclusive
         source: ShotSource; reason: string }
KindSpan = { kind: ShotKind; wordStart: number; wordEnd: number; reason: string; payload?: ShotSource }
ScenePlan = { sceneId: string; durationSec: number; durationFrames: number; fps: number; shots: Shot[]; warnings: string[] }
BeatGrid = { bpm: number; beatsSec: number[]; confidence: number }   // music time
ComposeStats = { shotsPerMin: number; meanShotSec: number; stdevShotSec: number; kindShare: Record<ShotKind, number>;
                 kindEntropyBits: number; maxSameKindRun: number; wordGapCutPct: number; beatCutPct: number | null }
ComposePlan = { version: 1; engine: "compose"; preset: EditPresetId; aspect: AspectRatio; scenes: ScenePlan[];
                beatGrid?: BeatGrid; stats: ComposeStats }
```

Add `validateScenePlan(plan, words): string[]`, which returns error strings (an empty list = valid):
- the shots cover `[0, durationSec]` with no gap and no overlap (tolerance 1 ms);
- `shotFrames(plan)` (rounding each cut to a frame) sums to `durationFrames` exactly;
- every shot is ≥ `MIN_SHOT_SEC`, and graphic shots are in [1.5, 6] s;
- `shot.kind === shot.source.kind`;
- no cut falls strictly inside a word (`word.startSec < cut < word.endSec`).

**Tests:** one passing plan, plus one failing case per invariant.

### A2. `words.ts`: scene words in clip time

- `sceneWords(scene: TimelineScene, track: VoiceTrack | null): { words: SceneWord[]; source: "provider"|"aligned"|"estimated"|"none" }`.
- `SceneWord = { i, text, startSec, endSec, sentenceEnd: boolean, punct: boolean }`. Times are in scene clip time: `track time + VOICE_LEAD_SEC`, clamped to `[0, durationSec]`.
- **Fallbacks:** with no `words`, spread the words of each cue evenly over that cue (`source = "estimated"`). With no cues either, return an empty list (`none`).
- `sentenceEnd` = the text ends with `. ! ? …`; `punct` = it ends with `, ; :` or a sentence end.
- `cutCandidates(words, durationSec): Cut[]`, where `Cut = { t, gapSec, sentenceEnd, punct }`:
  - a cut is the midpoint of each gap between word `k` and word `k+1`;
  - a gap under 40 ms still counts (its midpoint);
  - always include `0` and `durationSec`.

**Tests:** provider words, estimated words from cues, Vietnamese diacritics, clamping.

### A3. `beats.ts`: beat detection (pure TS)

- `detectBeats(pcm: Float32Array, sampleRate: number): BeatGrid | null`.
- **Method:**
  1. RMS energy per frame with hop 512 and window 1024;
  2. the positive first difference (onset strength);
  3. normalise it;
  4. the autocorrelation of the onset curve over lags for 70–180 BPM gives the best lag → BPM;
  5. the phase is the offset in `[0, period)` with the most onset sum at `offset + k·period`;
  6. `beatsSec` covers the whole track;
  7. `confidence` = the normalised autocorrelation peak (0–1).
- Return `null` when `confidence < 0.3`.
- `musicToSceneBeats(grid, music, sceneStartSec, sceneDurationSec): number[]`. The beat times in scene clip time are `musicTime = sceneStartSec + t - music.startOffsetSec`, wrapped by `sourceDurationSec` when `loop`.

**Tests:**
- synthetic click tracks made in code at 11 025 Hz (5 ms noise bursts) at 90, 120 and 150 BPM, each 20 s long: the tempo is within ±2 BPM and the phase error < 50 ms;
- white noise → `null`;
- the wrap and offset maths of `musicToSceneBeats`.

### A4. `pacing.ts`: where to cut (dynamic programming)

**Bands by preset (target, min, max), in seconds.** For 9:16, multiply every value by 0.8.

| preset | target | min | max |
|---|---|---|---|
| calm | 5.0 | 3.0 | 8.0 |
| story | 3.5 | 2.0 | 6.0 |
| news | 3.0 | 1.8 | 5.0 |
| energetic | 2.0 | 1.2 | 3.5 |

`paceSpan(input): number[]` returns the cut times inside one span (it excludes the span start and end).
- **Input:** `{ startSec, endSec, cuts: Cut[], beatsSec: number[], band, guardSec }`.
- **Allowed cuts:** the candidates strictly inside the span, and not within `guardSec` (= `TRANSITION_GUARD_SEC`) of the scene edges 0 and `durationSec`. The caller passes the edges.
- **DP over the ordered points** `[start, allowed…, end]`. `best[j] = min over i<j of best[i] + segCost(i,j) + cutCost(j)`, with `cutCost(end) = 0`.
  - `segCost`: let `len = t_j − t_i`. If `len < max(band.min, MIN_SHOT_SEC)` or `len > band.max`, it costs `1e6`. Otherwise it costs `((len − target)/target)²`.
  - `cutCost`:
    - `+0.6` when it is not `punct` and `gapSec < 0.12` (mid-phrase);
    - `−0.3` when `sentenceEnd`;
    - `−0.25` when a beat lies within ±0.12 s.
  - If no valid path exists (the span is shorter than `band.min`, or no candidates), return `[]`: the span is one shot.
- **Graphic spans** (`kinetic_text`, `chart`) are never split by `paceSpan`. The caller clamps them (see B6).

**Tests:**
- a 12 s span of evenly spaced words with the `news` band → 3–5 shots, each within the band;
- with a beat grid, ≥ 1 cut snaps within 0.12 s of a beat;
- sentence ends are preferred over mid-phrase cuts;
- the guard zone is respected;
- the DP is deterministic.

### A5. `metrics.ts`: `computeStats(plan, scenesWords, sceneBeats): ComposeStats`

- **Kind entropy:** Shannon entropy in bits over the runtime share of each kind.
- `maxSameKindRun` counts across scene edges.
- `wordGapCutPct`: the share of inner cuts not inside a word.
- `beatCutPct`: the share of inner cuts within ±0.12 s of a beat, or `null` with no grid.

**Tests:** hand-computed values for a 2-scene plan.

### A6. `index.ts`

Export everything listed above.

---

## Phase B: server (`apps/server/src/compose/`, `providers/footage/`)

### B1. Footage provider (`providers/footage/`)

- **`types.ts`:**
  - `FootageHit = { provider, clipId, url, width, height, durationSec, author, licenseName, pageUrl, previewImage, tags: string[] }`;
  - `FootageProvider = { id; enabled(config): boolean; search({ query, orientation: "landscape"|"portrait"|"square", minDurationSec, limit }): Promise<FootageHit[]> }`.
- **`pexels.ts`:** `GET https://api.pexels.com/videos/search?query=&orientation=&per_page=`, with the `Authorization` header. Choose from `video_files` (see below). `licenseName = "Pexels License"`.
- **`pixabay.ts`:** `GET https://pixabay.com/api/videos/?key=&q=&per_page=`. Choose from `videos.{large,medium,small,tiny}`. `licenseName = "Pixabay Content License"`.
  - Check the response field names in the official API docs once.
  - The fixtures are hand-written JSON in `apps/server/test/fixtures/footage/`.
- **`registry.ts`:** `searchFootage(config, query, opts)` asks every enabled provider and merges the hits. Drop hits with an empty author or licence.
- **`download.ts`:** `ensureFootage(dataDir, hit, targetShortSide)`.
  - Pick the smallest file whose short side is ≥ the target short side.
  - Download it to `<dataDir>/footage/<provider>-<clipId>-<h>.mp4`, written to a temp name and then renamed.
  - Cap it at 60 MB and skip clips longer than 60 s.
  - Reuse an existing file.
- Use `http.ts`, `retry.ts` and `rateLimiter.ts` from `providers/images` (import them).

**Tests:** mocked `fetch`, file choice, licence fields, a disabled provider when its key is missing, and the size cap.

### B2. `hyperframes.ts`: full-screen template render

About 60 lines. Copy the pattern of `renderMotionGraphic` (`media/motion.ts:119`), but use the templates in `assets/compose/<id>/` and an opaque background.
- **Signature:** `renderComposeTemplate({ dataDir, templateId, variables, width, height, fps, durationSec, run? })`.
- It writes to the cache under `<dataDir>/compose-cache/`.
- The key is a hash of the template file content, the variables, the size, the fps, the duration and `COMPOSE_VERSION`.

### B3. Baseline templates (`assets/compose/kinetic_text/index.html`, `assets/compose/chart/index.html`)

**Working but simple. Fable redesigns them in TASK-067b.**
- Use Be Vietnam Pro and GSAP, linked the way `assets/motion` does it.
- Read the variables through `window.__hyperframes.getVariables()`.
- Use `brandColor` as the background and `accentColor` for the emphasis words.
- **kinetic_text:**
  - variables `{ lines, emphasis, style, words:[{t,text}] }`;
  - each word fades in at its `t`.
- **chart:**
  - variables `{ chart, title, labels, values, unit }`;
  - the bars grow over 0.6 s;
  - `line` and `pie` may fall back to the bar style in this task.

### B4. Shot renderers (`compose/render/`)

Each renderer is `renderShot(shot, target, ctx) => Promise<{ path, frames, warning? }>`. It writes an mp4 with `CLIP_OUTPUT_ARGS` and exactly `frames = round(endSec·fps) − round(startSec·fps)` frames.
- **`still.ts`:** build a one-visual `TimelineScene` and call `buildSceneClipPlan`. Do not copy the zoompan maths.
- **`footage.ts`:**
  - `-ss inSec -t dur -i file`;
  - `scale=W:H:force_original_aspect_ratio=increase,crop=W:H,fps=FPS,setsar=1`;
  - `-frames:v frames`.
  - If the source is shorter than `inSec + dur`, return a warning; do not loop.
- **`graphic.ts`:** `kinetic_text` and `chart` go through `renderComposeTemplate`, then are transcoded to `CLIP_OUTPUT_ARGS` with `-frames:v frames`.

### B5. `sceneClip.ts`: concatenation

- `renderComposedScene(scenePlan, target, ctx, outPath) => { frames }`: render the shots, then concatenate them with the concat demuxer and re-encode with `CLIP_OUTPUT_ARGS` and `-frames:v durationFrames`.
- Hard cuts only. Fable may add whips later.
- **Cache key:** `sha256(JSON(scenePlan) + asset file hashes + target + COMPOSE_VERSION)`.
- **Test:** 2 tiny shots (`testsrc2` 160×90, 1 s each) → the output has exactly 60 frames (checked with ffprobe).

### B6. Director interface and the baseline director (`compose/director.ts`)

**This is the interface Fable will implement.** Keep it exactly:

```ts
export type DirectorInput = {
  scene: { sceneId: string; index: number; count: number; text: string; durationSec: number };
  words: SceneWord[];
  recipeId: string;               // explainer | listicle | story | news_recap | myth_vs_fact | how_to | short_hook
  aspect: AspectRatio;
  stills: { candidateId: string; path: string }[];
  footage: FootageHit[];          // already searched; the director never fetches
};
export type Director = { id: string; directScenes(inputs: DirectorInput[]): Promise<KindSpan[][]> }; // one KindSpan[] per scene
export const baselineDirector: Director;
```

**Baseline behaviour:** one span per scene covering every word, with kind `footage` when there are ≥ 2 footage hits, otherwise `still`. The reason is `"baseline"`.

### B7. `composeService.ts`

- `planProject({ timeline, scenes, voiceTracks, recipeId, preset, aspect, director?, footageSearch?, beats? }) => Promise<ComposePlan>`:
  1. words via `sceneWords`;
  2. footage hits via `footageSearch(scene.visualQueries)`, at most 6 per scene;
  3. `director.directScenes(...)`;
  4. each span is paced:
     - footage and still spans → `paceSpan`;
     - graphic spans are clamped to [1.5, 6] s, and the rest of the span becomes the neighbouring span's time;
  5. sources are filled:
     - footage: a different hit per shot, `inSec = 0.5`, never the same clip twice in a scene;
     - still: rotate the scene's stills and their `motion`;
  6. the plan is validated (`validateScenePlan`), then `computeStats`.
  - If a scene fails validation, fall back to one `still` shot for the whole scene and add a warning.
- `renderSceneClip(plan, sceneId, target, ctx, outPath)`: the function TASK-068 will call from `renderService`.
- **`beatsFile.ts`:** `beatGridForMusic(dataDir, musicPath, run?)` decodes with `ffmpeg -i music -ac 1 -ar 11025 -f f32le -`, calls `detectBeats`, and caches JSON under `<dataDir>/compose-cache/beats-<filehash>.json`.
- The service touches no DB and no job system.

### B8. Evaluation harness (`compose/eval/`, `docs/compose/EVAL.md`)

- `apps/server/test/compose.eval.test.ts` runs only when `VG_COMPOSE_EVAL=1`. Normal `npm test` skips it.
- It builds 3 fixture projects offline:
  - explainer 16:9 with numbers in the text;
  - listicle 9:16;
  - story 16:9.

  Each has 4–6 scenes, generated colour stills, `testsrc2` footage files, a synthetic 120 BPM click track as music, and mock words.
- **Probes:**
  - `freezedetect=n=0.003:d=1.5` segments;
  - `blackdetect` (`parseBlackdetect`);
  - frame count per clip;
  - render seconds per minute of video.
- It writes a table to `docs/compose/EVAL.md` for the **legacy** plan (one still per scene) and the **baseline compose** plan. Fable will add a third column.
- HyperFrames runs for real only in this harness.

---

## Done checklist

- [ ] Everything is in the allowed paths. The only edit to an existing file is the one export line.
- [ ] `npm run typecheck` and `npm test` pass in every workspace. `package-lock.json` is unchanged.
- [ ] The beat and pacing tests pass with the numbers above.
- [ ] `VG_COMPOSE_EVAL=1 npx vitest run test/compose.eval.test.ts` (in `apps/server`) runs, and `EVAL.md` has the legacy and baseline columns. If HyperFrames cannot render full-screen opaque here, write the stderr tail (≤ 20 lines) in the report and go on.
- [ ] `docs/compose/README.md` (≤ 80 lines) lists each module, its main function and its file. Fable reads this instead of the code.
- [ ] Report `docs/tasks/TASK-067a.report.md`:
  - files created;
  - test counts;
  - the EVAL table;
  - any API field that differed from this guide;
  - deviations.
- [ ] An empty file `docs/tasks/TASK-067a.done`.
