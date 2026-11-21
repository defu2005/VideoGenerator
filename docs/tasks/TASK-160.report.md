# TASK-160 — hand-off từ cleanupFinishedUploads sang GC (báo cáo)

Trạng thái: chỉ thêm test, không đổi `src/`. Commit cục bộ trên `dev` theo quyết định advisor (2026-11-21), **chưa push, không có `.done`**. Commit này cũng gom sửa đi kèm của TASK-159 (xem cuối).

## Các nhánh của cleanup (`apps/server/src/node/leaseService.ts:424–437`)

| Nhánh | Điều kiện | Kết quả | Test |
|---|---|---|---|
| (a) khớp | không `linked`, lease UUID, tên trong `ANY_OUTPUT`, `expected === row.path`, `rmSync` không lỗi | xóa file và hàng | H1 |
| (b) lệch đường dẫn | như (a) nhưng `expected !== row.path` (`:432`) | giữ cả file và hàng | H3 |
| (c) rmSync lỗi | như (a) nhưng `rmSync` ném lỗi (`:433`) | giữ cả file và hàng | không test |
| (d) ngoài nhánh | `linked`, hoặc lease không UUID, hoặc tên ngoài `ANY_OUTPUT` | xóa hàng, **file không đụng** | H2 (synthetic) |

## Harness

`renderDir` = `projectDir(DATA_DIR, id)/render`, đúng bố cục `renderService.ts:289–290`. GC và cleanup cùng nhìn một cây thư mục. Không cần đổi `src/`.

## Test (`apps/server/test/leaseCleanupGcHandoff.test.ts`, mới, LF, 3 test)

Mỗi test kiểm từng giai đoạn: baseline `marked: 0`, sau cleanup (file và số hàng), sau mark, sau purge.

- **H1**: lease UUID, đường dẫn tính toán, job SUCCEEDED 25 giờ trước. Cleanup xóa file và hàng. GC không còn gì để đánh dấu.
- **H2 (synthetic)**: lease không UUID, tên hợp lệ. Cleanup xóa hàng, giữ file. GC đánh dấu 1, chưa purge sau nửa ngày, purge sau khi qua mốc 1 ngày.
- **H3**: hàng trỏ tới file ở thư mục lease khác. Cleanup giữ cả hai, lần cleanup thứ hai không lỗi và không đổi số hàng. GC đánh dấu 1 và purge 1 file. Hàng vẫn còn, trỏ tới file đã xóa.

## Phát hiện

1. **H2 chỉ là synthetic.** Đã đọc các đường ghi: `uploadJob` (`leaseService.ts:457–461`) cho `uploadOffset`, `appendOutput`, `outputTarget` và `haveOutputs`, và `receiveOutput` (`:529`, `:532`). Mọi đường ghi đi qua `holding()` (`:392`), bắt `leaseId` phải bằng lease của job. Lease của job là `randomUUID()` (`:245`, `:367`), nên hàng ghi qua server luôn có lease UUID. Tên: `outputNameOk` (`:96–100`) chọn một trong ba regex trong `packages/shared/src/schemas/renderBundle.ts:78–81`, và cả ba đều nằm trong `ANY_OUTPUT` (`leaseService.ts:94`). Regex không có cờ `g`, nên `.test` không có trạng thái. Kết luận: nhánh (d) với tên ngoài `ANY_OUTPUT` hoặc lease không UUID không tới được qua đường ghi. Nhánh (d) chỉ tới được qua hàng `linked`, mà đường dẫn của hàng này là đường dẫn artifact (`uploadStore.ts:54`). Đã kiểm ở TASK-161 (đọc mã): đường dẫn artifact CÓ THỂ nằm dưới `pending/`, vì `references.ts:172` và `fileGc.ts:451/465` đăng ký file pending trong bảng `artifacts`, và `linkKnown` không loại trừ `pending/`. Đây là đường đọc mã. TASK-162 đo chuỗi này qua method thật (`apps/server/test/leaseGcLinkedPending.test.ts`): hàng `linked` trỏ tới file pending của job khác, cleanup xóa file, và `complete` của job nhận hàng đó ném ENOENT thô. Giới hạn: đo bằng thời gian giả và fixture; chưa đo GC chạy sau khi job nguồn hoàn tất (xem `docs/tasks/TASK-162.report.md`).
2. **H3 mở rộng TASK-157 phát hiện 1, và là synthetic.** Sau purge, hàng còn lại trỏ tới file đã bị xóa. Test ghim hành vi hiện tại và có comment ghi rõ đó không phải bản sửa. Không write site nào trong `apps/server/src` tạo hàng không-linked có đường dẫn khác `outputPath()` (TASK-161 §1): `uploadStore.ts:45` là INSERT duy nhất, các UPDATE không đổi `path`, và không có writer chung nào (snapshot, checkpoint, input version đều lọc bảng `control`). Riêng `DATA_DIR` có thể đổi khi khởi động lại với cấu hình khác, đây là ngoại lệ chỉ do cấu hình, chưa đo (TASK-161 §2).
3. **Thư mục rỗng (đọc mã, chưa đo).** Cleanup chỉ xóa file, không xóa `<job>.uploads/<lease>/`. Sau H1 thư mục này có thể còn. Không assert.

