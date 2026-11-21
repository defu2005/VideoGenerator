# TASK-170 — đo thứ tự ghi `artifacts` theo trạng thái cache (chỉ test)

Trạng thái: **đã đo bằng test.** Không đổi `src`. File test: `apps/server/test/fileGcCacheCases.test.ts`.

Kết quả lần chạy đầu (TASK-170): 7 xanh, 1 đỏ (ca "stuck", 3 assertion soft).
Cập nhật theo TASK-171 (advisor 2026-11-21): nguyên nhân đỏ là **trùng render id** trong fixture, không phải "file versions chưa tồn tại trước complete" như cách giải thích cũ. Ca đỏ được đổi tên thành "collision", ghim giá trị quan sát (xanh). Thêm hai ca tách id (TASK-171). Cập nhật theo TASK-172 (advisor 2026-11-21): thêm hai ca "terminal không complete" (xem `TASK-172.report.md`). Cập nhật theo follow-up TASK-172 (advisor 2026-11-21): thêm ba ca restart và xóa row bằng tay (xem `TASK-172.report.md`). Hiện tại: file test 13/13 xanh; cùng TASK-168 pin, 15/15 xanh.

## Cấu hình đo

- Một `FileGc` dài hạn cho mỗi case, không truyền `artifacts` (giống `app.ts:255`).
- Mỗi pass gọi `run({ purge: true, ephemeralOnly: true })`, đúng lời gọi `app.ts:801` (xử lý áp lực đĩa). `app.ts:767` dùng `{ purge: true }`.
  Hai tùy chọn này chỉ ảnh hưởng xóa file (`fileGc.ts:421`, `:434`, `:445`). `collectReferences` chỉ nhận `now` và `postPublishDays` (`fileGc.ts:406`), nên đăng ký path không phụ thuộc hai tùy chọn này.
- Log ghi: trigger `AFTER INSERT` và `AFTER UPDATE` trên `artifacts` ghi `(sha256, path)` vào `gc_log` theo `id`. Mỗi pass báo:
  - `pre`: nhãn path của row S ngay trước pass;
  - `seq`: nhãn path của các lần ghi S trong pass, theo thứ tự;
  - `path`: nhãn path của row S sau pass.
- Nhãn: `versions` = `render/versions/render-1/output.mp4` (file của A), `retained-versions` = `render/versions/render-0/output.mp4` (chỉ có ở ca tách id), `pending` = file `final.mp4` của job A.
- Giá trị dự đoán viết trong file trước khi chạy lần đầu.

## Kết quả

| Case | pre | seq (theo thứ tự ghi) | path sau | Dự đoán | Kết quả |
|---|---|---|---|---|---|
| miss/miss (pass 1) | (không có row) | versions, pending | pending | seq [versions, pending] | xanh |
| hit/hit (pass 2) | pending | (rỗng) | pending | seq [] | xanh |
| collision: pass 1 (A RUNNING) | (không có row) | versions, pending | pending | (bước chuẩn bị) | — |
| collision: pass sau complete A | pending | versions | versions | seq [], path pending (dự đoán TASK-170, lệch) | xanh sau khi ghim quan sát |
| control (FileGc mới) | pending | versions | versions | seq [versions] | xanh |
| miss/hit (pass 1, chỉ pending) | (không có row) | pending | pending | seq [pending] | xanh |
| miss/hit (pass 2, thêm renders) | pending | versions | versions | seq [versions] | xanh |
| hit/miss (pass 1, chỉ versions) | (không có row) | versions | versions | seq [versions] | xanh |
| hit/miss (pass 2, A upload) | versions | pending | pending | seq [pending] | xanh |
| tách id, không có row cho render-1 (TASK-171 a): pass 1 | (không có row) | retained-versions, pending | pending | seq [retained-versions, pending] | xanh |
| tách id, không có row cho render-1 (TASK-171 a): pass sau complete | pending | (rỗng) | pending | seq [], path pending | xanh |
| tách id, không có row cho render-1 (TASK-171 a): sau cleanup 25 h | pending | — | pending (file đã xóa) | pending bị xóa, row vẫn trỏ pending | xanh |
| tách id, row render-1 đúng shape finalize (TASK-171 b): pass 1 | (không có row) | retained-versions, pending | pending | seq [retained-versions, pending] | xanh |
| tách id, row render-1 đúng shape finalize (TASK-171 b): pass sau complete | pending | versions | versions | seq [versions], path versions | xanh |
| tách id, row render-1 đúng shape finalize (TASK-171 b): sau cleanup 25 h | versions | — | versions | row không trỏ file đã xóa | xanh |

