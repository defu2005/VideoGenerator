# TASK-165 — các hướng sửa chuỗi TASK-159…164 (ghi chú, chưa sửa)

Trạng thái: chỉ đọc mã và tra cứu test (grep). **Không sửa `src/`, không chạy mutant, không có test mới.** Commit cục bộ theo quyết định advisor (2026-11-21), không phải xác nhận trực tiếp của người dùng. **Chưa push, không có `.done`.** Việc triển khai chờ advisor duyệt hướng.

## Chuỗi cần sửa (đã đo qua TASK-162 đến TASK-164, fixture)

1. Job A RUNNING, GC chạy: `references.ts:166–177` gọi `artifactRegistry.registerSync(real)` cho file pending của A (`render/pending/<A>.uploads/...`). Hàng `artifacts` của sha video trỏ tới file đó.
2. Job B lease, `haveOutputs` → `artifacts.locate` thấy file (đúng mtime) → hàng `linked` trỏ tới file của A.
3. A SUCCEEDED. Sau 24 giờ, `cleanupFinishedUploads` (`leaseService.ts:424–437`) xóa file của A (nhánh a: hàng `ready`, lease UUID, tên trong `ANY_OUTPUT`, đường dẫn khớp).
4. B `complete` → `finalizeHeld` (`leaseService.ts:620`) `sha256File(record.path)` ném `ENOENT` thô. Không phải `AppError`, nên `app.ts:1188` trả 500 `INTERNAL_ERROR`.
5. Agent POST `/fail` retryable (`agent.ts:807–811`). B re-queue (TASK-163) hoặc `FAILED` khi hết attempt (TASK-164). Re-lease upload lại bytes, nên không mất dữ liệu cuối, nhưng tốn attempt.

Gốc vấn đề: hai hệ thống không thống nhất ai sở hữu file pending sau khi job hoàn tất. GC coi nó là tham chiếu (`artifacts`), cleanup coi nó là rác (sau 24 giờ), và một hàng `linked` của job khác trỏ tới nó.

## Ba hướng

| Hướng | Thay đổi | Điểm đặt | Test sẽ đỏ (đã tra bằng grep) | Test không đổi (đã tra) |
|---|---|---|---|---|
| **1. Cleanup giữ file mà hàng `linked` của job chưa kết thúc đang trỏ tới** | Trước `rmSync` (nhánh a), kiểm tra `node_uploads` có hàng `linked` với cùng `path` của job RUNNING/QUEUED. Nếu có, `continue` **trước** `rmSync` và trước `DELETE`: giữ cả file lẫn hàng, lần quét sau xét lại khi job đó đã kết thúc. | `leaseService.ts:430–434` | `leaseGcLinkedPending.test.ts:153` (`existsSync(fileA) === false` sau cleanup); `leaseRetryAfterMissingLink.test.ts:137`, `:241` (cùng khẳng định); toàn bộ chuỗi ENOENT của TASK-163/164 không còn xảy ra. | `leaseCleanupUploads.test.ts:118` (hàng `linked` của **chính** job SUCCEEDED, file vẫn giữ, hàng bị xóa: không đổi vì không có job chưa kết thúc). |
| **2. `finalizeHeld` đổi ENOENT thô thành `AppError`** | Bọc `sha256File(record.path)` ở `:620`: file thiếu → `AppError(409 hoặc 422, "LINKED_FILE_MISSING", …)`. Không đổi dữ liệu, không đổi cleanup/GC. | `leaseService.ts:620` | `leaseGcLinkedPending.test.ts:163` (`code: "ENOENT", path`); `leaseRetryAfterMissingLink.test.ts:140` (reachEnoent) và `:244` (TASK-164). | `leaseCleanupUploads`, `fileGc*`. TASK-163 T1/T2 và TASK-164: đường `/fail` không đổi nếu mã là 422 (agent `:795–811`: non-ok, không phải 409/410, nên throw rồi `/fail`). Nếu chọn 409 hoặc 410, agent bỏ qua mà không `/fail` (đã đọc ở TASK-163), và job treo đến khi lease hết hạn. **Nên chọn 422.** |
| **3. GC không đăng ký file trong `render/pending` vào `artifacts`** | Trong vòng `graph` ở `references.ts:166–177`, bỏ qua đường dẫn thuộc `render/pending` trước `registerSync`. | `references.ts:167–172` | `leaseGcLinkedPending.test.ts:131` (`artifactPath === realA`), `:140` (hàng `linked` trỏ tới `realA`); `leaseRetryAfterMissingLink.test.ts:132–133` (`haveOutputs` → `["final.mp4"]` trên lease 1), `:171–172`, `:184`. | `leaseCleanupUploads.test.ts`, `fileGcPendingUploads.test.ts` (TASK-159: file không có hàng `artifacts`, và dựa vào trạng thái job, không vào `artifacts`), `fileGcPurgeIndex.test.ts` (đăng ký trực tiếp, không qua GC). Chưa chạy: xem §Chưa biết. |

