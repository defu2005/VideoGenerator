# TASK-074c-2 — báo cáo: gộp theo fingerprint, giới hạn và xếp hạng

**Trạng thái:** đã code và chạy test. **Chưa được review.** Không có `.done`. Không commit, không push.
**Guide:** `docs/cursor/TASK-074c.md` (bước 074c-2).
**Xếp chồng:** nằm trên 074c-1 (`docs/tasks/TASK-074c-1.report.md`), chưa được review. Các thay đổi 074c-1 và 074c-2 nằm chung trong cây làm việc.
**Migration:** không có. Không đổi schema. `drizzle-kit generate` báo `No schema changes, nothing to migrate` và không tạo file.

## Phạm vi đã làm

- **Gộp theo fingerprint** (`apps/server/src/operator/toolProposals.ts`, `recordToolProposal`):
  - Khi đã có dòng **chưa kết thúc** cùng fingerprint (`open`, `accepted` hoặc `in_progress`): cộng `weight` thêm 1, thêm đúng một mục `evidence`, cập nhật `updated_at`. Không thêm dòng. Trả `duplicate`.
  - Lần gộp **không tiêu ngân sách**.
  - `evidence` chỉ giữ 10 mục mới nhất (`MAX_EVIDENCE = 10`). `weight` tăng không giới hạn.
  - `evidence` lưu sai dạng (không phải mảng) thì được thay bằng mảng mới, không lỗi.
- **Giới hạn đọc từ bộ đếm ngân sách** (cùng file):
  - Dùng bộ đếm `improvementRequests` đã có trong `SelfImprovementBudgetSchema` (mặc định 10/ngày). Không hard-code.
  - Trong cùng một transaction `.immediate()`, theo thứ tự: kiểm tra gộp, rồi `consumeSelfImprovementBudget(db, "improvementRequests")`, rồi chèn dòng mới.
  - Lỗi `SELF_IMPROVEMENT_BUDGET_LIMIT` được đổi thành `AppError(429, "TOOL_PROPOSAL_LIMIT")`. Mã lỗi giữ nguyên.
  - Kiểm tra `existing_tool` và kiểm tra nội dung nhạy cảm nằm ngoài transaction, nên không tốn ngân sách.
  - Đã chứng minh được transaction lồng nhau (`consumeSelfImprovementBudget` mở `.immediate()` bên trong transaction của hàm này): test giới hạn 2 pass, và đúng 2 dòng được ghi.
- **Xếp hạng thuần** (`apps/server/src/operator/improvementRanking.ts`, mới, không truy cập DB):
  - `scoreImprovement` = `weight × impact ÷ effort`, với effort S=1, M=2, L=3. Effort null hoặc không rõ được tính là 1.
  - `rankImprovements`: điểm giảm dần, hòa thì `updatedAt` mới hơn trước, rồi `id` nhỏ hơn trước.
  - `selectWeeklyDigest`: lấy tối đa 3 dòng `open` xếp hạng cao nhất. **Chưa được gắn vào digest nào.**

## Thay đổi hành vi so với 074c-1 (cần biết khi review)

- Gộp áp dụng cho mọi trạng thái chưa kết thúc (`open`, `accepted`, `in_progress`), theo danh sách trạng thái trong `docs/cursor/TASK-074.md` (dòng 226). Trước đó chỉ gộp `open`: một đề xuất đã được duyệt hoặc đang làm mà bị đề xuất lại sẽ tạo dòng mới và tốn ngân sách. Lỗi này được advisor phát hiện; đã có test đỏ trước khi sửa.
- Đề xuất lại vào dòng `done`, `verified`, `failed_verification` hoặc `rejected` vẫn tạo dòng mới và tốn ngân sách. Đây là lựa chọn có chủ đích, xem giả định 4.
- `selectWeeklyDigest` vẫn chỉ lấy dòng `open`.
- Giới hạn trước đây đếm **mọi trạng thái** trong **cửa sổ 24 giờ** theo `created_at`. Nay đếm **chỉ yêu cầu mới** trong **ngày lịch theo múi giờ Asia/Ho_Chi_Minh** (đúng cách bộ đếm ngân sách tính ngày). Cửa sổ trượt 24 giờ đã bỏ.
- Dòng sao chép từ bảng cũ **không tính** vào giới hạn (test `does not count copied legacy rows against the new-request budget`). Đây là đảo ngược so với test 074c-1 cũ, đã viết lại.
- Thông báo 429 đổi từ "trong 24 giờ" thành "trong ngày".
- Bộ đếm `improvementRequests` chỉ có một người gọi là `toolProposals.ts`. Các bộ đếm khác (`skillDrafts`, `behaviourEvals`, `llmCalls`, `webFetches`) là bộ đếm riêng, không dùng chung. Nên đề xuất công cụ không chiếm phần ngân sách của nghiên cứu hay bản nháp skill.

