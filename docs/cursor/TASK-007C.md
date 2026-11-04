# TASK-007C — Cursor guide (web image search, low cost)

Read `docs/cursor/README.md` first. The old spec `docs/tasks/TASK-007C.md` asked for an **LLM agent that searches the web** (claude-cli / anthropic `web_search` / agy full access). **That plan is dropped**: it costs $0.2–3 per video and does not scale to batch production. This guide replaces the spec. Read the spec only for the UI ideas (button, badge, `why`, license warning); ignore its LLM-agent and agy full-access parts.

## Goal
For scenes where the stock providers found nothing good, find images **anywhere on the web** at near-zero cost:
1. **Search** with a search API (not an LLM agent);
2. **Crawl** the source page **with code** (no LLM) to get the original image and its context;
3. Rank with the existing code ranking. The vision check from TASK-004G (if on) runs on these candidates like any other.

Target cost: about $0–0.05 per video. **No LLM web-search tools, no agy `--dangerously-skip-permissions`.**

## Sources
| Source | Key env | How | Notes |
|---|---|---|---|
| **Brave Image Search API** | `BRAVE_SEARCH_API_KEY` | `GET https://api.search.brave.com/res/v1/images/search?q=...&count=20&safesearch=strict`, header `X-Subscription-Token` | ~$5 / 1,000 requests, $5 free credit per month. Returns direct image URLs + source page URL. Off when the key is missing. |
| **Gemini API grounding (free tier)** | `GEMINI_API_KEY` (already in config) | One `generateContent` call with the `google_search` tool, **batching up to 5 scenes per call**. Ask for source **page** URLs per scene. Read the pages from `groundingMetadata.groundingChunks[].web.uri` (these are Google redirect URLs: resolve them with a HEAD/GET redirect follow through the safe fetcher). Do not trust URLs the model writes in its text. | Free tier quota (e.g. 1,500 grounded prompts/day on 2.5 Flash, or 5,000/month on Gemini 3 — check `GEMINI_MODEL`). Off when the key is missing. Model setting: `WEB_IMAGE_GEMINI_MODEL` (default a Flash model). |

Order: Brave first (direct images, better for this); Gemini grounding when Brave is off, out of quota, or returned < 3 usable images. Both are optional; with neither key, the feature is hidden/disabled with a clear "thiếu key" message.

**Not allowed:** scraping Google/Bing/Pinterest result pages (ToS, CAPTCHA). Pinterest is excluded entirely (no public search API, reposted copyrighted images). The crawler must **skip `pinterest.*` / `pinimg.com` domains** and similar repost aggregators (keep a small denylist in config).

## Crawler (code only)
`apps/server/src/providers/images/webCrawl.ts` (pure helpers + fetch through the existing safe fetch / image store):
- Fetch the page HTML through the **existing SSRF-safe path** (`apps/server/src/services/imageStore.ts` or its HTTP helper): block private IPs, max 2 MB HTML, 10 s timeout, max 3 redirects, honest User-Agent `videoGenerator/1.0 (+local app)` (never the user's email).
- **robots.txt**: fetch and respect `Disallow` for that UA / `*` (cache per host for the run). Skip disallowed pages.
- Extract candidates: `og:image`, `twitter:image`, `<link rel=image_src>`, JSON-LD `image`, and `<img>` with width/height ≥ 320 (or `srcset` largest). Resolve relative URLs. Keep up to 5 per page.
- Context for ranking: page `<title>`, `og:title`, `og:description`, image `alt`, nearby `<figcaption>`.
- License hints (metadata only, never a block): `<link rel=license>`, `rel="license"` anchors, CC URLs (`creativecommons.org/licenses/...`, `publicdomain/zero`) → map to `LicenseSchema`; Wikimedia Commons file pages → reuse the Commons imageinfo check in `providers/images/wikimedia.ts` (verified). Otherwise `UNKNOWN`.
- Use a cheap HTML parse without new dependencies (regex/attribute scanning is fine for meta tags; there is no DOM lib — do not add one unless the README allows).
- Per-host rate limit (reuse `http.ts` limiter), cache page results in the existing search cache table (or a new table via drizzle-kit) with a TTL.

## Candidate fields
In `packages/shared/src/schemas/visual.ts`:
- provider values `brave` and `web-grounding`;
- `licenseVerified: boolean` (true only for CC/PD detected from a reliable signal or the Commons check);
- `sourcePageUrl` (if not already present) and `why` (short reason, e.g. "Brave image result for 'AlphaGo Lee Sedol' from deepmind.google").

**Auto-approve and AUTO preselect must skip `licenseVerified: false` web candidates** (check `approveAll` and the AUTO path in `visualService.ts`; follow the TASK-017/004G gate pattern). The UI shows "Chưa xác minh license" and a link to the source page.

## When it runs
- **Button "Tìm trên web"** on the scene card (`apps/web/src/features/visuals/`), route `POST /api/projects/:id/scenes/:sceneId/visuals/web-search`, service `VisualService.webSearch(projectId, sceneId, signal)`.
- **Pipeline:** inside VISUAL_SEARCH, after the stock search + code rank, for scenes whose best relevance is under the threshold (or 0 relevant results), up to a per-video cap from the budget feature `webImageSearch` in `packages/shared/src/budget/modes.ts`: ECO off, BALANCED 3 scenes, QUALITY 8, MAX all low scenes. Include it in the estimate (it costs search requests, not LLM tokens: show requests, and Gemini grounding counts as one LLM call per batch in usage).
- Queries: reuse the scene's existing queries (primary + alternatives). No extra LLM call to write queries.

## Settings
"Nguồn ảnh web" section on the settings page: Brave on/off + key status (configured / thiếu key, never show the key), Gemini grounding on/off + model, monthly request counter for Brave (from usage records), domain denylist (editable list).

## Usage records
Record Brave requests and Gemini grounding calls in the usage tables (TASK-004I `usage.calls`) so the report shows per-video counts.

## Tests (no network, no real CLIs)
Fixtures in `apps/server/test/fixtures/`:
- Brave image search JSON response;
- Gemini grounding response with `groundingMetadata` (redirect URIs);
- 3–4 HTML pages: one with `og:image` + CC license link, one Wikimedia file page, one with only `<img srcset>`, one Pinterest URL (must be skipped);
- a robots.txt that disallows one path.

Cover: mapping to candidates, license detection (`licenseVerified` true/false), robots skip, denylist skip, SSRF block (private IP), redirect resolution, auto-approve skipping unverified, the per-video cap per budget mode, missing key → feature off, the route.

## Steps
1. Shared: provider values, candidate fields, budget feature `webImageSearch` + estimate, tests.
2. Server: crawler helpers + tests; Brave provider; Gemini grounding provider (reuse `providers/llm/gemini.ts` request code where it fits); config + `.env.example` (`BRAVE_SEARCH_API_KEY`, `WEB_IMAGE_GEMINI_MODEL`, `WEB_IMAGE_SEARCH_PER_MINUTE`, denylist). **Do not touch `.env`.**
3. Server: `webSearch` service, pipeline hook with cap, auto-approve gate, route, usage records, cache.
4. Web: button, badge "Web", `why`, license warning + source link, settings section, tests.
5. Optional live check only if a Brave or Gemini key is already configured, on a throwaway project, scene "AlphaGo vs Lee Sedol". Otherwise write "live check not run: no key". **Never use project `56374fb2-54cf-48ff-9441-2e6c653295d4`.** Do not ask for keys.
6. Run the README done checklist, then write the report and the `.done` file.
