# TASK-025 report — YouTube publisher (long + Shorts)

## What changed

### Shared
- `packages/shared/src/schemas/publication.ts` — `warnings` trên Publication / PublishResult; `categoryId` / `playlistId` / `durationSec` trên PublishInput; `visibilityUsed` tùy chọn trên PublishResult
- `packages/shared/src/publishing/youtubeHelp.ts` — hướng dẫn setup tiếng Việt, scopes, quota cost constants, Shorts max
- `packages/shared/src/index.ts` — export youtubeHelp

### Server
- `apps/server/src/publishing/youtubePublisher.ts` — `YouTubePublisher`: OAuth (PKCE, offline, consent), resumable upload (chunk 8 MiB), resume sau drop, Shorts `#Shorts`, thumbnail / playlist soft-fail, privacy downgrade → warning, map lỗi tiếng Việt
- `apps/server/src/publishing/youtubeQuota.ts` — theo dõi `app_settings.youtubeQuota`, midnight Pacific, `YoutubeQuotaExceededError` + reschedule
- `apps/server/src/publishing/registry.ts` / `app.ts` / `fastify.d.ts` — đăng ký YouTube luôn; expose `vgPublish.youtube`
- `apps/server/src/publishing/types.ts` + `mockPublisher.ts` + `api/oauth.ts` — `accountId` trên exchange/refresh/revoke
- `apps/server/src/publishing/publishService.ts` — truyền category/playlist/duration/thumbnail; lưu warnings; `rescheduleForQuota`; YouTube `connectBlockedReason` = setup help
- `apps/server/src/stages/publish/publishExecutor.ts` — bắt hết quota → SCHEDULED tới nửa đêm PT (không fail)
- `apps/server/src/db/schema.ts` + migration `drizzle/0024_first_umar.sql` — cột `publications.warnings`
- `apps/server/src/lib/config.ts` + `.env.example` — `YOUTUBE_DAILY_QUOTA` (default 10000); comment setup YouTube (không đụng `.env`)
- Tests: `test/youtubePublisher.test.ts`; cập nhật `test/publishing.test.ts` (TikTok chưa hỗ trợ; YouTube thiếu creds → help)

### Web
- `ProfileDetailPage.tsx` — hướng dẫn kết nối YouTube; Category ID / Playlist ID; ghi chú scope playlist
- `PublishPanel.tsx` — hiện `warnings`; hiện `lastError` khi SCHEDULED (quota)
- Tests: help YouTube + playlist note; hiện cảnh báo đăng

## Hướng dẫn setup (cho user — cũng hiện trong UI)

1. Tạo project Google Cloud, bật **YouTube Data API v3**.
2. OAuth consent screen (External), thêm tài khoản Google làm test user.
3. OAuth client Desktop hoặc Web với redirect `http://127.0.0.1:3001/api/oauth/youtube/callback`.
4. Điền Client ID/Secret vào “Thông tin ứng dụng” hoặc `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` trong `.env`.
5. Consent “Testing”: refresh token hết hạn sau 7 ngày → “Kết nối lại” hàng tuần đến khi publish consent. Video từ project API chưa xác minh có thể bị khóa private → cảnh báo, không fail.

## Test counts

| Workspace | After TASK-024B | After TASK-025 |
|---|---|---|
| shared | 197 | **197** |
| mcp | 12 | **12** |
| server | 392 | **406** |
| web | 87 | **89** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”. No `package.json` / lockfile change.

## Live / browser check
- Không chạy upload YouTube thật (theo guide: Claude live-check sau review).
- Phủ bằng fake `fetch`: auth URL/PKCE/scopes, exchange, refresh, identity, resumable 2 chunk + resume, scheduled private+publishAt, Shorts tag, thumbnail 403 → warning, privacy downgrade → warning, quota counter + refuse.
- Web: help YouTube + warnings trên PublishPanel.
- Did **not** approve gates or render on `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Deviations from the spec
- Chi phí upload theo docs hiện tại (**~100** đơn vị / `videos.insert`, không còn ~1600). `YOUTUBE_DAILY_QUOTA` mặc định vẫn 10000. Thumbnail (50) và playlistItems.insert (50) cũng được cộng khi thành công.
- Video dọc > 180s vẫn được upload như video thường (không gắn `#Shorts`) kèm warning — không từ chối upload hẳn.

## Not done
- No commit/push (per rules).
- Live OAuth/upload với tài khoản thật của user (sau review).
