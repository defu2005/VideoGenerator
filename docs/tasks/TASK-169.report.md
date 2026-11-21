# TASK-169 — đọc `collectReferences` và thứ tự ghi artifacts (chỉ đọc)

Trạng thái: **chỉ đọc mã, chưa đo.** Không có test, không đổi `src`. Mọi câu dưới đây là "đọc từ mã", không phải kết quả chạy. Advisor đã rà soát bản này và yêu cầu sửa 5 điểm; các điểm đó đã được áp dụng (xem mục "Đã sửa theo advisor").

Câu hỏi:
1. Một lượt GC có đăng ký file pending của job đã xong (SUCCEEDED) không?
2. Khi pending và versions cùng sha256 trong một lượt, ghi nào đến cuối và thắng trong bảng `artifacts`?

## Đọc mã

### Lọc đầu vào (`apps/server/src/storage/references.ts`)

- `:115` `activeJobs` = job có status `RUNNING` hoặc `QUEUED`.
- `:116–117` `activeRuns` = run có status `GRANTED`, `RUNNING` hoặc `PAUSED_AT_GATE`.
- `:125` `node_uploads` chỉ được duyệt nếu `job_id` thuộc `activeJobs`.
- `:126` `run_uploads` và `run_checkpoints` chỉ được duyệt nếu `run_id` thuộc `activeRuns`.
- `:124` renders không được giữ (không trong `retainedRenders`, không pinned, và `due` hoặc `deleted_at`) thì bị bỏ.
- `jobs` và `renders` được duyệt **không có lọc status** (`:121` vòng lặp chung). Chưa grep xem JSON của `jobs` hoặc `renders.report` có chứa path pending hay không.
- `:128–135` với mỗi giá trị, `visitProjectFileReferences` (`dataContract.ts:106–120`) cho `path` khi khóa khớp `isProjectAssetPath` (`dataContract.ts:96–97`: tên `path` hoặc kết thúc `_path`). Giá trị sha256 làm khóa sha; path làm khóa `pathKey(path)` qua `protect(...)`.
- `:136–139` versionDir được bảo vệ như một thư mục, không phải file.

### Thứ tự chèn khóa vào `graph`

- `graph` là `Map`, nên thứ tự lặp theo thứ tự khóa được chèn lần đầu (`:85`, `add` ở `:86–90`).
- `PROJECT_TABLES` (`dataContract.ts:23–77`): renders ở dòng 40, jobs 52, nodeUploads 57, runUploads 61. Vòng `for (const { table } of PROJECT_TABLES)` (`:119`) duyệt đúng thứ tự này trong từng project.
- Vòng đăng ký (`:166–177`) lặp `[...graph]` theo thứ tự chèn. Khóa không phải đường dẫn tuyệt đối (`!isAbsolute`) bị bỏ qua, nên khóa sha không được đăng ký ở đây.

### Đăng ký (`:166–177`) và bảng artifacts (`:178–186`)

- `:172` `artifactRegistry.registerSync(real)` là nơi duy nhất trong `collectReferences` ghi bảng `artifacts`.
- `artifactService.ts:31–53` `registerSync`: nếu cache `registeredVersions` (`:14`) khớp path và stamp (`:36–37`) thì **return sớm, không gọi `remember`**. Chỉ khi cache miss thì `remember` (`:48`) chạy, và `remember` làm `INSERT … ON CONFLICT(sha256) DO UPDATE SET path=excluded.path` (`:55–58`). Ghi cuối cùng thắng.
- `:178–186` không đăng ký gì. Nó chỉ thêm ref theo sha và theo path.

### Người gọi và instance (đã kiểm tra)

- `fileGc.ts:60–70`: constructor nhận tham số thứ 7 `artifacts?`; nếu thiếu thì `this.artifacts = artifacts ?? new ArtifactService(db, this.now)`.
- `app.ts:255–256`: `new FileGc(database.sqlite, config.DATA_DIR, undefined, undefined, () => …, (work) => …)` truyền sáu tham số, **không truyền `artifacts`**, nên instance được tạo trong constructor và sống suốt vòng đời server.
- `app.ts:257`: cùng `fileGc` được truyền vào `createProjectService`, nên các lượt GC do project service kích hoạt dùng chung instance và chung cache.
- `fileGc.ts:304` và `:406` gọi `collectReferences(..., this.artifacts)`.
- `references.ts:165`: chỉ khi không truyền registry thì mới tạo instance mới cho lượt đó.

## Trả lời câu hỏi 1

Trong các route đã đọc, lượt GC chỉ đăng ký file pending khi có một **row đang hoạt động** trỏ đúng path đó:
- `node_uploads` của job RUNNING hoặc QUEUED (`:125`), hoặc
- `run_uploads` / `run_checkpoints` của run GRANTED, RUNNING hoặc PAUSED_AT_GATE (`:126`).

