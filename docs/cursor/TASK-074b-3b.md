# TASK-074b-3b — cổng shadow: route eval và shadow, đếm lượt, so sánh

**Who:** opencode (code), Codex (review). Claude viết guide này. **Size:** M. **Migration:** không (bảng `operator_skill_shadow_runs` đã có từ 074b-3a, migration 0098).
**Part of:** TASK-074b (ước lượng `docs/cursor/TASK-074-estimate-2026-11-19.md`, phần 3b).
**Depends on:** **074b-2** (behaviour eval, chưa bắt đầu; cần `docs/tasks/TASK-074b-2.done`) và **074b-3a** (xong về code, chờ Codex review; cần `docs/tasks/TASK-074b-3a.done`). Không bắt đầu trước khi cả hai `.done` tồn tại.
**Unblocks:** 074b-4 (quy tắc kích hoạt đọc số lượt đã đếm ở đây, cổng shadow và đồng hồ 7 ngày). 148e chỉ cần 3a, không cần task này.

## Bối cảnh (đọc trước khi code)

074b-3a đã làm:
- Bảng `operator_skill_shadow_runs` (`id`, `skill_name`, `shadow_version`, `active_version`, `run_id`, `query`, `rank`, `planned`, `created_at`).
- Cổng `operator.shadowEnabled` (mặc định tắt). Khi bật, `findSkills` và `suggestion` ghi một row cho mỗi skill có bản shadow được định tuyến. Không chạy gì.
- Marker shadow là status `'shadow'` trên `operator_skill_versions` (xem báo cáo 3a, mục 3, về sai khác so với spec).
- `markShadowVersion`, `clearShadowVersion`, `shadowVersionFor` trong `apps/server/src/operator/skillVersions.ts`.

Chưa có: route HTTP hoặc UI để chạy eval, đặt hay bỏ shadow; UI bật/tắt `shadowEnabled`; đếm và so sánh; điều kiện 7 ngày.

## Việc phải làm

1. **Cổng "đã qua 074b-2" và cổng "có bản nền".** Bản nền được truyền vào từ service (lấy từ `skillCandidates()`, `service.ts:1209`), không để `skillVersions.ts` hay `shadow.ts` import `workspace.ts`: tránh vòng import và giữ nguyên allowlist import ở `operatorShadow.test.ts:193`. `markShadowVersion` (hoặc route gọi nó) làm hai kiểm tra trước khi đổi trạng thái:
   - Không có bản nền cho tên skill: 409 `SKILL_NO_BASELINE`. Bản nền là bản đang định tuyến: bản `active` trong bảng nếu có, không thì bản tích hợp/repo lấy từ `skillBodiesForRouting()`. Lý do: "không xấu hơn" (074b-4) luôn có bản để so. Skill tích hợp chưa có bản trong bảng vào shadow được; skill hoàn toàn mới (không có bản nền) thì không, chỉ người dùng kích hoạt (xem 074b-4).
   - Không đọc được kết quả đạt: 409 `SKILL_BEHAVIOUR_NOT_PASSED` (mã riêng). Đọc key `operator.behaviourEval.<skill>.v<version>` (`docs/cursor/TASK-074b-2.md` bước 5). Chỉ `passed === true` và `judgeStatus === "ok"` mới qua. Không có kết quả, hoặc `judgeStatus` là "unavailable" hay "insufficient", thì từ chối. Còn so `activeVersion` trong JSON với bản active hiện tại: nếu lệch, từ chối (kết quả cũ cho một bản khác). Không cần migration.
