# TASK-074c-5c — lời từ chối cho biết khi nào hạn mức đã hạ là nguyên nhân (báo cáo)

Trạng thái: đã code và test trong cây làm việc. Chưa commit, chưa push, chưa có `.done`. Không khởi động app. Không ghi vào `data/`, `data-dev/` hoặc `docs/proposals/`. Không đổi `selfImprovementBudgetStatus`, không ghi `app_settings`, không đổi web hay MCP.

Quyết định của advisor (2026-11-20): chỉ đổi `apps/server/src/operator/toolProposals.ts:79`. Giữ mã 429 `TOOL_PROPOSAL_LIMIT`. Khi lần gọi bị từ chối vì hạn mức đã hạ, thêm một câu và `details: { halved: true, userLimit, effectiveLimit }`. Khi lần từ chối không do việc hạ, thông báo cũ giữ nguyên từng byte, không có `details`.

## Đã làm

- `apps/server/src/operator/toolProposals.ts`: đọc `selfImprovementBudgetStatus` một lần, giữ `userLimit` và `used` (`?? 0`). Tính `limit` như trước. Khi `SELF_IMPROVEMENT_BUDGET_LIMIT` xảy ra:
  - nếu `limit < userLimit && used < userLimit` (việc hạ là nguyên nhân): thông báo mới, bắt đầu bằng câu cũ, thêm "Hạn mức hôm nay đã được hạ xuống còn E vì tỉ lệ đề xuất được chấp nhận dưới 30%; người dùng đặt U.", kèm `details`.
  - ngược lại: thông báo cũ, không `details`.
- `apps/server/test/improvementSelfTune.test.ts`:
  - nhóm mới "TASK-074c-5c: the refusal says when the halved limit caused it" (4 test);
  - nhóm mới "the budget cap guard (pins existing behaviour)" (2 test: cap âm, cap NaN).
- Import thêm `saveSelfImprovementSettings` vào file test (dùng để đặt hạn mức 1).

## Kiểm tra red trước

- Chạy file test trước khi sửa `toolProposals.ts`: 1 test đỏ, 16 test xanh. Test đỏ là "names the halved limit…", đúng lý do: `AssertionError` vì thông báo chưa có câu mới.
- Các test còn lại là pin hành vi cũ (thông báo không đổi, không `details`, cap âm và cap NaN). Chúng xanh ngay từ đầu, đúng như dự kiến, nên không được tính là "đỏ trước".

## Kết quả sau khi sửa

- Focused 5 file server (`improvementSelfTune`, `improvementRequests`, `toolProposalAccept`, `researchSelfTuneRoute`, `selfImprovementBudget`): 55/55 pass.
- `improvementSelfTune.test.ts` riêng: 17/17 pass.
- Server typecheck (`npx tsc -p tsconfig.json --noEmit`, `apps/server`): exit 0.

## Mutation (mỗi cái một lần, hoàn nguyên, `cmp` giống hệt)

- M1: bỏ `&& used < userLimit` (điều kiện trên). Đỏ 1: "keeps the old message when the user's limit was already used up…".
- M2: bỏ `Number.isFinite` trong `autonomyBudget.ts` (cap NaN). Đỏ 1: "ignores a NaN cap…".
- M3: cap âm bị bỏ qua (coi như không có cap). Đỏ 1: "treats a negative cap as zero…".
- Lưu ý về cap âm: bỏ `Math.max(0, …)` không đổi kết quả, vì cap -5 và cap 0 đều từ chối; nên mutation dùng để chứng minh guard là M3.

## Giới hạn đã biết

1. Tỉ lệ vẫn là toàn cục, còn hạn mức theo workspace (`improvement_requests` không có `workspace_id`). Từ 5a.
2. Web và MCP không hiển thị `details`. Không thay đổi phía đó theo quyết định này.
3. Đường đi của thông báo (đã kiểm bằng đọc mã, 2026-11-20, không sửa gì):
   - `registry/invoke.ts:222` ném lại lỗi nguyên vẹn.
   - Operator: `operator/modelRuntime.ts:96-101` bắt lỗi, đặt `errorDetail = error.message`. Không đưa vào `observations`, nên model không thấy thông báo; lượt chạy thành `failed`.
   - `operator/service.ts:1363-1370`: `detail = redactOperatorText(errorDetail).slice(0, 500)`, rồi nối vào `text` nếu chưa có. `redactOperatorText` (`packages/shared/src/operator/redact.ts`) chỉ che email và chuỗi dạng khóa/token, nên câu hạ hạn mức (≈150 ký tự) đi nguyên vẹn đến người dùng. Đây là thông báo duy nhất người dùng operator thấy; `details` (`halved`, `userLimit`, `effectiveLimit`) không đi đến đây.
   - HTTP: `app.ts:1158-1163` gửi `code`, `message` và `details` cho API. Web không hiển thị `details`.
   - Không có chỗ nào thay thông báo bằng chuỗi cố định trên đường operator. Đường trợ lý (`assistant/service.ts:313-315`) không đi qua `recordToolProposal` và không thuộc slice này.
4. `used` đọc trước lần tiêu trong cùng transaction của `recordToolProposal`, nên khớp với giá trị mà `consumeSelfImprovementBudget` đã thấy.
5. Từ 5a: legacy `dismissed` → `rejected` có thể hạ hạn mức ngay sau migrate. (Đã đóng bởi 074c-5d, 2026-11-20.)

## Chưa làm (cố ý)

- Quy tắc chuyển trạng thái gated bằng `.done`, và `accepted → in_progress`.
- So sánh 14/28 ngày.
- Đường ghi `effort` và ánh xạ đầu ra cho 074c-3.

## Kết quả full server suite

- Lệnh: `npx vitest run` trong `apps/server`, chạy nền (task `b6kz9rhp9`). Log: `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\074f5dd9-9e4f-4407-b442-670a7f5dc0ae\scratchpad\server-full-5c.log`, `SUITE_EXIT=0`.
- Kết quả: Test Files 290 passed, 4 skipped (294); Tests 2383 passed, 9 skipped (2392). Không có dòng FAIL hay timeout.
- Đối chiếu: 5b là 290/2377; 5c thêm 6 test (4 nhóm halved/unhalved và 2 pin cap). Khớp, không có file nào thay đổi số lượng file.
- Trạng thái: 074c-5c đã đóng trên full server suite. Chưa commit, chưa push, chưa có `.done`.