Job SUCCEEDED thì `node_uploads` của nó bị bỏ ở `:125`, nên path pending không vào `graph` qua route đó và không được `registerSync`. Ngoại lệ đã đọc: một row đang hoạt động (ví dụ `run_uploads` đã `have` đến file pending) trỏ cùng path. Chưa kiểm tra `jobs` và `renders` (không có lọc), nên không khẳng định "chỉ khi" cho toàn bộ đường đi.

Khớp với pre-assert trong `runSnapshotRepointsPending.test.ts` (dòng 110–111): GC khi job A còn RUNNING thì đăng ký pending của A. Test xanh 2/2. Đây là bằng chứng gián tiếp, không phải phép đo riêng cho TASK-169.

## Trả lời câu hỏi 2

**Kết quả phụ thuộc trạng thái cache của từng path trong lượt đó.** Cả hai path đều phải được đăng ký trong cùng lượt (cả hai được bảo vệ):

| versions | pending | Kết quả |
|---|---|---|
| miss | miss | Ghi hai lần, **pending ghi sau và thắng** (`path = pending`) |
| miss | hit | **versions thắng**: pending return sớm ở `artifactService.ts:37`, không ghi |
| hit | miss | **pending thắng** (ghi pending, versions không ghi) |
| hit | hit | Không ghi, row giữ nguyên |

Thứ tự "versions trước, pending sau" trong một project đúng khi: renders row được giữ (`:124`), và **không có bảng nào trước dòng 40 có một path ref trỏ tới pending**. Nếu có, khóa pending được chèn trước khóa versions và thứ tự đảo lại (versions ghi sau và thắng). Trường hợp cache miss/miss là trường hợp đã đọc ở trên; các trường hợp còn lại phụ thuộc cache và chưa đo.

Ngoài một project: thứ tự quét `SELECT id,… FROM projects` (`:98`) không có `ORDER BY`, nên mã không đảm bảo thứ tự giữa các project. Chưa đo.

### Giả thuyết "kẹt ở pending" (chưa được xác lập)

Vì instance GC là lâu dài (`app.ts:255`), versions có thể đã nằm trong cache từ lượt trước. Khi đó một lượt mà chỉ pending được đăng ký (miss) hoặc cả hai đều được đăng ký nhưng versions hit, row có thể trỏ về pending. Khi cleanup xóa pending (`cleanupFinishedUploads`, sau khoảng 24 h theo tài liệu/pin, chưa đối chiếu lại ngưỡng trong mã), `artifacts.path` có thể trỏ tới file không còn.

- **Điều kiện cần:** một row đang hoạt động trỏ tới pending **và** một renders DONE được giữ có cùng bytes trong cùng lượt, hoặc versions đã nằm trong cache từ trước. Chưa xác lập rằng production đạt tới điều kiện này.
- **Không mâu thuẫn với pin TASK-168:** các writer dùng instance mới (`projectSnapshot.ts:97`, `references.ts:247`) vẫn repoint S về versions, như pin đã chứng minh.
- Đây là giả thuyết từ mã; cần đo bằng hai lượt trên cùng một `FileGc` (TASK-170).

Rút nhánh cache của `b2fad9d` **không áp dụng** cho đường GC. `b2fad9d` chỉ đúng với đường snapshot, nơi mỗi lần gọi dựng `ArtifactService` mới (`projectSnapshot.ts:97`).

## Đã sửa theo advisor

1. Q2 không còn là kết quả cold-cache đơn lẻ; có bảng bốn trường hợp theo trạng thái cache.
2. Giả thuyết "kẹt ở pending" ghi rõ điều kiện cần, đánh dấu chưa xác lập, và nêu các writer instance mới vẫn repoint.
3. Điều kiện đảo thứ tự đã sửa: là một bảng **trước** renders (dòng <40) có path ref tới pending, không phải một row versions.
4. Câu "chỉ khi" của Q1 đã thu hẹp về các route đã đọc; `jobs` và `renders` chưa kiểm tra.
5. Đã xác nhận `FileGc` constructor (`fileGc.ts:60–70`) và `app.ts:255` không truyền `artifacts`, và `app.ts:257` truyền cùng instance cho project service.

## Ghi chú

- Hardening (d), chỉ ghi nhận, không sửa `src`: `linkKnown` (`uploadStore.ts:49–56`) trả về ngay khi đã có row linked mà không kiểm tra `existsSync`.
- Chưa đo: thứ tự cross-project; hành vi cache qua nhiều lượt GC; `jobs`/`renders` JSON có chứa path pending hay không.
- Bước tiếp theo đã được advisor chỉ định: **TASK-170**, đo bốn trường hợp cache bằng một `FileGc` qua hai lượt; chỉ test, không đổi `src`.
