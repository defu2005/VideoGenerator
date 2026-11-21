# TASK-162 — chuỗi linked row dưới render/pending (báo cáo)

Trạng thái: thêm test (`apps/server/test/leaseGcLinkedPending.test.ts`, mới, LF, 2 test); sửa tài liệu `TASK-161.report.md` §5 và `TASK-160.report.md`. Không đổi `src/`. Commit local theo quyết định advisor (không phải xác nhận trực tiếp của người dùng). **Chưa push, không có `.done`.**

## Ba câu hỏi advisor yêu cầu đọc trước

1. **`discard()` có xóa file pending của A không?** Không. `discard()` (`apps/server/src/node/leaseService.ts:144–157`) chỉ xóa `pending/<jobId>.json` (`pendingPath`), không xóa thư mục `<jobId>.uploads/`. File `final.mp4` của A còn sau khi A hoàn tất. Điều kiện 4 của TASK-161 đứng vững.
2. **`complete()` cần gì để lease của B còn hiệu lực sau 25 giờ?** `complete()` (`:555`) gọi `holding(..., "live")`, yêu cầu `leaseUntil > now`. Test gia hạn lease bằng `nodes.heartbeat` (`nodeService.ts:167`), đường thật: khi lease còn dưới nửa thời lượng, heartbeat gọi `setJobLease`. Không dùng `UPDATE jobs`. Sau khi A hoàn tất, `setJobLease(null)` (`leaseService.ts:657`) xóa `finalizing_at`, nên cleanup mới chọn được hàng của A (điều kiện `finalizing_at IS NULL`, `:427`).
3. **Hai job RENDER cùng project có cùng RUNNING được không?** (Đọc mã, chưa đo.) Với cấu hình mặc định, không. `candidates()` (`leaseService.ts:160–176`) không kiểm tra project. Chặn duy nhất là `renderSlotsFull` (`src/pipeline/orchestrator.ts`), đếm RENDER RUNNING toàn cục so với `RENDER_CONCURRENCY`. Mặc định là 1 (`src/lib/config.ts:63`). Vì vậy thứ tự được đo là tuần tự: **A RUNNING → GC chạy → A complete → B được lease**. Thứ tự này không cần `RENDER_CONCURRENCY` ≥ 2.

## Harness

- `renderDir` = `projectDir(DATA_DIR, id)/render`, cùng bố cục với TASK-160. GC gốc là `DATA_DIR` của harness.
- Node thứ hai cho job B (`joinNode("may-2")`).
- **Fixture, không phải production:** mock `remoteBundle` (trả `files: []`) và stub `renders` (`prepare`, `finalize` là `vi.fn`).
- **Thời gian giả:** đồng hồ tiến 25 giờ; lease của B được gia hạn bằng heartbeat do test gọi.

## Kỳ vọng (viết trước lần chạy đầu; hai khẳng định ENOENT về `path` và `finalizing_at` được thêm sau lần chạy đầu, xem Kết quả)

Test "chain":
- GC `run({purge:true, ephemeralOnly:true})` lúc A RUNNING: `marked 0`, `purged 0`.
- Hàng `artifacts` của sha video trỏ tới đường dẫn thật (`realpathSync.native`) của file pending của A.
- A `complete` thành công, `finalize` gọi 1 lần, A `SUCCEEDED`.
- B `lease` trên node 2, `haveOutputs` trả `["final.mp4"]`, hàng B là `linked` với đường dẫn của artifact.
- Upload `report.json` của B thật. Sau đó: hàng B là `[final.mp4 linked, report.json ready]`.
- Sau 25 giờ, `cleanupFinishedUploads()`: file A và hàng A bị xóa; hàng B còn.
- Heartbeat gia hạn lease B. `complete` của B **ném `code === "ENOENT"`, không phải `AppError`**. (Được thêm sau lần chạy đầu: `path` bằng đường dẫn linked, và `finalizing_at` của B là NULL.) `finalize` vẫn 1 lần. B vẫn `RUNNING`. Hàng B không đổi.

Test "control" (không GC):
- Không có hàng artifact cho sha video. `haveOutputs` của B trả `[]`. Không có hàng `linked`.

## Kết quả

