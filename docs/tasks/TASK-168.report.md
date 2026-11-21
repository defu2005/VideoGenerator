# TASK-168 — `run_uploads` liên kết tới file pending không được cleanup bảo vệ (báo cáo đọc mã)

Trạng thái: đọc mã, thêm một test ghim âm `apps/server/test/runSnapshotRepointsPending.test.ts` (2 test, xanh) và chạy mutant M8. **Không sửa `src/`.** Theo quyết định advisor (2026-11-21). Commit cục bộ, **chưa push, không có `.done`.** Kết luận: nhánh "R bắt đầu trước khi A hoàn tất" bị đóng bởi guard lúc bắt đầu run; snapshot đầu đoạn chạy đưa `artifacts` của S về versions trước `have`. Nhánh còn lại (job A được lease trong lúc run R đang chạy) **chưa đo**. Không có nhánh cache: mỗi lần gọi `exportProjectRows` tạo `ArtifactService` mới với cache rỗng (`projectSnapshot.ts:97`; cache là `Map` trong bộ nhớ, `artifactService.ts:14`), nên snapshot sau không thể cache hit. Đây là đọc mã, chưa đo.

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
- **Phản ứng agent khi checkpoint không ok (thay cho "409"):** `request()` (`agent.ts:516`) ném `AppError(status, code)`. `send` (`projectRunner.ts:227–231`) không bắt. vòng lặp đoạn chạy (`projectRunner.ts:239`) chỉ bỏ `RUN_REBASE`, còn lại ném tiếp; `executeProjectRun` (`agent.ts`, quanh dòng 507) không bắt lỗi nào. (Sửa: trước đó ghi `agent.ts:237–239`, dòng đó thuộc `projectCapabilities`.) `startProject` (`agent.ts:498–503`) ghi log `Đoạn chạy … lỗi: <code>` và xóa khỏi `running` trong `finally`. Agent **không gửi `/finish`, không gửi `/fail`, không retry**. Heartbeat chỉ gửi các run còn trong `running` (`nodeService.ts:233–236`), nên `projectRuns.expire()` (`runService.ts:140–143`) đặt `LOST` với `end_reason='HEARTBEAT_LOST'` khi lease hết. Hệ quả: **run mất (LOST), không tự chạy lại.** Khác job (job được retry qua `/fail`).
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

### Đề xuất test (đã viết một phần: xem §Pin âm bên dưới)
Qua hàm thật, khẳng định trước khi chạy:
- GC `run({purge:true, ephemeralOnly:true})` lúc A RUNNING. Khẳng định hàng `artifacts` cho S trỏ pending.
- A complete. Khẳng định hàng `artifacts` cho S: pending hay versions (đây là điều cần đo).
- `runTransport.have` cho R, cùng lease: khẳng định hàng linked trỏ pending.
- `cleanupFinishedUploads()` sau 25 giờ. Khẳng định file pending bị xóa.
- `runTransport.have` lần hai, cùng lease: khẳng định trả tên (hàng cũ, không kiểm file).
- Checkpoint thứ hai nêu S: khẳng định ENOENT thô (không phải AppError).
- Đối chứng: GC chạy sau khi A hoàn tất, trước `have` của R. Khẳng định `artifacts` trỏ versions và không có hàng linked. Đây là bằng chứng cho câu hỏi người ghi cuối.

## Đọc bổ sung 2 (theo yêu cầu advisor, chỉ đọc)

