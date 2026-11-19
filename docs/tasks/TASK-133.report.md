# TASK-133 report: TOTP QR code & edge-tts version check 🔧

## Những việc đã làm

### 1. Mã QR cho xác thực hai bước (TOTP 2FA - web)
- **Nhúng mã nguồn mở (vendoring):**
  - Nhúng **Project Nayuki's QR Code generator** (TypeScript version, MIT) dưới dạng file đơn `apps/web/src/lib/vendor/qrcodegen.ts`.
  - Giữ nguyên toàn bộ tiêu đề bản quyền và giấy phép MIT ban đầu của tác giả.
  - Thêm mục tương ứng vào `docs/THIRD_PARTY.md`.
  - Không cài thêm bất kỳ gói npm nào.
- **Hiển thị giao diện (`apps/web/src/features/account/AccountPage.tsx`):**
  - Thêm component `TotpQrCode`: mã hoá chuỗi `totpURI` thành mã QR với mức sửa lỗi Medium (M), vùng đệm 4 module (`quietZone = 4`).
  - Render mã QR dạng inline SVG sử dụng `fill="currentColor"` đặt trên một ô màu sáng (`background: #ffffff`, `color: #000000`, viền nhẹ) giúp camera điện thoại quét dễ dàng cả trong giao diện tối (Dark mode) và giao diện sáng.
  - Đặt mã QR ngay phía trên chuỗi khoá bí mật.
  - Giữ nguyên nhãn "Quét mã QR bằng ứng dụng xác thực" và các phương án dự phòng: hiển thị chuỗi khoá bí mật với nút "Chép khóa" và liên kết "Thêm vào ứng dụng xác thực".
  - Hoạt động 100% cục bộ trên trình duyệt: không gửi URI hay khoá bí mật tới bất kỳ máy chủ hay dịch vụ ngoài nào, không ghi log bí mật.

### 2. Kiểm tra phiên bản edge-tts (server)
- **Hàm `edgeTtsVersion()` (`apps/server/src/providers/tts/edgeTts.ts`):**
  - Chạy binary đã phát hiện với cờ `--version`, timeout 5 giây, xử lý fallback `python -m edge_tts --version` trên Windows nếu bị chặn spawn.
  - Phân tích chuỗi đầu ra trích xuất phiên bản dạng `x.y.z` (hỗ trợ đầu ra thường, tiền tố `edge-tts`, `Python ... / edge-tts`, và trả về `unknown` nếu gặp dữ liệu rác/lỗi).
  - Cache kết quả theo đường dẫn binary trong 10 phút.
- **Hằng số `EDGE_TTS_MIN_VERSION`:**
  - Khai báo hằng số `EDGE_TTS_MIN_VERSION = "7.3.1"` với chú thích hướng dẫn nâng cấp khi Microsoft thay đổi endpoint.
  - Giá trị khởi đầu đặt theo phiên bản thực tế trên máy người dùng (`edge-tts 7.3.1` qua kiểm tra môi trường).
- **Hiển thị trên trang Cài đặt TTS và `/api/health`:**
  - Cập nhật `TtsProviderStatusSchema` (`packages/shared/src/schemas/tts.ts`), `describeTtsProviders` (`apps/server/src/settings/tts.ts`), và `GET/PUT /api/settings/tts` (`apps/server/src/api/ttsSettings.ts`) để gửi kèm `binaryPath`, `version`, `versionStatus`.
  - Trang `apps/web/src/features/settings/TtsSettingsPage.tsx` hiển thị đường dẫn, phiên bản và trạng thái ("OK" hoặc "cũ — chạy: `pip install -U edge-tts`").
  - Route `/api/health` trả về trường `details.edgeTts` gồm `path`, `version`, và `status`.
