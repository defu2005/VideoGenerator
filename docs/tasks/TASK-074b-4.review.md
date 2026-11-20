# TASK-074b-4 — review chỉ đọc (advisor), 2026-11-20

**Phạm vi:** `apps/server/src/operator/autoActivation.ts` (112 dòng, đọc đủ), `operator/service.ts` (`findSkills` và `suggestion` gọi `autoActivateAfterShadow`, `autoShadowAfterEval` 923–944, `autoActivateAfterShadow` 900–917, `writeUserSkill` 947–952), `skillVersions.ts` (`activateSkillVersionInTx`), `packages/shared/src/fleet/schema.ts:15`, `api/fleet.ts:57`, `apps/web/src/features/operator/FleetTab.tsx:37`, `test/operatorAutoActivation.test.ts`, `test/operatorAutoWiring.test.ts`, `docs/tasks/TASK-074b-4.report.md`.
**Không gồm:** các điều kiện 074b-1, 074b-2, 3a, 3b đã có review riêng. Ở đây chỉ nêu tác động của chúng lên chuỗi tự kích hoạt.
**Không ghi `.done`.** Review chỉ báo cáo; không sửa code.

## Kết luận

**Hai ý, tách riêng.** (a) Code và test: khớp đặc tả, chấp nhận có điều kiện. Trước khi merge cần thêm test cho nhánh ghi file lỗi (phát hiện 6) và cho flip rồi từ chối (phát hiện 7), và sửa báo cáo (phát hiện về số test). (b) Bật cờ tự kích hoạt: **không chấp nhận** cho đến khi các điều kiện dưới đây xong. Code khớp đặc tả, cờ `autoActivateReadOnlySkills` mặc định tắt (`fleet/schema.ts:15`), và hai suite liên quan pass. Nhưng khi cờ bật, chuỗi tự kích hoạt dựa trên ba thứ chưa đáng tin: (1) số lượt `du_mau` bị thổi phồng vì đường chat không có `runId` (review 3b); (2) bằng chứng định tuyến đến từ trigger của bản active, không phải bản shadow (review 3a); (3) cổng chất lượng markdown của agent (074b-1, 074b-2) còn lỗ hổng đã ghi. Markdown do agent viết (`agent_proposal`) có thể lên bản active và vào prompt của model mà không có người duyệt.

Điều kiện trước khi bật cờ ở môi trường thật:
1. Sửa `runId` cho đường chat (3b, việc tiếp theo 1), và thêm test đi qua chat thật.
2. Quyết định cách đếm shadow theo trigger của chính bản shadow, hoặc ghi rõ và chấp nhận rủi ro (3a, phát hiện 1).
3. Hoàn tất 074b-1 (phủ định, "tự động duyệt", trích dẫn nhiều dòng, `description` trong frontmatter) và 074b-2 (giữ slot ngoài chủ đề, chặn skill không có trigger, bỏ `skill: system` khỏi judge).
4. Thêm thông báo cho người dùng khi tự kích hoạt xảy ra (hiện chỉ có `logger.info`).
5. Quyết định cách xử lý khi `writeUserSkill` lỗi sau khi DB đã active (phát hiện 6). Tác động trên đường vận hành trung bình, và nhánh này chưa có test.

## Chạy test

- `npx vitest run test/operatorAutoActivation.test.ts test/operatorAutoWiring.test.ts` (trong `apps/server`): 2 file, **33/33 pass**. Đếm bằng grep `^\s*it(` (không có `skip` hay `todo`): `operatorAutoActivation.test.ts` 21, `operatorAutoWiring.test.ts` 12, tổng 33. Báo cáo ghi 20 + 12 = 32. Test thứ 21 là dòng 213 (`activates the renamed research-provider-terms skill ...`), không có trong danh sách 20 test của báo cáo (dòng 50). Chưa rõ báo cáo bỏ sót hay test được thêm sau báo cáo; cả hai trường hợp đều cần sửa báo cáo.
- Chạy cùng lượt với bộ 149/150 (7 file gồm cả hai suite trên): 95/95 pass.
- Mutation table a–k trong báo cáo **không chạy lại** trong lượt này.

## Đã kiểm

