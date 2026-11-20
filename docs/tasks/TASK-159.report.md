# TASK-159 — GC xóa file upload mồ côi trong render/pending (báo cáo)

Trạng thái: chỉ thêm test, không đổi `src/`. Commit cục bộ trên `dev` theo quyết định advisor (2026-11-21), **chưa push, không có `.done`**.

## Vì sao có task này

TASK-157 (`cleanupFinishedUploads`) xóa hàng `node_uploads` và file của upload chưa liên kết khi job đã kết thúc hơn 24 giờ (`apps/server/src/node/leaseService.ts:424–437`). Với hàng đã liên kết, cleanup chỉ xóa hàng và giữ file, vì file đó thuộc artifact. Phát hiện 3 của TASK-157 ghi rằng file upload còn nằm trong `render/pending/<jobId>.uploads/` sẽ bị GC thu, nhưng chưa có test. TASK-159 kiểm chứng điều đó.

Chưa kiểm: con đường production đưa tới trạng thái "file còn, không có hàng bảo vệ". Một giả thuyết: hàng bị cleanup bỏ qua (`expected !== row.path` ở `leaseService.ts:432`, hoặc `rmSync` lỗi ở `:433`) vẫn giữ file và hàng. Khi job đã kết thúc, `references.ts:125` không bảo vệ file, và GC vẫn thu file (case C). Đây là giả thuyết, chưa đo. TASK-159 không chạy cleanup, nên không khẳng định con đường này.

## Bố cục thật (đã đọc mã)

- `renderDir(projectId)` = `join(projectDir(DATA_DIR, id), "render")` (`apps/server/src/services/renderService.ts:289–290`).
- Đường dẫn upload: `renderDir/pending/<jobId>.uploads/` (`apps/server/src/node/leaseService.ts:140`).
- `fileGc.inventory()` duyệt `render/pending` khi hàng dự án còn tồn tại (`apps/server/src/storage/fileGc.ts:101`, danh sách `versions|pending|clips|reviews`).
- `assetClass` xếp `render/pending` vào `ephemeral` (`references.ts:30–36`), nên mốc GC là 1 ngày (`fileGc.ts:425`), không phải `graceDays`.
- Bảo vệ:
  - `collectReferences` (mốc đánh dấu) bỏ qua hàng `node_uploads` của job không RUNNING/QUEUED (`references.ts:125`).
  - `DbReferenceIndex.build` (kiểm lại lúc purge) làm tương tự (`references.ts:508`).
  - Dự án đang bận được bảo vệ cả thư mục (`references.ts:96`, từ `busyProjects` ở `:65–72`).
- Production gọi `fileGc.run({ purge: true })` hằng ngày (`apps/server/src/app.ts:767`), và `ephemeralOnly` khi đầy đĩa (`app.ts:801`).

## Test (`apps/server/test/fileGcPendingUploads.test.ts`, mới, LF, 4 test)

| Case | Tình huống | Kỳ vọng | Ghim |
|---|---|---|---|
| A | file không có hàng nào trỏ tới | đánh dấu 1; sau 12 giờ chưa xóa; sau 2,5 ngày bị xóa | mốc 1 ngày; mục `"pending"` ở `fileGc.ts:101` |
| B (đối chứng) | `node_uploads` của job RUNNING | không đánh dấu, không xóa | không tách được `:125`: dự án bận, `:96` bảo vệ cả thư mục |
| C | `node_uploads` của job DONE có sẵn trước lần chạy đầu | đánh dấu 1; sau 2 ngày bị xóa | `:125` (mốc) và `:508` (kiểm lại lúc purge) |
| D | job DONE chèn sau khi đã đánh dấu | đánh dấu 1; purge vẫn xóa | `:125` (graph dựng lại trong `run()`, `fileGc.ts:406`) và `:508` (kiểm lại lúc purge) |

A mô phỏng trạng thái sau cleanup: hàng đã mất, file còn. Test không chạy `cleanupFinishedUploads`; nó dựng trạng thái đó trực tiếp.

## Mutant (áp lên `src/`, chạy, khôi phục, so sánh byte)