## Giả định (cần reviewer độc lập xem xét; bước này chưa được review)

1. **`expectedImpact` không có số.** Spec §5 định nghĩa nó là `{ metric, direction, note }`, không có trường số. Hệ số impact vì vậy luôn là 1 và không được đọc khi chấm điểm. Spec không có ánh xạ sang số, nên không tự đặt. Khi spec định nghĩa, sửa `scoreImprovement`.
2. **Effort null hoặc không rõ = 1** (ngang S). Spec không nói rõ trường hợp này.
3. **Không có digest tuần cho cải tiến.** Đã kiểm lại không dùng `head`:
   - `apps/server/src/operator/autopilot.ts:472` có `buildDigest`. Đây là digest **theo ngày**, đọc `operator_requests` (bảng yêu cầu của operator, không phải `improvement_requests`). Route `/api/operator/digest` ở `apps/server/src/api/autonomy.ts:124`.
   - `apps/server/src/operator/digestLine.ts` là dòng tóm tắt của operator.
   - Không có digest nào đọc `improvement_requests`. Không sửa `digestLine.ts` hay `buildDigest`. `selectWeeklyDigest` để sẵn, chờ quyết định nối vào đâu.
4. **Đề xuất lại một fingerprint đã có dòng cũ** (quy tắc gộp):
   - Gộp: `open`, `accepted`, `in_progress`.
   - Mở dòng mới và tốn 1 đơn vị ngân sách: `rejected`, `done`, `verified`, `failed_verification`.
   - `failed_verification` là điểm reviewer cần quyết định: có nên gộp không (một đề xuất đã thử và thất bại vẫn đang là nhu cầu chưa được đáp ứng), hay mở dòng mới (coi như đã đóng). Bước này chọn mở dòng mới cho nhất quán với `done` và `verified`.
5. **Ngân sách theo workspace, còn bảng và fingerprint là toàn cục.** Bộ đếm được khóa theo `selfImprovement.<workspace>.used.<ngày>`, nhưng dòng và dedupe không theo workspace. Ghi nhận, không chặn bước này.

## Chưa làm (mở, cần quyết định)

- **Pre-check `find_tools` / `find_skills`:** **đã làm** sau báo cáo này, xem mục "Cổng pre-check" bên dưới. Việc tạo bản nháp skill khi `find_skills` có kết quả (spec §4) vẫn chưa làm; cổng chỉ chặn đề xuất, không tạo bản nháp.
- **Gắn `selectWeeklyDigest` vào digest tuần:** chưa có digest tuần cho cải tiến (xem giả định 3).
- **Ánh xạ `expectedImpact` sang số:** chờ spec (xem giả định 1).
- **Đổi tên biến `open` thành `active`** trong `recordToolProposal` (giờ giữ cả dòng `accepted` và `in_progress`): chưa làm. Chỉ đổi tên, không đổi hành vi; làm khi có lượt sửa tiếp theo.
- **Caller nhận `duplicate`:** đã kiểm, `assistant/tools.ts` trả nguyên object `{status, id, name}`, không có chữ hiển thị cho người dùng. Không cần đổi text.
- **Tự hiệu chỉnh hạn mức 074c-5, `openSource` 074c-3, bản nháp guide 074c-4:** không thuộc bước này.

## Kiểm đã làm

- **Đỏ trước** (trước khi có code):
  - `improvementRequests.test.ts`: 5 test lỗi, đúng lý do. Merge không cộng `weight` (`expected 1 to be 2`). Evidence không tăng. Giới hạn vẫn đếm hàng cứng (test bản sao legacy lỗi `Đã đạt giới hạn`). Test ngân sách bằng 2 không ném 429 (`expected undefined to match`).
  - `improvementRanking.test.ts`: lỗi `Cannot find module '../src/operator/improvementRanking.js'`.
