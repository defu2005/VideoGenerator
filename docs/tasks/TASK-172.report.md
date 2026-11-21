# TASK-172 — đường kết thúc không complete và các reader của `artifacts.path` (chỉ test + đọc)

Trạng thái: **đã đo bằng test**. Không đổi `src`. File test: `apps/server/test/fileGcCacheCases.test.ts`: hai ca TASK-172 (describe "terminal without complete") và ba ca follow-up (describe "restart and hand-deleted row", cuối file). Tổng file: 13 ca; cùng hai ca pin TASK-168: 15 ca.

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

Phạm vi câu này: **chỉ các reader của `artifacts.path`**. Reader thiếu kiểm tra đều nằm trong GC và oracle. `linkKnown` (`uploadStore.ts:52`) không đọc `artifacts.path` trực tiếp: nó gọi `locate`, nên có `existsSync`. Riêng `validate` (`uploadStore.ts:32–42`) đọc `${this.table}` (node_uploads hoặc run_uploads) theo (owner, lease, name) và trả row hiện có khi sha và size khớp, không kiểm tra file. `linkKnown` (`:50–51`) coi mọi status trừ `partial` là thành công. Đây là đường upload, không phải reader của `artifacts.path`; ghi là gợi ý cứng hóa (d), chưa đo.

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

Chạy: `npx vitest run test/fileGcCacheCases.test.ts test/runSnapshotRepointsPending.test.ts` (trong `apps/server`): 15/15 xanh, trong đó 13 ca của file cache (8 cũ + 2 TASK-172 + 3 follow-up) và 2 ca pin TASK-168. Lần chạy trước follow-up là 12/12.

**Probe (một lần, sau cleanup):** `isReferencedInGraph` không kiểm tra tồn tại. Trong fixture R, pass 3 chạy trên row đang trỏ file đã xóa, và `render-0` vẫn còn. Kết quả này chỉ cho biết fixture R không mất file; không cô lập được nhánh `isReferencedInGraph` là nguyên nhân.

## Phát hiện

1. **Trạng thái "kẹt ở pending" xảy ra trên đường FAILED không complete**, cả khi có bản sao hợp lệ (fixture R) và khi không có (fixture N). Đây là đường production đã đọc được, không chỉ mock.
2. **Row dangling che bản sao hợp lệ:** trong fixture R, `locate(S)` trả undefined dù `render-0` có cùng bytes. Ai dùng `locate` (upload có sha đã biết, `linkKnown`) nhận undefined. **Đọc từ mã, chưa đo:** khi đó `linkKnown` trả false và caller phải upload lại. Đây là lỗi hiệu quả cho đường upload (`linkKnown` → upload lại). Trên đường tải đầu vào (`artifactFor`), cùng trạng thái trả 404, không upload lại: xem mục Caller của `locate`. `remember` (`artifactService.ts:58`) là upsert theo sha: lần ghi sau thắng, nó đặt `path`, `size`, `mtime_ms` về file mới. Vì vậy khi S được đăng ký lại ở path mới, row sẽ trỏ tới path đó (đọc, chưa đo trên đường upload).
3. Trong fixture R, lượt GC sau cleanup không ghi lại row (`retained-versions` hit), nên row không được sửa.

## Đo thêm (follow-up, advisor 2026-11-21)

Dự đoán được viết trước lần chạy đầu. Cả bốn khớp; file và pin 15/15 xanh.

| Ca | Dự đoán | Quan sát |
|---|---|---|
| R, FileGc mới sau cleanup (restart, cache trống) | seq [retained-versions], path retained-versions; `locate` trả `render-0` | khớp |
| N, FileGc mới sau cleanup | seq [], path pending, locate undefined | khớp |
| R, xóa row S bằng tay sau cleanup, pass trên cùng FileGc | seq [], không có row, locate undefined | khớp |
| (cùng ca) FileGc mới sau đó | seq [retained-versions], path retained-versions | khớp |

