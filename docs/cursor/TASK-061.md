# TASK-061 — Cursor guide (scene images: no repeated or near-identical images, watermark filter, a "best quality" visual mode that does not save cost)

Read `docs/cursor/README.md` first. Tests never use the network: mock every image provider, Brave, download and LLM call. Update the user guide, `featureMap` and `nhat-ky-thay-doi.md` (README rule 10).

No new npm dependencies. Image decoding uses `ffmpeg-static`, which is already a dependency. Schema changes go in `schema.ts`; then run `npx drizzle-kit generate` in `apps/server`.

**Order:** run after TASK-060. It builds on the relevance rules (`entities`, `lowRelevance`, `reasons`) and the vision-reject → web-search path from TASK-060 section 2. Both tasks edit `rank.ts` and `visualService.ts`, so do not run them at the same time.

## Why

The user sees the same image on several scenes. The user also wants the image search to give the best result, with no cost saving. The code was checked:

| # | Today | Problem |
|---|---|---|
| 1 | `assignDistinct` (`packages/shared/src/visuals/assign.ts`) goes scene by scene in order. When a scene has no unused candidate left, it falls back to `preferred.find(item => key !== previousKey) ?? preferred[0]`, an image already used by another scene. It only sets `reusedAcrossScenes: true`. | Repeats are allowed silently. The flag is not used to search again. |
| 2 | The assignment is greedy: scene 1 takes its best image even when that image is the only good one for scene 5. | Later scenes run out of candidates and reuse earlier images. |
| 3 | When a scene has no usable candidate, `findNeighbourWithImage` copies the image of a nearby scene (`VISUAL_REUSED_NEIGHBOUR`, about line 744 in `visualService.ts`). | Two scenes next to each other show the same image. That is the most visible repeat. |
| 4 | `dedupeCandidates` and `dedupeKey` compare normalised URLs and provider ids only. The file has `TODO(TASK-012): add perceptual-hash matching`. | The same picture from Wikimedia and from a Brave result, or as a resized or cropped copy, counts as two different images. |
| 5 | `sameSeries` blocks only two images in a row with the same author and same title. | Shots of the same photo session, or the same frame in a different size, still repeat. |
| 6 | Watermarks: `rank.ts` gives a 4% weight to a stock-site domain list. Brave, crawl and Openverse results are `UNKNOWN` and get no penalty. The vision check caps the score at 3 when it sees a watermark, but that check is off in every budget mode except MAX. | A watermarked image can win when vision check is off. Even when vision sees one, the image is only scored lower, not removed. |
| 7 | Search effort follows the budget mode: `visualSearchBreadth` 8 or 16, `webImageSearch` 0/3/8/999, `visionCheck` only in MAX, `visionRetryRounds` up to 2. | The user wants the best images and accepts the cost. Today they must switch the whole project to MAX, which also changes every other stage. |

Goal: in one video, no scene shows the same image or a near-identical copy of another scene's image, unless the user picked that on purpose. No chosen image has a visible watermark. The visual stage can run at full effort no matter which budget mode the rest of the project uses.

## Mã nguồn mở có sẵn