| Mutant | Thay đổi | Đỏ |
|---|---|---|
| drop-125 | bỏ `if (name === "node_uploads" && !activeJobs…) continue;` ở `references.ts:125` | C, D |
| drop-508 | bỏ dòng tương ứng ở `references.ts:508` | C, D |
| no-pending-101 | bỏ `"pending"` khỏi danh sách ở `fileGc.ts:101` | A, C, D |
| grace-always-graceDays | `grace = settings.graceDays` thay vì `1` cho ephemeral (`fileGc.ts:425`) | A, C, D |
| no-fence | bỏ `busy` khỏi fence ở `references.ts:96` và `:463` | không đỏ (B xanh) |
| force-skip | bỏ hẳn mọi `node_uploads` ở `references.ts:125` và `:508` | không đỏ (B xanh) |
| no-fence + force-skip | cả hai thay đổi trên | đỏ: B |
| drop-347 | bỏ dòng skip ở `references.ts:347` (`isTargetReferencedInDb`) | không đỏ (không có test nào phủ oracle này cho `render/pending`) |

B xanh trong ba mutant đơn lẻ, đúng với vai trò đối chứng. Mỗi mutant được khôi phục và so sánh byte với bản gốc; `git diff -- apps/server/src` rỗng sau khi chạy.

Đọc bảng mutant:
- Fence `:96` và force-skip `:125/:508` dự phòng cho nhau trong B. Bỏ fence thì `:125` vẫn bảo vệ B. Bỏ `:125/:508` thì fence vẫn bảo vệ B. Chỉ khi bỏ cả hai, B đỏ. B là đối chứng cho cặp này, không tách được từng cơ chế.
- Quy tắc skip `:125/:508` được ghim bởi C và D (drop-125, drop-508). Fence `:96` không có test riêng làm đỏ khi `:125/:508` còn. Đây là khoảng trống đã biết, mức thấp.
- drop-508 cũng làm đỏ C, vì lúc purge chỉ bộ chỉ mục mới thấy hàng DONE và từ chối xóa. D là biến thể mà hàng xuất hiện sau khi đã đánh dấu.

Lần chạy đầu của drop-508 áp nhầm vào `references.ts:347` (cùng chuỗi, lần xuất hiện thứ hai). Script cuối chọn dòng theo số dòng và kiểm nội dung dòng trước khi thay, rồi in từng dòng đã thay. Các số trong bảng là của lần chạy cuối.

## Kết quả

- `fileGcPendingUploads.test.ts`: 4/4 xanh (trên mã chưa mutate).
- Hồi quy `fileGc.test.ts`, `fileGcPurgeIndex.test.ts`, `fileGcRecovery.test.ts` và file mới: 35/35 xanh (chạy lại sau khi sửa báo cáo và comment case D).
- `npx tsc --noEmit` (apps/server): exit 0.

## Lệch so với đề xuất advisor

- Advisor đề xuất case C tắt fence `:96` và buộc `:125` riêng. Cách làm ở đây khác: C dùng job DONE trong dự án không bận, nên `:96` không áp dụng và không cần tắt fence. B là đối chứng job RUNNING, bị `:96` chặn, nên không tách được `:125`.
- Quyết định (advisor, 2026-11-21): giữ cách làm này. Kết quả mutant không-fence, force-skip và cả hai khớp kỳ vọng đã đặt trước khi chạy: B chỉ đỏ khi bỏ cả hai cơ chế.

## Không kiểm / ghi nhận

- Không đọc hàng `artifacts` sau purge (`registerSync`); không khẳng định gì về nó.
- `references.ts:347` (`isTargetReferencedInDb`, oracle) không bị mutant. Phần parity do `fileGcPurgeIndex.test.ts` phủ, và chỉ cho `uploads/`, không cho `render/pending`.
- Đường `ephemeralOnly` (`app.ts:801`) không được kiểm.
- Fence `:96` không có test riêng làm đỏ (xem phần đọc bảng mutant).
- Trạng thái "file còn, không có hàng bảo vệ" trong production chưa được xác định (xem phần "Vì sao").

## Sửa đi kèm

- `TASK-157.report.md`, phát hiện 3: đánh dấu đã kiểm chứng bởi TASK-159.
- `TASK-158.report.md` (sửa chưa commit từ trước): findings 1–4, dòng test 4, dòng 29, và "ở trên" đổi thành tham chiếu bảng mutant. Advisor yêu cầu đưa vào commit này, không tách commit riêng.

## Không làm (theo ràng buộc)

- Không `git push`. Không tạo `TASK-159.done`.
- Không đổi `src/`, `app.ts`, `storageProvider.test.ts`.