Kết luận:
- **Restart là cách sửa row đã đo.** Trong FileGc mới, cache trống nên `render-0` miss, được ghi (repoint row), và `locate` trả lại bản sao hợp lệ. Thời gian row dangling tồn tại là tới khi cache mất (restart, hoặc cache đạt 4096 mục rồi bị xóa). Chỉ restart được đo; việc xóa cache đầy đủ là đọc, chưa đo.
- **Ca N không tự sửa:** không có ghi nào, row vẫn trỏ pending.
- **Xóa row bằng tay không được khôi phục trên cùng FileGc.** Cache hit ở `artifactService.ts:37` trả về sớm, không gọi `remember`, nên row không được tạo lại và `locate` vẫn undefined dù `render-0` còn. Vì vậy phương án 1 không thể chỉ "xóa row": cần xóa mục cache của path, hoặc repoint tường minh.

## Caller của `locate` (kiểm tra đọc, advisor 2026-11-21)

Đọc, không đo. `locate` trả undefined (`artifactService.ts:63–70`) khi: không có row; file tại `row.path` không tồn tại; **hoặc** size/mtime của file khác row. Điều kiện thứ ba xảy ra cả khi file vẫn còn (ví dụ file bị ghi đè cùng bytes, như ca collision ở TASK-170).

| Caller | Khi undefined | Đăng ký lại trước đó? | Kết luận |
|---|---|---|---|
| `leaseService.ts:528` (`artifactFor`, tải đầu vào của job) | 404 `ARTIFACT_NOT_FOUND` (`:529`) | Không trong `artifactFor`. Bundle được dựng trước đó ở `leaseService.ts:354` → `remoteBundle.ts:53` `register` (không cache, ghi lại row). Phản hồi phía node đã đọc, nằm trong repo (`agent.ts:825–878`): xem mục artifactFor bên dưới. | **Có thể 404 khi file còn tồn tại**, theo hai trường hợp (a) và (b) bên dưới. |
| `uploadStore.ts:52` (`linkKnown`) | `false` (`:53`); node upload lại (`leaseService.ts:507` không đưa sha vào `have`) | Không | Upload lại, không lỗi. Đường upload sau đó (có `remember` hay không) chưa đo. |
| `runTransport.ts:83` (`artifact`) | 404 `ARTIFACT_NOT_FOUND` (`:84`) | Có, gián tiếp: `snapshot()` (`:81`) chạy `exportProjectSnapshot` và `registerSync` cho file trong `projectSnapshot.ts:118`, trên instance mới (cache rỗng). Với file đã liệt kê, row được repoint trước `locate`. | Không lỗi trên file còn tồn tại khi file nằm trong snapshot. Đọc, chưa đo end to end. |

**Điều kiện dừng (advisor) và kết quả đợt sau:** `leaseService.artifactFor` 404 trên file còn tồn tại. Advisor tách thành hai trường hợp, đo bên dưới. Không đổi `src`.

### artifactFor: (a) và (b) (advisor 2026-11-21)

- **(a) Stamp đổi trên cùng path.** Input bị ghi lại sau `register` của bundle. `locate` trả undefined theo hợp đồng (`artifactService.ts:62`, "changed since it was hashed"). Đây là thiết kế, không phải kết quả của luồng TASK-172.
- **(b) Row bị repoint rồi file đích bị xóa.** Bundle `register` trỏ S tới input P. Một writer sau đó (`registerSync`, last writer wins) trỏ S tới bản sao X cùng bytes. X bị xóa. `artifactFor` trả 404 trong khi P còn. Đây là cơ chế của luồng TASK-172, và là trường hợp duy nhất có thể biện minh cho src change.

