# TASK-074b-4 — quy tắc kích hoạt: người dùng kích hoạt, tự kích hoạt chỉ cho skill chỉ đọc có bản nền

**Who:** opencode (code), Codex (review). Claude viết guide này. **Size:** S–M. **Migration:** không.
**Part of:** TASK-074b (`docs/cursor/TASK-074.md` §4.3; estimate `docs/cursor/TASK-074-estimate-2026-11-19.md`, dòng 074b-4).
**Depends on:** **074b-3b** (chưa bắt đầu; cần `docs/tasks/TASK-074b-3b.done`). 074b-3b cần 074b-2 (`docs/tasks/TASK-074b-2.done`) và 074b-3a (`docs/tasks/TASK-074b-3a.done`). Không bắt đầu code trước khi các `.done` đó tồn tại.
**Unblocks:** 074b-5 (kết quả và quay lui dùng quy tắc kích hoạt đã sửa).

## Bối cảnh (đọc trước khi code)

Hiện có hai đường kích hoạt, và cả hai đang dựa vào điểm định tuyến:

1. **Kích hoạt từ trang Tự cải tiến:** `activateSkillVersion` trong `apps/server/src/operator/skillVersions.ts:129` (gọi từ `apps/server/src/operator/service.ts:816`). Nút trên trang: "Duyệt và dùng" cho `draft` và "Khôi phục phiên bản" cho bản khác (`apps/web/src/features/operator/SkillVersions.tsx:78`); cả hai đi qua cùng hàm. Điều kiện hiện tại: không `needs_merge`, không `shadow`, tên khớp, và `evaluateSkill(...).score >= SKILL_EVAL_MIN_SCORE` (80, `apps/server/src/operator/skillEval.ts:14`).
2. **Tự kích hoạt cho skill chỉ đọc:** `apps/server/src/fleet/service.ts:189`. Điều kiện: cài đặt `autoActivateReadOnlySkills` bật (mặc định tắt, `packages/shared/src/fleet/schema.ts:15`), trạng thái `draft`, điểm ≥ 80, mọi công cụ là `read`, không có công cụ không-đọc nào được nhắc tên. Nó gọi thẳng `activateSkillVersion` lúc gửi bản nháp, không qua shadow. Dòng 187 ghi sẵn: "TASK-074b: reuse its behaviour/shadow gate when that task lands".

Sai khác cần ghi lại: spec §4.3 đặt tên cài đặt là `operator.autoActivateReadSkills`, còn code đang dùng `autoActivateReadOnlySkills` (cài đặt fleet, có UI ở `apps/web/src/features/operator/FleetTab.tsx:37` và test). Mặc định: **giữ tên đang có**, để không làm mất cài đặt đã lưu.

## Quy tắc mới (mặc định tôi chọn; báo cáo nếu khác)

**Ba điều cố định, đọc từ 3b:**
- Shadow chỉ vào được khi skill **có bản nền** (3b, `SKILL_NO_BASELINE` nếu không có). Bản nền là bản active nếu có, không thì bản tích hợp/repo. Vì vậy mọi phép so "không xấu hơn" đều có bản để so. Hệ quả: skill hoàn toàn mới (không có bản nền) chỉ được người dùng kích hoạt, không bao giờ tự kích hoạt.
- Bản `archived` chỉ có một nghĩa: từng là bản active (3b, bước 7). Khôi phục bản `archived` là quay lại một bản đã dùng, nên **được miễn gate behaviour eval**. Vẫn qua kiểm tra routing hiện có.
- Số lượt và đồng hồ 7 ngày dùng đúng hàm `shadowProgress` của 3b (bước 5). Không định nghĩa lại ở đây.

**Gate behaviour eval cho bản `draft`** (cả đường người dùng lẫn tự kích hoạt): key `operator.behaviourEval.<skill>.v<version>` có `passed === true`, `judgeStatus === "ok"`, và `activeVersion` lưu trong kết quả bằng `activeVersion` hiện tại (cả hai có thể là `null`).
**Ngoại lệ:** bản `draft` có `evidence.source` là `user_edit` (người dùng tự sửa) không cần gate này. Lý do: nếu judge không sẵn sàng hoặc hết hạn mức, người dùng không bị khóa khỏi bản của chính họ. Bản `user_review` (agent viết, người dùng duyệt, `service.ts:761`) **không** được miễn: đó vẫn là nội dung agent viết. Routing ≥ 80 áp dụng cho mọi nguồn. Ghi trong báo cáo.

