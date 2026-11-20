# TASK-138 — Vòng đời tệp và dọn kho

Hoàn tất triển khai và tự review ngày 2026-11-17. Không commit/push theo chỉ dẫn người dùng.

## Đã triển khai

- `pipeline/dataContract.ts` cung cấp bộ đọc tham chiếu tệp dùng chung, bao gồm bảng project, JSON legacy và bảng thư viện/hồ sơ. `inputVersion.ts` dùng lại hàm giải mã. `storage/references.ts` dựng đồ thị từ timeline, ảnh đã chọn, snapshot hoàn tác, bản render, bài đăng, clip và upload còn hoạt động. Các tham chiếu chỉ có đường dẫn được băm để bảo vệ cùng nội dung có nhiều bản cục bộ.
- `storage/fileGc.ts` đánh dấu tệp và blob chưa có tham chiếu, lưu thời gian chờ rồi kiểm tra lại trong transaction trước khi xóa. Dấu tệp gồm inode, kích thước, mtime và ctime. Junction, symlink, hard link, thư viện dùng chung và dự án bảo vệ nằm ngoài lượt xóa tự động. Cache dẫn xuất được phân loại ephemeral.
- Migration Drizzle `0086_zippy_johnny_storm.sql` thêm thời gian orphan/purge vào blobs, bảng dấu tệp cục bộ và bảng nhật ký. Generate tiếp theo báo No schema changes.
- Xóa project và giữ số bản render chuyển sang đánh dấu. Bản render được bài đăng sử dụng giữ lại. Project có job hoặc project run đang hoạt động bị chặn xóa.
- `storage/gcSettings.ts`, `diskPressure.ts`, resource governor, worker và lease service nối ngưỡng dung lượng. Dưới 15% có lượt dọn ephemeral đã hết hạn và thống kê project lớn. Dưới 5% chặn nhận RENDER và MEDIA_FETCH mới, kể cả khi tắt điều tiết thích ứng.
- API cấu hình lưu trữ, `StorageLifecycle.tsx`, featureMap, user guide và changelog có báo cáo, chạy thử, xác nhận dọn cùng cài đặt thời gian giữ. `storage_report` là tool chỉ đọc, lọc theo scope của người gọi.

## Recovery S3

PUT mirror và DELETE GC dùng chung hàng đợi. Trước DELETE, GC giữ bản phục hồi ở `gc-recovery/<location-hash>/<sha256>`, fsync và kiểm SHA. Nếu tham chiếu xuất hiện khi DELETE đang chờ mạng, app phục hồi bản cục bộ chuẩn và object S3, xác minh rồi mới công nhận bản sao. Lỗi phục hồi giữ bản dự phòng và trạng thái chưa xác minh để thử lại bằng FileGc instance mới.

SQLite transaction và HTTP DELETE là hai thao tác độc lập. Bản phục hồi và lượt kiểm lại đảm bảo có đường khôi phục khi tham chiếu đổi trong lúc chờ mạng. Nếu crash sau khi xóa row nhưng trước khi gỡ bản dự phòng, có thể còn tệp phục hồi thừa. Đường khôi phục cục bộ dựa vào artifacts.path. Một đường dẫn đã mất và chưa từng biết quan hệ với SHA không thể được tự suy ra.

## Kiểm chứng hiện có