Lưu ý thứ tự: `renders` được duyệt trước `node_uploads` (`dataContract.ts:40` và `:57`), nên trong pass có cả renders và pending, retained (hoặc versions) được ghi trước, pending ghi sau.

## Phát hiện 1: đỏ lần đầu là trùng render id (collision)

- `insertRenderRow()` ghi row retained là `render-1`, và `prepare` của A cũng trả `render-1`. Hai bản ghi dùng chung `render/versions/render-1/output.mp4`.
- `completeA` ghi đè file đó (`leaseService.ts:670–672`: copy sang `.node-part`, rồi đổi tên). Đo bằng `statSync`: inode, mtime, ctime đổi; size vẫn là 11.
- Cache `registeredVersions` (`artifactService.ts:36–37`) khớp path và stamp `dev:ino:size:mtimeNs:ctimeNs`. Stamp đổi nên pass sau complete miss ở versions, ghi versions, và repoint row về versions.
- Dự đoán ban đầu (seq [], path pending) sai. Giải thích cũ ("versions có thể chưa tồn tại trước complete") không phải nguyên nhân: file đó đã tồn tại từ trước, và chính complete ghi đè nó vì trùng id.

## Phát hiện 2: tách id (TASK-171)

Fixture: row retained là `render-0` (cùng bytes), A là `render-1`.

- **(a) không có row cho render-1 sau complete.** Dự đoán và quan sát khớp: pass 1 [retained-versions, pending] path pending; pass sau complete [] path pending; cleanup xóa file pending, row vẫn trỏ pending. Đây là hình dạng "stuck" của giả thuyết TASK-169.
  **Không đạt được trên đường complete thành công (trong các dòng đã đọc).** `leaseService.ts:673` gọi `renders.finalize` sau khi đổi tên file. Trong các dòng đã đọc, `finalize` INSERT một row cho `renderId` của A (`renderService.ts:996–1003`); `renderService.ts:895–969` không chứa INSERT. Nhánh `reused` (`renderService.ts:891–894`) trả về khi có row cùng id, trạng thái DONE **và** cùng `input_hash`. Fixture collision có hash khác nhau, và cách `prepare` gán `renderId` chưa đọc, nên không gọi `reused` là "đường collision". Mock `finalize` không insert nên (a) chỉ là hình dạng của mock trên đường complete thành công.
  **Không phải đường duy nhất để kẹt.** Job đi tới FAILED hoặc CANCELLED sau khi đã upload cũng để lại trạng thái (job kết thúc, không có row render cho id A, row trỏ pending) mà không gọi `finalize`. Đường này được đo ở TASK-172.
- **(b) row render-1 đúng shape finalize, chèn sau complete.** Dự đoán khớp: render-0 hit (không ghi); render-1 có inode mới nên miss và ghi versions; path versions. Cleanup xóa pending nhưng row đã trỏ versions, không có row nào trỏ file đã xóa.

Kết luận cho giả thuyết "kẹt ở pending" (TASK-169), **chỉ trên đường complete thành công đã đọc**: sau complete có row render-1 với file mới, nên row được repoint sang versions và không kẹt. Giả thuyết tái hiện ở hình dạng (a), là hình dạng mock; đường FAILED/CANCELLED không complete có cùng hình dạng kết thúc và được đo riêng ở TASK-172. Chưa loại trừ:
- finalize lỗi giữa `renameSync` (`leaseService.ts:672`) và INSERT (`renderService.ts:996`), để lại file mới không có row;
- row render-1 bị xóa hoặc không còn DONE trước một lượt GC;
- nhiều lượt GC xen với nhiều lần complete.

