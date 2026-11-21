# TASK-168 — `run_uploads` liên kết tới file pending không được cleanup bảo vệ (báo cáo đọc mã)

Trạng thái: **chỉ đọc mã và grep. Không sửa `src/`, không sửa test, không chạy test hay mutant.** Commit cục bộ, docs only, theo quyết định advisor (2026-11-21). **Chưa push, không có `.done`.** Kết luận: chuỗi **có thể tiếp cận** trên đường đọc mã (không đóng là "không tiếp cận"). Chưa đo.

## Câu hỏi advisor đặt ra (4 mục)

### 1. Ghi hàng `run_uploads` linked ở đâu, path lưu dạng nào

- Store run-scope: `runTransport.ts:54` `new NodeUploadStore(db, artifacts, …, now, "run")` → bảng `run_uploads`, cột chủ `run_id` (`uploadStore.ts:13–20`).
- Đường ghi linked: endpoint `/have` (`api/nodes.ts:242`) → `RunTransportService.have()` (`runTransport.ts:94–98`) → `uploads.linkKnown(output, (path) => insideProject(run.projectId, path))`.
- `linkKnown` (`uploadStore.ts:49–56`): `artifacts.locate(sha256)` lấy đường dẫn **đúng như đang lưu trong bảng `artifacts`**, rồi `insert(…, known.path, …, "linked")`. Path không được chuẩn hóa lại ở đây. Dạng path phụ thuộc người đã đăng ký hàng `artifacts` (GC đăng ký bằng realpath: `references.ts:170–172`).
- `have()` là đường duy nhất trong `src/` tạo hàng `run_uploads` với `status='linked'` (đã grep `run_uploads`/`runUploads`: không thấy đường khác ghi linked).

### 2. Có thể nằm dưới `render/pending/<job>.uploads/` không

**Có.** Đây là bước quan trọng nhất và nó không đóng được:

- File pending của job nằm ở `renders.renderDir(projectId)/pending/<jobId>.uploads` (`leaseService.ts:136–140`).
- `renderDir` = `join(this.dir(projectId), "render")` (`services/renderService.ts:289–291`), và `dir` = `projectDir(DATA_DIR, projectId)` (`renderService.ts:285–287`). Vậy file pending nằm **trong** thư mục dự án.
- `insideProject` (`runTransport.ts:67–73`) chấp nhận mọi path có realpath nằm dưới `realpath(projectDir)`. Không loại trừ `render/pending`. Vậy `have()` **sẽ link** một hàng run tới file pending, miễn là `artifacts.locate` trả về path đó.
- `artifacts` có hàng trỏ tới file pending khi GC đăng ký (`references.ts:166–177`, đã đọc ở TASK-161). Điều kiện: có tham chiếu path tới file đó từ một hàng `node_uploads` của job **đang active** (`references.ts:125`, `activeJobs`). Tức là đúng luồng TASK-161/162: A RUNNING → GC đăng ký file pending của A.

Kết luận bước 2: cùng đường `artifacts.locate` như TASK-161, nhưng từ phía `run_uploads` thay vì `node_uploads`. **Không đóng là "không tiếp cận".**

### 3. Ai tiêu thụ hàng run-scope linked, và file mất thì ném gì

| Điểm dùng | Đọc | Khi file đã mất |
|---|---|---|
| `RunTransportService` checkpoint (`runTransport.ts:55–60`) | `uploads.ready(run.id, run.leaseId).get(name)` (`uploadStore.ts:27–29`, gồm cả `linked`), rồi `artifacts.registerSync(file.path)` | `registerSync` gọi `statSync(path, {bigint:true})` **không kiểm tra tồn tại** (`artifactService.ts:33`) → `ENOENT` thô, không phải `AppError`. Không bị bắt ở đây. Hậu quả HTTP chưa đọc (route `nodes.ts:142` → `checkpoints.apply`); suy luận từ `app.ts:1188` là 500, **chưa đo**. |
| `RunTransportService.artifact()` (`runTransport.ts:80–86`) | `artifacts.locate` (`artifactService.ts:63–70`) | `locate` có `existsSync` → `undefined` → 404 `ARTIFACT_NOT_FOUND`. An toàn. |
| `have()` (`runTransport.ts:94–98`) | `linkKnown` → `locate` | Cũng an toàn: không link file đã mất. |
| `uploads.offset` / `append` cho hàng `linked` (`uploadStore.ts:71`) | `fileOffset` trả `row.size` mà không stat | Không lỗi ở đây; lỗi chỉ xuất hiện khi đọc file. |

