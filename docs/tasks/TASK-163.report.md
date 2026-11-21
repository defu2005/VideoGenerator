# TASK-163 — job B sau khi complete ném ENOENT (báo cáo)

Trạng thái: thêm test (`apps/server/test/leaseRetryAfterMissingLink.test.ts`, mới, LF, 2 test); không đổi `src/`. Commit cục bộ theo quyết định advisor (2026-11-21), không phải xác nhận trực tiếp của người dùng. **Chưa push, không có `.done`.**

Cập nhật (TASK-166, `aae87cf`): bước cleanup trong `reachEnoent` nay là unlink trực tiếp (`rmSync`, giả lập), vì cleanup giờ giữ file mà job chưa kết thúc còn liên kết. Hướng 1 của TASK-165 đã triển khai trong `aae87cf`.

## Đọc mã trước khi viết test

- **Node sau complete lỗi (đọc mã, chưa đo phía agent).** ENOENT thô thành 500 `INTERNAL_ERROR` (`apps/server/src/app.ts:1188–1189`). Đây không phải 409/410, nên agent throw và POST `/fail` với `retryable: true`, lỗi của POST bị nuốt (`apps/server/src/node/agent.ts:795–811`).
- **`fail()` (`leaseService.ts:797–801`):** `holding(...)` (mặc định live, yêu cầu lease còn hạn), rồi `failJob`, rồi `setJobLease(null)`, rồi `discard` (xóa `pending/<job>.json`, không xóa `<job>.uploads/`).
- **Hết hạn lease (`nodeService.ts:354–366`):** `failJob` với `NODE_LOST`, `retryable: true`, rồi `setJobLease(null)`, rồi `onReleased` → `discard`.
- **Retry (`orchestrator.ts:799–809`):** khi `error.retryable && attempt < maxAttempts`, đặt `attempt + 1` và `runAfter = now + JOB_RETRY_BASE_MS × 2^(attempt−1)`. Test đọc giá trị từ harness config, không hard-code. Mặc định: `JOB_RETRY_BASE_MS` 2000, `JOB_MAX_ATTEMPTS` 3 (`apps/server/src/lib/config.ts:138–139`), `NODE_LEASE_SEC` 60 (`config.ts:65`).
- **Khóa `node_uploads` là `(job_id, lease_id, name)` (`apps/server/src/db/schema.ts:2101`).** Hàng của lease cũ còn nguyên, lease mới không thấy chúng.
- **`artifacts.locate` (`apps/server/src/node/artifactService.ts:63–70`):** file thiếu thì trả `undefined` và không xóa hàng cũ.
- **Ghi output (`leaseService.ts:521–552`):** `receiveOutput` ghi qua `saveVerified` vào đường dẫn của lease mới. `remember` chỉ được gọi từ `register` (`artifactService.ts:25`) và `registerSync` (`:48`), nên upload mới không làm mới hàng `artifacts` cũ.
- **Re-lease (đọc mã):** lease RENDER ghi lại `pending/<job>.json` (`leaseService.ts:371`), nên `readPending` không lỗi sau `discard`. Đo gián tiếp trong T1: `haveOutputs` và `receiveOutput` dưới lease mới đều gọi `readPending` và thành công.

## Test

Cả hai test dùng chuỗi TASK-162 đến ENOENT: A SUCCEEDED khi có GC lúc RUNNING, B link file của A, cleanup sau 25 giờ, heartbeat gia hạn lease B, `complete` của B ném `code: "ENOENT"`. Tất cả qua method thật. Không `UPDATE jobs`, không hàng tự chèn.

**T1, đường fail:**
- Gọi `leases.fail` với `code: "NODE_RENDER_FAILED"`, `retryable: true` (mô phỏng `agent.ts:807–811`).
- Kỳ vọng: `QUEUED`, `attempt` = 2, `runAfter` = now + `JOB_RETRY_BASE_MS`, `lease_id` và `finalizing_at` NULL, `pending/<B>.json` đã bị xóa, hàng của lease cũ vẫn là `[final.mp4 linked, report.json ready]`.
- Advance `JOB_RETRY_BASE_MS + 1`, heartbeat node để giữ online, lease lại. Kỳ vọng: lease mới có UUID khác.
- Kỳ vọng: `haveOutputs` trả `[]` (file đã mất); hàng `artifacts` cho sha video vẫn trỏ tới đường dẫn đã xóa.
- Upload cả hai file dưới lease mới, `complete` thành công. Kỳ vọng: `finalize` gọi 2 lần, B `SUCCEEDED`, hàng lease cũ còn nguyên, hàng `artifacts` vẫn trỏ tới đường dẫn cũ.

