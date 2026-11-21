# TASK-172 — đường kết thúc không complete và các reader của `artifacts.path` (chỉ test + đọc)

Trạng thái: **đã đo bằng test** (bốn ca mới). Không đổi `src`. File test: `apps/server/test/fileGcCacheCases.test.ts` (hai `describe` mới ở cuối file).

Lý do: advisor (2026-11-21) đánh giá `23a13c0` (TASK-171). Kết luận "hình dạng kẹt chỉ xuất hiện ở mock" chưa đúng. Một job đi tới FAILED hoặc CANCELLED sau khi đã upload đạt cùng trạng thái kết thúc (job terminal, không có row render cho id của A, row trỏ pending) mà không gọi `finalize`. `cleanupFinishedUploads` chọn cả ba trạng thái (`leaseService.ts:427`), và `references.ts:115` loại chúng khỏi `activeJobs`.

## Đường RENDER tới FAILED hoặc CANCELLED sau upload (đã đọc)

- **Node báo lỗi:** `leases.fail` (`leaseService.ts:819–824`) gọi `orchestrator.failJob`, rồi `setJobLease(null)` và `discard(..., "failed")`.
- **`failJob` chỉ kết thúc khi không còn lượt retry.** Nếu `retryable && attempt < maxAttempts` thì job về **QUEUED** (`orchestrator.ts:799–815`), chưa terminal. QUEUED vẫn là active (`references.ts:115`), nên pending vẫn được đăng ký. Ca đo dùng `retryable: false`, cho FAILED.
- **Hủy:** `orchestrator.cancel` (`orchestrator.ts:350–379`) gọi `abortJob` cho job RUNNING, rồi set CANCELLED với `finishedAt`. **Chưa đo.**
- **Mất node:** `nodeService.sweep` (`nodeService.ts:354–366`) và `nodeService.revoke` (`:321–337`) gọi `failJob` với NODE_LOST, `retryable: true`. Như trên, chỉ kết thúc khi hết lượt retry. **Chưa đo.**
- **`discard`** (`leaseService.ts:144–157`) chỉ xóa file JSON pending của job (`pendingPath`), không xóa thư mục `.uploads`. Vì vậy file `final.mp4` còn trên đĩa cho tới cleanup, như các ca đã đo.

## Reader của `artifacts.path` (đọc từ mã, kiểm tra tồn tại?)

| Reader | Có `existsSync`? | Ghi chú |
|---|---|---|
| `ArtifactService.locate` (`artifactService.ts:63–66`) | Có (`!existsSync(row.path)` → undefined) | Dùng bởi `leaseService.ts:528`, `uploadStore.linkKnown` (`:52`), `runTransport.ts:83`. |
| `ArtifactService.register` (`:19–23`) | Không, nhưng `statSync(path)` ném lỗi nếu thiếu | Được gọi với path đã biết tồn tại. Không phải reader im lặng. |
| `fileGc.isReferencedInGraph` (`fileGc.ts:75–81`) | **Không** | Đọc path của row, `resolve`, tính owner, rồi `referencesForPath`. Row trỏ file đã xóa vẫn được xét. **Đã probe, xem dưới.** |
| `references.ts:257–259` | Gián tiếp (chỉ khi `stat` lỗi) | Tra sha theo path khi stat lỗi. |
| `references.ts:266–268` | **Không** | Sha → path của row, dùng làm target khớp. |
| `references.ts:439–446` | **Không** | Sha → path của row (`validSha`), cho oracle. |
| `references.ts:520–522` | Không liên quan | Chỉ lấy sha của class `global`, không đọc file. |

Các reader không có kiểm tra tồn tại đều nằm trong GC và oracle. Không tìm thấy reader nào ở đường upload hoặc tải file mà thiếu kiểm tra.

## Ca đo (mỗi ca: một `FileGc` dài hạn; cleanup sau 25 h kể từ lúc FAILED)

Hai fixture:
- **R:** `render-0` đã có sẵn cùng bytes S (row DONE, được giữ theo retention).
- **N:** không có bản sao nào khác của S.

