# TASK-157 — test cleanupFinishedUploads() (báo cáo)

Trạng thái: chỉ thêm test, không đổi `src/` và không đổi `app.ts`. Commit cục bộ trên `dev` theo quyết định advisor (2026-11-21), **chưa push, không có `.done`**.

## Vì sao có task này

`LeaseService.cleanupFinishedUploads()` (`apps/server/src/node/leaseService.ts:424`) xóa file và hàng `node_uploads` của job đã kết thúc. Nó được gọi từ `worker.setSweep` trong `app.ts:761`. Trước TASK-157, không có test nào gọi hàm này (grep `cleanupFinishedUploads` trong `test/` không có kết quả).

## Test mới (`apps/server/test/leaseCleanupUploads.test.ts`, 6 test)

Hàng `jobs` và `node_uploads` được chèn tay (`foreign_keys` tắt), không qua lease thật. Mọi đường dẫn nằm dưới một thư mục `mkdtemp` trong thư mục temp của OS.

| Nhóm | Test | Ràng buộc được ghim |
|---|---|---|
| 1 | removes the file and the row of an unlinked upload whose job finished more than 24 h ago | file và hàng đều bị xóa khi job SUCCEEDED, `finished_at` 25 h trước, đường dẫn đúng |
| 2 | keeps the file and the row when the job finished 23 h ago | `finished_at` còn trong 24 h thì giữ nguyên |
| 3a | keeps the file and the row when the job is not terminal, even if finished_at is old | job RUNNING thì giữ nguyên |
| 3b | keeps the file and the row when the job is still finalizing | `finalizing_at` khác NULL thì giữ nguyên |
| 4 | drops the row of a linked upload but leaves its file on disk | hàng `linked` bị xóa, file vẫn còn |
| 5 | does not delete a file at the computed path when the row points somewhere else | `row.path` khác đường dẫn tính toán thì file ở đường dẫn tính toán (decoy) còn nguyên |

Test 5 không khẳng định hàng còn hay mất (xem phát hiện 1).

## Mutant (sửa bản sao trong `leaseService.ts`, chạy, khôi phục, `cmp`)

| Mutant | Thay đổi | Kết quả |
|---|---|---|
| nordm | bỏ `rmSync` | đỏ 1: test 1 |
| nodelete | bỏ `DELETE` | đỏ 2: test 1 và test 4 |
| nofinished | bỏ điều kiện `finished_at <= cutoff` | đỏ 1: test 2 |
| nostatus | bỏ điều kiện `status IN (terminal)` | đỏ 1: test 3a |
| nofinalizing | bỏ điều kiện `finalizing_at IS NULL` | đỏ 1: test 3b |
| nolinked | bỏ kiểm tra `status !== "linked"` | đỏ 1: test 4 |
| nomismatch | bỏ kiểm tra `expected !== row.path` | đỏ 1: test 5 |

Cả bảy mutant đều được khôi phục và `cmp`-identical với bản sao trước khi mutate. `git diff` của `leaseService.ts` rỗng.

## Kết quả

- `leaseCleanupUploads.test.ts`: 6/6 xanh (trên mã chưa mutate).
- Hồi quy: `workerNodes`, `workerNodeE2E`, `remoteStages`, `runTransport`, `fileGcPurgeIndex` (năm file cũ): 73 pass, 1 skipped. Cộng 6 test mới trong cùng lần chạy: 79 pass, 1 skipped. Test skipped là `workerNodeE2E` (chỉ chạy khi `VG_E2E_NODE=1`, theo thiết kế). Chạy với `VG_E2E_NODE=1`: 1/1 xanh.
- `npx tsc --noEmit`: exit 0.
- Mã hóa dòng: `leaseService.ts` là LF thuần (810 LF, 0 CRLF). File test mới là LF.

## Phát hiện (không sửa, mức thấp)

1. Hàng bị bỏ qua vì `path` lệch hoặc `rmSync` lỗi (`continue`) không bao giờ bị xóa. Vì vậy chúng được chọn lại ở mỗi lần sweep. Truy vấn có `LIMIT 1000` nhưng không có `ORDER BY`, nên về lý thuyết các hàng này có thể chiếm slot và làm đói các hàng khác. Mức thấp.
2. Wiring `setSweep` → `cleanupFinishedUploads` trong `app.ts:761` chưa được ghim bằng test.
3. File mồ côi của upload thường: sau khi hàng bị xóa, file vẫn nằm trong `pending/<job>.uploads`. Theo đọc mã, `fileGc` duyệt cây dự án, gồm thư mục `pending` (`fileGc.ts:90–105`), và bỏ qua hàng `node_uploads` của job không còn hoạt động (`references.ts:125`), nên file được đưa vào diện GC. Phần đọc mã dừng ở bước duyệt; quyết định xóa thực tế của GC chưa được đọc đến và chưa có test end-to-end. Coi đây là chưa kiểm chứng.
4. Hàng `linked` không phải file mồ côi. `uploadStore.ts:54` ghi hàng `linked` với `known.path`, tức đường dẫn của artifact đã có cùng sha256 (thuộc chủ sở hữu khác). File đó được giữ có chủ đích, và cleanup không xóa nó (test 4 khẳng định điều này).

## Giới hạn còn lại

- Hàng được chèn tay, không đi qua lease và upload thật.
- Test 4 gán cho hàng `linked` đường dẫn tính toán (`pending/<job>.uploads/...`). Production không làm vậy: hàng `linked` trỏ tới đường dẫn artifact (`uploadStore.ts:54`). Test này chỉ ghim nhánh `status !== "linked"`, không mô phỏng đường dẫn thật của hàng `linked`.
- Chỉ dùng tên `final.mp4` và lease id UUID cố định. Không có test cho lease id không phải UUID, cho tên ngoài `ANY_OUTPUT`, cho nhánh `rmSync` lỗi, hay cho giới hạn 1000 hàng.

## Sửa đi kèm

- `TASK-155.report.md`, giới hạn 1 và 2: đánh dấu đã đóng bởi TASK-156 (`8d84baa`, `251d178`). Guard bên trong thân `wake()` vẫn chưa có test.

## Không làm (theo ràng buộc)

- Không đổi `src/`, không đổi `app.ts`, không đổi `storageProvider.test.ts`.
- Không `git push`. Không tạo `TASK-157.done`.
