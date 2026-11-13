# TASK-067b — Fable guide (compose engine, part 2: the creative core)

**Who:** Claude Fable 5.2 in Claude Code. The budget is small, so this guide is split into **3 parts. Run each part in its own new session**, at the effort shown. Start each session with: "Đọc docs/cursor/TASK-067b.md, làm phần N."

**Product goal:** an app that makes good, cheap videos by itself and earns money on YouTube, TikTok, Facebook and Instagram.
- Today a video is one still per scene (a slideshow). A slideshow loses viewers and risks YouTube's "mass-produced content" rule.
- TASK-067a (Cursor) built the plumbing of a compose engine: shots of the kinds `still`, `footage`, `kinetic_text` and `chart`, cut on word gaps and beats, with exact-frame clips, the footage provider, metrics and an eval harness.
- It uses only a **baseline director** (footage or still for the whole scene) and **plain templates**.
- **Your job is the part that decides whether the video is good:** choosing the right shot for each sentence, graphics that look professional, and footage that matches the meaning.

**Prerequisite:** `docs/tasks/TASK-067a.done` exists, and Claude has reviewed 067a. If it does not exist, stop.

**Part 1 also needs `docs/tasks/TASK-067c.done`.** Cursor builds the language packs (`getLangPack`), the number parser (`parseNumbers`, `comparableGroups`, `startsWithOrdinal`, `findContrastWord`) and the variety pass (`checkVariety`, `enforceVariety`) in `packages/shared/src/compose/` (guide TASK-067c). Use them; do not rewrite them. Your Part 1 work is the rules R1–R6 on top (labels for charts, which group to show, hook and punchline taste), the LLM director, and the eval columns. Parts 2 and 3 do not need 067c.

**Facts from Claude's review of 067a and 068 (2026-11-10).** These replace anything above or below that disagrees.
- **`kinetic_text` source:** it has `lines: string[]` only, with no per-word times. The template spreads the words evenly over the shot. Part 2 may add an optional `wordTimes?: number[]` to the schema (shot-relative seconds). Keep `validateScenePlan` passing for old plans.
- **`FootageHit`:** it has `files[]` (sizes to choose from) and an optional `localPath`. Since 2026-11-10, **files are no longer downloaded during search.** `composeBridge.downloadChosenFootage` downloads only the clips the final plan uses. So `localPath` is normally empty while planning, and the director and `rankFootage` must not depend on it. Use the hit's tags, slug, size and duration.
- **Pixabay** has no `orientation` filter. Orientation comes from `width` and `height`.
- **Pixabay is the only live footage source** (Pexels is not issuing API keys). So in Part 3, `rankFootage` must score Pixabay `tags` well; the Pexels URL slug is a secondary case. Search results are cached for 24 h (`cachedFootageSearch` in `composeBridge.ts`), so the same project gets the same hits between renders.
- **`EVAL.md` has no plan-stat columns yet** (shots/min, entropy, max run, still share, beat-cut %). Part 1 adds them from `computeStats` for every row: a few lines in `compose/eval/runEval.ts`.
- **Render time:** the baseline already costs 4.1–9.5 s per minute of video, against 1.8–2.4 s for legacy (HyperFrames is the slow part). Part 3 only reports render time; it is not a stop rule (TASK-075 owns speed).
- **068 is integrated:** `pickDirector` in `apps/server/src/services/composeBridge.ts` still returns `baselineDirector`. **Do not edit it.** TASK-070 §0 wires your directors in.
- **Where the directors go:** the `Director` and `DirectorInput` types live in the server (`apps/server/src/compose/director.ts`), because `DirectorInput.footage` is the server type `FootageHit`. So build the directors in **`apps/server/src/compose/director/`**, not in shared. Export `ruleDirector` and a factory `createLlmDirector(llm)`.
- **Pure helpers** with no server types (the number parser, the variety pass) may go in `packages/shared/src/compose/`.
- **Not Vietnamese-only.** The app targets any country the user picks, and `project.settings.language` holds the video language (default `vi`). So:
  - Everything language-specific (number words, ordinals such as `Thứ nhất` / `First`, contrast words such as `nhưng` / `but`, quote marks) lives in a small **language pack** keyed by the language code, in `packages/shared/src/compose/lang/`. Build `vi` and `en` in Part 1. Unit symbols and plain digits (`20%`, `2020`, `1.5`, `1,500`) work for every language.
  - An unknown language falls back to the digits-only parser, with no ordinal or contrast words. R1 and R2 still work; R3 and R6 simply do not fire.
  - Number-parsing tests: ≥ 12 for `vi` and ≥ 6 for `en`. Note that `1.500` is fifteen hundred in `vi` and one-point-five in `en`: the pack decides the decimal separator.
  - The LLM prompt says the video language. Part 2 templates use Be Vietnam Pro for Latin scripts and fall back to Noto Sans (installed with the system, or the font list in `assets/`) for other scripts. Do not download fonts in tests.