Đọc (không đo trừ khi ghi chú):
- `readPending` (`leaseService.ts:464–468`) đọc file pending. `Pending.files` là `ArtifactRef[]` (`leaseService.ts:84–87`), và `ArtifactRef` là `{name, sha256, size}` strict (`packages/shared/src/schemas/renderBundle.ts:7–11`). **Pending không có path.** Vì vậy "registerSync trước locate" trong `artifactFor` không có path để đăng ký. Sửa cần lấy path từ nơi khác (ví dụ lưu path lúc dựng bundle, `leaseService.ts:353–354`): đó là thay đổi src.
- Cửa sổ dựng → tải: bundle được dựng và pending ghi **mỗi lần lease** (`leaseService.ts:354` dựng, `:370–372` ghi pending và `setJobLease`). Lease mới dựng lại bundle và register lại P (`remoteBundle.ts:53`).
- Phía node: tải đầu vào nằm trong `runJob` (`agent.ts:825–828`). `installArtifact` ném lỗi khi không ok (`agent.ts:613–615`). Lỗi rơi vào `catch` (`agent.ts:868`), gửi `POST /fail` với `retryable: true`, code `NODE_RENDER_FAILED` (`agent.ts:871–878`). Server: `failJob` retryable → QUEUED nếu còn lượt (`orchestrator.ts:799–815`). Lease mới register lại P, row về P. **Suy ra từ đọc: mỗi 404 tốn một lượt retry và tự phục hồi; chỉ thành terminal khi hết `maxAttempts`.** Nhánh QUEUED với `retryable: true` đã đo (mục "Đo heal"): QUEUED, nhưng bị giữ đến `runAfter`.
- Tải đầu vào ưu tiên `preferredUrl` (`agent.ts:585–601`, lỗi được nuốt), rồi fallback `/api/nodes/agent/artifacts/:sha?jobId=` (`agent.ts:603`). Chỉ fallback đi qua `artifactFor`. Đọc, chưa đo.
- Điều kiện để (b) xảy ra trong thực tế: X cùng bytes và bị xóa **trong cửa sổ lease** của B. Pending của job đã xong bị dọn sau 24 h (`leaseService.ts:424–428`), GC chạy mỗi 24 h (`app.ts:757–775`). Đường giảm áp lực đĩa (`app.ts:801`) chưa đọc hết. Chưa đo.

Đo (`apps/server/test/workerNodes.test.ts`, describe artifactFor, dự đoán viết trước lần chạy). Các ca này ghim hành vi quan sát, không phải ca đỏ:

| Ca | Dự đoán | Quan sát |
|---|---|---|
| (a) stamp đổi, cùng path | 404 `ARTIFACT_NOT_FOUND`; P còn | khớp |
| (b) repoint sang X, rồi xóa X | trước xóa: path = X; sau xóa: 404; P còn | khớp |

**Lưu ý (b):** repoint trong test là một lời gọi `artifacts.registerSync(copy)` trực tiếp, **không phải** một lượt GC. Ca này chỉ chứng minh cơ chế (row trỏ tới file đã xóa). Nó không chứng minh GC có thể làm việc đó (xem mục "Khả năng tới được" bên dưới).

#### Đo heal (advisor 2026-11-21, dự đoán viết trước lần chạy)

Lần chạy đầu: **cả ba ca đỏ** ở `leases.lease` thứ hai (trả undefined). Dự đoán H1/H2 sai ở bước này, không phải ở heal. Nguyên nhân: retry đặt `runAfter = now + backoff` (`orchestrator.ts:800–810`), nên job không thể lease lại cho tới khi đồng hồ vượt `runAfter`. Sửa test: `harness.advance(24 h)` sau `failJob`. Ghi chú không đổi giá trị dự đoán, chỉ thêm bước đồng hồ.

| Ca | Dự đoán | Quan sát |
|---|---|---|
| (a-heal) stamp đổi, `failJob` retryable, lease lại, `register(P)` | QUEUED; sau register artifactFor trả P | khớp sau khi thêm advance |
| (b-heal) repoint, xóa X, `failJob` retryable, lease lại, `register(P)` | QUEUED; sau register artifactFor trả P | khớp sau khi thêm advance |
| (b-control) như (b-heal) nhưng không `register` | 404 còn | khớp |

