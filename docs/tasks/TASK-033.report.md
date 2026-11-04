# TASK-033 report — platform analytics sync + dashboard

## What changed

### Shared
- `packages/shared/src/schemas/analytics.ts` — overview/series/accounts/sync zod schemas, metrics fields
- `packages/shared/src/schemas/publication.ts` — `latestMetrics` / `metricsSyncedAt` trên Publication; `analyticsStatus` trên AccountConnectionDetail
- `packages/shared/src/publishing/youtubeHelp.ts` — `YOUTUBE_ANALYTICS_READONLY_SCOPE` + hướng dẫn YouTube Analytics
- `packages/shared/src/publishing/tiktokHelp.ts` — scopes `video.list`, `user.info.stats` + ghi chú duyệt portal
- `packages/shared/src/publishing/metaHelp.ts` — scopes `instagram_manage_insights`, `read_insights`
- `packages/shared/src/index.ts` — export analytics schemas

### Server — data
- `apps/server/src/db/schema.ts` — `publication_metrics_snapshots`, `channel_metrics_daily`; cột analytics trên `platform_accounts`; `latest_metrics` / `metrics_synced_at` trên `publications`
- Migration `apps/server/drizzle/0028_stale_silver_surfer.sql` (+ snapshot) via drizzle-kit; lần generate thứ hai → “No schema changes”

### Server — analytics
- `apps/server/src/analytics/types.ts` — `MetricsFetcher`, snapshot/channel types
- `apps/server/src/analytics/freshness.ts` — rule 2h / 12h / daily / weekly
- `apps/server/src/analytics/scopes.ts` — `missingScopes` (YouTube FULL covers READONLY) + required scopes map
- `apps/server/src/analytics/youtubeFetcher.ts` — Data API batch 50 + Analytics reports; `chunkIds`
- `apps/server/src/analytics/tiktokFetcher.ts` — video/query ≤ 20 + user.info followers
- `apps/server/src/analytics/instagramFetcher.ts` / `facebookFetcher.ts` — Graph insights + mapping (metric reject → null)
- `apps/server/src/analytics/registry.ts` — `createFetchers` + mock fetcher
- `apps/server/src/analytics/overview.ts` — totals, delta kỳ trước, series, top/bottom, bảng video
- `apps/server/src/analytics/syncService.ts` — tick, manual sync (5 phút), backoff 429, refresh 401 một lần, needs_reconnect + notification dedup 6h
- `apps/server/src/api/analytics.ts` — GET overview / publications/:id / accounts; POST accounts/:id/sync
- `apps/server/src/publishing/youtubePublisher.ts` — thêm `yt-analytics.readonly` vào `scopesForAccount`
- `apps/server/src/publishing/ticker.ts` — `setAnalytics` + gọi trong `tick`
- `apps/server/src/publishing/publishService.ts` — map latest metrics; expose analyticsStatus trong connectionDetail
- `apps/server/src/assistant/tools.ts` + `service.ts` — tools `analytics_overview`, `video_metrics` (risk read)
- `apps/server/src/app.ts` — wire AnalyticsSyncService → ticker + assistant + routes
- Tests: `apps/server/test/analytics.test.ts`, `analyticsFreshness.test.ts`

### Web
- `apps/web/src/services/analyticsApi.ts`
- `apps/web/src/features/analytics/AnalyticsPage.tsx` — bộ lọc, KPI + delta, SVG charts, bảng sort, sync strip, drawer
- `apps/web/src/features/analytics/charts.tsx` — LineChart / BarChart SVG (không thư viện chart)
- `apps/web/src/features/analytics/AnalyticsPage.test.tsx`
- `apps/web/src/App.tsx` / `AppLayout.tsx` — route `/analytics`, NavLink «Thống kê»
- `apps/web/src/features/render/PublishPanel.tsx` — hiện views/likes từ `latestMetrics`
- `apps/web/src/features/profiles/ProfileDetailPage.tsx` — «Kết nối lại để bật thống kê»
- `apps/web/src/index.css` — layout analytics nhỏ

## Test counts

| Workspace | After TASK-032 | After TASK-033 |
|---|---|---|
| shared | 208 | **208** |
| mcp | 12 | **12** |
| server | 490 | **520** |
| web | 99 | **102** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”. No `package.json` / lockfile change.

## Live / browser check
- Không gọi network/LLM/TTS thật: mock `fetch`, fake clock, mock notification.
- Phủ fetchers, batching, missing scope + dedup, freshness, quota backoff, 401 refresh, overview aggregation, no token leak.
- Web: filter query, sort bảng, hint needs_reconnect.
- Did **not** approve gates or render on `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Deviations from the spec
- Channel daily TikTok / Instagram / Facebook chỉ ghi followers (và views/watch khi API trả) cho ngày hiện tại — không có lịch sử day-series đầy đủ như YouTube Analytics `dimensions=day`.
- Overview series chủ yếu từ snapshots `fetched_at` + `channel_metrics_daily`; không suy diễn ngày thiếu.
- Manual sync rate-limit trả HTTP 429 với mã `ANALYTICS_SYNC_RATE_LIMIT`.

## Not done
- No commit/push (per rules).
- Live sync với API thật / browser trên project throwaway (sau review).
- Revenue (TASK-034) và learn-from-results (TASK-035).
