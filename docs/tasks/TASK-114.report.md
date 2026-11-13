# TASK-114 — Đăng nhập, chủ sở hữu đầu tiên, bảo vệ mọi route (báo cáo hoàn thiện)

Hoàn thiện bởi Claude Sonnet (Cursor hết hạn mức). Không commit, không push.

## Đã làm
- Better Auth + `@better-auth/api-key` 1.7.21 (email+mật khẩu, session cookie, rate limit, twoFactor/apiKey ở backend). Module `apps/server/src/auth/`.
- Migration: `apps/server/drizzle/0065_auth-core.sql` (+ snapshot). `npx drizzle-kit generate` báo "No schema changes".
- Chủ sở hữu = cột `user.role = 'owner'`.
- Web: `LoginPage`, `SetupPage`, tên người dùng + "Đăng xuất" trong sidebar, 401 → về đăng nhập.
- Hướng dẫn: `docs/user-guide/dang-nhap.md`.
- Sửa lần này: (1) `AppLayout.tsx` khai báo `session` nhầm trong `CommentNavLink`, chuyển lên `AppLayout`; (2) `auth/setup.ts` kiểm tra "đã có người dùng" (409) trước kiểm tra loopback/mã (403), nên lần gọi thứ hai hoặc song song trả 409, gọi từ xa không có mã lần đầu vẫn 403.

## Danh sách mở (không cần đăng nhập)
- `/api/health` (giám sát), `/api/auth/*` (đăng nhập), `/api/setup/*` (thiết lập lần đầu, tự khoá khi đã có chủ)
- `GET /api/oauth/:platform/callback`, `GET /api/settings/llm-providers/openrouter/callback` (dịch vụ ngoài gọi về, có `state`)
- `POST /api/knowledge/webhooks/tiktok` (TikTok gọi vào, tự xác thực chữ ký)
- `OPTIONS` (CORS preflight)

## Máy khách tự động
- MCP: gửi `x-api-key` từ env `VG_API_KEY`, nếu không có thì đọc `DATA_DIR/secrets/local-services.key` (cùng máy).
- Khoá cục bộ "local-services" tạo khi tạo chủ sở hữu, lưu ở `DATA_DIR/secrets/`.
- Trợ lý, Telegram, operator: gọi service trong tiến trình, không đi qua HTTP (grep không thấy gọi HTTP nội bộ), nên không đổi. Telegram đã ghép cặp vẫn chạy.

## node_modules (platform packages)
Sau khi cài: `@esbuild` có `linux-x64`, `win32-x64`; `@rollup` có `rollup-win32-x64-gnu`, `rollup-win32-x64-msvc`. Không chạy `npm install` trong phiên này; không có bản "trước" để so ngoài ghi chú của kiến trúc sư.

## Kết quả kiểm tra
- `npm run typecheck` (gốc): xanh.
- `packages/shared`: 716/716. `apps/mcp`: 21/21. `apps/web`: 185/185.
- `apps/server`: `auth.test.ts` 8/8. Chạy cả bộ lúc máy đang tải nặng (có phiên TASK-121 chạy song song) có 14 lỗi do timeout 30–65 giây ở các file assistant, automation, connections, pipeline, openverse, telegram…; chạy lại riêng assistant/automation/connections/auth đều xanh (53/53). `render.test.ts` đã biết hay timeout (ffmpeg/EPERM). Nên chạy lại cả bộ khi máy rảnh.
- Lưu ý: `packages/shared/dist` đã cũ so với mã TASK-121 (`defaultRepairSettings`), đã build lại bằng `npm run build -w @vg/shared`.
- Kiểm tra thủ công với `DATA_DIR` tạm, cổng 3999: `/api/projects` không đăng nhập → 401; `setup/status` → `userExists:false`; tạo chủ → 201; tạo lần hai → 409; đăng nhập → có cookie; `/api/projects` → 200; đăng xuất → lại 401; có `secrets/better-auth.secret` và `local-services.key`. Đã dừng server, không đụng `data/` thật. (Chưa mở trình duyệt thử giao diện.)

## Sau khi khởi động lại, người dùng làm gì
1. Khởi động lại server. Khi chưa có người dùng, log in "Mã thiết lập một lần ..." (chỉ cần nếu mở từ máy khác).
2. Mở web từ chính máy chạy server: sẽ ra trang thiết lập; nhập tên, email, mật khẩu (≥ 8 ký tự). Từ máy khác thì dán mã trong log.
3. Đăng nhập. Sau đó MCP trên cùng máy tự dùng khoá `secrets/local-services.key`; máy khác đặt `VG_API_KEY`.
