# TASK-039 — Cursor guide (trending topics + multi-language versions)

Read `docs/cursor/README.md` and `TASK-028.md` first (the topic queue). This task has two parts:
- **A.** Feed trending topics from official/public sources into topic suggestions.
- **B.** Make translated versions (dubbed voice + subtitles + metadata) of a finished video for other languages and channels.

No new npm dependencies. No scraping of Google, Bing, TikTok or other sites. Only official APIs, public RSS/Atom feeds the user adds, and the Wikimedia REST API.

## Part A — Trends

### A1. Sources (`apps/server/src/trends/`)
One interface `TrendSource { id, fetch(region, language, signal): Promise<TrendItem[]> }`, where `TrendItem = { title, url?, source, score, publishedAt?, category? }`.
- **`youtube_popular`:**
  - YouTube Data API `videos.list?chart=mostPopular&regionCode=VN&videoCategoryId=…&maxResults=50`, using a connected YouTube account's token (1 quota unit) or an optional YouTube API key setting stored with `TokenVault.storeSecret`;
  - map titles and tags.
- **`wikimedia_top`:** `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/{lang}.wikipedia/all-access/{yyyy}/{mm}/{dd}` (yesterday).
  - Drop the main page, special pages and the per-language list of evergreen/meta pages (configurable).
  - Send a descriptive `User-Agent` "VideoAgent/1.0 (local app)", with no email.
- **`rss`:**
  - user-added RSS/Atom feeds (news sites in their niche);
  - parse with a small in-house XML parser for `<item>`/`<entry>` title/link/pubDate (no dependency);
  - max 20 feeds, each fetched at most every 2 h.
- Each source is enabled per profile. Responses are cached for 2 h in a table `trend_cache` (source, region, language, fetched_at, json).

### A2. Relevance (code first, then LLM)
- In code: filter items against the profile's direction keywords and `learnedNotes`/`topicAngles` (TASK-035) by keyword overlap. Keep the top 40.
- The LLM task `trendMatch` (tier fast, budget feature) gets those plus the profile direction. It returns ≤ 8 topic ideas:
  - `{ title, angle, whyNow, sourceTitles[], urgency: "today"|"this_week"|"evergreen", fitScore 0-100 }`;
  - ideas with fitScore < 60 are dropped;
  - it must not invent facts. `whyNow` cites the source items.
- The ideas enter the topic queue (TASK-028) as `PENDING` with `source: "trend"` and the sources attached. With `autoApproveTopics` on, only `fitScore ≥ 80` are auto-approved.
  - "today" ideas get the earliest free slot;
  - when automation is on, they may take a slot ahead of older evergreen topics: reorder, do not delete.
- Sensitive-topic guard: skip items about disasters, deaths, crimes against named private people, elections or health claims unless the profile direction explicitly covers news. Use a keyword list in code plus the LLM flag `sensitive: boolean`. Skipped ones are logged.

### A3. UI
- The profile "Tự động" tab gets a "Xu hướng" section:
  - enable sources;
  - region (default VN), language, YouTube category;
  - the RSS feed list;
  - "Xem xu hướng ngay": the raw items plus the matched ideas with "Thêm vào hàng chờ".
- Dashboard widget: "Xu hướng hôm nay" (top 5 matched ideas across profiles).
- Assistant tools:
  - read: `trend_ideas`;
  - safe: `add_trend_topic`.

## Part B — Multi-language versions

### B1. Model
- A per-profile setting `translations: { language: string, accountIds: string[], voice?: string, mode: "dub" | "subtitles_only" }[]`.
  - Example: a Vietnamese channel plus an English channel that gets dubbed versions.
- A finished project gets child projects with `kind: "translation"` (reusing `parent_project_id` from TASK-037), `language`, and a link to the parent.

### B2. Pipeline for a translation child
1. **Translate the script** (LLM task `translateScript`, tier strong, budget feature):
   - scene by scene, keeping scene ids;
   - natural spoken style for the target language, not literal;
   - keep proper nouns;
   - each translated scene's estimated speech duration (chars/sec per language table) should stay within ±15% of the original. If it is longer, ask the LLM once to shorten that scene.
2. **TTS** in the target language with the profile's translation voice (TASK-040 sources when available; edge-tts otherwise).
3. **Re-timing:** reuse the parent's visuals and scene order. Each scene's duration follows the new voice length (the same timeline builder as the main pipeline). Music is re-fit.
4. **Subtitles** from the translated text and the new voice timings.
5. **Metadata** (title/description/tags) translated and adapted by the LLM, within platform limits (`trimMetadata`).
6. **Render**, then the thumbnail (TASK-036) with the translated overlay text.

`subtitles_only` mode keeps the original voice and adds translated subtitles only: re-render with the new subtitle track.

The child runs fully automatically (no gates) when the parent's profile automation is on. Otherwise it stops once at a single "Duyệt bản dịch" gate showing the side-by-side script.

### B3. YouTube extras (optional, when the scopes allow)
- Same-channel multi-language: instead of a new upload, add translated title/description through `videos.update` `localizations` (full `youtube` scope).
- Upload subtitle tracks through `captions.insert` (scope `youtube.force-ssl`, opt-in like TASK-038).
- Without the scopes, show the hint and skip.

### B4. UI
- On a finished project: a "Bản dịch" panel lists the configured languages, with "Tạo bản dịch", progress, the child links and the side-by-side script review.
- The profile settings get a "Đa ngôn ngữ" section.
- Assistant tool (confirm): `make_translation` (project, language).

## Tests (mock fetch, mock LLM, mock TTS, no network)
- **Trends:**
  - the YouTube popular mapper;
  - the Wikimedia mapper drops meta pages;
  - RSS/Atom parsing, including CDATA and entities;
  - the 2 h cache.
- **Relevance and topics:**
  - keyword prefilter, then `trendMatch`; fitScore < 60 dropped;
  - the sensitive guard skips and logs;
  - auto-approve only ≥ 80;
  - "today" ideas take the earliest free slot without deleting other topics.
- **The User-Agent has no email.**
- **Translation:**
  - scene ids are kept;
  - an over-long scene triggers one shortening call;
  - re-timing follows the new voice durations;
  - `subtitles_only` keeps the original audio;
  - the metadata is trimmed to limits;
  - the automation profile has no gate, and the manual profile has one gate.
- **YouTube localizations/captions** are only called with scopes; otherwise there is a hint.
- **Web:** the trend list adds to the queue, and the translation panel starts a job.

## Done
Done checklist from the README. Write `docs/tasks/TASK-039.report.md` and `docs/tasks/TASK-039.done`.
