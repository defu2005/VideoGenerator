# TASK-056 report: thiết lập mọi thứ trong app (khoá, nhà cung cấp AI, nhiều tài khoản nền tảng)

## Đã làm
- Server `apps/server/src/settings/secrets.ts`:
  - Kho khoá dùng TokenVault (mã hoá bằng `data/secrets/token.key`).
  - Cách đọc khoá: lấy trong app trước, nếu không có thì lấy từ `.env`. Code cũ vẫn đọc khoá qua lớp này nên không phải sửa từng chỗ.
  - `describeSecret` trả về nguồn (app/env/none), 4 ký tự cuối và lỗi `UNREADABLE`. Không bao giờ trả khoá ra trình duyệt hay ghi vào log.
- API `apps/server/src/api/connections.ts`:
  - Nhà cung cấp AI: bật/tắt, lưu và xoá khoá, base URL, model, nhà cung cấp tuỳ chỉnh tương thích OpenAI, kiểm tra, đăng nhập OpenRouter (PKCE).
  - Khoá kho ảnh và tìm ảnh web.
  - Nhập từ `.env`: chỉ chép khoá còn thiếu và chỉ báo tên khoá.
  - Tổng quan và trạng thái **Thiết lập ban đầu** (lưu trong `app_settings`).
  - Danh sách mọi tài khoản, chuyển hồ sơ, tìm tài khoản trùng.
  - Ứng dụng nhà phát triển theo thứ tự: tài khoản → hồ sơ → dùng chung → `.env`.
- Kiểu dữ liệu dùng chung nằm ở `packages/shared/src/connections/`.
- Web:
  - Trang `/settings/connections` (`ConnectionsPage`, `KeyRow`).
  - Trang `/accounts` (`AccountsPage`, `AddAccountWizard`).
  - Thẻ `SetupChecklist` trên Bảng điều khiển.
  - Ô nhập khoá trên trang Nguồn ảnh và Nguồn ảnh web.
  - Mục mới trong thanh bên và Ctrl+K.
- Trợ lý và MCP không có công cụ nào đọc, lưu hoặc xoá khoá, hay mở OAuth.
- Không đổi schema bảng nên không có migration mới. `drizzle-kit generate` báo không có thay đổi.
- Tài liệu: trang mới `docs/user-guide/ket-noi.md`, liên kết từ Bắt đầu nhanh (README) và `dang-bai.md`. Thêm mục vào `GUIDE_PAGES`, featureMap (`connections`, `all-accounts`) và nhật ký thay đổi.

## Kiểm chứng
- `apps/server/test/connections.test.ts` (14 test):
  - Thứ tự đọc khoá giữa app và `.env`, cùng lỗi `UNREADABLE`.
  - Khoá không lọt ra phản hồi API.
  - Nhập từ `.env` chỉ chép khoá thiếu.
  - Nhà cung cấp tuỳ chỉnh.
  - Đăng nhập OpenRouter với `fetch` giả.
  - Chuyển hồ sơ và tìm tài khoản trùng.
  - Thứ tự chọn ứng dụng nhà phát triển.
  - Ẩn checklist.
- Web:
  - `KeyRow.test.tsx`: lưu khoá đã cắt khoảng trắng, nhãn nguồn, nút Xoá, cảnh báo `UNREADABLE`, lỗi khi kiểm tra.
  - `SetupChecklist.test.tsx`: hiện các bước, nút Ẩn, không hiện gì khi đã ẩn.
  - `AccountsPage.test.tsx`: bộ lọc, thanh cảnh báo, và trình thêm tài khoản với Redirect URI và lưu ứng dụng.
- Không test nào dùng mạng thật, OAuth thật hay khoá thật.

## Ghi chú
- Không kiểm lại tài liệu OpenRouter trên mạng trong lúc làm. Luồng PKCE theo hướng dẫn task: `https://openrouter.ai/auth` rồi `POST /api/v1/auth/keys`. Hãy thử một lần với tài khoản thật.
- Cursor CLI bị Windows Application Control chặn (ERR_DLOPEN_FAILED), nên Claude làm trực tiếp.