---

## 0. Token rules (all parts)

1. **Read only:**
   - this file;
   - `docs/compose/README.md` (the module map written by 067a);
   - `docs/tasks/TASK-067a.report.md`;
   - the files your part names.

   Never open a file over 300 lines whole: use `grep -n`, then `sed -n a,bp`. Do not read `apps/web/`, `docs/user-guide/` or other TASK guides.
2. **Trust the 067a code and its tests.** Do not refactor them.
   - If you find a bug in 067a, write a minimal fix only when it blocks your part. Otherwise list it under "067a issues" in the report.
   - Do not fix typecheck or lint problems outside your files; list them instead.
3. Run only your own tests (`npx vitest run <paths>`). Run the full `npm test` and `npm run typecheck` **once**, at the end of the part.
4. **Stop and report** after 3 failed attempts at the same test, or when you are about to add an npm dependency.
5. **The report** goes in `docs/tasks/TASK-067b-partN.report.md`, using the format in §4 (≤ 40 lines). No other summary.
6. **Do not write** DESIGN.md, user-guide pages or follow-up guides. Claude writes those from your report.

## 1. Hard rules (all parts)

- **Allowed files:**
  - `packages/shared/src/compose/**`, `apps/server/src/compose/**`, `apps/server/assets/compose/**`;
  - `apps/server/test/compose*.test.ts`, `docs/compose/EVAL.md`.
- **Git and paths:** no commit or push. No new npm dependency. No DB change. Do not touch `.env`, `.claude/`, `data/` or `scripts/`.
- **Tests:** no network, no real LLM. No real HyperFrames, except in the `VG_COMPOSE_EVAL=1` harness.
- **Protected project:** never render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- **Cost:**
  - ECO mode (rules only, 0 LLM calls) must give a good result on its own;
  - quality mode adds **at most 1 LLM call per video**;
  - no paid GPU, no paid API.
- **Interface** (fixed by 067a; do not change its shape):
  - `Director = { id; directScenes(inputs: DirectorInput[]): Promise<KindSpan[][]> }`;
  - `KindSpan = { kind, wordStart, wordEnd, reason, payload? }`;
  - `planProject` paces footage and still spans and clamps graphic spans to [1.5, 6] s.

---

## Part 1: the director (effort **high**)

**Files:** `compose/director.ts` (the baseline and its interface), `compose/schema.ts`, `compose/words.ts`, `packages/shared/src/formats/recipes.ts` (only the ids at lines 5–13).

**Build `ruleDirector` and `createLlmDirector(llm)`** in `apps/server/src/compose/director/` (see the facts at the top). They are pure; the LLM is injected as `llm(prompt) => Promise<string>`.

### A. Rules (ECO)

The output must be the same for the same input. The rule ids go into `reason`.

- **`R1-numbers`:** the scene states ≥ 2 comparable numbers → a `chart` span over the words that state them.
  - "Comparable" means the same unit, both percentages, or a series over years.
  - Parse number forms through the language pack. For `vi`: `1,5 triệu`, `1.500`, `20%`, `20 phần trăm`, `gấp 3 lần`, `năm 2020`, `nghìn/tỷ`. For `en`: `1.5 million`, `1,500`, `20 percent`, `3 times`, `in 2020`, `thousand/billion`.
  - The chart type is `line` for a series over time, `pie` when the shares add up to about 100 %, otherwise `bar`.
  - The payload is `{ title, labels, values, unit }`, taken from the text, with no invented data. When the labels are unclear, skip the rule.
- **`R2-hook`:** the first scene of the video, or the recipe `short_hook` → a `kinetic_text` span over the first ≤ 2.5 s of words. For 9:16 the first shot is ≤ 1.5 s.
- **`R3-list`:** the recipe `listicle`, or a scene that starts with an ordinal (`Thứ nhất`, `Số 1`, `1.`) → a short `kinetic_text` heading, then footage or still.
- **`R4-footage`:** there are footage hits and they match the scene → `footage`. **This is the default for spoken content.**
- **`R5-still`:** otherwise → `still`.
- **`R6-emphasis`:** a short punchline sentence (≤ 8 words, ending with `!`, or a contrast word such as `nhưng`, `thực ra`, `sự thật là`) may become `kinetic_text`, within the limits below.

**Variety pass** (after the rules; every item has a test):
- no more than 2 spans of the same kind in a row, counted across scene edges;
- when footage exists for ≥ 50 % of scenes, the `still` share is ≤ 40 % of the runtime;
- `kinetic_text` + `chart` together are ≤ 30 % of the runtime;
- no `kinetic_text` repeats the words the subtitle shows at the same moment for > 3 s (avoid the "subtitle twice" look).

### B. LLM (quality mode)