- Core ban đầu đạt 61 test qua fileGc, projects, render và resource governor. Recovery S3 đạt 7 test trong hai suite, bao gồm tham chiếu xuất hiện trong lúc DELETE, PUT phục hồi lỗi rồi thử lại sau restart và bản tải dự phòng sai SHA.
- Browser dùng Fastify/SQLite tạm, chạy thử báo một tệp đủ hạn, xác nhận dọn xóa đúng một tệp và giữ ảnh timeline. Cài đặt 21 ngày lưu qua reload. Desktop/mobile 375 px không lỗi JS hoặc tràn trang. Xem `tmp/task138-browser-result.json`, `task138-browser-desktop.png`, `task138-browser-mobile.png`.
- Lượt workspace đầu phát hiện catalog tool vượt 37.000 ký tự và test nút xóa render dùng nhãn cũ. Đã rút mô tả catalog và cập nhật test theo nhãn mới. Một số ca preview/CLI/visual bị timeout trong lượt chạy nhiều worker. Lượt kiểm lại giới hạn hai worker ở `tmp/task138-workspaces-retry.log` còn hai lỗi từ bản source trước delta; đã kiểm lại và khép trong lượt xác minh cuối.
- Typecheck/build sau bổ sung bộ đọc bảng thư viện phát hiện một type predicate quá rộng. Đã sửa và cả hai lệnh kiểm lại đạt ở `tmp/task138-recovery-typecheck.log` và `tmp/task138-recovery-build.log`. Test cache ephemeral bổ sung đã đạt.
- Bộ skill có nội dung mới dùng ký tự ellipsis bị validator coi là placeholder và một entry coverage cũ. Đã sửa nội dung ví dụ và bỏ entry đã có skill phủ. Bộ kiểm skill bổ sung đã đạt.
- Bộ delta gồm skill, core GC, recovery và resource governor đạt 34/34 (`tmp/task138-delta-final.log`). Test vòng đời archive giữ bản đã đăng, bản mới nhất và các đầu vào rồi render lại đạt (`tmp/task138-rerender-regression.log`). Test cache ephemeral riêng đạt (`tmp/task138-cache-regression.log`). Lượt xác minh cuối ở bên dưới đã thay thế các kết quả tạm.
- Bộ bổ sung scope/candidate/recovery/skill đạt 15/15 (`tmp/task138-scope-selection-tests.log`). Ảnh được chọn chỉ được bảo vệ bởi visual selection vẫn giữ, ảnh chưa chọn được dọn sau archive. Tool báo cáo lọc project của workspace khác.
- Đã bỏ cơ chế sweep 24 giờ riêng trong preview để các tệp preview cũ đi qua cùng GC. Sweep ngày kiểm S3 trước rồi kiểm local, đợi lượt đang chạy khi đóng app.

## Kiểm tra cuối và phạm vi

Lượt workspace xác minh `tmp/task138-workspaces-verified.log` đã kết thúc exit 0 với shared 781, MCP 49, server 1.547 đạt / 7 skip, web 227. Delta preview, GC, recovery và provider đạt 34/34 ở `tmp/task138-sweep-final-tests.log`. Thống kê tệp được giữ, project bảo vệ và S3 có thêm kiểm scope, đạt 11/11 ở `tmp/task138-report-scope-tests.log`.

Typecheck toàn repo đạt ở `tmp/task138-sweep-typecheck.log` và lượt cuối `tmp/task141-takeover-typecheck.log`. Build toàn repo cuối đạt ở `tmp/task138-close-build.log`. TASK-141 bắt đầu song song và có code dở riêng. Lỗi declaration ở cấu hình kiểm delta ban đầu được sửa bằng cách đưa các ambient declaration hiện có vào cấu hình test, không thêm dependency.

`git diff --check` đạt. 433 file văn bản thay đổi được kiểm UTF-8 và NUL, không phát hiện lỗi. Drizzle lần cuối báo No schema changes ở `tmp/task138-final-schema-check.log`.

Thống kê hiện tính đủ tệp giữ lại, project bảo vệ và object S3 đã ghi trong registry. Báo cáo dung lượng theo đường dẫn nên một nội dung có nhiều bản cục bộ có thể được tính nhiều lần. Marker này không nghiệm thu phần continuity của TASK-141.

## Bổ sung sửa lỗi sau review Codex (Fix pass 1, 2026-11-17)

- **[P1] Tối ưu dựng đồ thị và tái sử dụng stamp cache `ArtifactService`**:
  - `apps/server/src/storage/references.ts`: `collectReferences` nhận tham số `registry?: ArtifactService`. Khi chuyển vào, quá trình giải quyết các tham chiếu đường dẫn cục bộ (path-only) tái sử dụng cache dấu tệp (`registeredVersions` theo `dev:ino:size:mtimeNs:ctimeNs`), không đọc và băm lại nội dung đồng bộ nếu tệp không đổi.
  - `apps/server/src/storage/fileGc.ts`: `FileGc` giữ một instance `ArtifactService` sống lâu. Trong `runBlobs()`, đồ thị tham chiếu cơ sở (`baseGraph`) được dựng duy nhất 1 lần đầu sweep thay vì dựng lại ở mỗi row blob.
  - An toàn ranh giới bất đồng bộ: Khi cần purge blob sau các bước chuẩn bị sao lưu/xoá remote, hàm `currentReferenced(sha)` kiểm tra lại trên cơ sở `baseGraph` và chỉ quét lại khi cần thiết để bảo đảm các tham chiếu mới thêm vào trong lúc chờ I/O không bị xóa nhầm. Bảo toàn kiểm tra quyền sở hữu project bảo vệ, tệp hỏng JSON fail-closed và phục hồi crash-safe.
  - Bằng chứng tái hiện sau sửa: chạy `npx tsx tmp/codex-review-138-repro.ts`, kết quả lưu tại `tmp/codex-review-138-repro-after.log`:
    - 1 blob S3: 1 lần gọi registerSync, băm 16 MiB, 0 trong transaction, 43ms.
    - 8 blob S3: 1 lần gọi registerSync (thay vì 16 lần), băm 16 MiB (thay vì 256 MiB), 0 trong transaction, 35ms.

