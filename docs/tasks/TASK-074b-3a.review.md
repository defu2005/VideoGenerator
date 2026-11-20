# TASK-074b-3a — review chỉ đọc (advisor)

**Phạm vi:** `apps/server/src/operator/shadow.ts` (`recordShadowRuns`), gọi `recordShadow` và `findSkills`/`suggestion` trong `service.ts` (dòng 622–626, 1334), `test/operatorShadow.test.ts`, migration `0098_operator_skill_shadow_runs.sql`.
**Lưu ý phạm vi:** toàn bộ 074b-1 đến 074c nằm trong một cây làm việc chưa commit, nên 3a không thể review ở trạng thái lúc viết báo cáo. Review này đọc cây hiện tại. Các phần 3b đã đổi hành vi 3a (đặt shadow cũ thành `draft`, không còn `archived`; test 3a được sửa), và phần đó được ghi ở "Sai lệch" bên dưới.
**Không gồm:** việc 074b-4 thêm `autoActivateAfterShadow` và `autoShadowAfterEval` vào cùng các điểm gọi. Đánh giá ở review 074b-4, nhưng có ghi lại ở đây vì nó làm thay đổi bảo đảm "không chạy gì" của 3a.
**Không ghi `.done`.** Review chỉ báo cáo; không sửa code.

## Kết luận

**Chấp nhận có điều kiện.** Phần ghi nhận (`recordShadowRuns`) làm đúng đặc tả: cổng tắt thì không ghi gì, bật thì ghi một row cho mỗi skill có bản shadow được định tuyến, kết quả định tuyến không đổi, và module không import executor, runner hay registry. Ba điều kiện:

1. **Bảo đảm "không chạy gì" chỉ đúng cho phần ghi nhận.** Từ 074b-4, `findSkills` và `suggestion` (cùng hai điểm gọi `service.ts:626` và `:1334`) còn gọi `autoActivateAfterShadow`. Hàm này có thể đổi trạng thái bản skill và ghi file vào workspace (`writeUserSkill`) trên đường đọc. Đây không phải chạy tool, nhưng không còn là "chỉ ghi nhận". Báo cáo 074b-4 phải nêu điều này.
2. **Báo cáo 3a còn ghi sai hành vi đã đổi** (xem "Sai lệch"). Cần đánh dấu là đã bị 3b thay thế.
3. **File tạm `C:/Users/defu/AppData/Local/Temp/shadow.bak.ts`** do 3a để lại. Chưa xóa. Người dùng cần quyết định. Không xóa khi chưa được hỏi.

## Chạy test

- `npx vitest run test/operatorShadow.test.ts test/operatorShadowGate.test.ts` (trong `apps/server`): 2 file, 43/43 pass (gồm cả test 3b). Test 3a riêng (`operatorShadow.test.ts`) pass.

## Kiểm tra từng điểm

1. **Ghi khi cổng tắt.** `shadow.ts:61` trả `[]` trước mọi thao tác ghi. Test "gate off" (`operatorShadow.test.ts:110`) xác nhận không có row.
2. **Kết quả định tuyến không đổi.** Test "gate on" (`:118`) và "baseline" (`:176`) so sánh chuỗi JSON của `findSkills` và `suggestion` trước và sau khi bật. Khớp.
3. **Không gọi executor hay runner.** Test "non-execution" (`:150`) mock `runTool` và `runCursorProcess` để ném lỗi, rồi gọi hai đường định tuyến. Pass. Test "module imports" (cùng file) kiểm tra danh sách import của `shadow.ts` bằng regex. **Giới hạn:** test này chỉ chứng minh `shadow.ts` không import executor. Nó không chứng minh đường gọi trong `service.ts` không tới được executor. Đường đó vẫn được bảo đảm bằng test "non-execution", nhưng chỉ cho các skill có tool được khai báo trong fixture.
4. **Chỉ một bản shadow và bản shadow không bao giờ active.** `markShadowVersion` (`skillVersions.ts:105–114`) xóa shadow cũ rồi đặt shadow mới trong cùng transaction. `activateSkillVersionInTx` (`skillVersions.ts:146`) từ chối status `shadow` với `SKILL_IS_SHADOW`. Test ở `:161` xác nhận (assertion `SKILL_IS_SHADOW` ở `:173`).
5. **Migration.** `0098` tạo bảng và hai index, khớp với bảng mô tả trong guide 3a (`id`, `skill_name`, `shadow_version`, `active_version`, `run_id`, `query`, `rank`, `planned`, `created_at`). Không sửa migration đã áp dụng.
6. **Thứ tự rank.** Rank là vị trí đầu tiên của skill trong mọi phần định tuyến (`shadow.ts:63–69`). Guide 3a cho phép.
7. **Không có ghi dữ liệu nhạy cảm ngoài `query`.** `query` là toàn bộ câu hỏi người dùng, lưu vĩnh viễn và không có cơ chế dọn (xem mục "Phát hiện" 6).

