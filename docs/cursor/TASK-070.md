# TASK-070 — Cursor guide (compose engine, part 4: more shot kinds, shot editing, learning from retention)

**Scope:**
- add 4 shot kinds;
- let the user edit the shot plan;
- feed the shot mix into the learning loop, so the system learns which mix keeps viewers.

Read `docs/cursor/README.md`, `docs/compose/README.md`, and the reports `docs/tasks/TASK-067b-part1..3.report.md` and `TASK-068.report.md` (the "for TASK-068/070" lines first).

**Order:** after TASK-067b (all 3 parts), TASK-068 and TASK-071 (the `map` kind picks the admin-1 file from `project.settings.market`). Claude reviews this guide against those reports before you start. If a fact below differs from the reports, the reports win: write the difference in your report.

**Cursor model:** grok-4.7-medium.

**Rules:**
- no new npm dependency;
- tests have no network and no real LLM or HyperFrames;
- schema changes only through `npx drizzle-kit generate`;
- never render or approve on project `56374fb2-54cf-48ff-9441-2e6c653295d4`;
- do not commit or push;
- update the user guide and `featureMap`.

---

## Mã nguồn mở có sẵn

| Project | Licence | Use |
|---|---|---|
| Natural Earth admin-0 (countries) + admin-1 (provinces/states) | public domain | the `map` kind: simplify once to small GeoJSON files: `assets/compose/map/world.json` (countries, ≤ 300 KB) and admin-1 files only for the markets in use (start with `vn.json`, `us.json`), each ≤ 300 KB, with a README saying where they came from. Place names come in the video language and in English |
| HyperFrames, GSAP (installed) | Apache-2.0 / standard | the templates for the new kinds |
| the existing web crawl (`providers/images/webCrawl.ts`) | ours | the `screen` kind is postponed (see §1) |

Download the Natural Earth file **once**, by hand, during development. Tests use the committed small file, with no network.

---

## 0. Wire in the 067b directors, and a real live check (do this first)

**The wiring** (`apps/server/src/services/composeBridge.ts`):
- Today `pickDirector(mode)` always returns `baselineDirector`.
- Pass it `{ ruleDirector, llmDirector: createLlmDirector(llm) }` from `apps/server/src/compose/director/`.
- `llm` goes through the normal routed LLM path, so usage and cost are counted. Grep how `scriptExecutor` calls `generateRoutedStructured`, and use the stage name `COMPOSE` or the closest existing usage label.
- ECO mode never calls it.
- **Tests:**
  - `eco` → `rule`;
  - `quality` → `llm`, with a fake LLM, and exactly 1 call per render;
  - an ECO project with `quality` → `rule`.
- Update the expectations in `test/composeRender.test.ts` ("treats a missing engine as legacy").
- **From the 067b part 3 report** (`docs/tasks/TASK-067b-part3.report.md`, "Suggestions"), do these too:
  - pass `targetShortSide: shortSide` to `planProject` so the plan knows the output size;
  - raise the footage search `limit` from 6 to about 12, so `rankFootage` has more to choose from;
  - log `footageRelevance` for the chosen and the dropped clips in the plan report;
  - a scene with no matching footage now becomes one long still: give it a second image, or a graphic if `composeGraphics` allows (TASK-075);
  - `FOOTAGE_MIN_SCORE` (0.45) was tuned on test tags with a thin margin (0.43 vs 0.47). In the live check, list each footage clip's score and say whether any good clip was dropped or bad one kept.
  - list `packages/shared/src/compose/footage.ts` and `planEval` in `docs/compose/README.md`.

**The live check:** the 068 check was only 3 s at 160×90 with no footage, so it proved little.
1. Check through `AppConfig` whether `PIXABAY_API_KEY` is set (since 2026-11-10 it is; Claude checked it live. Pexels is not issuing keys, so `PEXELS_API_KEY` is normally empty and `searchFootage` skips it). **Never print the values.** Search results are cached for 24 h in `data/footage/search-cache/` (`cachedFootageSearch`), as Pixabay's terms ask.
2. **If one is set:** render a new test project (not `56374fb2-…`) at 1280×720, 45–90 s, as `legacy` and as `compose` (`eco`). Report:
   - render seconds;
   - shots/min, still share, footage share, beat-cut %;
   - freeze and black;
   - the number of footage files downloaded. It must equal the number of distinct clips in the plan.