## So sánh

- **Hướng 2** là thay đổi nhỏ nhất và giữ nguyên đường retry của TASK-163/164. Nó không ngăn mất file, chỉ làm lỗi rõ ràng. Chỉ đổi mã lỗi ở ba khẳng định (một trong `leaseGcLinkedPending`, hai trong `leaseRetryAfterMissingLink`).
- **Hướng 1** (giữ cả file và hàng) không tự tạo file mồ côi: file còn hàng `ready` của A, nên lần quét sau, khi không còn job chưa kết thúc nào liên kết tới nó, vẫn dọn được. Biến thể **xóa hàng** (vẫn `DELETE`) thì có mồ côi: không còn hàng để cleanup xét lại, và phải dựa vào GC file (TASK-159 `fileGcPendingUploads`, chưa đọc đầy đủ). Hàng `linked` của B bị xóa (nhánh d) không kéo theo file của A, vì file thuộc hàng `ready` của A. Rủi ro còn lại cần đo: `LIMIT 1000` không có `ORDER BY`, nên hàng bị chặn có thể chiếm cửa sổ quét.
- **Hướng 3** gốc hơn (không tạo tham chiếu chết), nhưng có thể làm file pending của A thành orphan và bị TASK-159 purge sau grace một ngày. Đó là thay đổi hành vi, chưa đo.

## Khuyến nghị (chờ advisor)

Hai điểm cân nhắc, cả hai là sự thật đã đọc hoặc đã đo:
- Hướng 2 chỉ đổi tên lỗi. Vẫn tốn một attempt, và ở attempt cuối vẫn thành `FAILED` (TASK-164).
- Hướng 1 (giữ cả file và hàng) gỡ chuỗi từ gốc, nhưng chi phí quét và rủi ro starvation chưa đo.

Claude nghiêng về hướng 2 vì nhỏ và không đổi đường retry đã đo. Đây là khuyến nghị của Claude, **chưa có quyết định advisor**. Lựa chọn còn mở, phụ thuộc vào việc đo hướng 1 trên fixture.

## Chưa biết / chưa đo

- **Chưa chạy test nào sau khi đổi.** Các cột "Test không đổi" là suy ra từ grep tên và khẳng định, chưa chạy.
- **`fileGcPendingUploads.test.ts`** chưa đọc đầy đủ; kết luận "không đổi" dựa trên comment đầu file và grep.
- **Hướng 3: `register` có được gọi từ đường nào khác cho file pending không** (`artifactService.ts:25`, `:48`). Chưa đọc các caller.
- **Hướng 1 (giữ cả hàng):** chi phí quét và starvation do `LIMIT 1000` không `ORDER BY` chưa đo. Biến thể xóa hàng: mồ côi và việc GC file dọn được hay không chưa đo.
- **Hướng 2: mã 409/410/422 và đường agent** đọc từ TASK-163 (`agent.ts:795–811`), chưa đo phía agent.
- **Ai cũng chưa đo:** GC chạy sau khi A hoàn tất nhưng trước khi B lease (TASK-162 §Không kiểm).

## Ghi chú

- Không có test mới trong TASK-165. Các số liệu test lấy từ TASK-163/164 (`12f75d9`, `fe3f2e8`) và `leaseGcLinkedPending` (`c40b3a6`).
- Các dòng code dẫn ở trên là vị trí hiện tại; sau khi đổi, số dòng sẽ lệch.
- Đã kiểm lại bằng grep sau `fe3f2e8`: các dòng trích từ `leaseRetryAfterMissingLink.test.ts` (137, 140, 241, 244, 132, 172, 184) và `leaseGcLinkedPending.test.ts` (131, 140, 163) khớp HEAD.