- **Ánh xạ lỗi `TTS_BINARY_OUTDATED` & failover:**
  - Khi tổng hợp giọng đọc qua `edge-tts` thất bại và phiên bản đang cài thấp hơn `EDGE_TTS_MIN_VERSION`, lỗi được ánh xạ thành `StageError` với mã lỗi mới `TTS_BINARY_OUTDATED` (`retryable: false`).
  - Thông báo lỗi tiếng Việt chứa câu lệnh chính xác: `pip install -U edge-tts`.
  - Nếu phiên bản không xác định (`unknown`), hệ thống không báo lỗi giả "outdated".
  - Cơ chế dự phòng `runProviderFallback` (`packages/shared/src/tts/catalog.ts`) xử lý `TTS_BINARY_OUTDATED` như trạng thái "chưa cấu hình", lập tức chuyển giao việc tạo giọng cho nhà cung cấp TTS tiếp theo trong chuỗi (ví dụ `piper` hoặc `mock`) mà không thử lại `edge-tts`.
  - Ứng dụng không tự ý chạy lệnh pip.

### 3. Tài liệu & Nhật ký
- Cập nhật `docs/THIRD_PARTY.md` ghi nhận thư viện Project Nayuki QR Code generator (MIT).
- Cập nhật `docs/user-guide/khong-gian-va-quyen.md` phần Tài khoản của tôi về quét mã QR 2FA.
- Cập nhật `docs/user-guide/hinh-anh-va-giong-doc.md` và `docs/user-guide/xu-ly-su-co.md` về kiểm tra phiên bản edge-tts và mã lỗi `TTS_BINARY_OUTDATED`.
- Cập nhật `docs/user-guide/nhat-ky-thay-doi.md` mục `## TASK-133`.

## Danh sách file thay đổi & tạo mới

### Tạo mới:
- `apps/web/src/lib/vendor/qrcodegen.ts`
- `apps/web/src/features/account/qr.test.tsx`
- `apps/server/test/edgeTtsVersion.test.ts`
- `docs/tasks/TASK-133.report.md`
- `docs/tasks/TASK-133.done`

### Chỉnh sửa:
- `apps/web/src/features/account/AccountPage.tsx`
- `apps/web/src/features/settings/TtsSettingsPage.tsx`
- `apps/web/src/features/settings/TtsSettingsPage.test.tsx`
- `apps/server/src/providers/tts/edgeTts.ts`
- `apps/server/src/providers/tts/registry.ts`
- `apps/server/src/settings/tts.ts`
- `apps/server/src/api/ttsSettings.ts`
- `apps/server/src/api/health.ts`
- `apps/server/src/app.ts`
- `apps/server/src/lib/config.ts`
- `packages/shared/src/schemas/tts.ts`
- `packages/shared/src/tts/catalog.ts`
- `docs/THIRD_PARTY.md`
- `docs/user-guide/khong-gian-va-quyen.md`
- `docs/user-guide/hinh-anh-va-giong-doc.md`
- `docs/user-guide/xu-ly-su-co.md`
- `docs/user-guide/nhat-ky-thay-doi.md`

## Sai lệch so với đặc tả (Deviations)
- Không có. Toàn bộ yêu cầu của TASK-133 được tuân thủ nghiêm ngặt.

## Những việc chưa làm (What is not done)
- Không có. Toàn bộ các hạng mục đã hoàn thành.

## Kết quả kiểm thử (Verification)
- `npm run typecheck`: Đạt 100% trên cả 4 workspace (`@vg/shared`, `@vg/mcp`, `@vg/server`, `@vg/web`).
- `npm run build`: Hoàn thành thành công cho toàn bộ monorepo.
- `apps/web`: 76 test files passed (213 tests passed), bao gồm 3/3 test TOTP QR (`qr.test.tsx`), 8/8 test tài khoản (`team116.test.tsx`), test cài đặt TTS (`TtsSettingsPage.test.tsx`) và 5/5 test độ phủ hướng dẫn (`guideCoverage.test.ts`).
- `apps/server`: 18/18 tests edge-tts passed (`edgeTtsVersion.test.ts`: 11 passed; `edgeTts.test.ts`: 7 passed).
- `packages/shared`: 12/12 tests TTS selection and fallback passed (`tts.test.ts`).
- `apps/mcp`: 22/22 tests passed (`tools.test.ts`).
- `drizzle-kit generate`: In "No schema changes, nothing to migrate" (không thay đổi cấu trúc bảng DB).