Ý nghĩa: heal phụ thuộc vào việc lease lại **gọi register** trên P. Production làm điều này (`remoteBundle.ts:53`). Module mock của `buildRemoteBundle` trong test không gọi, nên mỗi ca heal tự gọi `artifacts.register(P)`. Không có register thì không heal (ca control). Heal chỉ đo cho đường copy (a, b). Chuỗi P bị purge (input bị xóa, không có bản sao) chưa đo heal.

Chạy: `npx vitest run test/workerNodes.test.ts` (đầy đủ): **36/36 xanh**. Trước đó chỉ chạy lọc tên (3/3), nên đã thiếu bước kiểm tra trạng thái dùng chung. Chạy đầy đủ đã chứng minh: các ca mới không làm đỏ ca cũ. `npx tsc --noEmit -p .` (trong `apps/server`) exit 0, nhưng tsconfig của server **không** bao phủ `test/`. Các ca heal không được type-check. Không chặn kết luận, vì các ca đã chạy và xanh.

Kết luận tạm (chưa khóa): nếu requeue + lease lại + register heal được (đã đo ở trên), (b) là một lượt retry lãng phí, không phải lỗi vĩnh viễn trừ khi rơi vào lượt cuối. Chưa đủ để chọn src change, vì còn câu hỏi có tới được (b) trong production không.

#### Khả năng tới được (đọc, advisor 2026-11-21)

Câu hỏi: có đường production nào vừa đăng ký X cùng bytes, vừa xóa X, trong khi lease của B còn sống?

- **Lease:** `NODE_LEASE_SEC` mặc định 60 s (`src/lib/config.ts:65`, min 10, max 600). Lease được ghi tại `leaseService.ts:369`.
- **Điều kiện xóa trong purge** (`src/storage/fileGc.ts`):
  - Ứng viên phải có **mark cũ**: mark được ghi ở lượt GC đầu tiên thấy file không được tham chiếu (`:417–428`), với `purge_after = startedAt + grace` (`:425–431`). Mốc đếm là **lúc có mark**, không phải tuổi file. Grace là 1 ngày với `ephemeral` (`:425`), và `graceDays` với project file: mặc định 14, tối thiểu 7 (`gcSettings.ts:6`, `:10`). Vậy X không thể bị xóa trong cùng lượt nó vừa xuất hiện; X phải đã unreferenced ít nhất một grace kể từ mark.
  - Trong transaction (`:457–471`): kiểm tra path tại `:460` (và `:422` ở mark loop) chạy trước; `registerSync(target)` tại `:465` **ghi row trỏ tới X trước khi kiểm tra sha** (`:466`). Nếu `sha` của X không được tham chiếu (`index.isReferenced(file.path, sha)`, `references.ts:432`), `unlinkSync(X)` tại `:467`. Kết quả: row trỏ tới X đã xóa, đúng hình dạng (b). Thao tác này do chính GC gây ra, không cần writer bên ngoài.
  - Chặn duy nhất là kiểm tra theo **sha** ở `:466` (`index.isReferenced`, `references.ts:432`): sha được coi là tham chiếu khi nằm trong tập `*sha256` của các bảng được duyệt (`dataContract.ts:106–129`), gồm `node_uploads` của job RUNNING/QUEUED (`references.ts:125`) và `run_uploads` của run đang hoạt động (`:126`); hoặc path (hoặc tổ tiên) của file nằm trong tập path được bảo vệ. **File `render/pending/*.json` không được duyệt.** `Pending.files` (sha của input, ghi tại `leaseService.ts:370–371`) chỉ nằm ở đó, nên sha của input không vào tập sha, trừ khi một row khác đang được duyệt mang đúng sha đó (ví dụ `visual_candidates.sha256`, khi row không bị bỏ qua tại `references.ts:122`).
