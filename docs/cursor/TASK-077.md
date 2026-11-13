# TASK-077 — Hard relevance gate for scene images (from the Berserk run)

**Who:** Cursor (grok-4.7-medium). **Order:** after TASK-075 finishes, or in a second Cursor chat now: it does not share files with TASK-075 (compose, budget) or TASK-073c (knowledge, analytics, operator). Do not run it together with any other task that edits `packages/shared/src/visuals/` or `apps/server/src/services/visualService.ts`.

Read first: `docs/cursor/README.md`, this file, `PROPOSALS_AND_BUGS.md` §5 (Hermes, 2026-11-11), `docs/cursor/TASK-060.md` §2 and `TASK-061.md` §2–§4 (what already exists). Never open a file over 300 lines whole; `visualService.ts` is huge, so grep it.

## Why

Hermes re-ran image search on the Berserk project (`1ef6de1f-cf84-4552-8aed-8958f290bc0e`) in MAX mode with vision. Result: **31 of 31 scenes had `lowRelevance = true`, yet every scene was `READY_FOR_RENDER`**, with stock photos of thunder, bands, parades and NASA satellites. TASK-060/061 already detect bad images (keyword < 0.34, entity check, fan terms, watermark filter, no repeats). The detection works. What is missing is that nothing **acts** on it:

1. `deriveSceneVisualStatus` (`packages/shared/src/schemas/visual.ts` ~line 175) ignores `lowRelevance`. Approved + downloaded means `READY_FOR_RENDER`.
2. `autoResolve` (`visualService.ts` ~line 758) approves the top image even when vision says it does not fit, and only logs `VISUAL_LOW_FIT` as a warning.
3. `protectedSelectionStatuses` (~line 131) = APPROVED/CUSTOM/REPLACED, whatever `selectedBy` is. A selection the **agent** approved is locked like one the **user** chose, so a better Brave result can never replace it.
4. Queries such as "human spirit" or "peaceful dawn" do not name the work, so every provider returns stock photos.
5. Low-quality web sources (wallpaper sites, AI image sites, aggregators) enter the pool with license `UNKNOWN`.
6. Met returns HTTP 410 on every scene. The per-run breaker only reacts to Cloudflare and 403.

## The user's decision (2026-11-11)

**When no relevant image exists for a scene, stop and ask the user, in every mode including AUTO.** Never fill the scene with an off-topic image, and do not swap in a text/graphic shot on its own. The scene becomes `NEEDS_ATTENTION` with a clear reason; the pipeline waits at VISUAL_REVIEW and sends the usual "Cần bạn xử lý" notification (dashboard, Telegram if set up). The user can then upload, paste a URL, pick another candidate, re-search, or mark the scene "không cần ảnh" (`SKIPPED`), all of which exist today.

## Rejected: watermark removal and the 1/10 crop to avoid copyright detection

`PROPOSALS_AND_BUGS.md` §3 proposed removing watermarks and cropping licensed images so Content ID would not match them. **Do not build it.** It is a legal risk, and it contradicts the skill `.agents/skills/video-kiem-tra-truoc-khi-dang/` (Hermes withdrew it in §5, Lỗi 11). Watermarked images stay rejected (TASK-061 §4). The TASK-062 crop tool stays manual and for framing only.

## Mã nguồn mở có sẵn

Nothing new to add: the rules are ours, on top of code that already exists (ranking, perceptual hash, Hungarian assignment from TASK-061, vision check from TASK-004G). If you find an open-source image relevance or source-reputation list worth using, report it (README rule 11), do not add it.

## Rules for this task

- No commit or push. No new npm dependency. **No DB change**: Codex may be generating a migration for TASK-073c at the same time, and two migrations at once break the journal. If §3 truly needs a column, stop that part and say so in the report.
- Do not touch `.env`, `.claude/`, `data/`, `scripts/`, `apps/server/src/compose/**`, `packages/shared/src/compose/**`, `packages/shared/src/budget/**`, `apps/server/src/knowledge/**`.
- Tests: no network, no real LLM or vision. Fake providers and a fake vision checker.
- Never approve gates or render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- Update the user guide and featureMap.
- Other agents work in the same checkout: before editing a shared file (`docs/user-guide/**`, featureMap, `apps/server/src/app.ts`), re-read it and make a small edit; never rewrite it whole.

## 1. The gate: low relevance is never "ready"

- `deriveSceneVisualStatus` gets the selected candidate's relevance facts: `lowRelevance`, and the vision verdict (rejected, or below the fit threshold, when vision ran). If the selected image is low relevance or vision rejected it, the status is `NEEDS_ATTENTION`, not `READY_FOR_RENDER`. Exceptions: selections with `selectedBy = "USER"` (or status `CUSTOM` / `AI_GENERATED`) are the user's own choice and stay ready.
- Keep the gate check in one place, so the visual review gate, `approveAll`, the render precheck and the assistant/MCP tools all see the same answer. Grep every reader of `READY_FOR_RENDER` and `needsUser`.
- The scene summary carries a short reason the UI and Telegram can show: `lowRelevance` (with the TASK-060 `reasons`: keyword / entity / fan), `vision_reject`, `no_candidate`.
- `approveAll` and "approve all" from the assistant skip scenes that fail the gate and say how many were skipped and why.

## 2. AUTO stops and asks

