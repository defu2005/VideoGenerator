# TASK-138 — Review chính thức, 2026-11-17

**Verdict: chưa chấp nhận.** Marker `.done` ghi nhận lượt triển khai trước, không thay thế kết quả review này. Codex review theo vai trò mới của người dùng; không commit/push.

## Findings cần sửa

### [P1] Kiểm từng blob S3 lại dựng và băm toàn bộ đồ thị tham chiếu

`storage/fileGc.ts`, hàm `runBlobs`, gọi `collectReferences` bên trong `referenced(sha)`. Helper này được gọi ít nhất hai lần trên mỗi row trong lượt mark thông thường, thêm nhiều lần khi purge. `storage/references.ts` lại tạo `new ArtifactService(db)` trong mỗi lần dựng graph. Cache `registeredVersions` vì vậy không được tái sử dụng: mọi live path bị đọc và băm đồng bộ lại, kể cả khi chỉ đang xét một SHA khác. Chi phí tăng theo số blob nhân tổng dung lượng tệp tham chiếu, chặn event loop và kéo dài khóa SQLite.

**Đã tái hiện offline** bằng `npx tsx tmp/codex-review-138-repro.ts`. Một live file 16 MiB, không gọi provider/network:

| Số blob S3 | Số lần registerSync live file | Dữ liệu băm lại | Trong transaction | Thời gian |
| --- | ---: | ---: | ---: | ---: |
| 1 | 2 | 32 MiB | 1 | 92 ms |
| 8 | 16 | 256 MiB | 8 | 526 ms |

Log: `tmp/codex-review-138-repro.log`. Cần dựng snapshot đồ thị một lần cho sweep, dùng registry có vòng đời đủ dài, và kiểm lại tham chiếu hiện hành của **SHA sắp xóa**. Không được chỉ tái sử dụng một graph cũ qua các `await`: các test tham chiếu xuất hiện trong DELETE và recovery phải tiếp tục đạt, kể cả path-only reference tới bản sao cùng nội dung.

### [P2] Local GC giữ write transaction qua toàn bộ graph và lượt unlink

`FileGc.run()` mở `.immediate()` trước `collectReferences`, rồi duyệt mọi tệp và `unlinkSync` trước khi commit. Cả dry-run cũng giữ write lock trong lúc băm live file. Repro trên ghi nhận một lần băm 16 MiB trong transaction cho mỗi local dry-run.

Cần chuyển việc quét/băm nặng ra ngoài write transaction và thu hẹp transaction cho từng quyết định xóa. **Giữ nguyên yêu cầu của guide:** kiểm tham chiếu hiện hành và xóa row phải cùng transaction; không sửa bằng cách bỏ kiểm cuối hoặc chỉ unlink ngoài transaction. Thêm kiểm chứng phạm vi transaction và số lần đọc/băm khi tăng blob count.

## Kiểm chứng và giới hạn

- Đã đọc guide, report, toàn bộ `references.ts`/`fileGc.ts`, registry file refs, recovery, API/tool/UI lưu trữ và các diff tích hợp. Các module mới đang untracked nên được đọc trực tiếp, không suy từ `git diff --stat`.
- Focused: **5 file, 55 test đạt** (`fileGc`, `fileGcRecovery`, `storageProvider`, `preview`, `resourceGovernor`), `--maxWorkers=2`; log `tmp/codex-review-138-139-focused.log`.
- Drizzle đối chiếu schema hiện tại với **bản sao metadata journal đã gồm 0087 của TASK-145**: `No schema changes`. Lệnh chạy trong `apps/server` với `--dialect sqlite --schema ./src/db/schema.ts --out ../../tmp/codex-review-drizzle`; không sửa journal/migration đang do worker145 sở hữu. Log `tmp/codex-review-138-139-drizzle.log`. Lệnh thử đầu thiếu dialect/schema đã thất bại và được chạy lại đúng tham số.
- Typecheck toàn repo đã chạy, **chưa đạt** do code đang triển khai 143/145/147a (duplicate imports ở db/client, API/type trong storyEngine, adapter return type và fixture ScriptTab thiếu draft). Không có diagnostic trong module GC/preview ở lượt này. Log `tmp/codex-review-138-139-typecheck.log`. Không coi typecheck cũ trong report là bằng chứng hiện tại.
- Full workspace suites giới hạn hai worker đã kết thúc **exit 1**: shared 765 đạt / 16 lỗi; MCP 49 đạt; server 1.542 đạt / 27 lỗi / 7 skip; web 224 đạt / 4 lỗi. Log `tmp/codex-review-138-139-workspaces.log`. Lỗi nằm ở budget/routing, script, catalog/skill, scene-plan, auth/audit và kiểm heartbeat143; chưa phân loại nguyên nhân từng lỗi trên shared working tree. Không quy tất cả về task khác chỉ vì đang có worker sửa và không tuyên bố full-suite/build đạt.
- Migration 0086 là thay đổi additive (hai bảng GC và hai nullable columns trên blobs). Không thấy thay đổi dependency hoặc diff trong `.env`, `.claude/`, `data/`, `scripts/` tại thời điểm kiểm. Không thể quy mọi thay đổi của shared working tree về một task chỉ bằng trạng thái Git.
- Docs vòng đời tệp, featureMap, changelog, ARCHITECTURE và skill có `storage_report` đã có. Browser artifacts của report trước tồn tại; chưa chạy lại browser trong lượt review này và chưa dùng chúng để nghiệm thu bản sửa chưa có.

## Xử lý

