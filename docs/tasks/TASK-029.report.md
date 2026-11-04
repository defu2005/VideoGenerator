# TASK-029 report — TikTok publisher

## What changed

### Shared
- `packages/shared/src/publishing/tiktokHelp.ts` — hướng dẫn setup tiếng Việt, scopes, giới hạn caption/chunk, cảnh báo audit + inbox
- `packages/shared/src/schemas/profile.ts` — `tiktokUploadMode` (`direct_post` | `inbox`) trên publish settings
- `packages/shared/src/schemas/publication.ts` — `tiktokUploadMode` trên `PublishInput`
- `packages/shared/src/index.ts` — export tiktokHelp

### Server
- `apps/server/src/publishing/tiktokPublisher.ts` — `TikTokPublisher`: OAuth (client_key, scopes CSV, PKCE), creator_info → privacy resolve, Direct Post + inbox init, FILE_UPLOAD chunks (5–64 MB), status poll (~10 phút, backoff), 429 retry, chỉ vertical, kiểm tra `max_video_post_duration_sec`, `is_aigc: true`
- `apps/server/src/publishing/oauthState.ts` + `api/oauth.ts` — PKCE challenge hex cho TikTok (theo Login Kit desktop)
- `apps/server/src/publishing/registry.ts` / `app.ts` / `fastify.d.ts` — đăng ký TikTok luôn; expose `vgPublish.tiktok`
- `apps/server/src/publishing/publishService.ts` — truyền `tiktokUploadMode` từ account settings vào `PublishInput`
- `.env.example` — comment setup TikTok (không đụng `.env`)
- Tests: `test/tiktokPublisher.test.ts`; cập nhật `test/publishing.test.ts` (Facebook Reels = chưa hỗ trợ; TikTok thiếu creds → chặn Kết nối)

### Web
- `ProfileDetailPage.tsx` — hướng dẫn kết nối TikTok; chọn Direct Post / Gửi vào hộp thư nháp; gợi ý audit SELF_ONLY
- Tests: help TikTok + hint chế độ inbox

## Giới hạn nền tảng (quan trọng)
Cho đến khi app TikTok của user được TikTok **audit**, Direct Post chỉ đăng được `SELF_ONLY`. Khi user yêu cầu công khai mà options không có `PUBLIC_TO_EVERYONE`, publisher đăng `SELF_ONLY` và ghi cảnh báo: **「Ứng dụng TikTok chưa được duyệt: video đăng ở chế độ riêng tư」**.

## Hướng dẫn setup (cho user — cũng hiện trong UI)

1. Tạo app trên developers.tiktok.com, bật Login Kit + Content Posting API.
2. Redirect URI `http://127.0.0.1:3001/api/oauth/tiktok/callback`. TikTok có thể yêu cầu HTTPS / domain đã đăng ký — làm theo console của họ (không bịa workaround).
3. Điền Client Key / Client Secret vào “Thông tin ứng dụng” hoặc `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` trong `.env`.
4. Scopes: `user.info.basic,video.publish,video.upload`.
5. Chỉ đăng render dọc (9:16). Lên lịch dùng ticker TASK-024 (API TikTok không có `publishAt` gốc).

## Test counts

| Workspace | After TASK-028B | After TASK-029 |
|---|---|---|
| shared | 208 | **208** |
| mcp | 12 | **12** |
| server | 433 | **451** |
| web | 93 | **94** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”. No `package.json` / lockfile change. No migration (không đổi schema).

## Live / browser check
- Không chạy OAuth/upload TikTok thật (theo guide: Claude live-check sau review).
- Phủ bằng fake `fetch`: auth URL/PKCE hex/scopes, exchange, refresh (token rotation), identity, creator_info privacy downgrade, chunk plan, init → chunks → status complete, FAILED status, inbox `SEND_TO_USER_INBOX`, duration limit, landscape reject.
- Web: help TikTok + chế độ inbox trên form tài khoản.
- Did **not** approve gates or render on `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Deviations from the spec
- Field `username` trên `/v2/user/info/` theo docs hiện tại thuộc `user.info.profile`; guide chỉ liệt kê scope `user.info.basic`. Vẫn request `open_id,display_name,username`; nếu username trống thì dùng profile URL từ `creator_username` khi đăng / fallback `https://www.tiktok.com/`.
- `brand_content_toggle` / `brand_organic_toggle` gửi `false` (bắt buộc theo schema Direct Post hiện tại).

## Not done
- No commit/push (per rules).
- Live OAuth/upload với tài khoản/app TikTok thật của user (sau review).