3. Look at 3 frames.
4. **If neither key is set:** write that in the report, and stop this step.

## 1. New shot kinds

Add each kind with the 5 steps of "how to add a shot kind" in `docs/compose/README.md` or DESIGN.md: schema → director rule → template → metric → test.

| kind | rule (it goes into the 067b rule director, with a new rule id) | template |
|---|---|---|
| `map` | the scene names ≥ 1 country, or a province/state/city of a market that has an admin-1 file, and the recipe is `news_recap` or `explainer` | the map zooms to the place, with a pin and a label |
| `compare` | a scene with a compare phrase from the 067b language pack (`vi`: "so với", "khác với", "trước … sau"; `en`: "compared to", "versus", "before … after"), or `myth_vs_fact` | split screen, left vs right, with 2 labels |
| `quote_full` | the scene contains a quote in quotation marks ≥ 6 words, with a speaker | a big quote and the speaker's name |
| `list_full` | `listicle` and `how_to`: a scene with ≥ 3 short items | the items appear on their word times |

- **The variety limits still hold:** graphic kinds (`kinetic_text`, `chart`, `map`, `compare`, `quote_full`, `list_full`) together are ≤ 30 % of the runtime.
- **`screen`** (scrolling a web page screenshot) is **postponed**: it needs a licensing decision about showing other sites.
- **The template rules from 067b part 2 apply:** the subtitle safe zone, the 9:16 right margin, diacritics and the font fallback, contrast, and the `variant` variable.

## 2. Shot editing (web + API)

On the "Cảnh quay" panel from TASK-068, each shot gets:
- **Đổi kiểu:** pick another kind that is valid for that span;
- **Đổi footage:** the next ranked hit;
- **Khoá:** a locked shot is kept on the next re-plan.

- **API:** `PATCH /api/projects/:id/compose-plan/shots/:shotId` with `{ kind? , reroll?: true, locked? }`.
  - It validates with `validateScenePlan` and saves the plan JSON.
  - It marks only that scene's clip as stale (through the clip hash).
- **Re-plan:** keep locked shots, and redo the rest.
- **Autopilot:** any edit is a user touch (`markUserTouch` from TASK-059/066).
- **Tests:** swap, reroll, lock kept after re-plan, an invalid swap → 400.

## 3. Learning loop

- **When a video is published,** copy `renders.report.compose.stats` into the publication's learning data. Find where the learning rows are built (`apps/server/src/learning/loadRows.ts`, `features.ts` `buildFeatureRows` at line 168).
- **New features:**
  - `engine`;
  - `shotsPerMin`;
  - `stillShare`;
  - `graphicShare`;
  - `beatCutPct`;
  - `hookShotKind` (the kind of the first shot);
  - `kindEntropyBits`.
- **The insight stats** (`computeInsightStats`, line 273) compare the top and bottom quarters by `averageViewPercentage` on these features. The weekly insight text may then say, for example, "video có ≥ 20 cảnh/phút giữ người xem tốt hơn".
- **Follow the existing rule:** recommendations change settings only through the existing proposal flow, never directly.
- **Tests:** feature rows include the stats; `null` for legacy videos; the insights handle a mix.
- **Not in scope:** the per-second retention curve from YouTube Analytics. It needs a new sync endpoint; Claude will decide on it later.

## 4. User guide

- Update the compose page with the new kinds and the shot editing.
- Add one entry to `nhat-ky-thay-doi.md`.
- Update `featureMap`.

## Done checklist

- [ ] The 4 kinds, each with its rule, template, metric and tests.
- [ ] Shot editing and re-plan with locks.
- [ ] The learning features and insights.
- [ ] `npm run typecheck` and `npm test` pass in every workspace. The eval harness (`VG_COMPOSE_EVAL=1`) still runs; add the new kinds to `EVAL.md`.
- [ ] Report `docs/tasks/TASK-070.report.md`, and an empty file `docs/tasks/TASK-070.done`.
