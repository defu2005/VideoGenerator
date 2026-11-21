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

- `cleanupFinishedUploads` (`leaseService.ts:424–439`; sửa từ 416–437 theo đọc bổ sung dưới đây) chỉ đọc và xóa **`node_uploads`** (`DELETE FROM node_uploads`, dòng 437). Guard của TASK-166 (`linkedByUnfinishedJob`) cũng chỉ truy vấn `node_uploads` joined `jobs`. **Hàng `run_uploads` không được cleanup đụng tới và không được guard.**
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

## Đọc bổ sung (2026-11-21, theo yêu cầu advisor, vẫn chỉ đọc)

Không có test, không sửa `src/`. Các đọc dưới đây thay thế các dòng sai nêu trên.

### Sửa các dòng sai
- **Cleanup:** `leaseService.ts:424–439` (không phải 416–437). Dòng 416 nằm trong vòng lặp của hàm trước đó, gọi `uploads.ready(row.id, row.lease_id)` cho `node_uploads` của job. Guard `linkedByUnfinishedJob` (442–450) và `DELETE` (437) chỉ đụng `node_uploads`. Đã xác nhận từ file.
- **`dataContract.ts:61`:** `childTable(schema.runUploads, "control", "run_id", schema.projectRuns)`. Owner là `control`. Người dùng đã đọc: `projectSnapshot.ts:65` (`contracts = PROJECT_TABLES.filter(owner !== "control")`) loại bảng control khỏi snapshot, nên `run_uploads` không vào snapshot. `runCheckpoint.ts:61` lọc theo owner của stage. `references.ts:126/348/509` (đã nêu). `inputVersion.ts` import `PROJECT_TABLES`, **chưa đọc** có duyệt bảng control không. Kết luận "không có delete ngoài FK cascade" vẫn đúng với grep trong `src`.
- **Phản ứng agent khi checkpoint không ok (thay cho "409"):** `request()` (`agent.ts:516`) ném `AppError(status, code)`. `send` (`projectRunner.ts:227–231`) không bắt. `executeProjectRun` (`agent.ts:237–239`) chỉ bỏ `RUN_REBASE`, còn lại ném tiếp. `startProject` (`agent.ts:498–503`) ghi log `Đoạn chạy … lỗi: <code>` và xóa khỏi `running` trong `finally`. Agent **không gửi `/finish`, không gửi `/fail`, không retry**. Heartbeat chỉ gửi các run còn trong `running` (`nodeService.ts:233–236`), nên `projectRuns.expire()` (`runService.ts:140–143`) đặt `LOST` với `end_reason='HEARTBEAT_LOST'` khi lease hết. Hệ quả: **run mất (LOST), không tự chạy lại.** Khác job (job được retry qua `/fail`).
- **Chuỗi bước 4:** `have` và checkpoint dùng cùng lease (`runTransport.ts:56` `ready(run.id, run.leaseId)`). Tên phải bắt đầu bằng `files/<sha>` (`runTransport.ts:90`).

### Câu hỏi 1: có nội dung chung không? **Có.**
- Job pending: sha được kiểm ở `leaseService.ts:655–657`. Rồi `copyFile(final.path → versions/output.mp4.node-part)` và `renameSync` (`:670–672`). Đây là **cùng byte, cùng sha**, nằm trong dự án.
- Bảng `renders` (owner `RENDER`) tham chiếu `output.mp4` qua cột path. `exportProjectRows(owner=stage)` (`projectRunner.ts:292`) đưa file này vào `checkpoint.files` khi checkpoint `RENDER` `DONE`. Tên thành `files/<sha>.mp4`.
- Đường dùng lại: `apps/server/src/services/renderService.ts:806–809` (dòng 808 là "Dùng lại bản render trước"; đường dẫn đầy đủ, sửa từ tên file rút gọn) trả render cũ, nên run có thể xuất lại đúng hàng đó.
- Tên khác (`final.mp4` so với `files/<sha>`) không quan trọng: `linkKnown` khớp theo sha (`uploadStore.ts:52`).
- **Chưa đo:** `artifacts` có khóa theo sha, mỗi sha một hàng (`artifactService.ts:55–60`, `ON CONFLICT(sha256) DO UPDATE SET path=excluded.path`). Người ghi cuối quyết định `locate` trả pending hay versions. Các người ghi: GC `references.ts:166–177` (pending khi job còn active; versions khi render còn được tham chiếu), `remoteBundle.ts:53` (input job), `inputVersion.ts:100`, `runTransport.ts:58` (cùng path, không đổi). Sau khi A hoàn tất, ai ghi lại path versions và khi nào: chưa đo.