Giao opencode sửa theo `tmp/opencode-task138-139-fix-brief.md` khi có slot; không migration, không dependency. Chưa đánh dấu accepted và chưa xóa marker triển khai cũ. Sau sửa, Codex chạy lại repro, regression, kiểm transaction/race/recovery rồi review lại.

Lượt fix được giao sau khi worker147a thoát. Lần gọi đầu thoát exit1 do `getaddrinfo ENOTFOUND agy.4u.io.vn`, không có fix marker. Kiểm DNS sau đó đã trả địa chỉ A; Codex tiếp tục **cùng session** với brief đính kèm, log `tmp/opencode-task138-139-fix-resume1.log`. Đây là lỗi hạ tầng trước nghiệm thu, chưa có bản sửa được chấp nhận.

## Review bản fix1 — 2026-11-18, vẫn chưa chấp nhận

Đã đọc `TASK-138-139.fix1.report.md` và source hiện tại. Mark sweep đã giảm graph từ mỗi blob xuống một lần và cache ArtifactService được giữ; đây là tiến bộ. Tuy nhiên việc thu hẹp transaction đã làm mất kiểm tham chiếu hiện hành:

**[P1] Local purge vẫn dùng graph dựng trước write transaction.** Callback transaction chỉ gọi `referencesForPath(graph,...)` trên cùng snapshot cũ, không đọc lại refs trong DB. Tái hiện offline bằng `npx tsx tmp/codex-review-138-late-local-ref.ts`: kết nối SQLite thứ hai commit timeline tham chiếu tệp sau graph build, ngay trước khi transaction purge lấy khóa. Kết quả `purged:1`, `referencedFileStillExists:false`, `timelineStillReferencesFile:true`. Log cùng tên `.log`. Không dùng dữ liệu thật. Repro đầu bị lỗi hook fixture do thuộc tính immediate readonly, đã sửa fixture trước kết quả nêu trên.

**P1 hiệu năng chưa giải quyết hết:** `currentReferenced(sha)` trong S3 purge vẫn gọi `collectReferences` toàn bộ registry cho mỗi SHA và ở nhiều ranh giới async. Cache giảm băm bytes ấm nhưng không giảm số lượt quét DB/stat toàn graph trong một lượt purge nhiều object. Test mới chỉ đếm registerSync ở mark sweep, không đo purge; test transaction mới chỉ assert inTransaction sau khi gọi collectReferences riêng, chưa kiểm vùng critical section thực tế.

Cần fix2: bảo vệ refs mới trong write transaction và kiểm SHA/path đích có giới hạn, không đổi an toàn thành snapshot stale. Thêm ca hai kết nối DB, provider DELETE có ref mới, warm/cold stamp và số lần graph scan ở **purge**. Không sửa review verdict của Codex hoặc ghi đè evidence logs.

Baseline supervisor round2: typecheck/build toàn repo đạt (`tmp/codex-supervisor-round2-typecheck.log`, `...-build.log`), Drizzle canonical `No schema changes` (`...-drizzle.log`). Các kết quả này không làm hợp lệ ca mất file đã tái hiện.

## Review fix2 — 2026-11-18: chưa chấp nhận

Event ba2f4673-6200-452a-a8fc-a8f2e30f4147 ghi exit0, marker rỗng và report mới. PID7580 đã thoát. Đã đọc report, diff và source references/fileGc; working tree vẫn chứa nhiều task, không quy thay đổi ngoài phạm vi cho worker này.

- Lỗi mất tệp khi có ref mới trước write lock đã sửa trên repro độc lập: tmp/codex-review-138-fix2-late-local-ref.log ghi purged0, referencedFileStillExists:true và timelineStillReferencesFile:true.
- **P1 hiệu năng vẫn mở:** isTargetReferencedInDb chỉ thu hẹp kết quả so khớp, chưa thu hẹp dữ liệu quét. Mỗi SHA lại SELECT * toàn SHARED_FILE_TABLES, clip_sets, lấy mọi project và dựng rowsByTable bằng projectTableRows cho toàn PROJECT_TABLES, rồi duyệt JSON. currentReferenced gọi hàm này nhiều lần/object và cả trong immediate transaction. Do đó vẫn O(objects × toàn bộ DB refs), dù không gọi tên collectReferences hay hash cả graph. Với local path đã có SHA, hàm cũng chuyển sang quét mọi project. Yêu cầu đo số DB scans/stat/hash ở many-object purge chưa được thực hiện; test mới chỉ chứng minh late reference được giữ, không đếm scans. Không thể nghiệm thu phần scale chỉ dựa trên việc thay tên hàm.
- Hàm còn stat/registerSync target path trong critical section; báo cáo “không quét đĩa” cần phân biệt target I/O với whole-graph I/O. Không tuyên bố đã tái hiện thêm mất dữ liệu.
- Focused GC+preview37/37 đạt, log tmp/codex-review-138-139-fix2-focused.log. Không chạy lại toàn workspace/build/drizzle/browser để nghiệm thu khi semantic/complexity gate vẫn chưa đạt; baseline cũ không đại diện cho acceptance mới. Không thấy status thay đổi ở các đường cấm; package server có script benchmark thuộc working tree task145, không phải bằng chứng dependency138.

Đây là fix2 vẫn chưa đạt. Theo brief không giao vòng sửa thứ ba; đã báo người dùng. Người dùng vừa yêu cầu hoàn tất các phiên hiện tại rồi chờ, không giao mới/fix/retry. Giữ task pending, không commit/push/promote.
