# TASK-074b-3b — review chỉ đọc (advisor)

**Phạm vi:** `apps/server/src/operator/behaviourGate.ts`, `skillVersions.ts` (`markShadowVersion`, `clearShadowVersion`, đường đọc), `service.ts` (`runSkillBehaviourEval` 867–879, `setShadowSkill` 885–892, `clearShadowSkill` 895–897, `skillVersions()` 795–816), `api/operator.ts` (88–109), `routePermissions.ts` (119–122), `apps/web/src/features/operator/SkillVersions.tsx` (nút shadow), `test/operatorShadowGate.test.ts`.
**Lưu ý phạm vi:** cây làm việc chưa commit. Review này đọc trạng thái hiện tại, không đọc từng commit.
**Không ghi `.done`.** Review chỉ báo cáo; không sửa code.

## Kết luận

**Chấp nhận có điều kiện.** Cổng shadow (`shadowGateRefusal`: NO_BASELINE, NOT_RUN, NOT_PASSED kể cả khi baseline hoặc phiên bản đã đổi), việc đưa shadow cũ về `draft`, route, quyền và đếm tiến độ đều làm đúng đặc tả và có test. Có ba điều kiện:

1. **Đường chat không truyền `runId`, nên `du_mau` bị thổi phồng.** `find_skills` gọi `hooks.findSkills(parsed.query, ctx.runId ?? null)` (`assistant/tools.ts:1677`). Trong `src/assistant` không có chỗ nào gán `ctx.runId` (grep chỉ thấy tham số audit của `runTool`, `tools.ts:2232–2267`, và `recordOperatorUsage`, `assistant/service.ts:618–622`); các lời gọi chat không truyền `meta`. Đường operator đã nối đúng qua `registry/invoke.ts:191` và `modelRuntime.ts:78`. Vì vậy `runId` là `null` và `COUNT(DISTINCT COALESCE(run_id, id))` coi mỗi lần gọi là một lượt riêng. Nhiều lần gọi trong cùng một lượt chat làm tăng `du_mau`. Test "find_skills wiring" (`operatorShadowGate.test.ts:473–489`) tự truyền `{ runId: "r-tool" }`, nên không phát hiện lỗi này. Đây là lỗi thật trên đường production, và nó ảnh hưởng trực tiếp đến ngưỡng `SHADOW_MIN_RUNS = 5` của 074b-4.
2. **Bằng chứng shadow không đến từ trigger của shadow.** Shadow không nằm trong `skillCandidates()` (chỉ đọc bản `active`, `service.ts:1425–1427`), nên lượt được đếm là lượt định tuyến của bản active. `userSkills()` cũng nạp file legacy cho tên không có bản active (`service.ts:1430–1432`), nhưng không nạp bản shadow. Test không có trường hợp nào kiểm trigger của bản shadow. Đã ghi ở 3a (phát hiện 1). Trước khi dựa vào đếm này để tự kích hoạt, cần có bằng chứng trên chính trigger của shadow, hoặc ít nhất ghi rõ là không có.
3. **`readBehaviourEval` không có try/catch.** `behaviourGate.ts:75–79` gọi `JSON.parse(row.value)` không bảo vệ. Một dòng `app_settings` hỏng làm ném lỗi ở các đường **không bọc try/catch**: `setShadowSkill` (`service.ts:889`) và đọc `skillVersions()` (`service.ts:801`, `:805`), tức là route thủ công và danh sách phiên bản. Đường tự động (`service.ts:931`) nằm trong try/catch nên không làm hỏng luồng, nhưng lỗi bị nuốt và chỉ còn một dòng log. Người gọi `behaviourReason` (`behaviourGate.ts:106–107`): `skillVersions.ts:154` (kích hoạt thủ công, không bọc try/catch), `service.ts:799` (đọc `skillVersions()`, không bọc), `autoActivation.ts:59` (tự động; lỗi không phải `AppError` bị ném lại và bắt ở `autoActivateAfterShadow`). Như vậy đường kích hoạt thủ công cũng bị ảnh hưởng.

## Chạy test

- `npx vitest run test/operatorShadow.test.ts test/operatorShadowGate.test.ts` (trong `apps/server`): 2 file, 43/43 pass.

## Kiểm tra từng điểm

