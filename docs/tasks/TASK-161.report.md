# TASK-161 — H3 có tới được qua production không (báo cáo đọc mã)

Trạng thái: chỉ đọc mã. Không đổi `src/`, không thêm test. Chỉ sửa comment trong `leaseCleanupGcHandoff.test.ts` và `TASK-160.report.md`. Commit cục bộ theo quyết định advisor (2026-11-21), **chưa push, không có `.done`**. Không đo runtime; mọi khẳng định là "đọc mã", kèm file:dòng.

## Kết luận

1. **H3 (đường dẫn lệch ở `leaseService.ts:432`, hàng không-linked): không tới được qua write site nào trong `apps/server/src`.** Đã grep bảng và các writer chung (§1). Giống H2, H3 là synthetic. Ngoại lệ duy nhất là đổi `DATA_DIR` khi khởi động lại (§2), chưa đo.
2. **Hàng `linked` có đường dẫn artifact, và đường dẫn đó CÓ THỂ nằm dưới `render/pending/`.** Đây là đường đọc mã, chưa đo. Đường đưa file pending vào `artifacts` là GC production (`fileGc.ts:304/406` → `collectReferences` → `references.ts:172`). Hệ quả có điều kiện: file có thể bị cleanup của job khác xóa trong khi hàng `linked` của job đang chạy vẫn trỏ tới. Khi đó finalize của job đó ném lỗi ENOENT thô (không đi qua `failJob` ở đường render thường). Không mất dữ liệu đã duyệt, vì `sha256File` (`leaseService.ts:620`) chặn nội dung khác. Mức độ: thấp, có điều kiện, chưa đo.

## 1. Mọi write vào `node_uploads`

Quét `apps/server/src` cho INSERT, UPDATE, DELETE trên bảng này, kể cả qua `this.table` trong `uploadStore.ts`. Bảng `run_uploads` không thuộc phạm vi.

| Site | Ghi gì | `path` lấy từ | Bằng `outputPath()`? |
|---|---|---|---|
| `uploadStore.ts:45` (`insert`) | INSERT duy nhất vào bảng | tham số `path` | tùy caller |
| `leaseService.ts:483` `appendOutput` → `uploads.append` | `partial` (`uploadStore.ts:96`) | `outputPath(job, output.leaseId, name)` | có |
| `leaseService.ts:549` `receiveOutput` → `saveVerified` | `ready` (`uploadStore.ts:64`) | `target = outputPath(job, leaseId, name)` | có |
| `leaseService.ts:594` finalize, nhánh S3 → `saveVerified` | `ready` | `target = outputPath(job, body.leaseId, name)` | có |
| `leaseService.ts:494` `haveOutputs` → `linkKnown` | `linked` (`uploadStore.ts:54`) | `known.path` từ `artifacts.locate(sha256)` | **không**: đường dẫn artifact |
| `runTransport.ts:54` | bảng `run_uploads` (scope `run`) | — | ngoài phạm vi |

UPDATE (`uploadStore.ts:117`, `:126`, `:130`) chỉ đổi `received_bytes` và `status`. Không UPDATE nào đổi `path`. DELETE duy nhất ở `leaseService.ts:435`.

Kiểm thêm các đường ghi chung (không dùng SQL trực tiếp):

- Grep `nodeUploads|node_uploads|PROJECT_TABLES|childTable(` trong `apps/server/src`. Chỉ có: định nghĩa bảng (`db/schema.ts:2091`), đăng ký `dataContract.ts:57` với owner `control`, và các đường đọc.
- `projectSnapshot.ts:65`, `runCheckpoint.ts:61`, `inputVersion.ts:15` đều lọc `owner !== "control"` hoặc `owner === stage`. `node_uploads` (owner `control`) không đi vào snapshot, checkpoint hay input version. Không có export, import, clone hay restore nào ghi bảng này.
- `references.ts:101–125`, `:324–347`, `:486–508` chỉ đọc.
- Không có Drizzle insert/update/delete trên `nodeUploads`. Cascade khi xóa job (nếu có FK) chỉ xóa hàng, không ghi `path`.

Vì vậy kết luận "không write site nào" đúng cho toàn bộ `apps/server/src`, không chỉ `leaseService` và `uploadStore`.

Kết quả: với hàng không-linked, `row.path` = `outputPath(job.projectId, job.id, lease_id, name)` tại lúc ghi. Cleanup tính `expected` bằng cùng `uploadsDir` (`leaseService.ts:139–140`), cùng `renders.renderDir(projectId)`, cùng `job_id`, `lease_id`, `name` (thay `/` bằng `__`). Hai đường chỉ khác nhau nếu `renderDir` đổi giữa lúc ghi và lúc cleanup.

## 2. Đường dẫn lưu có tuyệt đối không