- **Lịch chạy:** `app.ts:766–767` mỗi 24 h (`fileGc.run({purge:true})`). `app.ts:801` chạy `run({purge:true, ephemeralOnly:true})` mỗi ≥5 phút khi đĩa dưới 15% (`:789–800`). Cleanup pending chạy trước GC trong cùng tick (`app.ts:761`, 24 h cutoff).

**Kết luận đọc (cập nhật, advisor 2026-11-21):** đường này **không bị chặn** với input chỉ được nhắc trong pending JSON. Hai điều kiện, đều đọc chứ chưa đo:
1. Không row nào đang được duyệt tham chiếu input theo path hoặc theo sha tại thời điểm purge.
2. Input đã qua grace: 1 ngày với `ephemeral` (cũng là đường disk-pressure, `ephemeralOnly`), `graceDays` với file project.

Khi đó GC đăng ký input (`:465`) rồi xóa nó (`:467`). `artifactFor` trả 404 **kể cả khi chỉ có P**, không cần bản sao X, vì row đã trỏ tới P đã bị xóa. Ca (b) đã đo dùng bản sao; chuỗi đơn giản hơn là tự xóa input. Ứng viên cụ thể đã đọc, chưa đo: `visual_candidates` mà job đang dùng làm input, không còn được chọn **và** (`discarded_at` đặt, hoặc project due). Điều kiện bỏ qua chính xác tại `references.ts:122`: `!selected && (due || discarded_at)`. Đổi selection trên project không due không đủ, vì candidate vẫn được duyệt qua row. Ví dụ cũ chỉ dựa vào discard là chưa đủ. Ứng viên thứ hai: file ephemeral mà không bảng nào nêu; nguồn chưa xác định.

**Tập input của bundle (đọc theo category, advisor 2026-11-21).** `buildRemoteBundle` có một caller (`leaseService.ts:354`, trong `prepare` của render). TTS bundle (`buildTtsBundle`, `remoteBundle.ts:86`) chỉ có text cảnh và voice, không có path, nên không đăng ký file.
- voice, music: được row bảo vệ (đọc).
- visuals (`visuals` nằm trong `managedFolders`, `fileGc.ts:14`): được bảo vệ khi còn được chọn. Không được bảo vệ khi thỏa điều kiện `references.ts:122` ở trên.
- crops: được bảo vệ qua `visual_crops.output_path` (đọc).
- footage: ghi tại `dataDir/footage/<provider>-<id>-<height>.mp4` (`providers/footage/download.ts:20`). Inventory chỉ quét `projects/<uuid>` và `cache` (`fileGc.ts:84–128`), nên **footage không bao giờ là ứng viên purge**.
- sfx: chỉ là tên, resolve từ `apps/server/assets/sfx` (`executeRender.ts:181`, `agent.ts:53`), ngoài DATA_DIR, không được inventory.
- `renderPath`/`graphicPath`: giá trị enum (`"static"`, `"animated"`, `"reencoded"`), không phải file. Loại khỏi danh sách.
- subtitles: loại trừ (đã đọc trước đó).

**Kết luận khả năng tới được:** không input nào đã đọc bị purge rồi gây 404, ngoài trường hợp visuals có điều kiện: candidate không còn được chọn và (discard hoặc project due) trong suốt grace kể từ mark (`graceDays`, mặc định 14), trong khi fetch của lease còn chờ. Đọc, không đo. Không đề xuất src fix từ điều kiện này.

Lưu ý: `:465` làm GC tự repoint một row về file sắp xóa. Đây là điểm mà advisor cần biết, dù (b) có tới được hay không.

**Tuổi thọ cache:** cache thuộc từng instance `ArtifactService`. Ngoài `FileGc` (`fileGc.ts:70`), các instance khác cũng ghi bảng `artifacts`: `projectSnapshot.ts:97` và `:165`, `inputVersion.ts:46`, `runTransport.ts:52`, `app.ts:686`. `RunTransportService` được tạo một lần ở `app.ts:636` (đọc); vòng đời theo hàm dựng app, chưa đọc hàm đó. Tác động của các instance này lên row chưa đo.