- **[P2] Đưa việc dựng đồ thị và quét dấu tệp ra ngoài khóa ghi SQLite**:
  - `apps/server/src/storage/fileGc.ts`: trong `run()`, chuyển lời gọi `collectReferences` và việc duyệt `entries`/`marks` ra ngoài transaction ghi.
  - Dùng transaction ngắn có giới hạn (`immediate`) để cập nhật danh sách đánh dấu (`toClear` và `toMark`).
  - Khi purge tệp (`toPurge`), việc kiểm tra lại tham chiếu, đối chiếu canonical/stamp, xóa tệp (`unlinkSync`) và xóa mark được bọc trong transaction ngắn cục bộ cho từng tệp.
  - Tối thiểu hóa thời gian giữ khóa ghi SQLite xuống cấp microsecond, loại bỏ hoàn toàn việc quét I/O đĩa dưới transaction ghi lớn.

- **Kiểm thử hồi quy**:
  - `apps/server/test/fileGc.test.ts`: bổ sung 3 test case kiểm chứng tái sử dụng stamp cache, invalidation khi tệp thay đổi, graph ngoài write transaction, và bảo toàn path-only copy cùng SHA.
  - Chạy `npx vitest run test/fileGc.test.ts test/fileGcRecovery.test.ts test/storageProvider.test.ts test/preview.test.ts test/resourceGovernor.test.ts --maxWorkers=2`: 5 test files, 63 tests đạt (lưu tại `tmp/codex-review-138-139-focused.log`).

## Bổ sung sửa lỗi sau review Codex (Fix pass 2, 2026-11-18)

- **[P1 Fix2] Khắc phục triệt để race condition xóa tệp cục bộ khi có reference muộn**:
  - Đã tái hiện lỗi qua `tmp/codex-review-138-late-local-ref.ts`: kết nối thứ hai insert timeline ref trước write lock, code fix1 dựa vào `referencesForPath(graph)` cũ nên vẫn xóa nhầm tệp.
  - Thêm `isTargetReferencedInDb` trong `storage/references.ts`: thực hiện kiểm tra có mục tiêu (targeted) trực tiếp trên trạng thái DB hiện tại ngay dưới transaction ghi (`immediate`), kiểm tra toàn bộ registry tables (`PROJECT_TABLES`, `SHARED_FILE_TABLES`, `clip_sets`), JSON legacy columns, alias đường dẫn và SHA, busy/protected/global ownership.
  - Không quét toàn bộ cây tệp hay băm lại toàn bộ đồ thị dưới khóa ghi. Nếu kiểm tra không thể chứng minh an toàn mục tiêu, file được giữ lại (fail-safe).
  - Tích hợp `isTargetReferencedInDb` vào transaction `purged` trong `FileGc.run()`. Tái kiểm tra với `tmp/codex-review-138-late-local-ref.ts`: tệp được giữ an toàn (`purged: 0`, `referencedFileStillExists: true`).

- **[P2 Fix2] Loại bỏ hoàn toàn việc dựng lại toàn bộ đồ thị tham chiếu trong S3 purge**:
  - `currentReferenced(sha)` trong `FileGc.runBlobs()` trước đây gọi `collectReferences` khi graph cơ sở không khớp, dẫn tới O(N) dựng lại toàn bộ đồ thị với mỗi SHA cần purge.
  - Thay thế bằng `isTargetReferencedInDb(db, root, { sha256: sha })`: kiểm tra có mục tiêu trên DB tại các ranh giới bất đồng bộ (trước claim, sau prepareBackup, sau remote delete) và trong transaction xóa DB cuối cùng (`DELETE FROM blobs`).
  - Kiểm tra SHA alias và path alias trực tiếp qua registry tables mà không băm hay quét lại các file khác trong workspace.

- **Kiểm thử và xác nhận**:
  - Thêm persistent regression test trong `apps/server/test/fileGc.test.ts`:
    - "does not purge a file if a concurrent connection references it right before the write lock" (2 kết nối DB với immediate transaction wrapper).
    - "re-checks targeted DB reference in S3 purge without rebuilding the entire graph".
  - Chạy `npx vitest run test/fileGc.test.ts`: 13/13 tests đạt.


