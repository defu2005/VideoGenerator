# TASK-030 report — Facebook Reels + Instagram Reels publishers

## What changed

### Shared
- `packages/shared/src/publishing/metaHelp.ts` — hướng dẫn setup tiếng Việt, scopes Meta, `META_GRAPH_VERSION` (`v26.0`), giới hạn FB/IG, copy cảnh báo `Cần kết nối lại`
- `packages/shared/src/schemas/publication.ts` — `MetaTargetPublic` trên `AccountConnectionDetail`, `SelectMetaTargetBodySchema`
- `packages/shared/src/index.ts` — export metaHelp

### Server
- `apps/server/src/publishing/metaGraph.ts` — helper Graph chung: OAuth dialog, exchange + long-lived swap, `/me/accounts` discovery, identity Page/IG, `mapMetaGraphError` (190 / 10·200 / 4·17·32·613), fetch retry chỉ cho rate-limit + 5xx
- `apps/server/src/publishing/facebookReelsPublisher.ts` — `FacebookReelsPublisher`: start → rupload → finish (`PUBLISHED` / `SCHEDULED` + `scheduled_publish_time`) → poll status; `is_ai_generated=true`; chỉ vertical; 3–90s; ~1 GB
- `apps/server/src/publishing/instagramReelsPublisher.ts` — `InstagramReelsPublisher`: `content_publishing_limit` → container REELS resumable → rupload → poll `FINISHED` → `media_publish`; không schedule gốc; chỉ vertical; 3s–15 phút; 300 MB
- `apps/server/src/publishing/registry.ts` / `app.ts` / `fastify.d.ts` — đăng ký cả hai publisher
- `apps/server/src/publishing/publishService.ts` — `metaTargets` khi `external_id` còn `pending:*`; `selectMetaTarget` (đổi user token → Page token); `bindExternalId` trước upload/check
- `apps/server/src/api/oauth.ts` — sau callback Meta redirect `?metaPick=<accountId>`
- `apps/server/src/api/publications.ts` — `POST …/meta-target`
- `.env.example` — comment setup Meta (`META_APP_ID` / `META_APP_SECRET` đã có sẵn)
- Tests: `test/metaPublishers.test.ts`; cập nhật `test/publishing.test.ts` (FB thiếu creds → chặn Kết nối, không còn “chưa hỗ trợ”)

### Web
- `ProfileDetailPage.tsx` — hướng dẫn Meta; picker Page/IG; cảnh báo hết hạn Meta = **Cần kết nối lại**
- `publishApi.ts` — `selectMetaTarget`
- Tests: help Meta + picker + cảnh báo hết hạn

## Hướng dẫn setup (cho user — cũng hiện trong UI)

1. Tạo app Business trên developers.facebook.com, thêm Facebook Login.
2. Redirect URI `http://127.0.0.1:3001/api/oauth/facebook_reels/callback` (hoặc `…/instagram_reels/callback`). Nếu Meta bắt buộc HTTPS, làm theo console của họ (không bịa workaround).
3. Điền App ID / App Secret vào “Thông tin ứng dụng” hoặc `META_APP_ID` / `META_APP_SECRET` trong `.env`.
4. Development mode đủ cho tài khoản có role trong app (Page + IG của chính user).
5. Sau login: chọn Page (FB Reels) hoặc IG professional liên kết Page (IG Reels). Token ~60 ngày.

## Test counts

| Workspace | After TASK-029 | After TASK-030 |
|---|---|---|
| shared | 208 | **208** |
| mcp | 12 | **12** |
| server | 451 | **466** |
| web | 94 | **95** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”. No `package.json` / lockfile change. No migration (không đổi schema).

## Live / browser check
- Không chạy OAuth/upload Meta thật (Claude live-check sau review).
- Phủ bằng fake `fetch`: auth URL/scopes/version, exchange + long-lived, Page/IG discovery, FB start→upload→finish→status (+ schedule + AI flag), IG quota→container→upload→poll→publish, error mapping, duration/format reject, pending identity.
- Web: help Meta + Page picker + “Cần kết nối lại”.
- Did **not** approve gates or render on `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Deviations from the spec
- Instagram Content Publishing limit theo docs hiện tại có thể là 100/24h; vẫn đọc `content_publishing_limit` live và fallback soft `50` khi thiếu `quota_total`.
- `bindExternalId` trên publisher (thay vì mở rộng `PublishInput`) để truyền Page/IG id vào upload/check — giữ nguyên interface TASK-024.
- IG không có field AI-disclosure rõ trong API dùng ở đây → không gửi thêm field (theo guide).

## Not done
- No commit/push (per rules).
- Live OAuth/upload với Meta app + Page/IG thật của user (sau review).