- **Cờ mặc định tắt.** `fleet/schema.ts:15` `autoActivateReadOnlySkills: z.boolean().default(false)`. Ghi qua `PUT /api/settings/hermes-fleet` (`api/fleet.ts:57`) có `userOnly`. Đúng.
- **Cờ bật ở UI.** `FleetTab.tsx:37` có checkbox "Tự kích hoạt skill chỉ đọc khi qua đánh giá". Không có hiển thị lịch sử tự kích hoạt nào trong `apps/web/src`.
- **Tự kích hoạt chỉ bản shadow, không bản draft tùy ý.** `checkAutoActivation` đưa shadow → draft trong `db.transaction(...).immediate()` rồi gọi `activateSkillVersionInTx`. Điều kiện: `du_mau`, `fitReasons` (built-in không phải research bị bỏ qua ở `service.ts:902`; `readOnlyReasons`; có baseline; tool khai báo là tập con của baseline; score ≥ 80; eval đạt).
- **Built-in không tự kích hoạt** trừ khi có cờ `research` (xem phát hiện 5 về va chạm tên).
- **Cổng shadow dùng chung** `shadowGateRefusal` với đường thủ công (`service.ts:931`). Eval đạt rồi mới thành shadow.
- **Bảo vệ khi lỗi.** `autoActivateAfterShadow` bọc `checkAutoActivation` và `writeUserSkill` trong try/catch (`service.ts:903–915`). `autoShadowAfterEval` bọc toàn bộ trong try/catch (`:925–943`). Lỗi không làm hỏng định tuyến.
- **Không ghi đè shadow thủ công.** `autoShadowAfterEval` trả về sớm khi đã có shadow (`:929`).
- **Test wiring.** `operatorAutoWiring.test.ts:143` (cả hai cờ bật: eval đạt thì thành shadow) và `:152` (chỉ bật tự động, shadow tắt: không thành shadow) đều pass.

## Phát hiện

1. **Chuỗi phụ thuộc vào `du_mau` bị thổi phồng (cao).** `du_mau` là điều kiện đầu tiên của `autoEligibility`. Đường chat không gán `runId` (review 3b, đã xác nhận: `src/assistant` không gán `ctx.runId`), nên `COUNT(DISTINCT COALESCE(run_id, id))` coi mỗi lần gọi `find_skills` là một lượt. Đã đọc `shadow.ts:29–46`: `du_mau` cần 5 giá trị `COALESCE(run_id, id)` khác nhau trong cửa sổ 7 ngày tính từ hàng đầu. Hàng có `run_id` null được tính riêng từng hàng. Hàng chỉ được ghi khi skill có bản shadow được định tuyến (`recordShadowRuns`), không phải mọi lần gọi `find_skills`. Chat không truyền `runId` (`assistant/service.ts:565–596` không gán), nên năm lần định tuyến bản shadow trong 7 ngày là đủ, kể cả trong một cuộc chat. Đây là lỗi phải sửa trước khi bật, không phải ghi chú.

2. **Bằng chứng định tuyến không đến từ trigger của bản shadow (cao).** Shadow không nằm trong `skillCandidates()`, nên lượt được đếm là lượt định tuyến của bản active (review 3a, phát hiện 1). Auto-activation có thể đưa lên bản mà trigger chưa từng được kiểm trong định tuyến thật. Báo cáo 074b-4 không nêu điều này.

3. **Chuỗi tin cậy markdown của agent (cao).** Nguồn `agent_proposal` (`tools.ts:1797`, `fleet/service.ts:183`) đi qua: cổng 074b-1 (có lỗ phủ định, thiếu "tự động duyệt", bỏ sót trích dẫn nhiều dòng, không kiểm `description` trong frontmatter mà `find_skills` trả `description` cho model) → cổng 074b-2 (skill không có trigger đạt điểm tối đa; judge nhận `skill: system` ở `skillBehaviourEval.ts:264`; `slice(0, 8)` có thể bỏ slot ngoài chủ đề) → tự kích hoạt không có người duyệt. Một markdown đạt cả ba cổng có thể vào prompt của model ở lượt tiếp theo. Đây là rủi ro cấp chuỗi, không thuộc riêng 074b-4.

4. **Không có cơ chế ép bước act theo tool khai báo (trung bình).** `skill.tools` chỉ được dùng để dựng prompt và danh sách ứng viên (`service.ts:1385`, `skills.ts:239`, `workspace.ts:196`). Không tìm thấy bộ lọc tool theo `tools:` trong đường thực thi. Kiểm tra "tool khai báo là tập con của baseline" là kiểm tra tĩnh, không phải kiểm tra theo vết gọi tool. Báo cáo nêu rằng kiểm tra là tĩnh ("không phải đối chiếu vết gọi tool"), nhưng không nêu việc không có bộ lọc theo `tools:` lúc chạy. Lượt này xác nhận bằng grep, chưa truy hết đường thực thi.

5. **Va chạm tên với research built-in (trung bình).** Ghi nhận trong báo cáo và `autoActivation.ts:47`: tên skill người dùng có thể trùng tên research provider (TASK-151 chưa làm). Cần quyết định trước khi bật.