**Người dùng kích hoạt** (bản `draft`, từ trang Tự cải tiến):
- routing ≥ 80 (giữ nguyên), và
- nếu không thuộc ngoại lệ trên: behaviour eval đạt, đúng bản, khớp `activeVersion`.
- Không cần shadow xong: người dùng là người quyết cuối. Trang hiển thị kết quả shadow (3b) để họ xem.

**Tự kích hoạt** (chỉ khi `autoActivateReadOnlySkills` bật, chỉ cho skill chỉ đọc, chỉ cho bản `draft` không thuộc ngoại lệ, và skill có bản nền). Gồm hai bước:

- **Bước 1, vào shadow.** Bổ sung vào route `POST /api/operator/skills/:name/versions/:version/behaviour-eval` của 3b (đây là sửa handler của 3b; 074b-4 không tạo route mới). Sau khi `runBehaviourEval` trả `passed` và `judgeStatus === "ok"`: nếu `operator.shadowEnabled` bật, cài đặt tự kích hoạt bật, skill chỉ đọc, và bản không thuộc ngoại lệ, route gọi `markShadowVersion`. Nếu thiếu bất kỳ điều kiện nào thì không vào shadow, và ghi lý do vào phản hồi của route. Route chỉ chạy khi có người bấm "Chạy eval hành vi" (3b). Không có eval tự động sau khi gửi bản nháp.

- **Bước 2, kích hoạt.** Hàm mới `checkAutoActivation(db, name, { now, registry, autoEnabled, minRuns })` trong module mới `apps/server/src/operator/autoActivation.ts`. Module này không import `fleet/` và không import executor, runner hay registry thực thi; chỉ đọc registry để tra `read`/`safe`/`confirm`. Cài đặt `autoEnabled` do caller truyền vào, nên không có vòng import.
  **Lời gọi nằm trong `service.ts`, không nằm trong `shadow.ts`.** Cụ thể:
  - `recordShadowRuns` (`shadow.ts`) đổi kiểu trả về từ số lượng sang danh sách tên skill đã ghi row (`string[]`). Không thêm import nào vào `shadow.ts`.
  - `recordShadow` trong `service.ts` (dòng 1339) trả về danh sách tên đó. Ngay sau lời gọi `this.recordShadow(...)` ở `findSkills` (dòng 616) và `suggestion` (dòng 1203), `service.ts` gọi `this.autoActivateAfterShadow(name)` cho từng tên. Hàm này bọc try/catch riêng và ghi lỗi bằng logger hiện có của `service.ts`. Một lỗi ở đây không làm hỏng định tuyến hay lượt chat.
  - `autoEnabled` đọc từ cài đặt fleet ở `service.ts` (cùng nguồn `fleet/service.ts:189` đang dùng).
  - Điều kiện kích hoạt, cả bốn phải đạt:
    1. `shadowProgress(...).status === "du_mau"` (đủ N lượt, mốc trong 7 ngày; định nghĩa ở 3b bước 5);
    2. không xấu hơn bản nền (định nghĩa dưới đây);
    3. gate behaviour eval vẫn đạt (`passed`, `judgeStatus` "ok", `activeVersion` khớp bản nền hiện tại; với bản nền tích hợp, `activeVersion` là `null`);
    4. `activationGate` (phần kiểm tra điểm ≥ 80, tên khớp, không `needs_merge`) đạt cho bản shadow.
  - Nếu chưa đủ điều kiện thì không làm gì. Trang hiển thị lý do lấy từ `shadowProgress` và `activationGate`.
  - Khi đạt thì gọi đường chuyển shadow → active (việc 3 bên dưới).
  - Lượt chat **kế tiếp** dùng bản active mới: `findSkills` và `suggestion` đọc lại bản active mỗi lần, nên không cần bộ nhớ đệm. Kiểm bằng test.

- **"Không xấu hơn" định nghĩa trên dữ liệu thật có sẵn** (không có số lệnh gọi thực tế để so): số công cụ khai báo của bản shadow ≤ số công cụ khai báo của bản nền, và mọi công cụ khai báo của shadow có `registry.get(tool) === "read"`. Cả hai đọc từ `parseSkillMarkdown(...).tools`. Bản nền có thể là bản tích hợp không có row DB: khi đó so với markdown tích hợp (`renderSkillMarkdown`/`skillBodiesForRouting`), và bản cũ không có gì để thành `archived`. Đây là so khai báo, không phải so lệnh gọi thật. Ghi trong báo cáo.
- **`safe`/`confirm` không bao giờ tự kích hoạt.** Có công cụ không-đọc được nhắc tên trong markdown thì không tự kích hoạt (giữ logic `mutatingNamed`, chuyển vào `checkAutoActivation`).
- Đường `fleet/service.ts:189` bị gỡ phần kích hoạt trực tiếp. Gửi bản nháp chỉ lưu bản nháp.