**T2, đường hết hạn:**
- Không gửi `/fail`, không heartbeat. Advance `NODE_LEASE_SEC × 1000 + 1000`, rồi gọi `nodes.sweep()` thật.
- Kỳ vọng: `QUEUED`, `attempt` = 2, `error.code` = `NODE_LOST`, `error.retryable` = true, `lease_id` NULL, `pending/<B>.json` đã xóa (qua `onReleased`), hàng lease cũ còn nguyên.

Kỳ vọng được viết trong file trước lần chạy đầu. Lần chạy đầu: 2/2 xanh. Sau đó thêm một khẳng định trước: `existsSync(s.pendingJson(jobB.id)) === true` ngay sau ENOENT trong `reachEnoent`, để hai khẳng định "pending json đã xóa" không xanh do sai đường dẫn. Chạy lại: 2/2 xanh. Không khẳng định nào khác bị sửa.

## Kết quả

- `leaseRetryAfterMissingLink.test.ts`: 2/2 xanh ở lần chạy đầu; 2/2 xanh sau khi thêm khẳng định trước (lần chạy hiện tại).
- `npx tsc --noEmit` (apps/server): exit 0.
- Hồi quy 8 file (7 file của TASK-162 cộng test mới): 48/48 xanh.

## Mutant

Sửa bản sao bằng `sed`, chạy test, khôi phục bằng `cp` từ bản sao lưu lấy trước khi mutant. `cmp` xác nhận từng file (`artifactService.ts`, `leaseService.ts`, `nodeService.ts`) khớp bản sao lưu sau khi khôi phục.

| Mutant | Thay đổi | Kết quả |
|---|---|---|
| M1 | bỏ `!existsSync(row.path)` ở `artifactService.ts:66` | ĐỎ tại test dòng 173 (`haveOutputs`), nhưng do **throw** `ENOENT` từ `statSync` ở `artifactService.ts:67`, không phải kết quả `[]` như dự đoán. Vẫn bắt được, cơ chế khác dự đoán. |
| M2 | bỏ `setJobLease(null)` ở `leaseService.ts:800` | ĐỎ tại test dòng 158 (`lease_id` không NULL sau fail), đúng dự đoán. |
| M3 | bỏ `j.finalizing_at IS NULL` ở `nodeService.ts:356` | XANH. Dự đoán trước khi chạy là xanh, vì kịch bản T2 không có job đang finalizing. Guard này chưa được test bắt. |

## Không kiểm / giới hạn

- **Phía agent:** chỉ đọc mã (500 đến `/fail`, và không biết node có render lại hay chỉ upload lại). Không đo.
- **Fixture và thời gian giả:** stub render, mock `remoteBundle`, advance 25 giờ và advance theo backoff.
- **Không đo hết attempt (`FAILED`):** chỉ đọc mã. Nếu ENOENT xảy ra khi `attempt == maxAttempts` (sau các lần retry khác không liên quan), `/fail` hoặc sweep đưa B sang `FAILED` terminal (`orchestrator.ts:799`, `:828`). Đây là đọc mã ở TASK-163. TASK-164 (`12f75d9`) đo đường `/fail` ở attempt cuối, không đo đường sweep.
- **Chưa đo GC chạy sau khi A hoàn tất**, và GC có làm mới hàng `artifacts` (qua `remember` upsert khi `references.ts:172` đăng ký lại file) trong lúc B đang RUNNING hay không. Có thể đưa job thứ ba vào chuỗi. Chưa đo.
- **Hàng lease cũ** còn tới khi job kết thúc và cleanup sau 24 giờ (nhánh d, không đụng file). Đọc mã, chưa đo.
- **`/fail` đến muộn sau khi lease đã hết hạn:** `holding` live sẽ từ chối. Đọc mã, chưa đo.
- **M3 không bị bắt:** cần kịch bản job đang `finalizing` (đã `claimFinalization`) để đo guard này.

## Kết luận ngắn

Với fixture, ENOENT của B không làm job treo. B được re-queue một lần (`attempt` 2), qua `/fail` hoặc qua hết hạn lease. Re-lease upload lại bytes và hoàn tất. Chi phí là một attempt, khi còn attempt trong `maxAttempts` = 3. Nếu hết attempt, B thành `FAILED`: TASK-164 (`12f75d9`) đo đường `/fail`, không đo đường sweep. Hàng `artifacts` cũ vẫn trỏ tới file đã xóa. Không gây lỗi trong đường này, vì `locate` trả `undefined` và job upload lại. Hệ quả của việc GC làm mới hàng đó chưa được đo.