## Phát hiện

1. **Shadow không bao giờ được định tuyến, nên 3a chỉ đếm lượt của bản active.** `skillCandidates()` (`service.ts:1340–1365`) lấy skill người dùng qua `userSkills()` (`service.ts:1425–1427`), và `userSkills()` chỉ lấy bản `active`. Nghĩa là markdown và trigger của bản shadow không tham gia định tuyến. `userSkills()` cũng nạp file `skills/user/<name>.md` cho tên không có bản active (`service.ts:1430–1432`); nhánh đó không đưa bản shadow vào định tuyến. Một row shadow được ghi khi tên skill được định tuyến theo trigger của bản active. `planned` là danh sách tool của bản shadow, và giống nhau ở mọi row. Guide 3a không yêu cầu bằng chứng về trigger của bản shadow. Đây là **giới hạn cần ghi**, và 074b-4 dựa vào nó để tự kích hoạt (xem review 074b-4). Mức: trung bình.
2. **Bảo đảm không chạy gì chỉ phủ đường ghi nhận.** Đã nêu ở điều kiện 1.
3. **Kiểm thử không chứng minh đường production.** Test "non-execution" gọi `findSkills` trực tiếp, nên không kiểm được việc chat truyền `runId` (xem review 3b, phát hiện về `runId`).
4. **Cổng thấp nhưng không có hậu quả trong 3a:** `recordShadow` bắt mọi lỗi và trả `[]` (`service.ts:1470–1478`). Lỗi ghi shadow không làm đổi kết quả định tuyến. Đúng với đặc tả.
5. **Ngoài phạm vi 3a:** không kiểm `SkillVersions.tsx` trong lượt này. Phần UI của shadow được xem ở review 3b (mục 9).
6. **Lưu trữ `query` không có dọn dẹp.** Mỗi lượt định tuyến khi cổng bật ghi toàn bộ câu hỏi. Không có TTL, không có lệnh xóa. Mức thấp, nhưng cần quyết định về quyền riêng tư và dung lượng trước khi bật ở môi trường thật.

## Sai lệch với báo cáo `TASK-074b-3a.report.md`

- **Báo cáo 3a nêu bản shadow cũ chuyển thành `archived`** (ở nhiều chỗ). Sai với mã hiện tại. `markShadowVersion` (`skillVersions.ts:111`) đưa shadow cũ về `draft`. Test ở `operatorShadow.test.ts:199` vẫn có tên "...a new shadow archives the old one..." nhưng assertion đã đổi sang `draft`. Tên test còn sót chữ "archives". Đây là thay đổi của 3b (guide 3b dòng 47 ghi rõ), không phải lỗi của 3a, nhưng báo cáo 3a không đánh dấu việc bị thay thế.
- **Báo cáo 3a không ghi việc test 3a bị sửa bởi 3b.** Cần ghi.
- **Báo cáo 3a nói "chỉ bản `draft` được đặt, `SKILL_NOT_DRAFT` cho các trạng thái khác".** Đúng với mã (`skillVersions.ts:110`).

## Việc tiếp theo

1. Ghi trong báo cáo 3a (hoặc 3b) rằng bảo đảm "không chạy gì" đã được 074b-4 thu hẹp (điều kiện 1).
2. Sửa tên test ở `operatorShadow.test.ts:199` từ "archives" thành "draft" (không đổi logic).
3. Ghi giới hạn trigger của shadow (phát hiện 1) vào báo cáo 3a, để 074b-4 và người dùng biết.
4. Chờ người dùng quyết định về `shadow.bak.ts`.
