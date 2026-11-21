# TASK-164 — job B ở attempt cuối (báo cáo)

Trạng thái: thêm test thứ ba (`apps/server/test/leaseRetryAfterMissingLink.test.ts`, LF, cùng file với TASK-163); không đổi `src/`. Commit cục bộ theo quyết định advisor (2026-11-21), không phải xác nhận trực tiếp của người dùng. **Chưa push, không có `.done`.**

## Đọc mã trước khi viết test

- **`failJob` (`apps/server/src/pipeline/orchestrator.ts:758–828`):** retry khi `error.retryable && job.attempt < job.maxAttempts` (`:799`). Khi retry, `attempt + 1` và `runAfter = now + JOB_RETRY_BASE_MS × 2^(attempt−1)` (`:800`, `:809`). Khi không retry, ghi `FAILED` với `finishedAt` (`:828`).
- `error.retryAt` không có ở đường RENDER fail, nên `delay` bằng `baseDelay`.
- Với `maxAttempts` = 3 (`config.ts:138`): fail ở attempt 1 → attempt 2 (chờ `base`); fail ở attempt 2 → attempt 3 (chờ `2·base`); fail ở attempt 3 → `FAILED`.

## Test (thêm `it` thứ ba)

Kịch bản: A SUCCEEDED với GC lúc RUNNING (như TASK-162). B:
1. Lease attempt 1, `leases.fail` retryable. Kỳ vọng `attempt` = 2. Không gọi `haveOutputs`, nên không link file nào.
2. Advance `base·2^0 + 1` (đọc từ config), beat, lease attempt 2, `fail` retryable. Kỳ vọng `QUEUED`, `attempt` = 3.
3. Advance `base·2^1 + 1`, beat, lease attempt 3. Chạy chuỗi: `haveOutputs` link `final.mp4`, upload `report.json`, advance 25 giờ, cleanup, file A bị xóa, renew, `complete` ném `ENOENT`.
4. `leases.fail` retryable lần nữa trên lease attempt 3.

Kỳ vọng (viết trước lần chạy đầu): `FAILED`, `attempt` = 3, `error.code` = `NODE_RENDER_FAILED`, `finishedAt` có giá trị, `lease_id` và `finalizing_at` NULL, `pending/<B>.json` đã xóa, `finalize` gọi đúng 1 lần (của A).

Không `UPDATE jobs`, không hàng tự chèn. Fixture và thời gian giả như TASK-163.

## Kết quả

- `leaseRetryAfterMissingLink.test.ts`: 3/3 xanh ở lần chạy đầu (2 test của TASK-163 và test mới).
- Sau lần chạy đầu có hai thay đổi, cả hai trước commit: (a) xóa biến `realA` không dùng (`realpathSync.native(fileA)`), không phải khẳng định; (b) thêm `existsSync(s.pendingJson(jobB.id)) === true` ngay sau ENOENT, trước `/fail` cuối. Chạy lại: 3/3 xanh.
- `npx tsc --noEmit` (apps/server): exit 0, chạy sau hai thay đổi trên.
- Hồi quy 8 file (7 file của TASK-162 cộng test mới): 49/49 xanh.

## Mutant

| Mutant | Thay đổi | Kết quả |
|---|---|---|
| M4 | `orchestrator.ts:799`: `job.attempt < job.maxAttempts` → `<=` | ĐỎ tại test mới: `expected 'QUEUED' to be 'FAILED'`, đúng dự đoán. |

Cách làm: sao lưu `orchestrator.ts` bằng `cp`, sửa một dòng bằng `sed`, chạy test, khôi phục bằng `cp`, `cmp` xác nhận khớp bản sao lưu, `git diff --quiet -- apps/server/src` xác nhận `src/` sạch so với HEAD.

## Không kiểm / giới hạn

- **Phía agent:** chỉ đọc mã (500 đến `/fail`). Không đo node có render lại hay chỉ upload lại.
- **Chỉ đo đường `/fail` ở attempt cuối.** Đường `NODE_LOST` (sweep) ở attempt 3 chỉ đọc mã (`nodeService.ts` sweep, `retryable: true`, đi qua cùng `failJob`), chưa đo.
- **Fixture và thời gian giả:** stub render, mock `remoteBundle`, advance 25 giờ, advance theo backoff.
- **Hậu quả của `FAILED` ở tầng project/stage:** `failJob` sau dòng `:828` gọi `emitAgentEvent` và xử lý job phụ (CLIP, publish). Chỉ đọc mã, chưa đo trạng thái project sau FAILED.
- **Retry thủ công sau FAILED** và việc đẩy lại job: không đo.
- **GC làm mới hàng `artifacts` cũ trong lúc B RUNNING:** vẫn chưa đo (xem TASK-163 §Không kiểm).
- **Đánh giá "severity" đầy đủ:** kịch bản này chứng minh job B đi đến `FAILED` sau đúng 3 attempt, không chứng minh tần suất xảy ra ngoài thực tế.

## Kết luận ngắn

Với fixture, khi ENOENT rơi vào attempt cuối, B không quay lại hàng đợi. Job đi thẳng tới `FAILED`, lease được xóa, và `finalize` không chạy lần thứ hai. Đây là đường cuối cùng của chuỗi TASK-162/163. Mutant M4 chứng minh test phân biệt được "còn attempt" với "hết attempt".