## Việc phải làm

1. **Hàm kiểm tra gate.** Một hàm thuần, `activationGate(db, name, version, registry, { path: "user" | "auto" })`, trả `{ allowed, reasons[] }`, dùng cho cả hai đường. Mỗi lý do từ chối là một chuỗi ngắn để UI và test đọc được (ví dụ: "chưa qua behaviour eval", "kết quả eval cũ (active đã đổi)", "routing 72 < 80", "shadow 3/5 lượt", "chưa đủ mẫu sau 7 ngày", "skill có công cụ không-đọc", "shadow khai báo nhiều công cụ hơn active", "skill chưa có bản active").
2. **Sửa `activateSkillVersion`.** Rẽ theo `status`:
   - `draft` đi qua `activationGate` với đường `user`. Lỗi mã riêng `SKILL_BEHAVIOUR_NOT_PASSED` (409) kèm lý do, khi gate eval không đạt.
   - `archived` (khôi phục) được miễn gate eval; vẫn qua kiểm tra routing hiện có.
   - `shadow` vẫn bị từ chối `SKILL_IS_SHADOW`, trừ khi đi qua đường chuyển shadow → active ở bước 3, do `checkAutoActivation` gọi.
3. **Đường chuyển shadow → active** (dùng cho tự kích hoạt). Không gọi lồng `clearShadowVersion` rồi `activateSkillVersion`, vì mỗi hàm đã mở transaction `.immediate()` riêng. Tách phần UPDATE thành hàm nội bộ không mở transaction: archive bản active hiện tại (đã từng active), đặt bản shadow thành `active`. Bọc một lần duy nhất trong `.immediate()`. Test cả hai trạng thái đầu ra: bản cũ thành `archived`, bản mới thành `active`, không còn `shadow`.
4. **Sửa đường tự kích hoạt** (`fleet/service.ts:189`): bỏ lời gọi `activateSkillVersion`; để lại lưu bản nháp. Logic `mutatingNamed` chuyển vào `checkAutoActivation`.
5. **Trang Tự cải tiến** (`apps/web/src/features/operator/SkillVersions.tsx`): hiển thị `reasons[]` khi nút bị khóa; hiển thị trạng thái đếm lượt và "chưa đủ mẫu" từ `shadowProgress`. Không thêm công tắc mới; công tắc `autoActivateReadOnlySkills` đã có ở FleetTab.

## Không được làm

- Không đổi điểm định tuyến, `evaluateSkill`, hay `SKILL_EVAL_MIN_SCORE` (vẫn là 80).
- Không đổi tên cài đặt sang `operator.autoActivateReadSkills` trong task này.
- Không tự kích hoạt `safe`/`confirm`.
- Không tự quay lui. Quay lui là 074b-5.
- Không chạy LLM trong lúc gửi bản nháp, và không chạy shadow hay eval trong `checkAutoActivation`. Chỉ đọc kết quả đã lưu.
- Không thêm `import` nào vào `shadow.ts`.
- Không thêm migration.
- Không chạm dự án được bảo vệ `56374fb2-…` hoặc `data/`. Dùng dev data dir.

## Test (phải có)