- **Đỏ thêm cho merge vào trạng thái chưa kết thúc:** test `merges a repeat into an accepted or in-progress request` chạy trước khi đổi SELECT: lỗi `AppError: Đã đạt giới hạn đề xuất công cụ trong ngày.` (lần gộp không được nhận ra, rơi xuống kiểm ngân sách). Sau khi đổi SELECT: xanh.
- **Sau khi có code:**
  - `improvementRequests.test.ts` 13/13 (7 test không đổi, 1 test 074c-1 đã viết lại, 5 test mới: 4 về merge và ngân sách, 1 về merge vào `accepted`/`in_progress`).
  - `improvementRanking.test.ts` 8/8 (điểm, xếp hạng, digest tối đa 3, bỏ `rejected` và `done`).
  - `registry.test.ts` (test cũ, không sửa): xanh.
  - Ba file: **38/38 xanh** (`improvementRequests` 13, `improvementRanking` 8, `registry` 17).
- **`npx tsc -p tsconfig.json --noEmit`** ở `apps/server`: exit 0.
- **`npx drizzle-kit generate --name checkonly074c2`**: `No schema changes, nothing to migrate`. Không có file mới.
- **Full suite `apps/server`:** xem mục dưới.

## Kết quả full suite `apps/server`

Hai lần chạy: một trước và một sau khi sửa gộp sang `accepted` và `in_progress`.

- **Lần 1** (trước khi sửa gộp; `scratchpad\full-server-074c2.txt`): `Test Files 1 failed | 271 passed | 4 skipped (276)`; `Tests 1 failed | 2193 passed | 8 skipped (2202)`. Lỗi duy nhất: `preview.test.ts` > "uses the selection basis when TIMELINE is not DONE", timeout 5000 ms khi chờ WS endpoint của Chrome (`src/preview/shotRenderer.ts:178`). Chạy riêng `preview.test.ts`: 45/45 xanh. Coi là flake do tải, chưa tìm được nguyên nhân gốc.
- **Lần chạy lại** (sau khi sửa; `scratchpad\full-server-074c2-rerun.txt`): `Test Files 270 passed | 4 skipped (274)`; `Tests 2192 passed | 8 skipped (2200)`; `EXIT=1`. Không có assertion nào đỏ, nhưng có `2 errors`: hai file `test/task145HoldFloor.test.ts` và `test/task145OldScriptRender.test.ts` không khởi động được worker (`Timeout waiting for worker to respond`), nên không chạy. `preview.test.ts` không đỏ trong lần này.
- **Chạy riêng hai file bị lỗi khởi động:** `Test Files 2 passed (2)`, `Tests 3 passed (3)`, `EXIT=0`.
- **Tổng hợp (ghép, không phải một lần chạy sạch):** 272 file đạt + 4 bỏ qua (276); 2195 test đạt + 8 bỏ qua (2203). Đây là ghép của lần chạy lại và lần chạy riêng hai file, khớp số kỳ vọng. Sau sửa gộp chỉ có một lần chạy full suite, và nó kết thúc `EXIT=1`. Lỗi khởi động worker là lỗi môi trường khi tải cao, không phải lỗi assertion. Lần chạy full suite cuối cùng vẫn có `EXIT=1` vì lỗi khởi động worker, nên không gọi là "full suite xanh sạch".

## Cổng pre-check `find_tools` / `find_skills` (thêm sau báo cáo trên)

Chi tiết và giới hạn: `docs/tasks/TASK-074c-2.review.md`, mục "Quyết định hiện tại".

- `propose_missing_tool` bị từ chối trước khi chạy `execute` (`apps/server/src/registry/invoke.ts:73-77`) cho đến khi `find_tools` và `find_skills` đều đã chạy trong cùng `runId` operator. Trả `kind: "refused"`, không ném lỗi. Audit `reason = "ROUTE_CHECK_REQUIRED"`, không ghi dòng đề xuất, không tốn ngân sách.
- Trạng thái trong `apps/server/src/operator/proposalGate.ts`, bộ nhớ, theo `runId`, tối đa 500 lượt (LRU). Khởi động lại server xóa trạng thái.
- Ghi check trong `apps/server/src/assistant/tools.ts` chỉ sau khi hook trả về.
- Tên và tham số của `propose_missing_tool` không đổi.
- **Đỏ trước:** lần chạy đầu, 3 test đỏ và 3 test xanh. Ba test xanh là các trường hợp cho qua có chủ đích (không có `runId`, hook null, `turnId` không là khóa).
- **Đột biến:** đưa `recordRouteCheck` lên trước lời gọi hook trong `find_tools` làm test "records a %s check only after its hook returns" đỏ (`find_tools` và `find_skills`). Đã hoàn tác; xanh lại.
- **Kiểm sau cùng:** focused 51/51 trên 4 file (`proposalGate`, `operator`, `registry`, `agentSkillPack`); `apps/mcp` 65/65; `apps/server` tsc exit 0; full suite `apps/server` 278 file đạt, 2247 test đạt (8 bỏ qua) chạy trước khi thêm case `find_skills` vào test ném lỗi.
- **Phạm vi:** được cổng: operator trong app và Cursor operator qua MCP có token hợp lệ. Không được cổng: chat, MCP không token, `qualityRepair.ts` (không gọi `propose_missing_tool`).
- Không commit, push, `.done`.