## Mutant (sửa bản sao, chạy, khôi phục, so sánh byte)

Kỳ vọng ghi trước khi chạy. Kết quả khớp kỳ vọng:

| Mutant | Thay đổi | Dòng assert đầu tiên đỏ (test file) |
|---|---|---|
| nordm | bỏ `rmSync` (`:433`) | dòng 80, H1 file sau cleanup |
| nodelete | bỏ `DELETE` (`:435`) | dòng 81 (H1 số hàng sau cleanup), dòng 104 (H2 số hàng sau cleanup) |
| nomismatch | bỏ `expected !== row.path` (`:432`) | dòng 129, H3 số hàng sau cleanup đầu tiên |
| drop-uuid-regex | bỏ kiểm tra UUID (`:430`) | dòng 105, H2 file sau cleanup |
| drop-125 | bỏ skip `node_uploads` ở `references.ts:125` | dòng 135, H3 `marked: 1` |
| drop-508 | bỏ skip ở `references.ts:508` | dòng 137, H3 `purged: 1` |
| no-pending-101 | bỏ `"pending"` ở `fileGc.ts:101` | dòng 107 (H2 `marked: 1`), dòng 135 (H3 `marked: 1`) |
| grace-always-graceDays | `grace = settings.graceDays` (`fileGc.ts:425`) | dòng 112 (H2 `purged: 1`), dòng 137 (H3 `purged: 1`) |

Không mutant nào chỉ đỏ ở `existsSync` cuối. Cả ba file nguồn khôi phục byte-identical (`leaseService.ts`, `references.ts`, `fileGc.ts`).

## Kết quả

- `leaseCleanupGcHandoff.test.ts`: 3/3 xanh (trên mã chưa mutate).
- Hồi quy sáu file (`fileGcPendingUploads`, `leaseCleanupGcHandoff`, `leaseCleanupUploads`, `fileGc`, `fileGcPurgeIndex`, `fileGcRecovery`): 44/44 xanh.
- `npx tsc --noEmit` (apps/server): exit 0.

## Không kiểm / ghi nhận

- Không đo `rmSync` lỗi (nhánh c).
- Không đo giới hạn `LIMIT 1000` và thứ tự không có `ORDER BY` (TASK-157 phát hiện 1).
- Không đo wiring `app.ts:761`.
- `linked` có thể trỏ tới đường dẫn dưới `pending/`: đã đọc mã ở TASK-161 (xem phát hiện 1). Chuỗi xóa file của job khác đã đo ở TASK-162 (`docs/tasks/TASK-162.report.md`), qua method thật, với fixture. Vẫn chưa đo: GC chạy sau khi job nguồn hoàn tất, và job nhận sau ENOENT (TASK-163).
- `blobs.outputTarget` (`leaseService.ts:467–473`) đã đọc ở TASK-161: chỉ trả URL đăng ký, không ghi hàng `node_uploads`, nên không tạo đường dẫn lệch. Nhánh H3 không tới được qua đường này.

## Sửa đi kèm (gom vào commit này, theo quyết định advisor)

- `fileGcPendingUploads.test.ts` (TASK-159): case C và D dùng `SUCCEEDED` thay cho `DONE`. `DONE` là trạng thái của stage, không phải của job. Kết quả mutant không đổi.
- `TASK-159.report.md`: sửa dòng C và D, mục "Lệch", ghi chú drop-508, số test B, dòng hồi quy, ghi chú trạng thái job.

## Không làm (theo ràng buộc)

- Không `git push`. Không tạo `TASK-160.done`.
- Không đổi `src/`.
