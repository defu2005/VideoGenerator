# BUGFIX-VISION-SCHEMA — One bad vision answer must not kill VISUAL_SEARCH 🩹

**Who:** Cursor, model `composer-2.5`. Small, well-located fix with clear tests. **Size:** S. **Order:** any time. It does not overlap TASK-114 (auth) or TASK-117 (`deploy/`). **No DB change. No new dependency.**

Source: Hermes report `PROPOSALS_AND_BUGS.md` entry 10 (`BUG-VG-VISION-SCHEMA-004`), Berserk project `1ef6de1f-cf84-4552-8aed-8958f290bc0e`, job `9feb37c1…`.

Read first:
- `docs/cursor/README.md`
- `packages/shared/src/schemas/vision.ts`: `VisionIssueSchema`, `VisionCheckBatchSchema`
- `apps/server/src/providers/llm/structured.ts`: `generateStructured`. Look at the cache parse (~line 84), `z.toJSONSchema` (~line 114), `validateOutput` (~line 865) and the repair loop (~line 204)
- `apps/server/src/services/visionVerify.ts`: `verifySceneVision`, its inner `runCheck` (~line 115), and the consistency check (~line 272), which already has the try/catch pattern you need
- `apps/server/src/services/visualService.ts`: the call to `verifySceneVision` (~line 1914) and the single-candidate check (~line 2925)
- `packages/shared/src/visuals/sceneQuery.ts`: the `vision_missing` attention reason (~line 133)
- `apps/server/test/visionMax.test.ts`: existing vision tests and mocks

## Why

In MAX, VISUAL_SEARCH ran to 70% ("Vision-checking candidate images") and then FAILED at attempt 1 with `LLM_INVALID_OUTPUT`. The vision model itself worked, for example "Guts in Berserker armor holding the Dragon Slayer", fit 5. Two problems turned one off-format answer into a dead stage:

1. **The parse is too strict.** `VisionCheckBatchSchema` is `.strict()` at every level, and `issues` is a closed enum of 8 values. If the model writes an issue like `"blurry"` or `"fan_art"`, or adds a field like `"reason"` or `"confidence"`, the whole batch fails. One repair attempt often repeats the same word.
2. **No guard around the batch call.** `runCheck` calls `generateRoutedStructured` with no try/catch. Alt queries, rerank, vision research and the consistency check all degrade gracefully. Vision check does not, so its error escapes and fails the stage. `LLM_INVALID_OUTPUT` is non-retryable, so the worker does not try again.

The relevance gate (TASK-077) already handles a candidate that has no vision result: in MAX it gets `vision_missing`, needs your attention, and is not auto-rendered. So the safe behaviour is: skip the bad batch, keep the stage running, and let the gate stop those scenes.

## What to do

### 1. Lenient parse, strict wire schema

The JSON schema sent to the provider (`z.toJSONSchema(input.schema)`) must stay exactly as it is now. Do **not** put `z.preprocess`/`transform` into `VisionCheckBatchSchema`. `toJSONSchema` cannot represent a transform: it would throw, `jsonSchema` would become `undefined`, and the provider would lose structured output for every vision call.

Instead, add an optional normalize step to `generateStructured` (and pass it through `generateRoutedStructured`):

```ts
/** Runs on the extracted JSON before schema.safeParse, at every parse point. */
normalize?: (raw: unknown) => unknown;
```

- Apply it at **all three** parse points: the cache hit, the first validation, and each repair validation. Otherwise a cached raw answer fails later with "Cached LLM output no longer matches its schema".
- When `normalize` is not set, behaviour is unchanged. Every other caller stays as it is.

Then add a pure `normalizeVisionCheckBatch(raw)` next to the schema in `packages/shared/src/schemas/vision.ts` (or `packages/shared/src/visuals/`) and export it:
- Keep only these keys on each image: `label`, `fit`, `depicts`, `issues`, `cropOk`, `subject`. Drop unknown keys on the image and at the top level.
- `issues`:
  - lower-case and trim each value, and turn spaces and `-` into `_`;
  - map obvious synonyms with a small table, for example:
    - `blurry`, `blur`, `pixelated`, `low_resolution`, `low_res` → `low_quality`
    - `irrelevant`, `off_topic`, `unrelated`, `wrong_character` → `wrong_subject`
    - `logo` → `logo_only`
    - `text`, `caption`, `subtitle` → `text_overlay`
    - `watermarked` → `watermark`
    - `anachronism` → `wrong_era`
  - drop anything still not in `VisionIssueSchema`, and remove duplicates;
  - if `issues` is missing or not an array, use `[]`.
- `fit`: accept a numeric string (`"7"`), and clamp to 0–10. If it is missing or not a number, leave it as it is, so the schema still rejects the image.
- `cropOk`: accept `"true"`/`"false"` strings.
- Leave anything else to the schema. Do not invent values the model did not give.
- Return a count of dropped issue words. Log it once per call at `debug`, and at `warn` when it is not 0, so new words show up and can be added to the table.

Use `normalize: normalizeVisionCheckBatch` at both `VisionCheckBatchSchema` call sites: `runCheck` in `visionVerify.ts` and the single-candidate check in `visualService.ts` (~2925).