## Sửa thêm (fix2): dòng `open` hỏng nuốt lần lặp

- Lỗi: dòng `open` có `proposal` không parse hoặc không qua schema vẫn khớp điều kiện gộp (SQL theo fingerprint), nên lần lặp hợp lệ bị gộp vào và không bao giờ hiện trong danh sách.
- Sửa: `recordToolProposal` đọc thêm `status` và `proposal` khi tìm dòng chưa kết thúc. Nếu dòng là `open` và `proposal` hỏng, lần lặp hợp lệ cộng `weight`, thêm evidence và ghi đè `proposal`, `problem`, `acceptance` bằng đề xuất mới. Giữ nguyên id, không tốn ngân sách, trả `duplicate`. Dòng `accepted`, `in_progress` hoặc dòng có `proposal` đọc được không đổi.
- Test đỏ trước: `improvementRequests.test.ts`, `it.each` hai dạng (`{not json`, thiếu trường). Đỏ ở dòng `listToolProposals` (`expected [] to deeply equal ['swallow_tool']`). Sau khi sửa, thêm kiểm tra: `duplicate` đúng id, 1 dòng, `weight` = 2, `used.improvementRequests` = 0.
- Test bảo vệ: lần lặp khác `operation` trên dòng khỏe không đổi `proposal` (xanh cả trước và sau sửa, để chặn sửa lan sang dòng khỏe).
- `weight` không giới hạn: đã kiểm, ngoài test không có đường đọc nào (`rankImprovements`, `selectWeeklyDigest`, `scoreImprovement`). Ghi là giới hạn đã biết, quyết định khi gắn digest.
- Kiểm sau sửa: `improvementRequests`, `improvementRanking`, `proposalGate`, `selfImprovementBudget` 40/40; `operator.test.ts` và `registry.test.ts` 36/36; `tsc --noEmit` exit 0.
- Còn mở: dòng `open` hỏng không bao giờ được lặp lại vẫn ẩn; dòng `accepted`/`in_progress` hỏng không được sửa.
- Full suite `apps/server` sau fix2 (chạy 2026-11-20 15:00, cùng lần chạy ghi trong TASK-074c-3 report): **279 file đạt, 4 bỏ qua (283); 2265 test đạt, 8 bỏ qua (2273); 0 lỗi; EXIT 0.** Lần chạy này bao gồm mọi thay đổi fix2 và 074c-3. Khác với số 278/2247 ghi ở trên: lần đó chạy trước khi thêm case `find_skills`, nên số này là số đúng cho trạng thái hiện tại.

## File đã đổi

- `apps/server/src/operator/toolProposals.ts` (gộp, ngân sách, import `consumeSelfImprovementBudget`, `mergeEvidence`; fix2: sửa dòng `open` hỏng tại chỗ)
- `apps/server/test/improvementRequests.test.ts` (fix2: thêm `it.each` hai dạng và test bảo vệ dòng khỏe)
- `apps/server/src/operator/improvementRanking.ts` (mới)
- `apps/server/test/improvementRequests.test.ts` (sửa 1 test, thêm 5 test, thêm import)
- `apps/server/test/improvementRanking.test.ts` (mới, 8 test)
- `docs/tasks/TASK-074c-2.report.md` (file này)
- Cổng pre-check: `apps/server/src/operator/proposalGate.ts` (mới), `apps/server/src/registry/invoke.ts`, `apps/server/src/assistant/tools.ts` (`find_tools`, `find_skills`, mô tả `propose_missing_tool`), `apps/server/src/operator/handbook.ts`, `apps/server/src/operator/modelRuntime.ts`, `apps/server/test/proposalGate.test.ts` (mới), `apps/server/test/operator.test.ts` (test HTTP mới), `.agents/skills/video-xu-ly-su-co/SKILL.md`