- Người dùng kích hoạt bản `draft` (không thuộc ngoại lệ) bị từ chối khi chưa qua behaviour eval (`SKILL_BEHAVIOUR_NOT_PASSED`), dù routing ≥ 80.
- Bản `draft` (không thuộc ngoại lệ) bị từ chối khi `activeVersion` đã lưu khác bản active hiện tại ("kết quả eval cũ").
- Bản `draft` do `user_edit` được kích hoạt khi routing ≥ 80, không cần eval.
- Bản `draft` (không thuộc ngoại lệ) được phép khi routing ≥ 80, behaviour `passed`, `judgeStatus = "ok"`, `activeVersion` khớp; không cần shadow xong.
- Khôi phục bản `archived` không bị chặn bởi gate eval (chỉ bởi routing như trước).
- Tự kích hoạt tắt mặc định: cài đặt tắt thì không vào shadow và không tự kích hoạt, dù mọi điều kiện khác đạt.
- Tự kích hoạt bật, `shadowEnabled` bật, skill chỉ đọc, có bản nền: eval đạt → route đặt shadow; đủ N lượt trong 7 ngày, không xấu hơn bản nền → `checkAutoActivation` kích hoạt; bản cũ thành `archived`, bản mới thành `active`, không còn `shadow`.
- Tự kích hoạt trên bản nền **tích hợp** (không có row DB, `activeVersion` null): sau khi đạt, bản mới thành `active`; không có bản cũ để `archived`; test kiểm đúng điều này và kiểm `activeVersion` lưu là `null`.
- Skill không có bản nền: eval đạt → không vào shadow (`SKILL_NO_BASELINE`), không tự kích hoạt.
- Chỉ có N-1 lượt, hoặc lượt thứ N đến sau 7 ngày: không kích hoạt; lý do "chưa đủ mẫu".
- Skill có công cụ `confirm`/`safe` được nhắc tên: không tự kích hoạt dù cài đặt bật.
- Bản shadow khai báo nhiều công cụ hơn active: không tự kích hoạt.
- `shadowEnabled` tắt: đường tự kích hoạt không vào shadow, dù cài đặt tự kích hoạt bật.
- Lỗi trong `autoActivateAfterShadow` được ghi log, và lượt chat vẫn trả kết quả định tuyến như bình thường.
- Lượt chat kế tiếp sau khi tự kích hoạt dùng bản active mới.
- **Không thực thi:** `runTool`, `runCursorProcess`, `createModelRuntime` và runner của eval được mock ném lỗi; test xác nhận không được gọi. `autoActivation.ts` không import executor hay runner (test kiểm import).
- **Không đổi test 3a ngoài các chỗ được liệt kê:** test 3a đếm giá trị trả về của `recordShadowRuns` (số lượng) sẽ đổi thành danh sách tên. Test 3a về "bản shadow cũ thành archived" đã đổi ở 3b. Test "routing không đổi" và "shadow không bao giờ active" phải vẫn xanh. Báo cáo liệt kê đúng các test đã đổi.
- **Không migration:** `apps/server/drizzle/meta/_journal.json` không đổi (kiểm bằng `git diff`); mục cuối vẫn là idx 98.
- Test cũ `apps/server/test/fleet.test.ts:74` (bật `autoActivateReadOnlySkills`) được cập nhật theo điều kiện mới, không xóa.
- Mutation check: bỏ kiểm tra behaviour trong gate của `draft` thì test đỏ; bỏ kiểm tra "không xấu hơn" thì test đỏ; bỏ chặn `confirm` thì test đỏ. Báo cáo cả ba.

## Done when

- Test pass; typecheck `apps/server`, `apps/web`, `apps/mcp`, `packages/shared` đều exit 0 (shared build lại `dist` nếu đổi schema).
- Báo cáo `docs/tasks/TASK-074b-4.report.md`: nêu tên cài đặt đang dùng (`autoActivateReadOnlySkills`, không phải tên trong spec), định nghĩa "không xấu hơn" đã chọn (so khai báo), ngoại lệ cho `user_edit` (không miễn `user_review`), miễn gate eval cho `archived` và lý do, vị trí lời gọi trong `service.ts`, các test 3a đã đổi, và kết quả mutation.
- Không có `docs/tasks/TASK-074b-4.done` trước khi Codex review.

## Open source available

Không cần. Đây là quy tắc nội bộ trên dữ liệu đã có.

## Open questions (báo cáo, không tự quyết)

- Estimate ghi "Thay điều kiện cũ (điểm định tuyến ≥ 80)". Guide này **giữ** routing ≥ 80 và **thêm** behaviour eval (trừ bản do người dùng tự sửa). Nếu người dùng muốn thay hẳn, bỏ điều kiện routing trong `activationGate`.
- Ngoại lệ cho `user_edit` (không cần eval): mặc định là có, để judge không sẵn sàng không khóa người dùng khỏi bản của chính họ. `user_review` không được miễn (nội dung agent viết). Nếu muốn áp dụng eval cho cả bản người dùng, bỏ ngoại lệ trong `activationGate`.
- Người dùng kích hoạt có cần shadow xong trước không. Mặc định: không cần.
- Ngưỡng "không xấu hơn" là so khai báo, không phải so lệnh gọi. Muốn so lệnh gọi thật cần ghi bản active nào được chọn cho mỗi lượt (3b chưa ghi). Đây là sai khác cần quyết.
- Tên cài đặt: giữ `autoActivateReadOnlySkills` (mặc định) hay đổi theo spec `operator.autoActivateReadSkills`.
- Eval không tự chạy sau khi gửi bản nháp (3b chỉ chạy khi bấm). Vì vậy tự kích hoạt chỉ xảy ra sau một lần bấm "Chạy eval hành vi". Chạy eval nền cần hàng đợi và ngân sách riêng; để sau.
- Skill không có bản nền (hoàn toàn mới) không bao giờ vào shadow, nên không bao giờ tự kích hoạt. Skill tích hợp chưa có bản trong bảng có bản nền là bản tích hợp, nên vào shadow được. Đây là chủ đích; nếu muốn khác, cần quyết định riêng.
