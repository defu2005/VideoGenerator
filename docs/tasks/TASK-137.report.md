# TASK-137 — Kho tệp S3 cho worker

Hoàn tất triển khai và tự review ngày 2026-11-17.

- `apps/server/src/storage/{provider,sigv4,blobStore,settings,health}.ts` thêm local/S3, chữ ký AWS SigV4, dữ liệu trong vault, bản sao theo SHA-256 và theo dõi fallback. Chỉ cấp URL cho vị trí kho đang dùng. Tệp của dự án bảo vệ giữ cục bộ.
- `apps/server/src/db/schema.ts` và migration Drizzle `0085_complete_colonel_america.sql` tạo `blobs` cùng snapshot/journal. Lượt generate tiếp theo báo `No schema changes`.
- `apps/server/src/node/{leaseService,remoteBundle,agent}.ts`, `api/nodes.ts`, `app.ts` và schema node dùng URL ngắn hạn và giữ đường truyền cũ. Worker kiểm SHA-256 và kích thước đầu vào. Sau PUT trực tiếp, máy điều khiển ghi khai báo và claim finalize, rồi kiểm HEAD, tải và băm tệp rồi mới dùng luồng finalize sẵn có. Tệp sai hash gây `STORAGE_HASH_MISMATCH` với mức thử lại tối đa một lần theo policy job. Khai báo đi cùng pending bundle để phục hồi khi máy điều khiển khởi động lại.
- `api/storageSettings.ts`, `supervision/snapshot.ts` và trang `/settings/storage` cung cấp cấu hình, probe, số liệu và cảnh báo. Chủ sở hữu hoặc quản trị viên của workspace mặc định cấu hình kho dùng chung trên máy chủ. Khóa bí mật nằm trong vault. URL SigV4 mang ID của khóa ký trong trường Credential theo giao thức AWS. Khóa bí mật không được gửi qua lease.
- `docs/ARCHITECTURE.md`, `docs/THIRD_PARTY.md`, `deploy/README.md`, featureMap, hướng dẫn người dùng và changelog mô tả đường truyền, cấu hình R2 và thời gian giữ staging.

Tệp PUT đi vào prefix `incoming/` riêng theo lease để URL ghi không thể ghi đè lên `blobs/`. Kho cần lifecycle riêng cho staging đã hết hạn. Bản sao đầu vào hoàn tất trong nền, nên lease đầu tiên có thể tải qua máy điều khiển. Phiên bản worker cũ vẫn nhận manifest cũ. Khi bật kho S3 mà endpoint không hỗ trợ checksum, máy điều khiển tải và tính hash trước khi công nhận bản sao.

Kiểm chứng đến hiện tại:

- Bộ kiểm tra tích hợp cuối đạt 67/67 (`tmp/task137-final-delta.log`). Worker fixture tải S3 sai hash hai lần, quay về control, rồi gửi một output trực tiếp và một output theo đường resumable.
- Trình duyệt dùng Fastify/SQLite tạm với S3 giả lập. Lưu trả 200, probe lần lượt PUT/HEAD/GET/DELETE, kho thử trống sau probe, SQLite chỉ lưu ciphertext cho thông tin truy cập. 375 px không tràn ngang, không lỗi JS. Xem `tmp/task137-browser-result.json` và ảnh desktop/mobile.
- `npm run typecheck` và `npm run build` đạt (`tmp/task137-final-typecheck.log`, `tmp/task137-final-build.log`). `npm test --workspaces` đạt shared 765, MCP 49, server 1.529 (7 skip), web 227. Xem `tmp/task137-workspaces.log`. Lượt tích hợp 67 test bao phủ các thay đổi nhỏ ở manifest và lỗi kích thước sau lượt toàn workspace.
- Kiểm tra 372 file văn bản thay đổi đều hợp lệ UTF-8 và không có NUL. `git diff --check` đạt.

Chưa chạy với bucket R2 hoặc máy MinIO thật. Fixture kiểm giao thức của app, bytes, checksum và fallback. Không thêm dependency, không sửa cấu hình vận hành, không commit/push.
