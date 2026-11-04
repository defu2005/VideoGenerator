# TASK-024B report — Account management UI gaps

## What changed

### Shared
- `packages/shared/src/schemas/publication.ts` — `AccountConnectionDetailSchema` thêm `canConnect` + `connectBlockedReason`

### Server
- `apps/server/src/publishing/envAppCredentials.ts` — helper kiểm tra fallback `.env` (YouTube / TikTok / Meta)
- `apps/server/src/publishing/publishService.ts` — `connectionDetail()` trả `canConnect` / `connectBlockedReason` (không publisher → “chưa hỗ trợ”; thiếu vault + env → “chưa có thông tin ứng dụng”; `mock` không cần credentials)
- `apps/server/src/api/publications.ts` — response schema dùng `AccountConnectionDetailSchema`
- `apps/server/src/lib/config.ts` + `.env.example` — optional `YOUTUBE_*` / `TIKTOK_*` / `META_*` (fallback; không đụng `.env`)
- `apps/server/src/app.ts` + `publishing/fastify.d.ts` — expose `vgPublish.registry` cho test
- `apps/server/test/publishing.test.ts` — 4 case `canConnect` (mock ok, youtube chưa publisher, thiếu credentials, env fallback)

### Web
- `apps/web/src/services/publishApi.ts` — `saveAppCredentials` / `deleteAppCredentials`, type từ `@vg/shared`, query keys
- `apps/web/src/features/profiles/ProfileDetailPage.tsx` — card tài khoản: identity, expiry + “Sắp hết hạn”, scopes, last check, lỗi kết nối, mục Thông tin ứng dụng (ẩn với `mock`), Kết nối/lại (disabled + hint), Kiểm tra kết nối, Ngắt kết nối (confirm), Xóa thông tin ứng dụng (confirm)
- `apps/web/src/features/profiles/ProfileDetailPage.test.tsx` — form credentials clear + secret không echo, connect disabled + reason, kiểm tra kết nối gọi API, cảnh báo hết hạn

## Test counts

| Workspace | After TASK-024 | After TASK-024B |
|---|---|---|
| shared | 197 | **197** |
| mcp | 12 | **12** |
| server | 388 | **392** |
| web | 83 | **87** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. `drizzle-kit generate` → “No schema changes” (không đổi bảng). No `package.json` / lockfile change.

## Live / browser check
- Covered by web component tests (credentials save/clear, connect blocked reason, connection check, expiry warning) + server integration for `canConnect`.
- Did **not** approve gates or render on `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Deviations from the spec
- Không có. Real publishers vẫn chờ TASK-025/029/030; `canConnect` phản ánh đúng trạng thái đó.

## Not done
- No commit/push (per rules).
- YouTube / TikTok / Meta publishers (TASK-025, 029, 030).
