# TASK-138 — Báo cáo fix3 (purge kiểm tham chiếu bằng chỉ mục DB một lần mỗi lượt)

Ngày: 2026-11-18. Chưa commit, chưa push, chưa promote. Chưa đổi README; chờ Advisor review.

## Sửa gì

- `apps/server/src/storage/references.ts`: thêm `DbReferenceIndex`. Chỉ đọc DB, lọc giống `isTargetReferencedInDb`. Dựng lại khi `PRAGMA data_version` hoặc `total_changes()` đổi. Gọi `refresh()` trong transaction ghi quyết định xóa.
- `apps/server/src/storage/fileGc.ts`: purge cục bộ dùng một chỉ mục cho cả lượt. Trong mỗi transaction immediate: kiểm đồ thị trước lock (như cũ), `refresh()`, kiểm SHA của đích (`registerSync`, stat-cache), `isReferenced(path, sha)`, rồi mới unlink. Sau ghi của chính GC: `acknowledgeOwnWrites()`.
- Đường S3 (`runBlobs`) chưa đổi: vẫn gọi `isTargetReferencedInDb` cho từng SHA. Đây là P1 hiệu năng còn mở.

## I/O

- Dưới write lock, theo từng ứng viên: stat + realpath + hash đích (qua stat-cache của registry), một lần `refresh()`.
- Dưới write lock, một lần khi lượt bắt đầu: quét DB toàn bộ để dựng chỉ mục (build đầu tiên nằm trong transaction đầu tiên). Chỉ dựng lại khi DB đổi.
- Ngoài lock: một lần dựng đồ thị (`collectReferences`) như trước.

## Kiểm chứng

- `npx vitest run test/fileGcPurgeIndex.test.ts test/fileGc.test.ts test/fileGcRecovery.test.ts`: 20/20 đạt.
- Test mới (`test/fileGcPurgeIndex.test.ts`, 4 ca):
  - Số lần dựng chỉ mục = 1 cho 3 và 30 ứng viên (không tăng theo số object).
  - Tham chiếu được commit bởi kết nối thứ hai sau khi đồ thị đã dựng: file được giữ, `purged: 0`.
  - Warm stamp: giữa hai lần purge, kết nối khác commit tham chiếu, lần dựng thứ hai xảy ra, file được giữ, file còn lại bị xóa.
- Mutation: bỏ so sánh stamp (`refresh()` không dựng lại sau lần đầu) → ca warm stamp FAIL. Đã khôi phục, 4/4 đạt.
  - Ghi chú trung thực: ca "kết nối thứ hai trước lock" vẫn đạt dưới mutation, vì chỉ mục được dựng mới ở transaction đầu. Ca này kiểm việc đọc DB dưới lock, không kiểm stamp.
- `npx vitest run` cho GC + preview + composeRender + mediaPrefetch + storageProvider: 82/82 đạt.
- Typecheck `apps/server`: 3 lỗi, đều ngoài phạm vi (`scriptService.ts`, `storyEngine.ts`), không có lỗi ở file GC.

## Còn mở / giới hạn

- Path-only reference tới bản sao cục bộ khác cùng SHA: chỉ được bảo vệ bởi đồ thị trước lock. Tham chiếu DB mới kiểu này xuất hiện sau khi dựng đồ thị có thể không được bắt. Chưa xử lý.
- Đường S3 purge còn gọi `isTargetReferencedInDb` cho từng SHA (quét DB mỗi object). Chưa chuyển sang chỉ mục.
- Chưa đo số stat/hash/quét DB ở mức lớn (chỉ đếm số lần dựng chỉ mục).
- Repro `tmp/codex-review-138-fix2-late-local-ref.ts` chưa chạy lại trong vòng này.


## Cập nhật cuối (2026-11-18)

