# Báo cáo TASK-058

App kiểm tra thông tin ứng dụng OAuth trước khi lưu, phát hiện thông tin sai đã lưu và cho phép kiểm tra trước ứng dụng YouTube. Callback hiển thị kết quả tiếng Việt. Wizard cho phép sửa hoặc kết nối lại tài khoản, đồng thời dọn hàng do chính nó tạo khi người dùng huỷ. Trang Tài khoản có thao tác xoá có xác nhận và đếm riêng số tài khoản chưa kết nối.

## Tệp thay đổi

- **Shared và tài liệu trong app** — `packages/shared/src/connections/catalog.ts`, `packages/shared/src/connections/api.ts`, `packages/shared/src/schemas/publication.ts`, `packages/shared/src/features/featureMap.ts`, `packages/shared/test/platformAppInput.test.ts`.
- **Server** — `apps/server/src/api/connections.ts`, `apps/server/src/api/oauth.ts`, `apps/server/src/api/profiles.ts`, `apps/server/src/api/publications.ts`, `apps/server/src/publishing/appCredentialValidation.ts`, `apps/server/src/publishing/oauthResult.ts`, `apps/server/src/publishing/youtubePublisher.ts`, `apps/server/src/services/profileService.ts`.
- **Test server** — `apps/server/test/connections.test.ts`, `apps/server/test/profiles.test.ts`, `apps/server/test/publishing.test.ts`.
- **MCP** — `apps/mcp/src/tools.ts`, `apps/mcp/test/tools.test.ts`.
- **Web** — `apps/web/src/components/ui/Modal.tsx`, `apps/web/src/features/accounts/AccountsPage.tsx`, `apps/web/src/features/accounts/AccountsPage.test.tsx`, `apps/web/src/features/accounts/AddAccountWizard.tsx`, `apps/web/src/features/accounts/VerifyPlatformApp.tsx`, `apps/web/src/features/profiles/ProfileDetailPage.tsx`, `apps/web/src/features/settings/ConnectionsPage.tsx`, `apps/web/src/services/connectionsApi.ts`, `apps/web/src/services/profilesApi.ts`.
- **User guide** — `docs/user-guide/ket-noi.md`, `docs/user-guide/xu-ly-su-co.md`, `docs/user-guide/nhat-ky-thay-doi.md`.

## Nguồn và quyết định

- Google mô tả Web application, redirect URI khớp chính xác, lỗi `invalid_client`, `redirect_uri_mismatch`, `access_denied`, `org_internal`, `admin_policy_enforced` và `invalid_grant`. Google mô tả `unauthorized_client` trong tài liệu OpenID Connect. Regex đầy đủ của Client ID và cảnh báo tiền tố `GOCSPX-` là quy tắc của task. Với mã giả, coi `invalid_grant` là dấu hiệu thông tin app được chấp nhận theo quy ước của task. [Google OAuth web server](https://developers.google.com/identity/protocols/oauth2/web-server), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/reference).
- Google quy định refresh token trong chế độ Testing hết hạn sau 7 ngày khi yêu cầu phạm vi YouTube. Hạn mức YouTube Data API theo dự án Google Cloud. Hướng dẫn yêu cầu hoàn tất xác minh nếu Google yêu cầu. [Google OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [YouTube Data API](https://developers.google.com/youtube/data/getting-started).
- TikTok mô tả `client_key`, `client_secret` và mã uỷ quyền nhưng không nêu regex cho client key hoặc kiểm tra phân biệt app sai và mã sai trước khi người dùng cấp quyền. Chỉ áp dụng kiểm tra chung. [TikTok Login Kit](https://developers.tiktok.com/docs/en/login-kit-web?enter_method=left_navigation), [TikTok token API](https://developers.tiktok.com/docs/en/login-kit-manage-user-access-tokens).
- Meta App ID chỉ gồm chữ số theo quy tắc của task. Trang tài liệu token của Meta trả HTTP 429 khi tra cứu. TikTok và Meta trả trạng thái chưa hỗ trợ kiểm tra trước. [Meta access tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/).
- Callback hiển thị `oauth_error` cho mã không nhận diện được để tránh đưa dữ liệu tuỳ ý từ nền tảng ra giao diện. Khi state không còn trong bộ nhớ, app hiển thị hướng dẫn mở lại đăng nhập. Lựa chọn Page của Meta tiếp tục dùng luồng hiện tại. Tab tài khoản trong chi tiết hồ sơ có kiểm tra theo từng hàng, vì vậy chỉ bổ sung hướng dẫn hết hạn và gợi ý tên tại đó.

## Kiểm tra trên trình duyệt

Chạy Chromium headless với web build, API Fastify và SQLite tạm. Dùng ID và secret giả, không dùng cấu hình hay dữ liệu người dùng.

| Tình huống | Kết quả |
| --- | --- |
| Nhập email vào Client ID của YouTube | Có lỗi ngay dưới ô và nút lưu bị tắt |
| Mở wizard khi ID đã cấu hình là email giả | Hiện cảnh báo và nút Nhập lại |
| Chỉ có tài khoản chưa kết nối | Nút Kiểm tra tất cả bị tắt và trang giải thích chưa có tài khoản để kiểm tra |
| Callback `error=access_denied` và `code=x&state=bogus` | Cả hai trả HTML và tiêu đề Chưa kết nối được |
| Bấm Esc sau khi tạo tài khoản trong wizard | Hàng tạm biến mất và hàng có trước còn nguyên |

Test web với timer giả kiểm tra trợ giúp xuất hiện đúng sau 20 giây và wizard ngừng chờ khi API báo `ERROR`. Kiểm tra riêng bằng Fastify với log `info` và Google giả lập đã tìm chuỗi secret giả trong các response và toàn bộ log thu được. Chuỗi này không xuất hiện.

## Build và test

- `npm run typecheck` và `npm run build` đều qua. Vite vẫn báo cảnh báo chú thích Rollup trong Zod và kích thước chunk.
- `npx drizzle-kit generate` trong `apps/server` báo `No schema changes, nothing to migrate`.
- Lượt toàn workspace với `--maxWorkers=2 --testTimeout=30000 --hookTimeout=30000` có Shared 348 pass, MCP 19 pass, Web 171 pass. Server có 726 pass, 1 skip và 1 fail do `EPERM` khi test giả lập Copilot CLI dọn tiến trình con trên Windows.
- Chạy riêng nhóm Copilot CLI và API Kết nối sau đó có 25 pass. Nhóm wizard, trang Tài khoản và user guide có 14 pass. Nhóm publishing có 22 pass. MCP có 19 pass sau khi thêm kiểm tra chặn API thông tin ứng dụng và bắt đầu OAuth.
- Lượt server đầy đủ cuối cùng chạy riêng với cùng tham số có 85 tệp test qua, 727 test pass và 1 skip. Lỗi `EPERM` không lặp lại.

## Giới hạn kiểm tra

- Các cuộc gọi Google trong test dùng response giả lập. Kiểm tra trình duyệt dùng bản web build và API trên cổng loopback tạm để tách khỏi dữ liệu người dùng. Các luồng cấp quyền của Google, TikTok và Meta được kiểm tra bằng fixture, không đăng nhập nền tảng thật.