1. **Cổng shadow chặn đúng.** `shadowGateRefusal` trả NO_BASELINE khi chưa có baseline, NOT_RUN khi chưa có eval, NOT_PASSED khi eval không đạt, insufficient, judge không khả dụng, hoặc eval cũ (baseline/version đã đổi). Test ở `operatorShadowGate.test.ts:159–209` (NOT_RUN 159, passing eval 166, judge unavailable 176, insufficient 184, stale baseline 192, NO_BASELINE 202). Baseline của skill built-in không có dòng DB được chấp nhận (211).
2. **Shadow cũ về `draft`, không phải `archived`.** `markShadowVersion` (`skillVersions.ts:105–114`) đặt shadow cũ thành `draft` trong cùng transaction. Test ở `:223–234` xác nhận. Điều này đúng với guide 3b (dòng 47), nhưng khác với báo cáo 3a.
3. **Chỉ `draft` được đặt làm shadow.** `markShadowVersion` trả `SKILL_NOT_DRAFT` (409) cho trạng thái khác. Không có `await` giữa kiểm tra và ghi, nên không có race trong better-sqlite3 đồng bộ.
4. **Eval chỉ lưu khi cờ tắt (mặc định).** `runSkillBehaviourEval` (`service.ts:867–879`): 404 khi không có phiên bản (test `:257`); 503 `BEHAVIOUR_LLM_UNAVAILABLE` trước khi trừ budget (test `:263`, `:274`); sau đó `runBehaviourEval`, rồi **luôn** gọi `autoShadowAfterEval` (`:877`). Hàm này tự kiểm `shadowEnabled` và `autoActivateReadOnlySkills` (`:926`) nên mặc định không làm gì. Test "eval route stores the result and does not change any status" (`:235`) chỉ đúng với cờ tắt. Với cờ bật, phần đó thuộc 074b-4 và được kiểm ở `operatorAutoWiring.test.ts:143` (cả hai bật: eval đạt thì thành shadow) và `:152` (chỉ bật tự động, shadow tắt: không thành shadow). Hai test này được chạy ở review 074b-4 cùng suite auto-activation: pass.
5. **`clearShadowSkill` trả số dòng đổi.** Test ở `:247–256` (404 ở `:257`, không thuộc test này).
6. **Route và quyền.** Ba route (eval, POST shadow, DELETE shadow) được Zod kiểm tra và trả `{ok, cleared}`. Các dòng `routePermissions.ts:119–121` là `operator.use`, và `ANY /api/operator/*` (122) cũng là `operator.use`. `PUT /api/operator/settings` nằm dưới catch-all, nên `shadowEnabled` dùng chung quyền với `killed` và `maxRunsPerDay`. Đây là mẫu sẵn có, không phải lỗi của 3b. Đã grep: chỉ `PUT /api/operator/settings` ghi `shadowEnabled` ở server (qua `saveOperatorSettings`, `operator/service.ts:198`). Grep không thấy công cụ agent nào gọi đường này, nhưng chưa truy hết đồ thị gọi.
7. **Đếm tiến độ.** `shadowProgress`: `COUNT(DISTINCT COALESCE(run_id, id))` trong 7 ngày kể từ `MIN(created_at)`. Test "run-id dedup", "legacy rows", "7-day boundary" đều có. Test re-shadow (`:458–469`) ghim hành vi: đặt lại cùng phiên bản không làm lại đồng hồ. Đây là hành vi có chủ đích, nhưng cần ghi rõ.
8. **Đọc model `skillVersions()` (`service.ts:795–816`).** `activation` chỉ được tính cho `draft` (qua `behaviourReason`). Shadow và archived nhận `allowed: true`. Đây là gây hiểu lầm (mức thấp): giao diện không dùng `allowed` cho shadow (nút kích hoạt ẩn cho shadow và `needs_merge`), nên hiện chưa gây lỗi hiển thị.
9. **UI.** `SkillVersions.tsx` (nút bật và tắt shadow, dòng 126–141) gọi POST và DELETE đúng route. Chưa kiểm trạng thái lỗi `SKILL_NOT_DRAFT` và `SHADOW_GATE` trên UI.
10. **Vi phạm quy tắc "không chạy".** Các đường gọi từ 3b (`setShadowSkill`, `clearShadowSkill`) chỉ đổi trạng thái và không chạy tool. Đúng với đặc tả 3b.

## Sai lệch với báo cáo `TASK-074b-3b.report.md`

- **Báo cáo không nêu lỗi `runId` ở đường chat.** Test wiring tự truyền `runId`, nên báo cáo nếu có nói "đã nối đường find_skills" là chưa đủ. Cần ghi thêm rằng đường chat chưa có `runId`.
- **Báo cáo không nêu `readBehaviourEval` không có try/catch.** Lỗi này đã có từ 074b-2 và được ghi ở review 074b-2.
- **Báo cáo không nêu `allowed: true` cho shadow trong read model.**

## Việc tiếp theo

1. Truyền `runId` (hoặc một khóa ổn định theo lượt chat) vào `ctx` trong `buildToolContext`, và thêm test đi qua đường chat thật, không tự truyền `runId`.
2. Bọc `JSON.parse` trong `readBehaviourEval` bằng try/catch, trả `null` khi hỏng, và thêm test.
3. Ghi giới hạn trigger shadow vào báo cáo 3b, để 074b-4 không dựa vào đếm này mà không biết.
4. Đổi `allowed` của shadow và archived trong read model thành `false` hoặc thêm lý do rõ ràng.
5. Đã làm: hai test `:143` và `:152` trong `operatorAutoWiring.test.ts` pass (xem review 074b-4). Hành vi khi cờ tắt: eval chỉ lưu kết quả (mục 4 ở trên).