6. **`writeUserSkill` lỗi sau khi DB đã active (trung bình, trên đường vận hành).** Thứ tự là: transaction commit (DB active), rồi `writeUserSkill` ghi file và `syncWorkspace()` (`service.ts:947–952`, ngoài transaction). Lỗi ghi file bị nuốt và chỉ còn log `operator auto activation failed`, không thử lại. Trên server, định tuyến (`userSkills()`, `service.ts:1425–1432`) và `read_skill` (`tools.ts:1713`) đều lấy markdown của bản active trong DB; file chỉ dùng cho tên không có bản active, nên file cũ không ảnh hưởng định tuyến. Handbook chỉ liệt kê tên và mô tả skill (`handbook.ts:95–96`), không chứa thân. Ngoại lệ: nếu tên skill trùng built-in, `extraSkills` ghi nội dung người dùng vào đường dẫn built-in (`workspace.ts:106–110`). Nhưng sổ tay bảo người vận hành chỉ đọc 1–3 file kỹ năng (`handbook.ts:118`). Nếu ghi file lỗi, file người vận hành đọc có thể là bản cũ trong khi DB đã active. Chú thích ở `service.ts:946` cũng nói người vận hành đọc file này. Chưa xác minh đường dẫn file cụ thể mà người vận hành mở. Chưa có test cho nhánh này.

7. **Flip rồi từ chối (thấp; đúng theo code, chưa có test).** Đã đọc `autoActivation.ts:97–108`: flip và activation nằm trong một transaction immediate; `AppError` ném từ `activateSkillVersionInTx` làm transaction rollback, rồi được trả về dưới dạng `reasons`. Báo cáo ghi nhánh này chưa được test; đọc code cho thấy hành vi đúng, nhưng chưa có test chứng minh.

8. **Người dùng không được báo (trung bình).** Tự kích hoạt chỉ ghi `logger.info` (`service.ts:909`, `:911`, `:934`, `:938`). Giao diện không có chỗ nào hiển thị. Người dùng không biết một bản active đã đổi, trừ khi tự xem danh sách phiên bản.

9. **Archive không gỡ skill khỏi định tuyến: không đúng, đã bỏ.** `archived` chỉ được ghi ở một chỗ, `skillVersions.ts:158` (đã grep `UPDATE operator_skill_versions` trong toàn bộ `apps/server/src`), trong cùng transaction với việc kích hoạt bản thay thế (`:159`). Không có đường nào xóa file. Vì vậy không có tên nào rơi về 0 bản active qua code hiện tại, và `userSkills()` (`service.ts:1430–1432`) chỉ nạp file khi tên không có bản active. Rollback (`activateSkillVersion`, `skillVersions.ts:163`) kích hoạt một bản archived và archive bản đang active; tên đó vẫn có đúng một bản active. Ghi chú thấp: tên không có hàng DB nào (skill từ trước khi có DB) vẫn được định tuyến qua file, nhưng đó là hành vi có sẵn, không do tự kích hoạt. Rollback không qua cổng eval (cổng chỉ áp dụng cho draft, `skillVersions.ts:153`); test "restoring an archived version is not blocked" ghim hành vi này. Chưa kiểm nút rollback trên UI (`SkillVersions.tsx`).

10. **Quyền truy cập route (đã nêu ở 3b, thấp).** Route eval và shadow dùng `operator.use`, nên API key gắn với owner vẫn gọi được đường đánh giá và đặt shadow, dẫn tới tự kích hoạt khi cờ bật. Đây là mẫu sẵn có của hệ thống, không phải lỗi riêng của 074b-4.

## Sai lệch với báo cáo `TASK-074b-4.report.md`

- Báo cáo ghi 32 test (20 + 12); file activation có 21, tổng 33. Test dòng 213 không có trong danh sách báo cáo.
- Mutation table a–k ghi "KILLED", lượt này không chạy lại.
- Báo cáo không nêu: phụ thuộc vào `du_mau` bị thổi phồng (phát hiện 1); bằng chứng từ trigger của bản active (phát hiện 2); chuỗi tin cậy markdown của agent (phát hiện 3); không có thông báo cho người dùng (phát hiện 8).

## Việc tiếp theo

1. Sửa `runId` đường chat và thêm test chat thật (3b).
2. Quyết định đếm shadow theo trigger của bản shadow (3a).
3. Hoàn tất 074b-1 và 074b-2 trước khi bật cờ.
4. Thêm test cho `writeUserSkill` lỗi, và cho nhánh flip rồi từ chối.
5. Thêm thông báo người dùng và cơ chế resync khi ghi file lỗi.
6. Sửa báo cáo: số test theo file (21 + 12 = 33), mục phụ thuộc chuỗi, và các rủi ro trên.
7. Giữ cờ tắt cho đến khi các mục 1–5 xong.

## Chưa xác minh

- Mutation table a–k: không chạy lại.
- Đường thực thi của bước act: chưa truy hết, chỉ xác nhận không tìm thấy bộ lọc theo `tools:`.
- Rollback qua UI: chưa kiểm điều kiện hiển thị nút kích hoạt cho bản archived.
- Hành vi với provider LLM thật: không kiểm được trong lượt này.
- Đường file mà người vận hành mở cho skill người dùng (phát hiện 6).