- In `autoResolve`, when a scene fails the gate:
  1. first run the existing extra web search for that scene (§4 makes it work), then re-rank and re-assign;
  2. approve a candidate only if it passes the gate (relevant, and vision accepts it when vision is on);
  3. otherwise leave the scene `NEEDS_ATTENTION` with the reason. Do **not** approve the "best of the bad".
- The AUTO pipeline then waits at VISUAL_REVIEW like ASSISTED does. Add an auto-report entry `VISUAL_NEEDS_USER` (use the strongest severity the auto-report already has; grep its schema, do not add a new level unless needed) and send one notification per project run listing the scenes (not one per scene).
- When the user fixes the scenes, the pipeline continues as today. Check this with a test.
- The `VISUAL_LOW_FIT` warning path that approved anyway is removed.

## 3. Agent choices are not locks

- Only `selectedBy = "USER"`, `CUSTOM` and `AI_GENERATED` are protected from re-search. An `APPROVED` selection made by the agent (`selectedBy = "AGENT"`) can be replaced when a new candidate passes the gate and scores higher.
- When the search replaces an agent selection, record the old and new candidate in the scene's history (use the existing selection history if there is one; grep before adding anything).
- After all web searches for a run, run the global assignment and perceptual dedupe from TASK-061 once more over the whole project, so new candidates can move between scenes. Order: relevance gate → vision gate (when on) → source/license filter → global assignment → dedupe → final gate (§1).

## 4. Better queries for named works

- When the scene has `entities` (TASK-060), every provider query must contain at least one entity (the work's name first). If a scene's `visualQueries.primary` has none, prefix it with the main entity. Abstract queries ("human spirit", "existentialism", "peaceful dawn") are then searched as "Berserk human spirit" etc.
- Add negative terms for web search providers that support them (Brave supports `-term`): cosplay, parade, statue, wallpaper, NASA, marching band, stock photo. Do not add a negative term that appears in the scene's own text.
- **Fictional works first to the web.** When the project topic is a fictional work (manga, anime, game, film, novel), search web providers (Brave / Gemini grounding, if enabled) in the first pass, not only after open-license sources fail. Decide "fictional work" with code from what the script stage already has (topic category, profile niche, or entity type); do not add an LLM call. If neither web provider is enabled, mark the scenes with the existing "web search unavailable" note so the user sees why.

## 5. Source risk

- Extend the domain denylist (config `WEB_IMAGE_DOMAIN_DENYLIST`, today only Pinterest) with defaults for wallpaper sites, AI image galleries and scrapers named in the Hermes report (for example wallhaven, craiyon, prompthero, stablediffusionweb). Keep it a config default, and keep the user able to change it.
- Reddit, fan-art and aggregator blogs are `high` source risk: allowed in the pool, but never auto-approved; they need the user (they fail the §1 gate with reason `source_risk`).
- Every web candidate keeps its page URL and the license evidence it has (or `UNKNOWN`). No change to TASK-061's watermark rule.

## 6. Broken providers

- HTTP 404 or 410 from a provider's search endpoint blocks that provider for the rest of the run on the first hit (same `blockProviderForRun` path as Cloudflare), with one warning, not one per scene.
- The visual search summary shows provider health for the run, e.g. `met: unavailable (HTTP 410)`, `loc: blocked (Cloudflare)`.
- The HTTP signal from TASK-073b already reports provider errors to the change inbox. Do not add another reporter; check that a 410 there leads to one change event, not 31.

## 7. Tests

- `visual.ts` status: low relevance + agent approved → `NEEDS_ATTENTION`; same image chosen by the user → `READY_FOR_RENDER`; vision reject → `NEEDS_ATTENTION`.
- AUTO: a fake project where providers return only off-topic images → AUTO stops at VISUAL_REVIEW with `VISUAL_NEEDS_USER`, nothing is approved, one notification. Then the user uploads images → the pipeline continues.
- AUTO: web search returns a relevant image that vision accepts → it replaces the agent's earlier selection and the scene is ready.
- A user-chosen image is never replaced by re-search.
- Query building: entity prefix, negative terms, no negative term that is in the scene text.
- Fictional topic → web providers are called in the first pass (fake Brave).
- Denylist and `source_risk`.
- Provider 410 → one call, then skipped for the rest of the run; other providers still called.
- A replay of the Berserk failure built from fixtures (titles/tags like "Golden Hawks marching band", "thunderstorm", "satellite", "Gut on Chip"): after the run, no scene is ready with an off-topic image.

## 8. Live check

On the Berserk project `1ef6de1f-cf84-4552-8aed-8958f290bc0e` (never on `56374fb2-…`), re-run VISUAL_SEARCH. Do not approve the gate and do not render. Report: number of ready scenes, number needing the user and why, Brave requests used, provider health, and 3 example scenes with the chosen image title and source. Success means no scene is ready with an off-topic image. Scenes left for the user are fine.

## 9. User guide

Update the image pages in `docs/user-guide/`: why a scene can be "Cần bạn" even in AUTO, what each reason means, and how to fix it (upload, URL, pick, re-search, skip). Add a changelog line. Update featureMap if a page or tool changes.

## Done

Write `docs/tasks/TASK-077.report.md` (≤ 40 lines: what changed per section, tests, live check numbers, anything you could not do) and an empty `docs/tasks/TASK-077.done`.
