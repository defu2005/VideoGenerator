# TASK-006 — Visual Search: image providers, candidate store, ranking, dedupe, initial selection

## GOAL
Replace the fake VISUAL_SEARCH executor with a real one: for every scene, search free image sources with the scene's `visualQueries`, store **candidates** with full license metadata, **rank** them with code (Tier 0), **dedupe**, and pre-select one **distinct** candidate per scene (selection status `DISCOVERED`). Show the selected image on the Scene Board cards. The full review UI is TASK-007 — only the API and a minimal preview are in scope here.

## CONTEXT
- Read `docs/ARCHITECTURE.md` §4 (cost tiers, budget modes, LLM rules), §6 (VisualCandidate, VisualSelection, LicenseMetadata, VisualStatus, license rules — **never hard-block**), §7 (providers, ranking formula), §9 (API shape).
- Scenes (TASK-005): `packages/shared/src/schemas/scene.ts`, `apps/server/src/services/sceneService.ts`. Each scene has `visualQueries { primary, alternatives[] }`, `queryVariant` (true when the primary is a derived variant like `"<base> close-up"`), `visualNotes`, `order`.
- Settings: `settings.aspectRatio` (16:9 / 9:16 / 1:1), `settings.language`; budget via `resolveBudget(project)` (`packages/shared/src/budget/modes.ts`): features `altQueryAssist` (BALANCED, QUALITY), `semanticImageRerank` (QUALITY), `visionCheck` (never in this task).
- Enums already exist in `packages/shared/src/enums.ts`: `VISUAL_STATUSES`, `CANDIDATE_ORIGINS`, `WATERMARK_STATUSES`, `LICENSE_KINDS`.
- Executors registered via overrides in `apps/server/src/pipeline/executorRegistry.ts`. LLM via `generateStructured` (`apps/server/src/providers/llm/structured.ts`) — cache, usage, repair are already handled there.
- **Live API facts (verified 2026-11-03, no key needed):**
  - Wikimedia Commons: `GET https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=<q>&gsrlimit=<n>&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=640` → `pages[].imageinfo[0]` with `url`, `thumburl`, `width`, `height`, `mime`, `descriptionurl`, `extmetadata.{LicenseShortName, LicenseUrl, UsageTerms, Artist (HTML), Credit, AttributionRequired, ImageDescription, ObjectName}`. Requires a descriptive `User-Agent`.
  - Openverse: `GET https://api.openverse.org/v1/images/?q=<q>&page_size=<n>` → `results[]` with `id, title, url, thumbnail, width, height, filetype, license ("by","by-sa","by-nc","by-nc-sa","by-nd","by-nc-nd","cc0","pdm"), license_version, license_url, creator, creator_url, foreign_landing_url, attribution, source, provider, tags, mature`. **Anonymous rate limit: 20 requests/min** (`x-ratelimit-*-anon_burst` headers).
  - Pexels: `GET https://api.pexels.com/v1/search?query=<q>&per_page=<n>&orientation=<landscape|portrait|square>` with header `Authorization: <PEXELS_API_KEY>`; enabled only when the key is set. License = Pexels License (`ROYALTY_FREE`, attribution not required but credit photographer).

## FILES TO INSPECT
- `apps/server/src/pipeline/*` (executorRegistry, orchestrator, invalidation, stageExecutor, fakeExecutor)
- `apps/server/src/stages/scenes/*`, `apps/server/src/services/sceneService.ts`, `apps/server/src/api/scenes.ts`
- `apps/server/src/providers/llm/*` (pattern for provider interface + registry + mock), `apps/server/src/config*`
- `packages/shared/src/enums.ts`, `src/schemas/scene.ts`, `src/budget/modes.ts`
- `apps/web/src/features/scenes/*`, `apps/web/src/hooks/useScenes.ts`