`config.ts:362–364` đưa `DATA_DIR` về đường dẫn tuyệt đối (`resolve(workspaceRoot, …)`). Vì vậy `renderDir` và mọi `path` đã lưu đều tuyệt đối. Khác biệt duy nhất còn lại là đổi `DATA_DIR` giữa ghi và cleanup. Đây là thay đổi cấu hình, không do code nghiệp vụ sinh ra. Không đo. `deploy/product/promote.ps1` không chứa `DATA_DIR` hay `data-dev`, nên không thấy nơi nào trong script đó đổi thư mục dữ liệu.

## 3. `blobs.outputTarget` (`leaseService.ts:467–473`)

`outputTarget` gọi `blobs.outputTarget` (`blobStore.ts:72–76`), chỉ trả URL từ `provider.getUploadTarget(stagingKey(...))`. Hàm này không INSERT vào `node_uploads`. Hàng được ghi sau đó qua `saveVerified` với `target` đã tính (`leaseService.ts:587–594`). Nhánh H3 không tới được qua `blobs.outputTarget`.

## 4. Re-lease

Lease mới có `randomUUID()` mới (`leaseService.ts:245`, `:367`). Hàng cũ giữ `lease_id` cũ và `path` cũ. Không UPDATE nào đổi `path` (mục 1). Cleanup tính `expected` từ `lease_id` của chính hàng đó, nên khớp. Re-lease không tạo mismatch.

## 5. Hàng `linked`: đường dẫn artifact có thể nằm dưới `pending/`

Chuỗi đọc mã:

- `linkKnown` (`uploadStore.ts:49–56`) ghi `path = known.path`, với `known` lấy từ `artifacts.locate(sha256)` (`artifactService.ts:63–70`). `locate` chỉ kiểm file còn tồn tại và size/mtime khớp. Không kiểm vị trí.
- Predicate ở `leaseService.ts:494–498` chỉ yêu cầu đường dẫn nằm trong `projectDir(DATA_DIR, projectId)`. `render/pending/` nằm trong thư mục đó, nên predicate cho qua.
- Bảng `artifacts` được ghi qua `remember` (`artifactService.ts:55–60`, upsert theo `sha256`, **ghi đè `path`**). `remember` chỉ được gọi từ `register` và `registerSync` (`artifactService.ts:25`, `:48`).
- Toàn bộ caller của `register`/`registerSync` trong `apps/server/src` (đã grep):
  - `references.ts:172`: đăng ký mọi đường tuyệt đối trong `root` có trong đồ thị tham chiếu. Đồ thị này gồm `node_uploads.path` của job RUNNING/QUEUED, vì `references.ts:125` chỉ bỏ hàng của job không active. Cột `path` được nhận diện bởi `isProjectAssetPath` (`dataContract.ts:97`). Đây là đường chính đưa file pending vào `artifacts`.
  - Production: `FileGc` luôn tạo `ArtifactService` trên cùng DB khi không được truyền (`fileGc.ts:70`), nên đăng ký vào bảng `artifacts` xảy ra cả khi harness không truyền registry. `app.ts:255` dựng `FileGc` production. `collectReferences` chỉ được gọi từ `fileGc.ts:304` và `:406`.
  - Bổ sung (TASK-162; đây là đính chính thiếu sót, không phải sửa sai): trigger thật đi tới hai dòng trên gồm `app.ts:766` (`runBlobs({purge:true})`, `runBlobs` bắt đầu `fileGc.ts:224`), `app.ts:767` (`run({purge:true})`, `run` bắt đầu `fileGc.ts:394`), `app.ts:801` (`run({purge:true, ephemeralOnly:true})`), và `storageSettings.ts:47`, `:55`, `:56`. `toolDefs.ts:15` và `storageSettings.ts:38` chỉ gọi `report()` (`fileGc.ts:157`), không gọi `collectReferences`. `app.ts:255` chỉ khởi tạo `FileGc`, không gọi GC.
  - `references.ts:252` nằm trong `isTargetReferencedInDb`, hàm này trong production không được gọi (chỉ test `fileGcPurgeIndex.test.ts` dùng). Không thuộc đường chính.
  - `fileGc.ts:451` (file `warm`) và `:465` (`target` trước khi purge): đăng ký ứng viên, rồi `unlinkSync` ở `:467`. Sau khi xóa, hàng artifact thành stale, và `locate` trả `undefined` nhờ `existsSync`.
  - Chưa đọc: `inputVersion.ts:100`, `projectSnapshot.ts:118`, `:168`, `runTransport.ts:58`, `:84`, `remoteBundle.ts:53`. Theo tên, chúng đăng ký file đầu vào, snapshot hoặc bundle. Chưa xác nhận chúng không bao giờ nhận đường dẫn `render/pending/`. Kết luận mục 5 chỉ áp dụng cho các caller đã đọc (GC).
- Receive, finalize của `leaseService` **không** tự đăng ký file pending. Không có `register` nào trong `leaseService.ts`.
- Finalize **sao chép**, không di chuyển: `copyFile(final.path, incoming)` (`leaseService.ts:648`), rồi `renameSync(incoming, outputPath)` (`:650`) vào thư mục `versions/`. File pending của A vẫn còn sau SUCCEEDED, tới khi cleanup (`:424–437`) chạy.
- Vì vậy: khi job A đang RUNNING và GC chạy, `artifacts[sha]` trỏ tới file pending của A. Nếu job B cùng dự án có output cùng sha256 và gọi `haveOutputs` lúc file A còn, B nhận hàng `linked` trỏ tới file pending của A.

