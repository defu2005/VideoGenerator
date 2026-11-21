# TASK-166 — cleanup giữ file mà job chưa kết thúc còn liên kết (báo cáo)

Trạng thái: thay đổi `src/` đầu tiên của chuỗi TASK-159…165, theo quyết định advisor (2026-11-21), không phải xác nhận trực tiếp của người dùng. Commit cục bộ, **chưa push, không có `.done`**.

## Thay đổi

- `apps/server/src/node/leaseService.ts`, `cleanupFinishedUploads`: trước `rmSync` (nhánh a), nếu file còn hàng `linked` của job **chưa kết thúc** trỏ tới thì `continue`. `continue` đi trước `DELETE`, nên **giữ cả file lẫn hàng**. Lần quét sau xét lại khi không còn job nào liên kết.
- Thêm `linkedByUnfinishedJob(file)`. "Chưa kết thúc" là phần bù của tập trong câu truy vấn cleanup (`SUCCEEDED`, `FAILED`, `CANCELLED`), không liệt kê `RUNNING`/`QUEUED`.
- Khớp cả hai dạng đường dẫn: hàng chủ lưu dạng `join` (kiểm tra `expected !== row.path` ở cùng vòng lặp), hàng `linked` lưu `realpath` (`uploadStore.ts:54` lấy từ `artifacts`, mà `references.ts:170` ghi bằng `realpathSync.native`). Nếu chỉ khớp một dạng, guard sẽ không bao giờ kích hoạt trên Windows khi hai dạng khác nhau.

## Kiểm tra đường dẫn (trước khi viết guard)

- `cleanupFinishedUploads` chỉ xóa file khi `expected === row.path`, nên hàng chủ luôn có dạng `join`.
- Hàng `linked` của B lấy `realpath` từ `artifacts`. Hai dạng có thể khác nhau; guard kiểm tra cả hai.

## Test (viết trước, rồi mới thêm guard)

- `leaseGcLinkedPending.test.ts`: chuỗi TASK-162 đổi kết quả thành **keep-row**.
  - Sau cleanup 25 h khi B còn RUNNING: `fileA` còn, hàng `final.mp4` của A còn `ready`. Hàng `report.json` của A bị xóa, vì không job nào liên kết tới nó (đúng như cũ).
  - B `complete` thành công, `finalize` gọi 2 lần, B `SUCCEEDED`.
  - Sau 25 h nữa: `fileA` và hàng của A bị xóa; hàng của B cũng bị xóa.
  - Xác nhận bảng artifacts còn trỏ tới file đã xóa (TASK-163 đã đo).
- `leaseRetryAfterMissingLink.test.ts`: bước cleanup trong `reachEnoent` và test attempt cuối được thay bằng `rmSync(fileA)`, ghi rõ là **giả lập**. Mục đích: vẫn tạo được ENOENT để giữ phần phủ retry của TASK-163/164.
- Đỏ trước guard: keep-row test đỏ tại `existsSync(fileA)` (`true` mong đợi). Các test retry vẫn xanh vì dùng unlink trực tiếp.

## Kết quả

- Năm file (`leaseGcLinkedPending`, `leaseRetryAfterMissingLink`, `leaseCleanupUploads`, `fileGcPendingUploads`, `fileGcPurgeIndex`): 30/30 xanh.
- `npx tsc --noEmit` (apps/server): exit 0.
- Toàn bộ `apps/server`: 305 file đạt, 4 bỏ qua; 2508 test đạt, 9 bỏ qua.
- Mutant M5 (xóa dòng guard trong `leaseService.ts`): keep-row test **đỏ** như dự đoán. Đã khôi phục bằng `cp` từ bản sao lưu, `cmp` khớp.

## Hạn chế cần nêu

- Job `QUEUED` còn hàng `linked` của lease cũ cũng chặn file của A cho đến khi job đó kết thúc. Đây là hệ quả của `NOT IN` đã chọn, không phải lỗi, nhưng có nghĩa là file có thể sống lâu hơn 24 h.
- `LIMIT 1000` không có `ORDER BY`: hàng bị chặn có thể chiếm cửa sổ quét. Chưa đo ở quy mô lớn.
- `report.json` của A không bị liên kết nên vẫn bị dọn như cũ. Chỉ file được liên kết mới được giữ.
- Bảng `artifacts` vẫn có thể trỏ tới file đã dọn (stale), đúng như TASK-163 đã ghi. `locate` trả `undefined` và job tải lại.
- Chưa đo phía agent, và chưa đo GC chạy giữa lúc A kết thúc và B được lease.
- Option 2 (TASK-167) chưa làm. Nó chỉ đổi mã lỗi, không thuộc phạm vi task này.
