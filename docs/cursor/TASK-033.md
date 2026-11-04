# TASK-033 — Cursor guide (platform analytics sync + analytics dashboard)

Read `docs/cursor/README.md` first. TASK-024…032 are committed. This task pulls performance numbers for every PUBLISHED publication from the official platform APIs and shows them in an analytics dashboard. Later tasks build on it:
- revenue (TASK-034);
- learn from results (TASK-035).

No new npm dependencies. Every HTTP call goes through `fetch`, and tests mock it.

## 1. Data model (generate migrations with drizzle-kit)
- `publication_metrics_snapshots` stores one row per publication per sync:
  - columns: id, publication_id (FK cascade), fetched_at;
  - `views`, `likes`, `comments`, `shares`, `saves` (nullable ints);
  - `watch_time_sec` (nullable real), `avg_view_duration_sec` (nullable real), `avg_view_pct` (nullable real 0–100);
  - `subscribers_gained` (nullable int), `reach` (nullable int);
  - `raw` json (trimmed to the fields used);
  - index on (publication_id, fetched_at).
- `channel_metrics_daily` stores one row per account per day:
  - columns: account_id, date (YYYY-MM-DD in the profile timezone), followers, views, watch_time_sec, fetched_at;
  - unique key (account_id, date).
- Add `latest_metrics` json and `metrics_synced_at` to `publications` as a denormalized cache for fast lists.

## 2. Fetchers (`apps/server/src/analytics/`)
One interface, implemented per platform:
```ts
interface MetricsFetcher {
  platform: PlatformId;
  requiredScopes: string[];
  fetchVideoMetrics(pubs: { publicationId; externalId }[], tokens, signal): Promise<Map<publicationId, MetricsSnapshotInput>>;
  fetchChannelDaily?(account, tokens, from, to, signal): Promise<ChannelDailyInput[]>;
}
```
- **YouTube:**
  - Data API `videos.list?part=statistics&id=…` (batch up to 50 ids) for views/likes/comments. This needs the existing readonly scope.
  - YouTube Analytics API v2 `reports.query` (`ids=channel==MINE`, `dimensions=video`, `filters=video==id1,id2…`) for `estimatedMinutesWatched`, `averageViewDuration`, `averageViewPercentage`, `subscribersGained`, `shares`. This needs the scope `https://www.googleapis.com/auth/yt-analytics.readonly`.
  - For channel daily, use `dimensions=day`.
- **TikTok:** `POST /v2/video/query/` with `filters.video_ids` (≤ 20 per call), fields `view_count,like_count,comment_count,share_count`. Needs the scope `video.list`. Followers come from `user/info` `follower_count` (needs `user.info.stats`).
- **Instagram:**
  - `GET /{ig-media-id}/insights?metric=views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time`. Needs the scope `instagram_manage_insights`.
  - `followers_count` comes from the IG user node.
- **Facebook Reels:**
  - `GET /{video-id}/video_insights?metric=blue_reels_play_count,post_impressions_unique,post_video_avg_time_watched,post_video_view_time,post_video_social_actions`. Needs the scope `read_insights`.
  - Page `followers_count`.
- Metric names differ between Graph versions. Keep a small per-platform mapping table and treat any metric the API rejects as `null` (log once). Do not fail the whole batch.

## 3. Scopes and reconnect
- Add the new scopes to the scope lists:
  - YouTube: add `yt-analytics.readonly` to `scopesForAccount`;
  - TikTok: `video.list`, `user.info.stats`;
  - Meta: `instagram_manage_insights`, `read_insights`.
- Existing connected accounts keep their old grant. Compare `tokens.scopes` with `fetcher.requiredScopes`. When something is missing:
  - mark the account `analyticsStatus: "needs_reconnect"`, exposed in the accounts API;
  - show "Kết nối lại để bật thống kê" with the existing reconnect button;
  - skip that account (no error spam: one `attention` notification per account, using the existing 6 h dedup).
- Update the help texts (`youtubeHelp.ts`, `tiktokHelp.ts`, `metaHelp.ts`) to list the new permissions in Vietnamese. TikTok `video.list` / `user.info.stats` need the app's scope approval in the TikTok developer portal; say so.

## 4. Sync scheduler
- `AnalyticsSyncService` runs on the publish ticker (honor `WORKER_ENABLED`). Freshness rule by publication age:
  - < 48 h: every 2 h;
  - < 14 days: every 12 h;
  - < 90 days: daily;
  - older: weekly.
- Channel daily runs once per day per account.
- Batch per account, respect quotas:
  - YouTube Analytics has its own quota; reuse the `youtubeQuota` pattern for Data API units (`videos.list` = 1 unit);
  - on 429/quota errors, back off until the next window.
- Refresh tokens through the existing token refresh path.
- Manual "Đồng bộ ngay" per account, rate limited to once per 5 min.
- Never log tokens.

## 5. API (`apps/server/src/api/analytics.ts`)
- `GET /api/analytics/overview?from&to&profileId&platform`:
  - totals (views, likes, comments, shares, watch hours, followers delta);
  - per-day series;
  - per-platform split;
  - top 10 and bottom 5 videos by views and by average view %.
- `GET /api/analytics/publications/:id`: the snapshots time series.
- `GET /api/analytics/accounts`: sync status per account (last sync, needs_reconnect, last error).
- `POST /api/analytics/accounts/:id/sync`.
- Shared zod schemas go in `packages/shared/src/schemas/analytics.ts`.

## 6. Web UI
A new sidebar page "Thống kê" (`/analytics`):
- **Filters:** time range (7/28/90 days, custom), profile, platform.
- **KPI tiles:** views, watch hours, likes, comments, shares, follower change, each with a delta versus the previous period.
- **Charts:** views per day (line, one series per platform) and per-platform share (bar). Plain SVG components, no chart library.
- **Table of videos:** title, platform, published at, views, avg view %, likes, comments, link. Sortable.
- **Account sync status strip:** reconnect hints and the "Đồng bộ ngay" button.
- **Detail drawer per video:** metric history line.
- Also show the latest metrics in the project's Publish panel next to each publication.

Add the `analytics` read tool to the TASK-032 assistant tool catalog (`analytics_overview`, `video_metrics`), so the assistant can answer "video nào nhiều view nhất tuần này?".

## 7. Tests (mock fetch, fake clock)
- Each fetcher maps a recorded API response to snapshot fields. Unknown or rejected metrics become null, and the rest still saves.
- YouTube batching splits 120 ids into 50/50/20. A TikTok batch has ≤ 20 ids.
- A missing scope sets needs_reconnect, makes no API call, and sends one attention notification.
- The freshness rule picks the right publications at a given fake time.
- A quota error backs off; a token refresh happens on 401 once.
- Overview aggregation: totals, per-day series, top/bottom, previous-period deltas.
- No token in logs or responses.
- Web: filters change the query, the table sorts, and a needs-reconnect hint renders.

## Done
Done checklist from the README. Write `docs/tasks/TASK-033.report.md` and `docs/tasks/TASK-033.done`.