- **One call for the whole video.**
- **Prompt:**
  - the scene texts (trimmed);
  - the word counts;
  - the available kinds per scene (footage yes/no, stills count);
  - the rule result as a compact JSON.

  Ask the model only to **improve** the rule plan: `{sceneId, spans:[{kind, words:[start,end], payload?}]}`.
- **Validation:** check with zod and run the variety pass again. Any invalid scene falls back to the rule result, with a warning.
- **Payload safety:** chart payload numbers must appear in the scene text. Drop invented numbers.
- **Size:** the prompt is ≤ 2 000 tokens for 12 scenes. Write a test that measures it with a chars/4 estimate.

### Tests

- each rule;
- each variety constraint;
- the number parsing (≥ 12 cases for `vi`, ≥ 6 for `en`, and the digits-only fallback);
- LLM: invalid JSON → fallback;
- invented numbers dropped;
- the prompt size;
- determinism.

### Eval

Add a `rule` column and a `rule+llm(mock)` column to `EVAL.md`.
- **Targets:**
  - kind entropy ≥ 1.2 bits;
  - max run ≤ 2;
  - still share ≤ 0.4 where footage exists;
  - shots per minute 12–30 (16:9) or 18–40 (9:16).

---

## Part 2: templates that look professional (effort **medium**)

**Files:** `apps/server/assets/compose/*/index.html`, `compose/render/graphic.ts`, and one existing template for style reference: `apps/server/assets/motion/kinetic_word/index.html`.

**Redesign `kinetic_text`** with 3 styles:
- `bold`: big words, the emphasis word in `accentColor`, a scale pop on its word time;
- `typewriter`;
- `stack`: lines stack up one by one.

**Redesign `chart`:**
- `bar`: values count up, with labels;
- `line`: the line draws in over 0.8 s, the points pop;
- `pie`: segments sweep.

**Rules:**
- Font: Be Vietnam Pro, with a Noto Sans fallback for non-Latin scripts. Diacritics (Vietnamese and others) must never be clipped (line-height ≥ 1.25, no `overflow:hidden` on text boxes).
- **Subtitle safe zone:** keep the bottom 22 % (16:9) or 30 % (9:16) free of text, because subtitles are burned in there.
- **Safe margins:** 6 % on each side. For 9:16, also keep the right 12 % free (TikTok and Reels buttons).
- **Text fits automatically:** shrink the font so the longest line fits; at most 3 lines for 9:16 and 2 for 16:9.
- **Contrast:** text vs. background ≥ 4.5:1. If `brandColor` is too light, darken the background automatically.
- **Motion:** every animation finishes by `durationSec − 0.2`, and the last frame holds (no blank end frame).
- **Variety:** a `variant` variable (0–2) changes the layout and the background (gradient, subtle grain, shapes), so 10 videos in a row do not look identical. Choose it as `hash(projectId + shotId) % 3`.

**Check:** render each style for 16:9 and 9:16 through the eval harness. Save one PNG frame per style (the middle frame) to `docs/compose/samples/` and look at them yourself (Read the PNG). Fix what looks wrong. Report what you changed after looking.

---

## Part 3: footage that matches the meaning, plus final tuning (effort **medium**)

**Files:** `compose/composeService.ts` (the footage-fill step), `providers/footage/types.ts`, `compose/metrics.ts`.

**Build `rankFootage(sceneText, queries, hits, used): FootageHit[]`** (pure, in shared):
- **Score:**
  - the overlap between the hit tags or URL slug and the scene queries (English `visualQueries`);
  - orientation matches the aspect;
  - duration ≥ the shot length + 1 s;
  - resolution ≥ the target;
  - a penalty if the same author is used more than twice in the video;
  - hits already used in the video are excluded.
- **Choose `inSec`:** skip the first and last 0.5 s; spread `inSec` when one long clip covers 2 shots, so they show different parts.
- **When the hits score low** (below a threshold you set, and record): fall back to `still` for that span. Off-topic footage is worse than a still.

**Tuning:** run the eval harness. Adjust only these constants:
- the pacing bands;
- the cut cost weights;
- the variety limits;
- the ranking threshold.

The targets are the ones in Part 1. Write the final `compose` column and the render seconds per minute in `EVAL.md`.

Render time is **not** a stop condition here: TASK-075 owns render speed and graphic modes (after RESEARCH-075). Just report render seconds per minute of video next to the baseline, and do not optimise render speed in this part.

---

## 4. Report format (each part, ≤ 40 lines)

```
TASK-067b PART <n> REPORT
status: done | partial | stopped(<reason>)
files: <created/edited, dirs only>
tests: <n> new, all pass | full npm test ok|fail | typecheck ok|fail
eval: <the changed EVAL.md rows>
decisions: <bullets: constants chosen and why, ≤ 8>
067a issues: <bullets or none>
for TASK-068/070: <what integration or the next kinds must know, ≤ 6 bullets>
```