- **Lần chạy đầu:** `leaseGcLinkedPending.test.ts` 2/2 xanh.
- **Sau đó test được sửa một lần** theo yêu cầu advisor: thêm `existsSync(fileA)` trước cleanup; lấy `linkedPathB` trước cleanup và khẳng định bằng `realpathSync.native(fileA)`; khẳng định lỗi của B là `{code:"ENOENT", path: linkedPathB}` và không phải `AppError`; khẳng định `finalizing_at` của B là NULL. Chạy lại: **2/2 xanh**. Lần chạy này là lần đang có trong cây làm việc. (Báo cáo cũ ghi "không chỉnh sửa sau khi chạy" là sai; đã sửa.)
- **Control xanh:** không GC thì không có hàng artifact cho sha video, `haveOutputs` của B trả `[]`, không có hàng `linked`. Đây là bằng chứng GC là điều kiện kích hoạt.
- **Câu hỏi mở về mtime đã có đáp án trên fixture này:** `haveOutputs` trả `final.mp4`, hàng B là `linked`, và đường dẫn của hàng đó bằng đường dẫn artifact của sha video (test khẳng định cả hai). Điều này cho thấy `artifacts.locate` chấp nhận file: so sánh mtime (`Math.trunc(statSync.mtimeMs)` với giá trị đã lưu) khớp ở đây.
- **Kiểm tra:** `npx tsc --noEmit` trong `apps/server` exit 0. Hồi quy 7 file, 46 test, xanh: `fileGcPendingUploads`, `leaseCleanupGcHandoff`, `leaseCleanupUploads`, `fileGc`, `fileGcPurgeIndex`, `fileGcRecovery`, `leaseGcLinkedPending`.
- **Mutant:** chưa chạy mutant nào.

## Chi tiết đọc mã (không phải đo)

- Vị trí ném ENOENT (`leaseService.ts:620`) suy ra từ đọc mã. Test chỉ khẳng định mã lỗi và đường dẫn, không khẳng định dòng.
- `claim` được định nghĩa ở `leaseService.ts:624` nhưng chỉ được gọi sau vòng lặp kiểm tra linked record (`:619–623`), nên không chạy trước khi vòng lặp ném lỗi. Khẳng định `finalizing_at IS NULL` đúng vì lỗi ném trước mọi lần gọi `claimFinalization`.

## Đính chính TASK-161 §5 (đã bổ sung)

- Đoạn cũ của TASK-161 §5 đúng về cơ chế, và đúng rằng `collectReferences` chỉ được gọi từ `fileGc.ts:304` và `:406`. Chỗ thiếu là danh sách trigger đi tới hai dòng đó. Đã bổ sung trong `docs/tasks/TASK-161.report.md`: `app.ts:766` (`runBlobs({purge:true})`), `:767` (`run({purge:true})`), `:801` (`run({purge:true, ephemeralOnly:true})`), và `storageSettings.ts:47`, `:55`, `:56`. `toolDefs.ts:15` và `storageSettings.ts:38` chỉ gọi `report()`, không gọi `collectReferences`. `app.ts:255` chỉ khởi tạo `FileGc`.
- Đây là bổ sung, không phải sửa sai.

## Không kiểm / giới hạn

- **Chuỗi được đo bằng thời gian giả (25 giờ) và fixture** (mock `remoteBundle`, stub `renders`). Test chứng minh chuỗi chạy được qua các method thật. Test không chứng minh chuỗi xảy ra trong thực tế.
- **Chưa đo GC chạy sau khi A hoàn tất, trước khi B được lease.** Vì vậy chưa biết đăng ký file pending vào `artifacts` có cần A ở trạng thái RUNNING không.
- **Chưa đo B sau ENOENT.** B vẫn `RUNNING` cho đến khi lease hết hạn. Chưa đo lease hết hạn, re-lease, hay retry; đây là việc của TASK-163.
- **Chưa đo khi GC chạy lại sau cleanup (`purge`)** xem hàng artifact trỏ tới file đã xóa có bị xử lý thế nào.
- Không đo thư mục rỗng `<job>.uploads/<lease>/` còn lại sau cleanup. Không đo nhánh `rmSync` lỗi (c) của cleanup. Không đo giới hạn `LIMIT 1000` không có `ORDER BY`.
- Không chạy mutant nào, nên chưa biết test có bắt được từng lỗi giả định hay không.
- Đồng thời hai RENDER RUNNING trong cùng project: đọc mã, chưa đo (xem câu hỏi 3).
