# TASK-167 — file liên kết bị thiếu trả 422 `LINKED_FILE_MISSING` thay vì ENOENT thô (báo cáo)

Trạng thái: thay đổi `src/` (`apps/server/src/node/leaseService.ts`, `finalizeHeld`) và sửa khẳng định trong `apps/server/test/leaseRetryAfterMissingLink.test.ts`. Theo quyết định advisor (2026-11-21), không phải xác nhận trực tiếp của người dùng. Commit cục bộ, **chưa push, không có `.done`**.

## Thay đổi

- `finalizeHeld`, vòng kiểm hàng `linked`: `sha256File(record.path)` nay được bọc. Nếu lỗi là `ENOENT` hoặc `ENOTDIR`, ném `AppError(422, "LINKED_FILE_MISSING", …)`. Lỗi khác được ném lại nguyên. Hàng `ready` vẫn bị bỏ qua như cũ.
- Vì sao 422: agent chỉ bỏ qua 409/410 (`agent.ts:795–811`, đã đọc ở TASK-163). Non-ok khác thì agent throw và POST `/fail` với `retryable: true`. Với 409/410, agent bỏ qua mà không `/fail`, và job treo tới khi lease hết hạn. Nên 422 giữ đúng đường `/fail` đã đo ở TASK-163/164.
- Test đọc `statusCode` (tên thuộc tính của `AppError`), không đọc `status`.

## Test (viết trước)

- Hai khẳng định `code: "ENOENT"` trong `leaseRetryAfterMissingLink.test.ts` (`reachEnoent` và test attempt cuối) đổi thành `{ statusCode: 422, code: "LINKED_FILE_MISSING" }`.
- Lần chạy trước khi sửa `src/`: **3/3 đỏ**, đúng dự đoán. Lỗi là `expected Error: ENOENT … to match object { statusCode: 422 … }`.
- `leaseGcLinkedPending.test.ts` không còn khẳng định ENOENT, vì sau TASK-166 luồng keep-row hoàn tất và không có ENOENT. Dòng "163" nêu trong bảng TASK-165 là trạng thái trước TASK-166 và không còn đúng.

## Kết quả

- Sau khi sửa `src/`, năm file lease/GC: **30/30 xanh**.
- `npx tsc --noEmit` (apps/server): exit 0.
- Toàn bộ `apps/server`: **305 file đạt, 4 bỏ qua; 2508 test đạt, 9 bỏ qua**. Số liệu giống TASK-166.
- Mutant M7 (bỏ mapping: `if (error.code === "ENOENT" || error.code === "ENOTDIR") {` → `if (false) {`): ba test retry **đỏ** với `code: "ENOENT"`. Đã khôi phục bằng `cp` từ bản sao lưu trong scratchpad, `cmp` khớp.

## Không kiểm / giới hạn

- **Phía agent:** chỉ đọc mã. Chưa chạy agent thật để xác nhận 422 đi tới `/fail` retryable.
- **Tầng test:** khẳng định trên `AppError` thrown từ method service (`complete`), không qua HTTP. Việc `app.ts` map `AppError` thành HTTP 422 qua route là đọc mã, chưa đo.
- **`ENOTDIR`** được map cùng ENOENT. Chưa có test riêng cho `ENOTDIR`.
- **Phạm vi:** mapping chỉ áp cho hàng `linked` trong `finalizeHeld`. Các đường khác (`completeVoice`, `completeMedia`) không đổi, chưa đo.
- **Không đổi số attempt:** vẫn tốn một attempt. Ở attempt cuối vẫn thành `FAILED` (TASK-164). Option 2 chỉ đổi mã lỗi, không ngăn mất file.
- **Lớp phòng thủ:** nguyên nhân gốc (cleanup dọn file còn liên kết) đã xử lý ở TASK-166 cho job chưa kết thúc. Mapping này bắt các trường hợp còn lại, ví dụ file bị mất vì lý do khác. Run-scope (`run_uploads`) chưa được guard, xem TASK-166 §Hạn chế (ứng viên TASK-168).
