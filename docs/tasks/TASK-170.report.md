# TASK-170 — đo thứ tự ghi `artifacts` theo trạng thái cache (chỉ test)

Trạng thái: **đã đo bằng test.** Không đổi `src`. File test: `apps/server/test/fileGcCacheCases.test.ts`.
Kết quả: 7/8 test xanh (gồm 2 test pin của TASK-168). Test "stuck" đỏ ở các assertion dự đoán (soft). Đó là phát hiện, không phải lỗi cần sửa assertion.

## Cấu hình đo

- Một `FileGc` dài hạn cho mỗi case, không truyền `artifacts` (giống `app.ts:255`).
- Mỗi pass gọi `run({ purge: true, ephemeralOnly: true })`, đúng lời gọi `app.ts:801` (xử lý áp lực đĩa). `app.ts:767` dùng `{ purge: true }`.
  Hai tùy chọn này chỉ ảnh hưởng xóa file (`fileGc.ts:421`, `:434`, `:445`). `collectReferences` chỉ nhận `now` và `postPublishDays` (`fileGc.ts:406`), nên đăng ký path không phụ thuộc hai tùy chọn này.
- Log ghi: trigger `AFTER INSERT` và `AFTER UPDATE` trên `artifacts` ghi `(sha256, path)` vào `gc_log` theo `id`. Mỗi pass báo:
  - `pre`: path của row S ngay trước pass;
  - `seq`: các path của S được ghi trong pass, theo thứ tự;
  - `path`: path của row S sau pass.
- Giá trị dự đoán viết trong file trước khi chạy lần đầu. Nhãn: `versions` = `render/versions/render-1/output.mp4`, `pending` = file `final.mp4` của job A.

## Kết quả

| Case | pre | seq (theo thứ tự ghi) | path sau | Dự đoán | Kết quả |
|---|---|---|---|---|---|
| miss/miss (pass 1) | (không có row) | versions, pending | pending | seq [versions, pending] | xanh |
| hit/hit (pass 2) | pending | (rỗng) | pending | seq [] | xanh |
| stuck (pass 1, chuẩn bị) | (không có row) | versions, pending | pending | (bước chuẩn bị) | — |
| stuck (pass sau complete A) | pending | versions | **versions** | seq [], path pending | **ĐỎ** (2 assertion soft) |
| control (FileGc mới) | pending | versions | versions | seq [versions] | xanh |
| miss/hit (pass 1, chỉ pending) | (không có row) | pending | pending | seq [pending] | xanh |
| miss/hit (pass 2, thêm renders) | pending | versions | versions | seq [versions] | xanh |
| hit/miss (pass 1, chỉ versions) | (không có row) | versions | versions | seq [versions] | xanh |
| hit/miss (pass 2, A upload) | versions | pending | pending | seq [pending] | xanh |

Lần chạy cuối: `Tests 1 failed | 7 passed (8)` khi chạy cùng `runSnapshotRepointsPending.test.ts`. Assertion soft đỏ: `seq` (`['versions']` so với `[]`), `path` (`versions` so với `pending`), và `artifactPath()` sau cleanup (`versions` so với đường dẫn pending). Hai assertion cứng trước đó (pending còn tồn tại trước cleanup, và file pending bị xóa sau 25 h) đều đúng như dự đoán.

## Phát hiện: stuck không tái hiện trong fixture này

- `completeA` thay file `render/versions/render-1/output.mp4`. Đo bằng `statSync` trước và sau complete: inode đổi, mtime và ctime đổi, size vẫn là 11.
- Nguyên nhân trong mã: `leaseService.ts:664–670` copy `final.mp4` sang `output.mp4.node-part`, rồi thay vào `output.mp4`. `renders.finalize` được mock và không ghi file, nên thay đổi này đến từ code thật, không phải từ mock.
- Cache `registeredVersions` (`artifactService.ts:36–37`) so khớp path và stamp `dev:ino:size:mtimeNs:ctimeNs`. Stamp đổi, nên pass sau complete miss ở versions, ghi versions, và repoint row về versions. Cùng hiện tượng với pin TASK-168, lần này trên một instance dài hạn.
- Sau 25 h, cleanup xóa file pending (`existsSync` là false). Row trỏ tới versions, không trỏ tới pending, nên không có row nào trỏ tới file đã xóa.

Hệ quả cho giả thuyết "kẹt ở pending" (TASK-169): trong fixture này điều kiện cần (versions hit trong cache sau khi A complete) không xảy ra, vì complete ghi đè versions. Fixture tạo file versions trước khi A complete để mô phỏng render DONE giữ lại. Trong production, file đó có thể chưa tồn tại trước complete. **Chưa đo** trường hợp versions tồn tại trước complete mà complete không ghi đè nó. Chưa kết luận production có đạt điều kiện này không.

## Các chỉnh sửa harness sau lần chạy đầu

Không đổi giá trị dự đoán. Ba lỗi nằm trong harness, không nằm trong hành vi GC:

1. `label()` gọi `realpath` trên file versions chưa tồn tại, gây `ENOENT` ở miss/hit pass 1. Sửa: chỉ `realpath` khi file tồn tại.
2. Case hit/miss so sánh `path` (đã đổi thành nhãn `pending`) với đường dẫn thô. Sửa: so với nhãn `"pending"`.
3. Case stuck: assertion dự đoán đổi sang `expect.soft` để phần cleanup vẫn chạy và được đo. Lần chạy đầu dừng ở assertion đầu tiên nên phần cleanup chưa được đo. Thêm log stat của file versions trước và sau complete (chỉ chẩn đoán).

## Chưa đo

- Trường hợp versions tồn tại trước complete mà complete không ghi đè (cần để kiểm tra điều kiện cần của stuck trong production).
- Thứ tự giữa nhiều project (`references.ts:98`, không có `ORDER BY`).
- Lời gọi thật của `renders.finalize` (đã mock trong fixture).
- Nhiều lượt GC xen với nhiều lần complete.

## Kiểm tra

- `npx vitest run test/fileGcCacheCases.test.ts test/runSnapshotRepointsPending.test.ts` (trong `apps/server`): 1 đỏ (stuck, đã mô tả), 7 xanh.
- `npx tsc --noEmit -p .` (trong `apps/server`): exit 0.