## Phương án sửa (chưa thực hiện)

1. **Khi job kết thúc không complete hoặc khi cleanup xóa pending:** nếu row của sha trỏ tới file sắp xóa, xóa row hoặc repoint tới bản sao còn tồn tại (`registerSync`) trước khi xóa file. Test: ca R và N ở trên, kỳ vọng `locate(S)` trả bản sao còn tồn tại (R) hoặc undefined (N) và row không trỏ file đã xóa. Hai ràng buộc, lấy từ đo follow-up và đọc:
   - (i) `artifacts` chỉ giữ một path cho mỗi sha, nên "bản sao còn tồn tại" không có sẵn trong bảng. Phải lấy từ row `renders` DONE còn `output_path`. Trong fixture R, bản sao còn lại duy nhất là row `renders` của `render-0`; row này không có cột sha, nên phải `registerSync` file của nó để lấy sha và ghi row.
   - (ii) Cache early return (`artifactService.ts:37`) không đọc row. Cache hit trả sha mà không ghi lại row. Ca hand-delete cho thấy xóa row một mình không khôi phục `locate` trong cùng FileGc, nên phương án 1 phải xóa mục cache của path (hoặc repoint tường minh).
2. **Cleanup giữ file mà row đang trỏ tới:** giống hướng đã làm cho file linked ở TASK-166. Đánh đổi là đĩa tốn thêm đến khi row được repoint. Test: pending còn sau cleanup khi row trỏ tới nó.
3. **Thêm kiểm tra tồn tại vào `isReferencedInGraph` và `references.ts:266`/`:439`:** chỉ sửa đọc, không sửa row. Đánh đổi: không xóa row dangling, chỉ tránh suy luận từ path đã mất. Cần một ca cô lập nhánh này trước khi làm.

Khuyến nghị của báo cáo: làm (1) trước, vì nó sửa gốc (row dangling) và có test rõ ràng, nhưng phải kèm xóa mục cache và lấy bản sao từ `renders` DONE qua `registerSync` (xem ràng buộc (i), (ii)). (2) và (3) là phương án dự phòng.

## Chưa đo

- `artifactFor` (b): chỉ đo repoint bằng `registerSync` trực tiếp rồi xóa, không đo bằng GC. Chưa đo GC tự repoint-rồi-xóa (`fileGc.ts:465–467`) với một input thực. Tập input đã đọc theo category (mục "Khả năng tới được"), chưa đo trên production. Heal chỉ đo cho đường copy; chuỗi P bị purge chưa đo heal.
- Chưa đo đường `preferredUrl` (`agent.ts:585–601`), vì nó không đi qua `artifactFor`.
- Đường cancel (`orchestrator.cancel`) và NODE_LOST (`nodeService.sweep`, `revoke`).
- Đường failJob có retry (QUEUED, rồi chạy lại trên lease mới).
- Đường upload lại S: `remember` ghi đè path khi đăng ký file mới cùng sha (đọc, chưa đo).
- Xóa cache đầy đủ khi đạt 4096 mục (`artifactService.ts:49`): đọc, chưa đo.
- `locate` ở đường upload sau khi row dangling: chỉ suy ra từ đọc (`linkKnown` trả false), chưa đo.
- Finalize lỗi giữa `renameSync` và INSERT (đã nêu ở TASK-170).
- Thứ tự cleanup và GC trong cùng chu kỳ (đã đọc, chưa đo).
- `references.ts:266` và `:439` chưa có ca riêng; chỉ có probe gián tiếp ở ca R.
- Trên `renders.finalize` thật: ca R và N không gọi finalize (chỉ dùng row chèn tay ở TASK-170 b).