- **Cache trong `registerSync`** (`artifactService.ts:31–53`): cache `registeredVersions` (dòng 36–37) trả về **trước** `remember`. Cache hit không ghi lại hàng `artifacts`. Cache là theo instance: mỗi `new ArtifactService(...)` bắt đầu rỗng, nên lần gọi đầu tiên trên instance đó luôn `remember`.
- **Điểm ghi lên `artifacts` (đã liệt kê):** `projectSnapshot.ts:118` (`exportProjectRows`), `projectSnapshot.ts:168`, `runTransport.ts:58` và `:84`, `remoteBundle.ts:53` (`register`), `inputVersion.ts:100`, `fileGc.ts:451/465`, `references.ts:172/252`. Không có lệnh đăng ký nào trong `renderService` hay `leaseService` (grep).
- **Thứ tự trên đường RENDER DONE (kết luận mới):** `exportProjectRows` chạy **trước** `transport.checkpoint` → `uploadOutputs` → `have` của cùng checkpoint (`projectRunner.ts:292`, rồi `send` ở `:228–230`). Vì vậy `versions/output.mp4` được `remember` (`ON CONFLICT(sha256) DO UPDATE path=excluded.path`, `artifactService.ts:57–58`) **trước** khi `have` tra S. Nếu node và server dùng chung một handle SQLite, `have` sẽ tra ra versions và liên kết versions. Chuỗi pending không xảy ra trên đường này.
- **Đã sửa: không có cấu hình "chung DB" trên đường run.** Báo cáo trước nhầm: `app.ts:702` là `JobWorker` (stock executors của job), không phải đường run. `createStockRunner` chỉ được gọi từ `agent.ts:543` (grep). Đoạn chạy mở DB riêng của node tại `nodeDataDir/runs/<run.id>/db.sqlite` (`projectRunner.ts:34`, `:36`, `:56–57`). Export RENDER DONE (`projectRunner.ts:292`) chỉ ghi `artifacts` của DB node. Server biết S qua upload/`have`, và hàng `artifacts` phía server chỉ được ghi bởi các đường server liệt kê ở trên. Nhánh "chung DB" không xảy ra trên đường run.
- **Ghi phía server (DB server), đã đọc:** `runTransport.snapshot` (`runTransport.ts:75–78`) gọi `exportProjectSnapshot(this.db, …)` trên DB server. Được gọi ở đầu đoạn chạy (`projectRunner.ts:205`), khi REBASE (`:214`), và qua route `artifact` (`runTransport.ts:80–81`, `api/nodes.ts:191–195`) khi node tải input. Mỗi lần gọi, `exportProjectRows` (`projectSnapshot.ts:97–120`, `new ArtifactService` mới, cache rỗng) ghi lại mọi đường dẫn cột path, gồm `renders` → `versions/output.mp4`. Nếu hàng `renders` đã có trước lúc snapshot (A đã hoàn tất), hàng `artifacts` của S bị trỏ về versions.
- **GC định kỳ:** `fileGc.run({purge:true})` chạy mỗi 24 giờ (`app.ts:763–767`, `nextFileGcSweep = now + 86_400_000`). Trong cùng sweep, `leaseService.cleanupFinishedUploads()` (`app.ts:761`) chạy **trước** GC. `collectReferences` đăng ký đường dẫn qua đồ thị (`references.ts:166–177`). `app.ts:801` (`ephemeralOnly`) chỉ là nhánh áp lực đĩa.
- **Sửa về "cache đã link":** `linkKnown` trả `existing.status !== "partial"` mà không `locate` và không `existsSync` (`uploadStore.ts:50–51`). Hàng linked giữ đường dẫn pending lúc `have` k, dù `artifacts` sau đó bị GC trỏ về versions. Vì vậy GC repoint sau `have` k **không** cứu checkpoint m. Điều quyết định là `artifacts` có trỏ pending đúng lúc `have` k hay không.
- **Chuỗi (đọc mã, chưa đo):** (i) A RUNNING và một lần GC đã đăng ký pending của A cho S. (ii) `have` k của R trước khi đường nào ghi S sang versions (snapshot đầu đoạn chạy, REBASE, route `artifact`, GC kế tiếp). (iii) Cleanup xóa pending của A, sau 24 giờ kể từ khi A kết thúc (`leaseService.ts:424–439`). (iv) R checkpoint m > k có cùng S, lease còn sống: `have` trả tên từ hàng cũ, agent bỏ qua upload, checkpoint ném ENOENT thô (`runTransport.ts:58`).
- **Ràng buộc thời gian (suy luận từ lịch GC 24 giờ, chưa đo):** nếu R bắt đầu sau khi A hoàn tất, snapshot đầu đoạn chạy đã trỏ S về versions, nên (ii) thất bại. Nếu R bắt đầu trước khi A hoàn tất, snapshot đầu đoạn không thấy hàng `renders`, nên (ii) còn có thể xảy ra, nhưng khi đó cần không có GC tick nào giữa lúc A hoàn tất và `have` k. Cleanup chạy ở mỗi sweep (`app.ts:761`) với ngưỡng tuổi 24 giờ tính từ khi job kết thúc; chỉ GC bị giới hạn 24 giờ (`app.ts:763–767`). Khoảng này hẹp.
- **Hệ quả cho kế hoạch đo:** dựng R qua đường lease run thật. Đo (a) hàng `artifacts` của S lúc `have` k (pending hay versions), với R bắt đầu trước và sau lúc A hoàn tất; (b) lịch GC tick và cleanup; (c) m có thất bại không.
- **Chưa đo:** GC có đăng ký `renders` như path-only reference hay không (mới đọc `references.ts:166–177`); lịch sweep thực tế; hành vi checkpoint trên route run khi ENOENT.

## Đọc bổ sung 3 (câu hỏi advisor a và b, chỉ đọc)