Chuỗi hỏng:

- Cleanup của A (`leaseService.ts:424–437`) chỉ xét hàng của A. Hàng đó không-linked và khớp đường dẫn, nên `rmSync` xóa file. Cleanup không kiểm tra hàng khác cùng đường dẫn.
- Hàng `linked` của B còn và trỏ tới file đã xóa.
- Finalize của B (`finalizeHeld`, `leaseService.ts:620`) gọi `sha256File(record.path)` cho hàng linked. File thiếu thì ném `ENOENT` thô, không phải `AppError`, và ném từ `finalizeHeld` trước khi `claim()`. Cùng lỗi có thể đến từ `copyFile` (`:648`) hoặc `readFileSync(reportRecord.path)` (`:639`) nếu file đó là linked.
- `:639` và `:648` chỉ lỗi nếu file biến mất sau khi vòng lặp `:620` đã qua, tức là một lần kiểm tra thứ hai có cửa sổ thời gian.
- Lỗi này không đi qua `failJob`: nhánh `catch` (`:598–612`) chỉ `failJob` khi `directClaimed` là true, tức đường S3. Với render thường, lỗi được ném ra ngoài và job không bị đánh dấu thất bại ở đường này. Trạng thái job sau đó (kẹt RUNNING, retry, hay lease hết hạn) không đọc được từ đoạn này. Không đo.
- Nếu file bị thay bằng nội dung khác thì `SHA256_MISMATCH` (`:621`). Không có trường hợp dữ liệu sai được duyệt.

Điều kiện để xảy ra, tất cả phải đúng:

1. A và B cùng dự án.
2. Cùng sha256, tức byte giống hệt. Ví dụ render lại có tính tất định.
3. B gọi `haveOutputs` khi `artifacts[sha]` trỏ tới file pending của A. Trong các caller đã đọc, đường đăng ký là GC (`references.ts:172`, `fileGc.ts:451/465`). Điều kiện này cần GC chạy trong lúc A còn file pending. Các caller chưa đọc (mục trên) chưa loại trừ.
4. Cleanup của A xóa file (A đã kết thúc hơn 24 giờ, và cleanup tick chạy) trong khi hàng linked của B còn và B chưa finalize xong. Cửa sổ là thời gian B tồn tại quanh mốc 24 giờ của A: B link trước mốc, finalize sau mốc.

Với job thông thường chạy vài phút, cửa sổ điều kiện 4 hẹp nhưng không rỗng. Mức độ: thấp, có điều kiện, chưa đo. Chưa xác định cửa sổ này có xảy ra trong vận hành thật hay không.

Ghi chú: `uploadStore.ts:71` bỏ qua `stat` cho hàng linked trong `fileOffset`. Điều này chỉ ảnh hưởng offset khi tải, không liên quan tới finalize.

## Không kiểm

- Chưa chạy test cho chuỗi linked. Nếu muốn đo, cần TASK-162: hai job cùng dự án, cùng sha, GC đăng ký file của A, B link, cleanup của A chạy, rồi finalize của B. Trình kích hoạt của giai đoạn 1 phải đi đúng đường production (`fileGc` → `collectReferences`). Nếu phải chèn hàng `linked` bằng tay, kết quả chỉ là synthetic, không nói gì về khả năng tới được.
- Ý tưởng cho TASK-162 (chưa đọc kỹ): cùng một job qua re-lease có thể thỏa điều kiện 1 và 2 (cùng dự án, cùng byte), nên có thể là đường thật đơn giản hơn. Chưa kiểm.
- Chưa đọc hết `collectReferences` (`references.ts:96–160`) và `DbReferenceIndex`. Chưa xác minh `isReferenced` có coi `artifacts` là tham chiếu hay không.
- Chưa đo hiệu lực của `fileGc.ts:451` và `:465`.
- Đổi `DATA_DIR` giữa ghi và cleanup (kể cả khi khởi động lại với `DATA_DIR` khác): chỉ ghi nhận từ mục 2, không đo. Đường dẫn tuyệt đối đã lưu sẽ không khớp `expected` của cleanup.
- Chưa đo "nhánh ENOENT" thật sự của `finalizeHeld` ở runtime.

## Sửa đi kèm (commit cục bộ, chưa push)

- `apps/server/test/leaseCleanupGcHandoff.test.ts`: comment của H2 sửa theo mục 5. H2 chỉ kiểm nhánh UUID, còn hàng linked vào nhánh status. Comment của H3 thêm ghi chú synthetic (mục 1). Chỉ comment; 3/3 xanh sau khi sửa.
- `docs/tasks/TASK-160.report.md`: phát hiện 1 (câu cuối), phát hiện 2 (H3 synthetic), và mục "Không kiểm" (linked dưới `pending/`, `blobs.outputTarget`).