## FILES TO CREATE/MODIFY (guide)
```
packages/shared/src/schemas/visual.ts              # LicenseMetadata, VisualCandidate, VisualSelection, SceneVisuals DTOs
packages/shared/src/visuals/license.ts             # normalizeLicense(...) pure mappers (wikimedia/openverse/pexels)
packages/shared/src/visuals/rank.ts                # scoreCandidate, rankCandidates (pure)
packages/shared/src/visuals/dedupe.ts              # candidateKey, dedupeCandidates (pure)
packages/shared/src/visuals/assign.ts              # assignDistinct(scenesWithRanked) (pure)
packages/shared/test/license.test.ts, rank.test.ts, dedupe.test.ts, assign.test.ts
apps/server/src/providers/images/types.ts          # ImageSearchProvider interface
apps/server/src/providers/images/wikimedia.ts, openverse.ts, pexels.ts, mock.ts, registry.ts, rateLimiter.ts
apps/server/src/db/schema.ts + drizzle (GENERATED)  # visual_candidates, visual_selections, image_search_cache
apps/server/src/services/visualService.ts
apps/server/src/stages/visuals/visualSearchExecutor.ts
apps/server/src/stages/visuals/altQueryPrompt.ts    # BALANCED/QUALITY, only when needed
apps/server/src/stages/visuals/rerankPrompt.ts      # QUALITY only
apps/server/src/api/visuals.ts
apps/server/test/fixtures/wikimedia-search.json, openverse-search.json, pexels-search.json   # recorded real responses (trimmed)
apps/server/test/imageProviders.test.ts, visualSearch.test.ts, visualsApi.test.ts
apps/web/src/services/visualsApi.ts, src/hooks/useVisuals.ts
apps/web/src/features/scenes/SceneCard.tsx          # show selected thumbnail + license badge
apps/mcp/src/tools.ts                               # + get_scene_visuals (read-only)
.env.example                                        # PEXELS_API_KEY=, IMAGE_PROVIDERS=wikimedia,openverse,pexels, IMAGE_SEARCH_USER_AGENT=
```

## REQUIREMENTS

### 1. Data model (shared zod + DB)
- `LicenseMetadata`: `kind` (extend `LICENSE_KINDS` with `CC_BY_ND`, `CC_BY_NC_SA`, `CC_BY_NC_ND` if missing), `name`, `url|null`, `author|null`, `authorUrl|null`, `attributionRequired: boolean`, `attributionText: string`, `evidence: "api"|"page_meta"|"user"|"none"`.
- `VisualCandidate`: `id, projectId, sceneId, origin ("SEARCH" here), provider ("wikimedia"|"openverse"|"pexels"|"mock"), providerItemId, query, title, description, previewUrl, imageUrl, sourceUrl, sourceSite, width, height, aspectRatio (number), fileType, watermark, relevanceScore (0–1), scoreBreakdown (object), license, rank (int), discardedAt|null, createdAt`.
- `VisualSelection`: `id, projectId, sceneId, slot (0), candidateId, status (VisualStatus), selectedBy ("AGENT"|"USER"), motion|null, reviewedAt|null, createdAt, updatedAt`. One selection per (scene, slot).
- `image_search_cache`: `key` (sha256 of provider + normalized query + params), `provider`, `query`, `response` (normalized JSON), `createdAt`; TTL 7 days (config `IMAGE_SEARCH_CACHE_TTL_HOURS`, default 168).
- FK cascade from project and scene deletion. **Generate the migration with `npx drizzle-kit generate --name visuals` from `apps/server`; never write/edit migrations by hand.**

### 2. Provider layer
- `ImageSearchProvider { id; enabled(config): boolean; search({ query, perPage, orientation, signal }): Promise<NormalizedImageResult[]> }`. Results already carry normalized `LicenseMetadata` (via `packages/shared/src/visuals/license.ts`).
- Plain `fetch`, no SDK, no new dependency. Timeout (default 15 s), 1 retry on network/5xx/429 honoring `Retry-After`; 4xx otherwise non-retryable.
- `rateLimiter.ts`: per-provider token bucket (Openverse 20/min default, Wikimedia 60/min, Pexels 180/min), configurable; requests wait instead of failing.
- Cache: every provider call goes through `image_search_cache`; same query again = 0 network calls.
- Registry: order from `IMAGE_PROVIDERS` (default `wikimedia,openverse,pexels`); Pexels disabled without `PEXELS_API_KEY`; `mock` provider (deterministic fake results with varied licenses, sizes, aspect ratios, one duplicate pair) used by tests and selectable via `IMAGE_PROVIDERS=mock` for offline dev.
- `User-Agent`: `IMAGE_SEARCH_USER_AGENT` or default `VideoAgent/0.1 (local)`.
- Filter out: `mature: true` (Openverse), non-image MIME, SVG **kept** but marked (`fileType: "svg"`) and penalized in ranking (logos/diagrams), images < 320 px on the short side.

