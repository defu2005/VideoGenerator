# TASK-087 — Metric snapshots by window + retention curves 📈🔴

**Who:** a new Sonnet 5.5 session (or Codex when the user asks). **Size:** M. **Migration:** yes (🗄; one migration task at a time); drizzle-kit only. **New dependency:** none.
**Depends on:** TASK-082 (a real connected YouTube channel with published videos) and `docs/research/api-capabilities/youtube.md` (RESEARCH-086). 🔴 means it needs real data; build with mocks, then verify on the real channel.

## Why

- Gap K9: `publication_metrics_snapshots` keeps "latest" numbers only, so a 48 h result cannot be compared with a 7-day one.
- There are no impressions or CTR, and no retention curve.
- The Lab (092a), video genes (089), the funnel (103) and the playbook (093) all need fair, same-window numbers.

## Read first

- `docs/research/api-capabilities/{youtube,other-platforms,gap-analysis}.md`:
  - YouTube Analytics gives `audienceWatchRatio` as **100 points of elapsed ratio**, not per second;
  - impressions and CTR come from the **Reporting API** reach reports (from 2026-01-15), as daily bulk files with a delay;
  - TikTok and Meta: store "không có dữ liệu", never a guess.
- `apps/server/src/analytics/{syncService,youtubeFetcher,freshness,overview,scopes}.ts`.
- `docs/ARCHITECTURE-TARGET.md` §3 (`publication_metrics_snapshots` extension, `retention_curves`).

## Build

1. **Windows.**
   - Add `window` (`48h|7d|28d|latest`), `impressions`, `ctr` and `fetchedAt` to the snapshots.
   - A snapshot for a window is taken by the first sync at or after publish time + window, and is then **frozen**: later syncs never rewrite it.
   - A missed window is marked `late` with the real age, never back-filled as if on time.
2. **Retention curves.** Make a `retention_curves` table (publication id, fetchedAt, points [100 ratios], viewsAtFetch, window).
   - Fetch at 7d and 28d, and only when views ≥ a minimum (a TASK-088 param if it exists, else a constant of 100).
   - Below the minimum, record `insufficient_data`.
3. **Reporting API.**
   - A job type that creates the reach report job once per channel, downloads the new daily files, parses impressions and CTR per video per day, and sums them into the window snapshots.
   - Quota and cost are logged. If the scope is missing, the Kết nối page asks to reconnect, and nothing crashes.
4. **Tools:**
   - extend `get_publication_metrics` with `window`;
   - add `get_retention_curve(publicationId)`, a read that returns points or `insufficient_data`.

   Update the `video-doc-so-lieu` skill: always compare the same window.

## Mã nguồn mở có sẵn (open source)

- The official **YouTube Reporting API** samples (Apache-2.0) for job creation and report download. Use their flow.
- **Plausible** and **Umami** (MIT/AGPL — read only) are references for how frozen time-window rollups are designed.

## Rules

README rules 1–11. Never fill a missing metric with an estimate. Tests use recorded fixture responses, no network.

## Tests

- a window freezes once;
- late marking;
- the retention parse from a fixture, and `insufficient_data`;
- a reporting CSV fixture is parsed and summed;
- a missing scope is handled;
- TikTok and Meta store no-data.

## Done

- [ ] windows + frozen snapshots; retention table; Reporting job
- [ ] tools + skill
- [ ] tests; suites; migration
- [ ] user guide (Số liệu page) + changelog
- [ ] real-channel check after 7 days noted in the report → `docs/tasks/TASK-087.done`