2. **Route chạy eval, route đặt và bỏ shadow.** Tất cả dưới `/api/operator/...`:
   - `POST /api/operator/skills/:name/versions/:version/behaviour-eval`: gọi `runBehaviourEval(db, name, version, opts)` của 074b-2. Đây là đường chạy duy nhất trong app. Chạy lại ghi đè cùng key, nên đó là cách làm mới khi `activeVersion` lệch. Route này **chỉ** chạy eval và lưu kết quả. Nó không đặt shadow. Việc tự đặt shadow sau khi đạt thuộc 074b-4 (bước 1 của tự kích hoạt).
   - `POST /api/operator/skills/:name/versions/:version/shadow`: gọi `markShadowVersion` (sau cổng bước 1).
   - `DELETE /api/operator/skills/:name/shadow`: gọi `clearShadowVersion`.
   - Thêm cả ba vào `apps/server/src/auth/routePermissions.ts` và `apps/server/src/auth/toolActions.ts` theo cách các route skill hiện có.
   - Trên `apps/web/src/features/operator/SkillVersions.tsx`: nút "Chạy eval hành vi" cho bản `draft`; nút "Đặt làm shadow" chỉ hiện khi kết quả đã đạt; nút "Bỏ shadow" cho bản `shadow`. Khi bị từ chối, hiện lý do từ mã lỗi.
   - Test: eval đạt, eval không đạt, judge unavailable, hết hạn mức (429 `SELF_IMPROVEMENT_BUDGET_LIMIT`, từ 074b-2) đều có test riêng ở tầng route.
3. **Công tắc bật/tắt.** UI cho `operator.shadowEnabled` (trang Tự cải tiến), dùng `OperatorSettingsUpdateSchema` đã có. Mặc định vẫn tắt.
4. **Đếm lượt.** Đây là quyết định phải làm trong 3b, vì 074b-4 cần con số này đúng. Công thức, đúng theo spec 074b-3a mục 6:
   `SELECT COUNT(DISTINCT COALESCE(run_id, id)) FROM operator_skill_shadow_runs WHERE skill_name = ? AND shadow_version = ?`
   Sai khác so với spec, cần sửa ở 3b: `findSkills` ghi `run_id = NULL` (`service.ts:615–616`), nên một lượt có cả `findSkills` và `suggestion` bị đếm hai lần (`docs/tasks/TASK-074b-3a.report.md` §7 mục 2).
   **Quyết định của guide này: (c).** Truyền run id vào `findSkills`, để mọi row mới có `run_id`. Đã kiểm trong mã: khi model operator gọi `find_skills`, đường là `modelRuntime.ts:78` → `invokeRegistryTool` (`registry/invoke.ts:191`), và invoke ghi đè `ctx.runId` bằng `input.runId`, tức `job.runId` (`service.ts:1116`). Vậy `ctx.runId` trong lúc chạy bằng `job.runId`. Việc cần làm: tool `find_skills` (`assistant/tools.ts:1673`) hiện bỏ qua `ctx` (`execute: async (args) =>`), phải đổi thành `async (args, ctx)` và truyền `ctx.runId ?? null` vào `hooks.findSkills(query, runId)` (`operator/hooks.ts:28`), rồi vào `service.ts:612–616`. Đường cursor cũng đã kiểm trong mã: `cursorRuntime.ts:29` đặt `VG_OPERATOR_INVOCATION` theo job, `workspace.ts:81` đặt `VG_OPERATOR_MANAGED`, `apps/mcp/src/apiClient.ts:409–411` gửi cả hai, `api/registry.ts:29` đổi token thành `job.runId` (`service.ts:173`), và `invoke.ts` nhận qua `...invocation`. Token thiếu hoặc sai thì `runId` là null và row sẽ đếm kép; đó là giới hạn đã biết, ghi trong báo cáo. Chat trợ lý không có run nên `runId` là null. Test bắt buộc: `find_skills` trong run operator ghi `run_id = job.runId`. Hệ quả cần ghi lại:
   - Mọi row mới từ `findSkills` có `run_id`, nên công thức đếm đúng một lần cho mỗi lượt. Không đổi công thức.
   - `logRouting` nhận thêm run id cho `findSkills`. Đây là thay đổi cột log, không đổi điểm định tuyến hay kết quả; test baseline "routing không đổi" của 3a phải vẫn xanh.
   - Row cũ từ 3a (`run_id` NULL) vẫn đếm kép. Không sửa dữ liệu cũ. Báo cáo ghi rõ.
   Mọi `rank` đều được đếm; không lọc `rank = 1`.