### 3. License normalization (pure, table-tested)
- Wikimedia: map `LicenseShortName`/`UsageTerms` (`CC0`, `Public domain`, `CC BY 4.0`, `CC BY-SA 3.0`, `GFDL`→`UNKNOWN` with name kept, etc.); strip HTML from `Artist`/`Credit`; `attributionRequired` from `AttributionRequired` (default true for CC BY*); `evidence: "api"`.
- Openverse: `cc0`→`CC0`, `pdm`→`PUBLIC_DOMAIN`, `by`→`CC_BY`, `by-sa`→`CC_BY_SA`, `by-nc`→`CC_BY_NC`, `by-nd`→`CC_BY_ND`, `by-nc-sa`→`CC_BY_NC_SA`, `by-nc-nd`→`CC_BY_NC_ND`; use the API `attribution` string.
- Pexels: `ROYALTY_FREE`, name "Pexels License", `attributionRequired: false`, `attributionText: "Photo by <photographer> on Pexels"`.
- Anything unrecognized → `UNKNOWN` with the original string in `name`. **Never** infer "free" without data. **Never drop** a candidate because of its license (rules in §6: badge only).

### 4. Ranking (Tier 0, pure, deterministic)
`scoreCandidate(candidate, { queryTerms, sceneTerms, targetAspect, minShortSide })` → `{ score 0–1, breakdown }`:
- keyword match of query + `visualNotes` terms in title/description/tags (normalized, diacritics-insensitive, stop words removed) — weight 0.35
- resolution: short side ≥ 1080 → 1, linear down to 320 → 0 — 0.20
- aspect closeness to the project aspect (16:9 / 9:16 / 1:1); since images will be cropped, use `1 - min(1, |log(a/t)| / log(3))` — 0.20
- license known (not `UNKNOWN`) — 0.10; non-commercial (`*_NC*`) or `ALL_RIGHTS_RESERVED` get 0 here but are **kept**
- watermark: `SUSPECTED` for known watermark stock domains (list in code: shutterstock, alamy, gettyimages, istockphoto, dreamstime, 123rf, depositphotos, adobe stock) → 0, `NONE`/`UNKNOWN` → 1 — 0.10
- file type: jpg/png/webp 1, svg 0.3, gif 0.2 — 0.05
Weights in one exported constant. Ties broken by provider order then providerItemId (deterministic).

### 5. Dedupe (pure)
- Same item: same `provider + providerItemId`; same normalized `imageUrl` (strip query/size suffixes, Wikimedia thumb paths → original); same `sourceUrl`.
- Same file across providers: Openverse results with `source: "wikimedia"` vs Wikimedia results matched by normalized file title. Keep the one with richer license evidence (Wikimedia direct).
- Perceptual hashing is **out of scope** (needs image decoding / new dependency) — leave a `TODO(TASK-012)` note; do not add `sharp`/`jimp`.