### Điểm mới: `linkKnown` bỏ qua kiểm tra file khi đã có hàng
- `uploadStore.ts:50–51`: nếu đã có hàng (job/lease/tên) thì trả `existing.status !== "partial"` **mà không** `locate`, không `existsSync`. `have()` (`runTransport.ts:94–99`) trả tên đó. Agent (`uploadOutputs`, `agent.ts:663`) bỏ qua upload.
- Vậy một hàng linked cũ được coi là "đã có" ở checkpoint sau, cùng lease, cùng tên `files/<sha>`. Checkpoint áp dụng: `ready()` (gồm `linked`, `runTransport.ts:56`), rồi `registerSync(file.path)` (`:58`) gặp ENOENT thô (`artifactService.ts:33`). HTTP cuối cùng là 500 theo suy luận từ TASK-163 (`app.ts:1188`), **chưa đo trên route run**.
- Agent gọi `have` rồi post checkpoint ngay (`agent.ts:558–560`). Vì vậy:
  - Chuỗi 24 giờ của mục 3–4 chỉ xảy ra khi **cùng S được tham chiếu ở hai checkpoint trong cùng lease**, với A bị cleanup xóa giữa hai lần.
  - Với một checkpoint, cửa sổ là từ `have` đến checkpoint đi ngay sau (vài giây). Cleanup phải chạy đúng lúc đó. Hẹp.

### Chuỗi đã sửa (đọc mã, chưa đo)
1. A RUNNING. GC đăng ký `pending/<A>.uploads/…/final.mp4` cho sha S (`references.ts:166–177`).
2. A hoàn tất: copy sang `versions/output.mp4` (`leaseService.ts:670–672`). Bảng `renders` tham chiếu. Người ghi cuối cho S: **chưa đo**.
3. R (lease L) checkpoint k xuất S. `have` → `linkKnown` → `locate(S)`. Nếu người ghi cuối là pending, hàng linked trỏ pending (`uploadStore.ts:54`).
4. Cleanup của A sau 24 giờ xóa pending (`leaseService.ts:435`; guard chỉ tính `node_uploads`).
5. R checkpoint m > k xuất S cùng lease. `have` trả S từ hàng cũ (`uploadStore.ts:50–51`), agent không upload. Checkpoint: `registerSync` ENOENT → 500 → run LOST sau khi lease hết.

### Kết luận đọc bổ sung
- Điều kiện 1 (nội dung chung): **có**. Theo quy tắc advisor, TASK-168 không đóng là "không có nội dung chung". Cần đo.
- Chưa đo: người ghi cuối của `artifacts` cho S sau khi A hoàn tất; ENOENT trên route run; LOST sau lease.
- Hướng sửa, đã đổi thứ tự:
  - (b) đổi ENOENT thành `AppError`: **không đổi kết quả**. Run không `/fail`, nên mã lỗi không đổi trạng thái LOST. Ít giá trị.
  - (d) mới: trong `linkKnown`, khi hàng cũ là `linked`, kiểm `existsSync(existing.path)` và size trước khi trả true. Nếu mất, trả false để agent upload lại (phải thay hàng cũ, không chỉ bỏ qua). Sửa nguyên nhân gần nhất.
  - (a) mở rộng guard TASK-166 cho `run_uploads` của run chưa kết thúc: chỉ bảo vệ khi người ghi cuối là pending.

### Đề xuất test (chưa viết, chờ advisor quyết định)
Qua hàm thật, khẳng định trước khi chạy:
- GC `run({purge:true, ephemeralOnly:true})` lúc A RUNNING. Khẳng định hàng `artifacts` cho S trỏ pending.
- A complete. Khẳng định hàng `artifacts` cho S: pending hay versions (đây là điều cần đo).
- `runTransport.have` cho R, cùng lease: khẳng định hàng linked trỏ pending.
- `cleanupFinishedUploads()` sau 25 giờ. Khẳng định file pending bị xóa.
- `runTransport.have` lần hai, cùng lease: khẳng định trả tên (hàng cũ, không kiểm file).
- Checkpoint thứ hai nêu S: khẳng định ENOENT thô (không phải AppError).
- Đối chứng: GC chạy sau khi A hoàn tất, trước `have` của R. Khẳng định `artifacts` trỏ versions và không có hàng linked. Đây là bằng chứng cho câu hỏi người ghi cuối.

## Liên kết

- TASK-161 (chuỗi gốc từ `node_uploads`): `docs/tasks/TASK-161.report.md`.
- TASK-166 (guard cho `node_uploads`): `docs/tasks/TASK-166.report.md`, §Hạn chế nêu run-scope là TASK-168.
- TASK-167 (422 `LINKED_FILE_MISSING` trong `finalizeHeld`, không áp cho đường run): `docs/tasks/TASK-167.report.md`.