5. **Điều kiện đủ mẫu và đồng hồ 7 ngày (định nghĩa một lần ở đây; 074b-4 chỉ tham chiếu).**
   - "Số lượt" của một bản shadow = kết quả công thức ở bước 4 với `shadow_version` là bản đó. Không phải số row.
   - `N` = 5 mặc định, là một cài đặt (`operator.shadowMinRuns`, đọc qua `OperatorSettingsUpdateSchema` nếu thêm được, không thì hằng số có ghi chú).
   - Đồng hồ 7 ngày bắt đầu từ `MIN(created_at)` của các row của đúng bản shadow đó (`skill_name` và `shadow_version`). Hết 7 ngày từ mốc đó mà số lượt chưa đủ N thì trạng thái là **"chưa đủ mẫu"**. Trạng thái này không tự kích hoạt bản nào, và không có timer: nó chỉ được tính khi có lượt mới hoặc khi trang được tải (quyết định 2026-11-19 trong `GOAL-2026-11-18.decisions.md`).
   - Bản shadow bị thay bằng bản khác rồi quay lại: đồng hồ tính lại, vì các row cũ thuộc `shadow_version` khác. Ghi trong báo cáo.
   - Hàm dùng chung: `shadowProgress(db, name, version, now)` trả `{ runs, firstAt, status: "dang_thu" | "du_mau" | "chua_du_mau" }`, và 074b-4 gọi đúng hàm này.
6. **So sánh.** Không chạy gì, và không có số lệnh gọi thật để so. `planned` (`shadow.ts:36`) là danh sách công cụ khai báo của bản shadow, giống nhau ở mọi lượt của một bản. So sánh là giữa số công cụ khai báo của shadow và của bản nền (bản active trong bảng, hoặc bản tích hợp/repo nếu không có; đọc `parseSkillMarkdown(...).tools` của hai bản lúc hiển thị), kèm số lượt shadow đã đếm. Không so theo từng query: 3a không ghi bản active nào được chọn, nên không có cơ sở so theo lượt. Đây là sai khác cần báo cáo (xem Open questions). Nếu bản shadow không khai báo tools (`planned` rỗng), hiển thị "không khai báo", không hiển thị 0.
7. **Dọn tồn đọng từ 3a.** Quyết định của guide này, có đổi hành vi 3a ở một chỗ:
   - Khi đặt shadow mới, bản shadow cũ **chuyển thành `draft`**, không còn thành `archived` (`skillVersions.ts:109`). Lý do: sau thay đổi này, `archived` chỉ có một nghĩa là "từng là bản active" (chỗ duy nhất khác ghi `archived` là `activateSkillVersion`, `skillVersions.ts:143`; đã grep, không có chỗ thứ ba). Nhờ vậy nút "Khôi phục phiên bản" trên `archived` luôn là quay lại một bản đã từng dùng, và không cần ẩn nút hay dựng chuỗi "phiên bản trước".
   - Đổi này làm đổi test 3a về "bản shadow cũ thành archived" (cập nhật thành `draft`), và các test 3a đặt shadow cho skill không có bản nền (nay bị `SKILL_NO_BASELINE`). Các test 3a hiện tại dùng skill `shadow-probe` có bản active trong bảng (`operatorShadow.test.ts:79`), nên vẫn có bản nền và không đổi. Liệt kê trong báo cáo.
   - Hiện không có route nào gọi `markShadowVersion`, nên mọi shadow trước 3b chỉ do test tạo. Route ở bước 2 là lý do chính của task này.

## Test (phải có)