### 6. VISUAL_SEARCH executor
For each scene in order (progress `scene i/N`):
1. Queries to try in order: `primary`, then `alternatives`, until **≥ 8 candidates** after dedupe or queries exhausted; per query, ask each enabled provider for `perPage = 10` with orientation from the aspect ratio. When `queryVariant` is true and the variant query returns < 3 results, also try the base query without the modifier.
2. **Code fallback before any LLM** when still < 3 candidates: drop the last word / modifiers, try the section's `visualQueries.primary`, try a query built from the top 3 nouns-ish terms of `visualNotes` (longest non-stop words).
3. **altQueryAssist** (BALANCED, QUALITY; CUSTOM toggle): if, after code fallbacks, some scenes still have < 3 candidates, make **one batched LLM call for all those scenes** → `{ scenes: [{ sceneId, queries: string[≤3] }] }` (English, concrete, searchable; keep proper nouns), cached by input hash, then search those queries. Failure → skip with message `AI query assist skipped (<code>)`; stage still DONE.
4. Rank + dedupe per scene; store candidates (rank 0..n), keep at most 24 per scene.
5. **semanticImageRerank** (QUALITY; CUSTOM toggle): one batched call with, per scene, the narration excerpt (≤ 200 chars) + top 8 candidates' title/description/tags (text only, **no images**) → `{ scenes: [{ sceneId, order: candidateIndex[] }] }`; blend: `final = 0.6 × codeScore + 0.4 × llmRankScore`. Cached; failure → keep code ranking.
6. **Distinct assignment** (`assignDistinct`, pure): walk scenes in order; each scene takes its highest-ranked candidate whose dedupe key is **not used by any earlier scene** (scenes that share a query must get different images); if none left, take the best one not used by the **previous** scene; if still none, the top one (flag `reusedAcrossScenes: true` in the breakdown).
7. Upsert selection `{ slot: 0, status: "DISCOVERED", selectedBy: "AGENT" }`. **Never overwrite a selection with `selectedBy: "USER"`** or status `APPROVED`/`CUSTOM`/`REPLACED`.
8. **Per-scene incremental re-run**: store `searchHash = sha256(visualQueries + aspectRatio + enabled providers)` on the scene's candidate set; on re-run, scenes whose hash is unchanged keep their candidates and selection (0 network calls, 0 LLM); changed scenes are re-searched; deleted scenes' rows are removed by cascade.
9. Scenes with 0 candidates: no selection, scene marked `needsUser: true` in the response; stage still DONE (`"N scenes · M with images · K need your input"`). Fail the stage (retryable `IMAGE_SEARCH_UNAVAILABLE`) only if **every** provider call failed with network/5xx errors.
10. Record usage (LLM calls, provider requests, cache hits) on the job; message on success: `"N scenes · C candidates · cache hits H · LLM calls L"`.

### 7. API (`apps/server/src/api/visuals.ts`)
| Method | Path | Behavior |
|---|---|---|
| GET | `/api/projects/:id/visuals` | per scene: `{ sceneId, order, selection \| null, selectedCandidate \| null, candidateCount, needsUser }` + summary `{ withImage, needsUser, licenseCounts }` |
| GET | `/api/projects/:id/scenes/:sceneId/visuals` | `{ selection, candidates[] (ranked, excluding discarded unless ?includeDiscarded=1) }` |
| POST | `/api/projects/:id/scenes/:sceneId/visuals/search` | `{ query: string, providers?: string[] }` → searches (cache first), appends new deduped candidates, re-ranks this scene; does not change the selection; 409 when a job is active |
| POST | `/api/projects/:id/scenes/:sceneId/visuals/select` | `{ candidateId }` → selection `selectedBy: "USER"`, status `REPLACED` (or keep `DISCOVERED`→`REPLACED`); marks later stages STALE via existing invalidation (VOICE is not affected — only timeline/render) |
| POST | `/api/projects/:id/scenes/:sceneId/visuals/:candidateId/discard` | sets `discardedAt`; if it was selected, auto-select the next distinct candidate (`selectedBy: "AGENT"`) |
Errors use the standard `{ error: { code, message, details } }` shape. Custom URL / upload endpoints belong to TASK-007.

### 8. Web (minimal — full review UI is TASK-007)
- SceneCard: replace the "Ảnh sẽ có ở bước Visual" placeholder with the selected candidate's `previewUrl` (`loading="lazy"`, `referrerPolicy="no-referrer"`, fixed aspect box using the project aspect, `object-fit: cover`, alt = title); license badge per §6 (green CC0/PD, "Attribution required" CC BY*, amber "Unknown — review", red ALL_RIGHTS_RESERVED/NC note "Non-commercial"); "Cần chọn ảnh" placeholder when `needsUser`.
- Image load error → placeholder with provider + "Ảnh không tải được" (no retry loop).
- Refresh on SSE `stage.updated` for VISUAL_SEARCH. Reuse the bounded query retry from TASK-005.