- **(a) Nguồn hàng `renders` (phía server):** `renders.finalize` tạo hàng khi job RENDER hoàn tất (`leaseService.ts:655–681`, `completeRender`). `completeRender` không đăng ký `artifacts`. Hàng `renders` trong DB node đến từ hai nguồn: import snapshot lúc bắt đầu run (`projectRunner.ts:60`), và export RENDER DONE của chính đoạn chạy (`projectRunner.ts:292`). **Chưa đo:** node tự render cùng byte có tạo hàng `artifacts` phía server không. Theo đọc, không: chỉ các đường ghi phía server đăng ký `artifacts` (§Đọc bổ sung 2). Pin dùng hàng `renders` giả lập vì harness TASK-162 stub `finalize`.
- **Guard lúc bắt đầu run:** `grant` từ chối (`RUN_PROJECT_BUSY`, 409) khi có job active của project (`runService.ts:57–59`). Snapshot đầu đoạn (`projectRunner.ts:205`) chỉ chạy sau `grant`, nên với R bắt đầu sau A, hàng `renders` đã có khi snapshot chạy. Nhánh "R bắt đầu trước khi A hoàn tất" bị loại.
- **(b) Chiều ngược lại (job được lease trong lúc run chạy): không có guard.** `grep` không thấy `project_runs`, `projectRuns` hay `activeRun` trong `leaseService.ts` và `pipeline/orchestrator.ts`. Nghĩa là không có chặn ở `candidates` (`leaseService.ts:160–176`) và `canStartQueuedJob` (`orchestrator.ts:430–431`). **Chưa đo** (chưa dựng job A lease trong lúc R chạy).

## Pin âm và mutant M8 (2026-11-21)

Test: `apps/server/test/runSnapshotRepointsPending.test.ts`. Phần giả lập, ghi rõ trong file: hàng `renders` và file versions do test ghi tay; bước thời gian 60 giây (TTL lease run là 90 giây, `runService.ts` `ttlMs`), lease R được gia hạn qua heartbeat ở mỗi bước.

- **Khẳng định trước (pre-assert):** sau GC lúc A RUNNING, `artifacts` của S trỏ pending. A complete, `artifacts` vẫn trỏ pending.
- **Pin:** R được grant sau khi A complete. `transport.snapshot` đăng ký `files/<S>.mp4` và đưa `artifacts` của S về versions. `have` link versions. Sau 25 giờ, cleanup xóa pending của A, versions còn. `have` lần hai trả tên; checkpoint SUBTITLE áp dụng `ok: true`.
- **Đối chứng (KHÔNG phải thứ tự production):** bỏ `transport.snapshot`. `have` link pending; cleanup xóa pending; checkpoint ném ENOENT thô (`code === "ENOENT"`).
- **Kết quả:** 2/2 xanh. `tsc` cho file test (qua tsconfig tạm có `rootDir: "."`, đã xóa): exit 0. Lưu ý: `apps/server/tsconfig.json` loại `test/`, nên `npx tsc --noEmit` không kiểm file này.
- **Mutant M8:** thay `artifacts.registerSync(real)` ở `projectSnapshot.ts:118` bằng hash trực tiếp không đăng ký. Pin **đỏ** ở khẳng định sau snapshot: `artifacts` vẫn trỏ `…/render/pending/…/final.mp4`, không phải `…/render/versions/render-1/output.mp4`. Đối chứng vẫn xanh (không đi qua snapshot). `projectSnapshot.ts` được khôi phục từ bản sao lưu, `cmp` khớp, `git status` sạch.

**Cache không là nhánh còn lại (đọc mã, chưa đo):** `exportProjectRows` tạo `ArtifactService` mới mỗi lần gọi (`projectSnapshot.ts:97`), cache `registeredVersions` là `Map` trong bộ nhớ của instance (`artifactService.ts:14`). Snapshot sau không thể cache hit từ snapshot trước. Trong cùng một lần gọi, lần đăng ký đầu tiên đã `remember` nên hàng `artifacts` đã trỏ versions. Không cần test hay đổi `src`.

**Chưa đo (nhánh còn lại):** job A được lease trong lúc R chạy, và GC repoint S sang pending trong lúc R chạy. Cần thêm một job B đang giữ hàng `node_uploads` linked tới file pending của A. Thứ tự pending/versions trong một lượt `collectReferences` chưa đọc. Nếu cả hai đúng, `have` k của R có thể link pending, và checkpoint m ném ENOENT sau cleanup. Chưa dựng.

**Hardening (không làm trong TASK-168, không đổi `src`):** (d) `linkKnown` kiểm `existsSync` và size của hàng linked đã có trước khi trả true (`uploadStore.ts:50–51`). Các hướng (a)–(c) ở trên vẫn là lựa chọn, chưa chọn.

## Liên kết

- TASK-168 pin: `apps/server/test/runSnapshotRepointsPending.test.ts`.
- TASK-161 (chuỗi gốc từ `node_uploads`): `docs/tasks/TASK-161.report.md`.
- TASK-166 (guard cho `node_uploads`): `docs/tasks/TASK-166.report.md`, §Hạn chế nêu run-scope là TASK-168.
- TASK-167 (422 `LINKED_FILE_MISSING` trong `finalizeHeld`, không áp cho đường run): `docs/tasks/TASK-167.report.md`.