- Bản chưa qua 074b-2 không đặt được làm shadow: `SKILL_BEHAVIOUR_NOT_PASSED`. Thử từng trường hợp: không có kết quả; `judgeStatus` là "unavailable"; "insufficient"; `activeVersion` lệch.
- Tên skill không có bản nền nào không đặt được làm shadow: `SKILL_NO_BASELINE`. Skill tích hợp chưa có bản trong bảng vẫn đặt được làm shadow (bản nền là bản tích hợp).
- Đặt shadow qua route, rồi bỏ: `draft` → `shadow` → `draft`.
- Đặt shadow mới khi đã có shadow: bản cũ thành `draft`, không thành `archived`.
- Chạy eval qua route: kết quả được lưu; route không đổi trạng thái bản nào (không gọi `markShadowVersion`).
- Đếm (đúng theo công thức thật, không theo ý định):
  - hai row cùng `run_id` cho ra 1;
  - hai row `run_id = NULL` cho ra 2;
  - row `run_id = NULL` (dữ liệu cũ từ 3a) cộng một row có `run_id` cho ra 2, khóa hành vi dữ liệu cũ;
  - `findSkills` và `suggestion` cùng một lượt, sau khi truyền run id, cho ra 1.
- Đồng hồ 7 ngày: đủ N lượt trong hạn → `du_mau`; N-1 lượt, hoặc lượt thứ N đến sau 7 ngày kể từ mốc → `chua_du_mau`; không có lượt nào → `dang_thu`.
- Bật shadow từ UI/route ghi đúng `shadowEnabled`; mặc định vẫn tắt.
- **Không thực thi:** test không-thực-thi của 3a (mock executor và runner) vẫn xanh, và không có đường mới nào của 3b gọi runner hay tool. Route eval chỉ gọi `runBehaviourEval`.
- **Routing không đổi:** test baseline của 3a vẫn xanh sau khi truyền run id vào `findSkills`.
- Mutation check: bỏ cổng 074b-2 thì test từ chối đỏ; bỏ `SKILL_NO_BASELINE` thì đỏ; thêm lời gọi runner vào đường đếm thì test không-thực-thi đỏ. Báo cáo cả ba.

## Done when

- Test pass; typecheck `apps/server`, `apps/web`, `apps/mcp` exit 0.
- Migration: không có. Nếu cần cột mới thì tạo bằng `drizzle-kit generate`, không sửa tay, và áp dụng lên bản sao DB dev.
- Báo cáo `docs/tasks/TASK-074b-3b.report.md`: nêu cách đếm đã chọn (c), các test 3a đã đổi, quyết định bản shadow cũ thành `draft`, và mutation check. Không có `.done` trước khi Codex review.

## Không được làm

- Không chạy shadow ở đây; không gọi executor hay runner.
- Không đổi điểm định tuyến, thứ hạng, hay hành vi của bản active.
- Không tự viết logic eval. Logic eval là của 074b-2; route chỉ gọi `runBehaviourEval`.
- Không tự đặt shadow sau khi eval đạt. Việc đó là bước 1 của 074b-4.
- Không kích hoạt tự động bản nào.
- Không chạm dự án được bảo vệ `56374fb2-…` hoặc `data/`. Dùng dev data dir.

## Open questions (báo cáo, không tự quyết)

- ~~Nơi lưu kết quả 074b-2~~ Đã quyết trong `TASK-074b-2.md` bước 5 (`app_settings`).
- **Đếm kép (từ 3a).** Đã chọn (c) ở bước 4. Dữ liệu cũ vẫn đếm kép; nếu muốn sửa cả dữ liệu cũ, đó là việc riêng (migration hoặc backfill), cần báo cáo trước.
- **So theo từng lượt.** Cần ghi bản active nào đã được chọn cho mỗi lượt shadow. Mặc định: không thêm cột, so khai báo. Nếu cần so theo lượt, đó là thay đổi schema, làm bằng `drizzle-kit generate` và báo cáo trước.
- **Ngưỡng `N`.** Mặc định: cài đặt `operator.shadowMinRuns`. 7 ngày: hằng số.
- **Eval chạy tự động sau khi gửi bản nháp?** Không, trong task này. Eval chỉ chạy khi bấm nút. Chạy nền cần hàng đợi riêng và ngân sách riêng; để sau.