### 9. MCP
Read-only `get_scene_visuals(projectId, sceneId?)` returning compact selection + top 5 candidates (title, provider, size, license kind, sourceUrl).

## LLM calls
| Mode | VISUAL_SEARCH |
|---|---|
| ECO | **0** |
| BALANCED | 0, or **1** (`altQueryAssist`, only if some scene has < 3 candidates after code fallbacks) |
| QUALITY | 0–1 alt-query + **1** rerank (`semanticImageRerank`) = max **2** |
| CUSTOM | per toggles; `visionCheck` is ignored in this task |
Update `estimateBudget` (`perStage` gains `"VISUAL_SEARCH"` with min/max per the table) and the estimate UI.

## DO NOT
- Do not download full-size images to disk (URLs only; downloading happens at approval/render — TASK-007/012).
- Do not add dependencies (no image libs, no SDKs, no scraping libraries); do not scrape Google Images or any HTML page.
- Do not use LLM vision; do not send image bytes to any LLM.
- Do not drop or hide candidates because of license; do not claim "no copyright" without data.
- Do not hand-write migrations. Do not implement the Visual Review UI, custom URL or upload (TASK-007).
- Tests must not hit the network (use recorded fixtures + mock provider). Do not run real `copilot` prompts. Do not commit.

## ACCEPTANCE CRITERIA
1. Root typecheck/build/test pass (incl. migration hygiene); `npx drizzle-kit generate` reports no changes after your migration; `npm audit --omit=dev` = 0.
2. Live dev server, **real Wikimedia + Openverse** (no Pexels key), mock LLM, BALANCED, a vi TikTok project (3 s scenes) and an en YouTube project (7 s): VISUAL_SEARCH DONE; ≥ 90% of scenes have a selection; **no two scenes share the same selected dedupe key** unless flagged `reusedAcrossScenes`; every candidate has a license `kind` + `evidence`; the Openverse rate limit is never exceeded (no 429 in logs).
3. Re-running VISUAL_SEARCH without changes: 0 provider network calls (all cache hits), 0 LLM calls, selections unchanged. Editing one scene's queries then re-running re-searches only that scene.
4. A selection made via the `select` API survives a re-run.
5. ECO makes 0 LLM calls; BALANCED makes at most 1; QUALITY at most 2; failures degrade gracefully (stage DONE).
6. Scene Board shows thumbnails + license badges; broken images show the placeholder.
7. `get_scene_visuals` works against the running API.

## TESTS
- Shared: license mapping tables (wikimedia/openverse/pexels incl. unknown strings and HTML authors), scoring (each component, weights sum, determinism, diacritics), dedupe (URL normalization, wikimedia thumb vs original, cross-provider file match), assignDistinct (shared queries → distinct picks; exhaustion fallbacks; flag).
- Server: each provider parses its recorded fixture; timeout/429 Retry-After/5xx retry; rate limiter waits (fake timers); cache hit = no fetch; executor (fallback order, altQueryAssist batching/only-when-needed/failure, rerank QUALITY only, incremental re-run by searchHash, USER selection preserved, 0-candidate scene → needsUser, all-providers-down → IMAGE_SEARCH_UNAVAILABLE); API endpoints incl. 409 and validation; estimate includes VISUAL_SEARCH.
- Web: SceneCard thumbnail, badge variants, needsUser placeholder, image error placeholder.
- MCP: `get_scene_visuals`.

## DEPENDENCIES
TASK-005 (done, commit a2c8271).

## REPORT BACK
Write `docs/tasks/TASK-006.report.md`: files, migration name, live-run stats for AC2 (scenes, % with selection, candidates/scene min/avg/max, license kind counts, distinct-assignment result, provider requests vs cache hits, LLM calls), AC3 re-run numbers, command results, deviations, remaining issues. Then create empty `docs/tasks/TASK-006.done`.