Dự đoán được viết trong test trước lần chạy đầu:

| Ca | Lượt | Dự đoán | Quan sát |
|---|---|---|---|
| R | pass 1 (A RUNNING) | seq `[retained-versions, pending]`, path pending | khớp |
| R | pass 2 (A FAILED) | seq `[]`, path pending, file pending còn | khớp |
| R | sau cleanup, pass 3 | seq `[]`, path pending, `render-0` còn | khớp |
| R | `locate(S)` sau cleanup | undefined (row trỏ file đã xóa, dù `render-0` có cùng bytes) | khớp |
| N | pass 1 (A RUNNING) | seq `[pending]`, path pending | khớp |
| N | pass 2 (A FAILED) | seq `[]`, path pending | khớp |
| N | sau cleanup, pass 3 | seq `[]`, path pending | khớp |
| N | `locate(S)` sau cleanup | undefined | khớp |

Chạy: `npx vitest run test/fileGcCacheCases.test.ts test/runSnapshotRepointsPending.test.ts` (trong `apps/server`): 12/12 xanh, trong đó 10 ca của file cache (8 cũ + 2 mới) và 2 ca pin TASK-168.

**Probe (một lần, sau cleanup):** `isReferencedInGraph` không kiểm tra tồn tại. Trong fixture R, pass 3 chạy trên row đang trỏ file đã xóa, và `render-0` vẫn còn. Kết quả này chỉ cho biết fixture R không mất file; không cô lập được nhánh `isReferencedInGraph` là nguyên nhân.

## Phát hiện

1. **Trạng thái "kẹt ở pending" xảy ra trên đường FAILED không complete**, cả khi có bản sao hợp lệ (fixture R) và khi không có (fixture N). Đây là đường production đã đọc được, không chỉ mock.
2. **Row dangling che bản sao hợp lệ:** trong fixture R, `locate(S)` trả undefined dù `render-0` có cùng bytes. Ai dùng `locate` (upload có sha đã biết, `linkKnown`) sẽ coi S là chưa có và phải upload lại. Đây là lỗi hiệu quả, chưa thấy lỗi dữ liệu.
3. Trong fixture R, lượt GC sau cleanup không ghi lại row (`retained-versions` hit), nên row không được sửa.

## Phương án sửa (chưa thực hiện)

1. **Khi job kết thúc không complete hoặc khi cleanup xóa pending:** nếu row của sha trỏ tới file sắp xóa, xóa row hoặc repoint tới bản sao còn tồn tại (`registerSync`) trước khi xóa file. Test: ca R và N ở trên, kỳ vọng `locate(S)` trả bản sao còn tồn tại (R) hoặc undefined (N) và row không trỏ file đã xóa.
2. **Cleanup giữ file mà row đang trỏ tới:** giống hướng đã làm cho file linked ở TASK-166. Đánh đổi là đĩa tốn thêm đến khi row được repoint. Test: pending còn sau cleanup khi row trỏ tới nó.
3. **Thêm kiểm tra tồn tại vào `isReferencedInGraph` và `references.ts:266`/`:439`:** chỉ sửa đọc, không sửa row. Đánh đổi: không xóa row dangling, chỉ tránh suy luận từ path đã mất. Cần một ca cô lập nhánh này trước khi làm.

Khuyến nghị của báo cáo: làm (1) trước, vì nó sửa gốc (row dangling) và có test rõ ràng. (2) và (3) là phương án dự phòng.

## Chưa đo

- Đường cancel (`orchestrator.cancel`) và NODE_LOST (`nodeService.sweep`, `revoke`).
- Đường failJob có retry (QUEUED, rồi chạy lại trên lease mới).
- Finalize lỗi giữa `renameSync` và INSERT (đã nêu ở TASK-170).
- Thứ tự cleanup và GC trong cùng chu kỳ (đã đọc, chưa đo).
- `references.ts:266` và `:439` chưa có ca riêng; chỉ có probe gián tiếp ở ca R.
- Trên `renders.finalize` thật: ca R và N không gọi finalize (chỉ dùng row chèn tay ở TASK-170 b).