- S3 `runBlobs`: dựng `DbReferenceIndex` một lần cho lượt quét. Ghi blob bọc trong `ownWrite` (refresh, ghi, acknowledge) trong giao dịch, để ghi của chính GC không làm đổi `total_changes()`. Kết quả: 1 lần dựng, không còn 6/60 lần.
- `isReferenced`: không có path và không có SHA hợp lệ thì giữ (fail closed).
- SHA → path qua dòng `artifacts`, như `isTargetReferencedInDb`.
- Đã bỏ việc băm path được tham chiếu trong `build()`. Lý do: làm hỏng test tệp không tham chiếu và đưa băm file vào trong khóa ghi. Khoảng còn lại (S3, tham chiếu path mới tới tệp cùng nội dung) được ghi rõ là mục mở, không phải đã đóng.
- Test parity: lỗi là khóa `sha` thay vì `sha256` trong test, không phải lỗi của hàm gốc.
- Kết quả: 7 file test, 86/86. Typecheck: 3 lỗi ngoài phạm vi.
- Chưa làm: repro late-ref (file không còn), test parity rộng, mutation từng nửa stamp.
- Trạng thái: sẵn sàng cho Codex re-review khi người dùng/Advisor quyết định. README chưa đổi.

## Cập nhật (2026-11-18, sau review nội bộ)

- Test S3 đổi từ `<= 2` sang đúng `1` lần dựng chỉ mục cho mỗi lượt quét (`fileGcPurgeIndex.test.ts`).
- Mutation từng nửa stamp (tạm sửa `storage/references.ts`, chạy lại, rồi khôi phục):
  - Bỏ `PRAGMA data_version` (= 0): 4 test fail (late-ref local, warm rebuild, S3 DELETE late-ref, `fileGc` concurrent-before-lock). Nửa này có tác dụng.
  - Bỏ `total_changes()` (= 0): 2 test fail (S3 PUT recheck, S3 targeted recheck). Nửa này có tác dụng.
- Sau khi khôi phục: 7 file cụm GC đạt **86/86**.
- Lập luận không để `acknowledgeOwnWrites` nuốt commit của kết nối khác: `refresh` và `acknowledge` luôn nằm trong giao dịch `.immediate()`, nên kết nối khác không ghi được trong khoảng đó.
- Chưa làm: repro late-ref gốc (file đã mất), test parity rộng (đã hủy, pinned, busy, shared library, clip không project).

## Bảng đóng từng phát hiện của fix2 (review nội bộ, không dùng Codex)

| Phát hiện fix2 | Cách đóng | Bằng chứng |
|---|---|---|
| P1 local: purge xóa tệp đã được tham chiếu ngay trước transaction ghi | `run()` kiểm `isReferenced` trong `.immediate()` sau `refresh()` | Repro `tmp/codex-review-138-late-local-ref.ts` chạy lại: `purged: 0`, tệp còn, timeline còn tham chiếu. Test `keeps a file whose reference was committed by a second connection after the graph was built` |
| P1 S3: tham chiếu mới commit trong lúc DELETE bị bỏ qua | `currentReferenced` kiểm lại trong `DELETE` và sau mỗi await | Test `keeps a remote blob whose reference is committed by a second connection during DELETE` |
| P2 S3: dựng lại toàn đồ thị với mỗi SHA | Một `DbReferenceIndex` cho cả lượt, ghi bọc `ownWrite` | Test `S3 purge builds the index once for %i blobs` (3 và 30 blob) đúng 1 lần |
| Parity oracle với index | Thêm ca cho: `{}`, SHA không tồn tại, tệp thiếu, đường dẫn ngoài data dir, cây project được bảo vệ | Test `answers the same as isTargetReferencedInDb for path and SHA targets` đạt |

Chưa phủ bằng test (ghi rõ để Advisor quyết định): nhánh cache khi có project bận (`busy`), và `versions/` của render đang giữ. Hai nhánh này nằm trong oracle nhưng test parity chưa có dữ liệu job/render để kích hoạt.

## Sửa bảng đóng: nguồn đúng là `docs/tasks/TASK-138.review.md` (thay thế bảng trên)

Bảng trên lấy nhầm tài liệu (fix1 report). Review chính thức của fix1 có hai phát hiện, đọc từ `TASK-138.review.md`:

| Phát hiện | Cách đóng | Bằng chứng (chạy lại trong lượt này) |
|---|---|---|
| **P1** S3: mỗi blob dựng và băm lại đồ thị tham chiếu | Một `DbReferenceIndex` và một `baseGraph` cho cả lượt quét; `currentReferenced` kiểm lại DB trong mọi transaction và sau mỗi await | `tmp/codex-review-138-repro.ts` chạy lại: 1 blob hashed 16 MiB, 8 blob vẫn 16 MiB (review cũ: 32 MiB và 256 MiB). Test `S3 purge builds the index once for %i blobs` (3 và 30 blob): đúng 1 lần dựng |
| **P2** local: giữ write transaction qua toàn bộ đồ thị và unlink | Dựng đồ thị ngoài transaction; dry-run không mở transaction; mỗi tệp purge trong transaction riêng, kiểm tham chiếu trong đó | Repro trên: `insideTransaction: 0` cho local dry-run và s3-mark, với 1 và 8 blob |
| P1 (fix1): kết nối thứ hai commit tham chiếu sau khi dựng đồ thị | Kiểm tham chiếu DB ngay trong transaction ghi, sau `refresh()` | `tmp/codex-review-138-late-local-ref.ts`: `purged: 0`, tệp còn, timeline còn tham chiếu. Test `keeps a file whose reference was committed by a second connection after the graph was built` |

Parity với `isTargetReferencedInDb` (`fileGcPurgeIndex.test.ts`, đều đạt):
- Ca thêm lần này: `{}`, SHA không tồn tại, tệp thiếu, đường dẫn ngoài data dir, cây project được bảo vệ.
- Ca mới: project đang `RENDERING` (cache và thư mục project bị khoá) và thư mục `versions/<id>` của render đã có.
- Chưa có ca: `clip_sets` không thuộc project, SHA toàn cục, `node_uploads`/`run_uploads` đang hoạt động. Nhánh này có trong oracle, chưa có test riêng.

Kết quả sau mọi sửa: 7 file cụm GC **87/87**. Typecheck `apps/server`: 3 lỗi ngoài phạm vi GC (`scriptService.ts:629`, `storyEngine.ts:383` ×2), không có lỗi trong `storage/*`.

## Fix4 (2026-11-18, theo nhận xét Advisor)

- **Hash local ngoài khóa ghi:** trước khi mở transaction purge, `FileGc.run()` gọi `registerSync` cho mọi ứng viên. Lệnh gọi trong khóa là cache hit khi stat không đổi. Test `hashes a local purge candidate before the write transaction opens` ghi `inTransaction` lúc gọi: lần đầu là `false`.
- **Lỗi index phát hiện khi kiểm parity:** `isReferenced(path, null)` không tra artifact theo path, nên thiếu nhánh bước 6 của oracle (tệp thư viện toàn cục). Đã thêm tra `artifacts WHERE path=?` rồi kiểm SHA trong tập global. Hướng này là index giữ tệp (an toàn), không phải mất dữ liệu.
- **Thứ tự warm:** warm hash đặt trước `index.refresh()`. Nếu đặt sau, ghi artifacts làm đổi `total_changes` và buộc dựng lại chỉ mục ở mỗi ứng viên (test build đếm 3 thay vì 2).
- **Parity:** nhánh bảo vệ đều assert `expected true` phía oracle. Đã tách test busy và test phiên bản render trên project rảnh. Thêm ca clip ngoài không project, tệp thư viện toàn cục theo path và theo SHA. Thêm ca gap same-content S3 (cả hai bên `false`).
- **Phần chưa phủ:** `node_uploads`, `run_uploads` đang hoạt động chưa có ca parity riêng. Oracle và chỉ mục dùng chung logic `activeJobs`/`activeRuns`, nhưng chưa có test chứng minh.
- **Kết quả:** 7 file cụm GC **91/91**. Typecheck `apps/server`: 3 lỗi ngoài phạm vi GC (`scriptService.ts:629`, `storyEngine.ts:383` ×2).
- **Docs:** `docs/ARCHITECTURE.md` mục 7 có đoạn `DbReferenceIndex`. README row 61u cập nhật: Advisor chấp nhận 2026-11-18.
