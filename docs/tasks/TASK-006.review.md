# TASK-006 Review (by Architect)

Verdict: **Fixes required.** Checks pass (typecheck, build, 286/286 tests, migration `0006_visuals` generated, drizzle-kit no changes, audit 0, no new deps). The code follows the spec structure, but a **full-size live run** shows the ranking picks irrelevant images and the stage is far too slow. The report's live sample (2 scenes/project) was too small to show this.

## Live run (architect, real Wikimedia + Openverse, mock LLM, BALANCED)
Real Copilot-written AlphaGo script (`packages/shared/test/fixtures/copilot-merged-story-vi.json`), TikTok vi, 28 scenes:
- `VISUAL_SEARCH DONE in 690 s` (11.5 min) — "28 scenes · 250 candidates · cache hits 263 · LLM calls 1".
- 28/28 selected, but most are **irrelevant**:
  - #0 "Lee Sedol AlphaGo match Seoul 2016" → Openverse "Dinosaur Adventure" (keyword 0.00, wins on resolution + aspect).
  - #8 "AlphaGo Lee Sedol game 2 move 37 Go board" → Wikimedia "Stream Line.JPG" (keyword 0.00, total 0.65).
  - #18–#27 "AlphaGo Lee Sedol final game 2016 …" → Vietnamese map "Trích bản đồ tỷ lệ 1-25.000 con đê…" and province logos. They only match the Vietnamese `visualNotes` words, and came from Vietnamese fallback queries.
- 5 selected images are shared between scenes (some because scenes had only 2 candidates).
- Root causes:
  1. A candidate with **no keyword match can still score 0.65**, because resolution, aspect and license dominate.
  2. Vietnamese `visualNotes` are used for keyword terms and for fallback queries.
  3. Variant queries (`"… 2016 archival photo"`) are sent to the search engines as-is, which hurts results.
  4. Long, specific queries return nothing relevant on Wikimedia (AND semantics), and there is no simplification ladder.
  5. Providers are called sequentially, and Openverse is capped at 20 requests/min.
- Progress reporting works (`Searching visuals: scene 16/28`).

## Required fixes (TASK-006-FIX)

### F1 — MUST: relevance first
- **Keyword terms:** use the query that found the candidate plus the scene's base primary query. Use `visualNotes` terms **only when `settings.language` is `en`**.
- **Provider position:** store each result's position in the provider response as `providerPosition = 1 - index / perPage` and add it as a ranking component.
- **New weights (sum 1):**
  - keyword 0.35
  - providerPosition 0.15
  - resolution 0.15
  - aspect 0.15
  - license 0.10
  - watermark 0.05
  - fileType 0.05
- **Relevance tier:** sort first by `keyword > 0`, then by score. Candidates with `keyword === 0` get `scoreBreakdown.lowRelevance = true`. They are still stored and still shown.
- **Assignment:** `assignDistinct` prefers relevant candidates. If a scene has no relevant candidate, still select the best one, but mark the scene `lowRelevance: true` in `GET /visuals`. Add `summary.lowRelevance`. SceneCard shows an amber "Ít liên quan — nên chọn lại" badge.

### F2 — MUST: code query ladder (before any LLM)
Per scene, try queries in order. Stop when the scene has **≥ 8 relevant** candidates (keyword > 0) after dedupe.
1. **Base primary:** strip the TASK-005 variant modifiers (`close-up`, `wide shot`, `archival photo`, `detail`, `portrait`, `illustration`). Variant scenes **never** send the modifier text to a provider. They reuse the base query results (cache) and rely on `assignDistinct` for a different image.
2. **Alternatives,** also with modifiers stripped.
3. **Simplified primary:** remove numbers, years and generic words (`match, game, move, final, photo, image, close up, exterior, analysis, press, conference, scene, view, shot`). Keep at least 2 terms.
4. **Proper-noun phrases:** runs of Capitalized/CamelCase tokens from the primary and alternatives (e.g. `Lee Sedol`, `AlphaGo`, `Seoul`, `DeepMind`). Try the first two joined (`Lee Sedol AlphaGo`), then each alone.
5. **Section primary** (base).

Never build queries from `visualNotes` when the language is not `en`. `altQueryAssist` triggers only when a scene still has **< 3 relevant** candidates after the ladder.

### F3 — MUST: performance
Target: the 28-scene fixture project, uncached, finishes in **≤ 180 s**. Re-run with no changes: 0 requests.
- Query enabled providers **concurrently** for the same query (`Promise.all`; each provider keeps its own rate limiter).
- Openverse is queried only for the **first 2 ladder steps** of a scene, and only while the scene has < 8 relevant candidates.
- **SHOULD:** optional `OPENVERSE_CLIENT_ID` / `OPENVERSE_CLIENT_SECRET`. When set, get a token via Openverse's documented client-credentials endpoint and use it (higher rate limit; set the per-minute config accordingly). Document the setting in `.env.example`. When not set, behaviour is unchanged.
- Report per-provider request counts and the elapsed time in the stage message, e.g. `"28 scenes · 26 relevant · 250 candidates · requests W 40 / O 30 · cache 12 · 95 s"`.

### F4 — MUST: assignment ignores selections that are kept
On a re-run, scenes that are unchanged (same `searchHash`) keep their existing selection. However, `assignDistinct` does not receive them as locked, so the global "used" set is wrong and a changed scene can take an image already used by an unchanged scene.
- Pass every kept selection (unchanged scenes and protected selections) as `lockedCandidate`.
- Test: plan two scenes, select image X for scene 1, edit scene 2's queries so X ranks top for it, re-run. Scene 2 must not get X.

### F5 — SHOULD: series diversity
When the best candidate for a scene has the same `creator` and the same normalized title as the previous scene's selection (e.g. a Flickr set "Dinosaur Adventure"), prefer the next relevant candidate.

### F6 — MUST: live regression and report
Re-run the architect's check:
- Script: AlphaGo fixture loaded via `PUT /api/projects/:id/script` → SCENE_PLAN → VISUAL_SEARCH.
- Setup: real Wikimedia + Openverse, mock LLM, BALANCED, TikTok (3 s scenes).

Report a per-scene table: order, primary, base query used, selected title, provider, keyword, lowRelevance.

Acceptance:
- ≥ 80% of scenes have a selection with keyword > 0.
- Every keyword-0 selection is flagged `lowRelevance`.
- A duplicate selected image is allowed only when flagged `reusedAcrossScenes`.
- Time ≤ 180 s uncached.
- Unchanged re-run: 0 provider requests and 0 LLM calls.
- No 429 in server logs.

Add a recorded fixture of an irrelevant provider response and test that it ranks below relevant results.

## Do not
- Do not touch migrations `0000`–`0006`. Generate a new migration only if a column is needed, and only with drizzle-kit.
- Do not add dependencies. Do not commit. Do not run real `copilot` prompts. Tests must not hit the network.

## Report
Append `## Fix round 1` to `docs/tasks/TASK-006.report.md` with:
- files changed
- test counts
- the F6 table and numbers

Then create empty `docs/tasks/TASK-006.fix-done`.