Do not loosen `VisionCheckSchema` (the stored record, parsed at ~2782). Stored data must stay clean.

### 2. Guard `runCheck`

In `verifySceneVision`'s `runCheck`:
- Wrap the `generateRoutedStructured` call.
- On `LlmError` with code `LLM_INVALID_OUTPUT` or `LLM_OUTPUT_TRUNCATED`:
  - If the batch had more than one image, retry **once**, one image per call, same prompt builder with a single label. A single image still failing is skipped.
  - If the batch had one image, skip it.
  - A skipped image gets no entry in `checks`/`scores`. Do not write a fake `VisionCheck`, and do not write fit 0.
- Any other error (abort, auth, budget, `VISION_PROVIDER_REQUIRED`, network after the provider's own retries) still throws as today. Do **not** swallow auth failures: a broken key must fail the stage clearly instead of turning every scene into `vision_missing`.
- Log at `warn` with the scene id, batch size, error code and how many images were skipped.
- Add a `visionBatchFailures` count (batches that failed) and a `visionSkipped` count (images left without a result) to the usage or result object that `verifySceneVision` returns. Add both to the VISUAL_SEARCH stage summary next to the existing vision counts, for example "Vision: 3 ảnh không đọc được kết quả, cần bạn xem". The UI only needs the text that already shows the summary. No new UI work.

Check the retry loop after `runCheck` (`while (best.fit !== null && best.fit < threshold …)`): when every candidate was skipped, `best.fit` is `null` and the loop must not run. Add a test for that case so it can never become an endless search again (see BUG-VG-VISION-PATH-003).

### 3. Prompt

`buildVisionCheckPrompt` already lists the 8 issue values. Make it stricter and shorter:
- Use exactly these issue words.
- Return no other fields.
- Put any other problem into `depicts` as a short phrase.

Bump `schemaVersion` for the vision check from `"1"` to `"2"` at both call sites, so cached entries from the old prompt are not reused.

### 4. Single-candidate check (`visualService.ts` ~2925)

It already has a try. With `normalize` in place, nothing else is needed. Just make sure an `LLM_INVALID_OUTPUT` there still reaches the user as the existing Vietnamese error, and does not become a 500.

## Open-source

Nothing to add. This is the "lenient input, strict output" pattern for LLM JSON that libraries such as `instructor` and the Vercel AI SDK `experimental_repairText` use. We already have a repair loop; the missing piece is a cheap, deterministic normalize before it. Do not add a dependency.

## Tests (no network, no real LLM)

In `packages/shared`:
- `normalizeVisionCheckBatch`:
  - unknown issue dropped;
  - synonyms mapped;
  - duplicates removed;
  - extra keys removed at both levels;
  - `"7"` → 7, 12 → 10, -1 → 0;
  - missing `fit` stays missing, so the schema rejects it;
  - non-array `issues` → `[]`.
- A normalized object passes `VisionCheckBatchSchema`.
- `z.toJSONSchema(VisionCheckBatchSchema)` still succeeds and still has the issue enum. This guards the wire schema.

In `apps/server` (mock provider):
- Model returns `issues: ["blurry", "fan_art"]` plus `reason`: the batch parses, the result has `low_quality` only, and there is no repair call.
- Model returns invalid JSON for a 3-image batch twice (first answer and repair), then valid single-image answers: there are 3 single calls, and all 3 images get results.
- Single calls also fail: the stage finishes (not FAILED), the scene's selection has attention reason `vision_missing`, the summary shows the skipped count, and the retry/search loop ran 0 extra rounds.
- Auth error (`LLM_AUTH`) from the vision provider: the stage still fails with that code, exactly as today.
- A cache hit holding an old raw answer with an extra issue word: it parses through `normalize` instead of throwing.

## Rules

- No commit or push. No new npm dependency. No migration.
- Do not touch `.env`, `.claude/`, `data/`, `scripts/`, `deploy/` (TASK-117), auth or user code (TASK-114), `apps/server/assets/compose/**`, `packages/shared/src/style/**`.
- Do not change the relevance gate rules in `sceneQuery.ts`. Reuse `vision_missing` as it is.
- Do not make `LLM_INVALID_OUTPUT` retryable globally. Do not change `shouldFallback` in `structured.ts`.
- Tests: no network, no real LLM. Never render or approve gates on project `56374fb2-54cf-48ff-9441-2e6c653295d4`. Do not re-run VISUAL_SEARCH on the Berserk project yourself; the user does that after review.

## Done

- `npm run typecheck` at the root. `npm test` in `packages/shared` and `apps/server`. List any failure outside your area, with its file.
- Add one line to `docs/user-guide/nhat-ky-thay-doi.md`.
- Write `docs/tasks/BUGFIX-VISION-SCHEMA.report.md` in Vietnamese, at most 40 lines:
  - what changed, file by file
  - the synonym table you used
  - how a failed batch now shows up in the stage summary
  - test results
- Then create the empty `docs/tasks/BUGFIX-VISION-SCHEMA.done`.