## Đọc, không đo: lịch GC và cleanup (TASK-171 bước 1)

- `renderService.ts`: `finalize` không gọi `registerSync` hay `artifacts`. Việc đăng ký chỉ xảy ra trong `collectReferences` và các writer khác (đã ghi ở TASK-169).
- `cleanupFinishedUploads` (`leaseService.ts:424–425`): cutoff là `finished_at` cách hiện tại 24 h, chỉ xóa job SUCCEEDED/FAILED/CANCELLED đã qua cutoff và không còn `finalizing_at`.
- `app.ts:757–775`: mỗi lượt sweep gọi `leaseService.cleanupFinishedUploads()`. `fileGc.run({ purge: true })` chỉ chạy khi `Date.now() >= nextFileGcSweep`, tức lần đầu ngay sweep đầu tiên sau boot, sau đó mỗi 24 h; khi lỗi thì thử lại sau 1 h.
- Đã đọc (TASK-172): trong cùng lượt sweep, cleanup chạy trước GC (`app.ts:761`, rồi `:763–767`). GC chạy bất đồng bộ sau `runBlobs`; lỗi ở đó bỏ qua `run` trong 1 h. Cả hai chu kỳ đều 24 h, nên thứ tự phụ thuộc thời điểm tick. **Chưa đo.**
- Hệ quả: không có đảm bảo lượt GC chạy giữa complete và cleanup (đã đọc, chưa đo).

## Sửa lại trong báo cáo này

- Lần chạy đầu đỏ **ba** assertion soft (seq, path, artifactPath sau cleanup), không phải hai.
- "pending bị xóa sau 25 h" là assertion **soft** (`expect.soft`), không phải hard. Hard chỉ có kiểm tra attribution (pending còn tồn tại trước cleanup).
- Các chỉnh sửa harness sau lần chạy đầu vẫn giữ nguyên (xem dưới).

## Các chỉnh sửa harness sau lần chạy đầu

Không đổi giá trị dự đoán. Ba lỗi nằm trong harness, không nằm trong hành vi GC:

1. `label()` gọi `realpath` trên file versions chưa tồn tại, gây `ENOENT` ở miss/hit pass 1. Sửa: chỉ `realpath` khi file tồn tại.
2. Case hit/miss so sánh `path` (đã đổi thành nhãn `pending`) với đường dẫn thô. Sửa: so với nhãn `"pending"`.
3. Case stuck: assertion dự đoán đổi sang `expect.soft` để phần cleanup vẫn chạy và được đo. Thêm log stat của file versions trước và sau complete (chỉ chẩn đoán).

## Chưa đo

- Thứ tự giữa nhiều project (`references.ts:98`, không có `ORDER BY`).
- Finalize lỗi giữa `renameSync` và INSERT (đường để lại file mới không có row).
- Nhiều lượt GC xen với nhiều lần complete.
- `renders.finalize` thật: case (b) dùng row chèn tay đúng shape cột, không gọi finalize thật.
- Thời điểm cleanup so với GC trong cùng chu kỳ (chỉ đọc, chưa đo).
- Đường cancel (`orchestrator.cancel`) và NODE_LOST (`nodeService.sweep`): TASK-172 chỉ đo đường `fail` (retryable:false).
- Ca control và bốn ca không complete vẫn dùng cùng id `render-1` cho row retained và A. Không ảnh hưởng vì chúng không có complete, nhưng ca control chỉ là đo collision, không phải hình dạng tách id.

## Kiểm tra

- `npx vitest run test/fileGcCacheCases.test.ts test/runSnapshotRepointsPending.test.ts` (trong `apps/server`): 15/15 xanh (13 ca file cache, 2 ca pin TASK-168). Lần chạy trước follow-up TASK-172 là 12/12.
- `npx tsc --noEmit -p .` (trong `apps/server`): exit 0.