| Project | Licence | Use |
|---|---|---|
| dHash ("difference hash"), from Neal Krawetz's "Kind of Like That" article | algorithm, no code to copy | 64-bit perceptual hash: scale to 9×8 greyscale, compare each pixel with its right neighbour. Write it yourself (about 30 lines). |
| [blockhash-js](https://github.com/commonsmachinery/blockhash-js) | MIT | Reference for a second, crop-tolerant hash and for Hamming-distance thresholds. Read only. Do not add it as a dependency. |
| [imagehash (Python)](https://github.com/JohannesBuchner/imagehash) | BSD-2-Clause | Reference for the dHash/pHash steps and typical thresholds (≤ 5 same image, ≤ 10 near-duplicate). Read only. |
| [FFmpeg](https://ffmpeg.org/) through `ffmpeg-static` | LGPL/GPL binary, already used for render | Decode any image to raw greyscale: `ffmpeg -i in -vf scale=9:8:flags=area,format=gray -f rawvideo -`. Use the same pipe for the 32×32 pHash variant if you add it. |
| Hungarian algorithm ([munkres-js](https://github.com/addaleax/munkres-js)) | Apache-2.0 | Reference for the optimal scene ↔ image assignment in section 2. Write a small typed version in `packages/shared/src/visuals/assignOptimal.ts`. If you copy code, keep the Apache-2.0 notice and attribution in the file header. |

If you find a better project, report it (README rule 11).

## Rules for this task

- Never approve gates or render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- The copyrighted-stills setting from TASK-060 still defaults to off. "Best quality" does not turn it on.
- Hash images only from bytes the app already downloads or from the preview the provider returns. Do not download full-size originals just to hash them. Use the provider's preview or thumbnail URL.
- A user-locked image (`lockedCandidate`) is never changed by this task's code, even when it repeats.

## 1. Perceptual hash and duplicate detection

- New `packages/shared/src/visuals/phash.ts`: pure helpers `dHashFromGray(pixels: Uint8Array, width = 9, height = 8): bigint`, `hamming(a, b): number`, `hashToHex` and `hexToHash`.
- New `apps/server/src/services/imageHash.ts`: `hashImage(pathOrBuffer)` runs `ffmpeg-static` with the filter above, returns the hash as hex, and has a 10-second timeout. It also computes a second hash on a 10%-cropped centre, so a cropped copy still matches.
- Store `phash` (and `phashCenter`) on the candidate row. Add the columns in `schema.ts` and generate the migration. Compute them when the preview is downloaded for ranking or vision, in the worker, with at most 4 at a time.
- Thresholds, as named constants in shared:
  - **same image**: Hamming ≤ 6 on either hash;
  - **near-duplicate**: Hamming 7–12.
- `dedupeCandidates` keeps today's URL and id keys, and also merges candidates whose hashes are "same image". It keeps the one with the higher resolution and the better licence, and records `alsoFoundAt: [{ provider, sourceUrl }]`.
- Remove the `TODO(TASK-012)` comment.
- Candidates without a hash (download failed) fall back to today's URL keys. They are never treated as unique on purpose.

## 2. Assignment with no repeats

Replace the greedy loop in `assignDistinct` with a global assignment. Keep the function name and return type, so callers do not change.

- Build a cost matrix of scenes × candidates from all scenes' ranked lists. Cost = `1 − finalScore` (the combined code, rerank and vision score). Same-image candidates (by hash or key) are one column, so one image can go to only one scene.
- Solve with the Hungarian algorithm (`assignOptimal.ts`). For large projects (more than 60 scenes × 40 candidates), solve in windows of 20 scenes with the used images carried forward, and note it in the stage summary.
- Near-duplicates: add a penalty of `+0.25` cost when a candidate is a near-duplicate of an image assigned to a scene within 3 positions. Penalise `sameSeries` pairs within 3 positions the same way (today it only checks the scene right before).
- Locked candidates are fixed first and removed from the pool.
- A scene with no unused, relevant candidate gets `candidate: null` and `needsMoreSearch: true`. It never silently reuses an image. Section 3 handles it.
- `reusedAcrossScenes` stays in the type. It is true only when the user locked a repeat or after section 3's last step.

## 3. Search more before any repeat

In `visualService.ts`, after assignment, collect scenes with `needsMoreSearch`, scenes where TASK-060 found low relevance, and scenes whose image vision rejected. For each, in this order, stop at the first round that gives a relevant, unused, watermark-free image:

1. Run the scene's `alternatives` queries that have not run yet, on every enabled provider, with the full breadth (section 5).
2. Ask the LLM for 3 new queries for the scene. Give it the narration, the topic `entities`, the queries already tried, and short descriptions of images already used in the video, so it looks for something different. Reuse the existing query-assist call and schema; do not add a new prompt family.
3. Web search (Brave, then Gemini grounding), with the TASK-060 relevance and licence rules.
4. Re-run the assignment for the affected scenes only, with all images used elsewhere excluded.
5. If there is still nothing:
   - first choice: a different crop of an image used **far away** (at least 5 scenes apart): a Ken Burns crop that covers a different region, marked `reuse: "crop"`;
   - otherwise leave the scene without an image, add a "Cần bạn" item (TASK-059) "Cảnh N chưa có ảnh riêng", and stop the stage at the visual gate. In AUTO mode, use a title card made from the scene label instead of a repeated photo, and report it.

Remove the neighbour copy (`findNeighbourWithImage` / `VISUAL_REUSED_NEIGHBOUR`) from the automatic path. Keep the function only for the user's manual "Dùng ảnh của cảnh khác" action, if the UI has one.

Write each scene's rounds, queries and result to the auto-report (`VISUAL_EXTRA_SEARCH`), so the user can see why an image was chosen.

## 4. Watermark filter

- Treat watermarks as a hard reject, not a score:
  - a vision issue `watermark` or `text_overlay` (when the overlay is a site name or a URL) removes the candidate from the pool for that project;
  - a candidate with `watermark: "SUSPECTED"` is removed;
  - `UNKNOWN` candidates (Brave, crawl, Openverse, any web source) must pass a vision check before they can be assigned, in every visual mode. This one check runs even when the budget mode has `visionCheck` off, because an unchecked web image is the main way a watermark gets in.
- Extend `WATERMARK_DOMAINS` into a shared list `STOCK_WATERMARK_HOSTS`. Add `alamy`, `bigstockphoto`, `canstockphoto`, `stock.adobe`, `pond5`, `vectorstock`, `freepik` (premium previews), `agefotostock`, `superstock`, `mediastorehouse`, `pixta`, `photodune`, `storyblocks`, `wirestock`, `ftcdn.net` (Fotolia/Adobe CDN) and `gettyimages`/`istockphoto` CDN hosts (`media.gettyimages.com`, `media.istockphoto.com`). Match on the image host and on the source page host. A match sets `watermark: "SUSPECTED"`, which means removed.
- Add a cheap code check before vision: an image URL whose path contains `/comp/`, `watermark`, `wm_` or `preview` on a known stock host is `SUSPECTED`.
- Vision prompt: add one line asking to report any logo, site name or URL drawn over the image, including faint diagonal ones. Keep the existing JSON schema; `watermark` is already an allowed issue.
- The visual review UI shows "Đã loại vì có watermark" in the rejected list with the reason. The user can still pick the image by hand, with a warning.

## 5. Visual quality setting ("Tốt nhất")

Add a profile and project setting `visuals.quality: "budget" | "best"`. The project setting overrides the profile. **Default for new profiles: `"best"`**, because the user asked for quality first. Existing profiles keep `"budget"` until the user changes it; the settings page offers a one-click "Dùng chế độ Tốt nhất cho mọi hồ sơ".

`"budget"` keeps today's behaviour from the budget mode. `"best"` sets the visual stage's features, whatever the project's budget mode is:

| Feature | Best |
|---|---|
| `visualSearchBreadth` | 32 per query (new allowed value; providers that cap lower return what they can) |
| Providers | every enabled image provider, not the mode's subset |
| `sceneQueryAssist`, `altQueryAssist` | on |
| `semanticImageRerank` | on |
| `visionCheck` | on, for the top 6 candidates per scene (not only the winner) |
| `visionThreshold` | 7 |
| `visionRetryRounds` | 3 |
| `webImageSearch` | every scene that needs it (999) |
| Section 3 extra search | all rounds |
| Vision model | the best vision model the route allows (TASK-060 capability data); never a model marked `vision: false` |

- Add `"best"` handling in one place: a helper `visualFeaturesFor(budgetFeatures, visualsQuality)` in `packages/shared/src/budget/modes.ts`. `visualService.ts` reads features only through it.
- Cost: "best" still counts every call in usage and in the TASK-059 budget tracker. It does not stop for the budget mode's soft caps. If the user set a hard monthly limit (TASK-059), that limit still wins. When it is hit, the stage pauses with `AUTONOMY_BUDGET_WAIT` and a "Cần bạn" item, not a silent downgrade.
- The cost estimate on the project page shows the visual stage's extra cost for "best" before the run.
- The assistant and operator may switch a project to `"best"` (risk `write`). Switching to `"budget"` is allowed too. Neither may change the hard monthly limit.

## 6. Fix existing projects

- `POST /api/projects/:id/visuals/dedupe` (and tool `dedupe_scene_visuals`, risk `write`): hash the current images, find repeats and near-duplicates, and run section 3 for the later scene of each pair. Skip locked images. Never run on a project that is rendering, or on `56374fb2-…` while it is rendering.
- Web: a banner on the visuals step when repeats exist: "3 cảnh đang dùng ảnh trùng — Tìm ảnh khác". It lists the pairs with thumbnails.
- The render pre-check (`renderVerify`) adds a warning when two scenes in the final timeline have the same image by hash, unless one is locked.

## 7. Tests

- `phash.test.ts`: identical pixels give distance 0; a resized copy is ≤ 6 (use small fixed pixel arrays, no files); a different image is > 12.
- `imageHash` server test with a tiny PNG fixture in `apps/server/test/fixtures/` (generate it in the test setup with ffmpeg if the fixture would be large). Skip with a clear message if `ffmpeg-static` has no binary for the platform.
- `assign.test.ts`:
  - the greedy-failure case (scene 1's top image is scene 5's only good one) now gives every scene a distinct image;
  - same-image candidates from two providers can't go to two scenes;
  - near-duplicates within 3 scenes are avoided when another option exists;
  - locked repeats stay;
  - not enough images gives `needsMoreSearch`, not a repeat.
- `visualService` tests with mocked providers:
  - section 3's rounds run in order and stop at the first success;
  - the neighbour copy no longer happens automatically;
  - the AUTO title card fallback;
  - the "Cần bạn" item is created once.
- Watermark tests:
  - stock host and `/comp/` URL are removed;
  - an `UNKNOWN` web image is vision-checked even in ECO;
  - a vision `watermark` issue removes the candidate.
- `visualFeaturesFor` tests: "best" overrides each field in ECO, BALANCED and MAX; the TASK-059 hard limit still pauses.

## 8. Live check

Use a new test project (not `56374fb2-…`), mocked or free providers only, and no real paid keys.

1. Run a 20-scene project with `visuals.quality: "best"`. Count repeats by hash in the final selection: 0, or each one listed with its reason.
2. Copy one image to two scenes by hand through the API, then run "Tìm ảnh khác". The later scene gets a new image.
3. Put a stock-host candidate in the mock provider and see it in the rejected list as "watermark".

Write the counts and what you saw in `docs/tasks/TASK-061.report.md`.

## 9. User guide

- Visuals page:
  - why images no longer repeat;
  - what "Tìm ảnh khác" does;
  - the watermark rule;
  - the "Tốt nhất" setting and its cost note.
- Settings page: the profile default and the one-click switch.
- `featureMap` entries for the new route, banner and setting; `nhat-ky-thay-doi.md` line.

## Done

- [ ] Candidates have perceptual hashes; same images across providers or sizes merge.
- [ ] Assignment is global, with no automatic repeats; the neighbour copy is gone from the automatic path.
- [ ] Missing images trigger extra search rounds before any fallback; fallbacks are reported.
- [ ] Watermarked, suspected and unchecked web images are never auto-picked.
- [ ] `visuals.quality: "best"` runs the full visual pipeline in any budget mode; it is counted, and the hard limit still applies.
- [ ] Existing projects can be deduped; render pre-check warns on repeats.
- [ ] All workspaces' tests and typecheck pass; live check in the report; user guide updated.
- [ ] No commit, no push, no edits to `.env`, `.claude/`, `data/`, `scripts/`; no new dependencies.