Điểm đau là **checkpoint** (dòng 56–59). Đây là chỗ đọc file trực tiếp qua hàng linked, không qua `locate`.

### 4. Có gì dọn hàng `run_uploads` không

- `cleanupFinishedUploads` (`leaseService.ts:416–437`) chỉ đọc và xóa **`node_uploads`** (`DELETE FROM node_uploads`, dòng 437). Guard của TASK-166 (`linkedByUnfinishedJob`) cũng chỉ truy vấn `node_uploads` joined `jobs`. **Hàng `run_uploads` không được cleanup đụng tới và không được guard.**
- Không có `DELETE FROM run_uploads` và không có delete qua Drizzle trên `runUploads` trong `apps/server/src` (grep).
- Hàng chỉ mất khi xóa `project_runs` cha, qua FK `ON DELETE CASCADE` (`db/schema.ts:401`).
- Ngoài ra `references.ts:126`, `:348`, `:509` chỉ coi `run_uploads` là tham chiếu khi `activeRuns.has(row.run_id)`. Run không active thì hàng không giữ file.

## Chuỗi đề xuất (đọc mã, chưa đo)

1. Job A RUNNING. GC chạy → `artifacts` trỏ tới file pending của A (`references.ts:166–177`).
2. Run R gọi `/have` cho sha đó → hàng `run_uploads` linked tới file của A (`runTransport.ts:94–98`, `insideProject` đúng).
3. A SUCCEEDED. Sau 24 giờ, `cleanupFinishedUploads` xóa file của A. Hàng `run_uploads` của R **không** được tính (chỉ `node_uploads`).
4. R checkpoint → `registerSync(file.path)` ném `ENOENT` thô (`runTransport.ts:58`, `artifactService.ts:33`).

Khác với TASK-166 ở chỗ: TASK-166 guard cho `node_uploads` của job **chưa kết thúc**. Chuỗi này dùng hàng của **run**, và run chưa kết thúc trong khi job A đã kết thúc. Guard hiện tại không nhìn thấy trường hợp này.

## Điều chưa đo / giới hạn

- **Chưa chạy gì.** Toàn bộ là đọc mã. Chưa có test đỏ, chưa có fixture.
- **Điều kiện tạo hàng linked tới pending:** cần sha của file pending khớp đúng sha mà run R tải. Tần suất thực tế chưa biết (có thể hiếm: file pending thường là output của job, còn R cần cùng nội dung).
- **HTTP của checkpoint khi ENOENT:** suy ra 500 từ `app.ts:1188`, chưa đọc route `nodes.ts:142` đầy đủ và chưa đo.
- **GC có bảo vệ file pending bị link bởi `run_uploads` của run không active không:** `references.ts:126` bỏ qua hàng run không active. Chưa đọc đường purge của `fileGc` cho `render/pending` (TASK-159) để biết nó có dựa vào tham chiếu này không. Nếu có, file có thể bị purge sau grace trong khi run vẫn đang chờ checkpoint. Chưa đo.
- **Đường ghi khác của `artifacts` cho path pending** (`projectSnapshot.ts:118/168`, `inputVersion.ts:100`, `runTransport.ts:58`): chưa đọc đầy đủ.
- **Path form:** `locate` trả path đã lưu. Trường hợp path khác dạng realpath (symlink, 8.3) chưa đo, cùng hạn chế với realpath branch của TASK-166.

## Đề xuất (chờ advisor, chưa làm)

- **Không sửa** trong TASK-168 khi chưa có quyết định advisor. Đề xuất thử nghiệm trước: viết test đỏ mô tả chuỗi 1–4 qua hàm thật (`runTransport.have` rồi `cleanupFinishedUploads` rồi checkpoint), khẳng định kết quả trước khi chạy.
- Hướng sửa có thể xét (chưa chọn): (a) mở rộng guard TASK-166 để tính cả `run_uploads` của run chưa kết thúc; (b) để `checkpoint` ném `AppError` 409 `RUN_FILE_CHANGED`-like khi file mất, theo mẫu TASK-167; (c) không cho `linkKnown` link tới `render/pending` (theo mẫu option 3 của TASK-165, có rủi ro orphan như đã ghi ở đó).

## Liên kết

- TASK-161 (chuỗi gốc từ `node_uploads`): `docs/tasks/TASK-161.report.md`.
- TASK-166 (guard cho `node_uploads`): `docs/tasks/TASK-166.report.md`, §Hạn chế nêu run-scope là TASK-168.
- TASK-167 (422 `LINKED_FILE_MISSING` trong `finalizeHeld`, không áp cho đường run): `docs/tasks/TASK-167.report.md`.
