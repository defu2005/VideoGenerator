# TASK-074c-2 — review (chỉ đọc, 2026-11-20)

**Phạm vi:** `docs/tasks/TASK-074c-2.report.md`; `docs/cursor/TASK-074c.md` (mục 074c-2, dòng 55-59); `apps/server/src/operator/toolProposals.ts` (`recordToolProposal`, `mergeEvidence`); `apps/server/src/operator/improvementRanking.ts`; `apps/server/test/improvementRequests.test.ts` (13 `it(`); `apps/server/test/improvementRanking.test.ts` (8 `it(`); `apps/server/src/operator/autonomyBudget.ts` (khóa ngày); `apps/server/src/assistant/tools.ts:1940-1950` (người gọi `propose_missing_tool`); `docs/cursor/TASK-074.md` dòng 226.
**Không sửa code.** Không có `.done`. Không commit. Xếp chồng trên 074c-1 (`TASK-074c-1.review.md`).

**Kết luận:** chấp nhận có điều kiện. Đường gộp và đường ngân sách làm đúng như guide (dòng 55-58: gộp ở dòng 56, budget ở dòng 58) và báo cáo mô tả. (Cập nhật 2026-11-20: số dòng đã dịch xuống một dòng sau khi thêm ghi chú advisor ở dòng 57 của `TASK-074c.md`; pre-check nằm ở dòng 60.) Ba điều kiện trước khi gắn digest hoặc bật bất kỳ thứ gì đọc `weight`: (1) quyết định về việc cộng `weight` không giới hạn; (2) bước `find_tools`/`find_skills` mà guide yêu cầu chưa có; (3) thiếu test cho việc tạo dòng mới sau `done`, `verified`, `failed_verification`.

> **Cập nhật 2026-11-20 (fix1, sau review):** điều kiện (3) đã có test khóa: `improvementRequests.test.ts`, "does not merge into done, verified, failed_verification or rejected rows". Đã chạy đỏ khi thêm `done` vào tập gộp, rồi khôi phục. Điều kiện (1) và (2) vẫn mở. Chi tiết ở [fix1 report](TASK-074c-1.fix1.report.md).

## Đã kiểm bằng đọc mã

- Thứ tự trong `recordToolProposal` (`toolProposals.ts:55-80`): kiểm `registry` → kiểm dữ liệu nhạy cảm và giới hạn 12 000 ký tự → transaction `immediate`: tìm dòng chưa kết thúc (`open`, `accepted`, `in_progress`) → nếu có thì `weight + 1` và gộp evidence, không gọi budget → nếu không thì `consumeSelfImprovementBudget` → chèn dòng. Lỗi budget được đổi thành 429 `TOOL_PROPOSAL_LIMIT`. Đúng như báo cáo.
- `mergeEvidence` (`toolProposals.ts:35-44`): thêm một mục, giữ 10 mục cuối (`slice(-10)`), evidence không phải mảng thì thay bằng mảng mới. Đúng như guide và test (`:141`, `:149`).
- Khóa ngày của budget dùng `localDateString(now, "Asia/Ho_Chi_Minh")` (`autonomyBudget.ts:33`, `:87`). Đúng với báo cáo.
- `scoreImprovement` (`improvementRanking.ts:19-22`): `weight / effort`, effort null hoặc lạ = 1. Impact không được đọc. Khác với guide (`weight × expectedImpact ÷ effort`), báo cáo đã ghi là giả định vì `expectedImpact` không có trường số.
- `rankImprovements` (`:25-29`): giảm dần theo điểm, hòa thì `updatedAt` mới hơn, rồi `id`. Đúng.
- `selectWeeklyDigest` (`:34-36`): lọc `open`, cắt 3. Đúng, và chưa được gọi ở đâu.
- Danh sách trạng thái trong `TASK-074.md:226` liệt kê bảy trạng thái và không nói gì về việc gộp. Việc coi ba trạng thái chưa kết thúc là quyết định của báo cáo, không phải của spec.
- Người gọi duy nhất của `recordToolProposal` là `propose_missing_tool` (`assistant/tools.ts:1947`). Không có bước kiểm tra trùng hay giới hạn tần suất nào phía trên nó.

## Phát hiện

1. **(trung bình, thiết kế, đã có trong spec) Cộng `weight` không giới hạn tần suất.** Guide dòng 56 yêu cầu "cùng fingerprint thì cộng evidence và weight", nên việc cộng là đúng theo spec. Nhưng không có chỗ nào chặn một nguồn lặp lại tự tăng `weight`: mỗi lần gọi `propose_missing_tool` với cùng `kind` và `name` là +1, không tốn budget, và `weight` là đầu vào của `scoreImprovement`. Guide cũng không nói rõ có nên đếm lần lặp từ cùng một ngữ cảnh hay không. **Quyết định cần có:** (a) chỉ cộng khi `reproduction` khác mục evidence gần nhất; (b) trần số lần cộng mỗi ngày, đếm bằng bộ đếm riêng; hoặc (c) giữ nguyên và ghi là chấp nhận rủi ro. Đây là lỗ hổng của spec chứ không phải lỗi cài đặt. Đã đọc handler (`assistant/tools.ts:1945-1950`): không có trần hay chống trùng nào phía trên `recordToolProposal`. **Quyết định của advisor (mục cuối):** không đổi code; thêm dòng vào `docs/cursor/TASK-074c.md` nói rằng phải quyết định trần hoặc quy tắc evidence khác nhau trước khi bất kỳ thứ gì đọc `weight` (digest). Có bổ sung: một yêu cầu đã `rejected` nằm ngoài tập gộp (`toolProposals.ts:57`), nên người dùng từ chối rồi thì lần gọi sau mở dòng mới. Guide dòng 23 của 074c chỉ chống trùng khi còn `pending`, nên đây không phải hồi quy; ghi nhận, không sửa.
2. **(trung bình, thiếu theo guide) Pre-check `find_tools`/`find_skills` chỉ có ở mức lời nhắc.** Guide dòng 60 yêu cầu chạy `find_tools` và `find_skills` trước khi đề xuất `tool`, và nếu có skill làm được việc thì tạo bản nháp skill thay vì yêu cầu. Đã đọc handler `propose_missing_tool` (`assistant/tools.ts:1940-1951`): nó gọi thẳng `recordToolProposal`, không gọi `find_tools` hay `find_skills`. Có hai lớp khác: (a) lời nhắc trong prompt, `handbook.ts:110` và `modelRuntime.ts:51`; (b) kiểm tra tên khớp đúng trong `recordToolProposal` (`toolProposals.ts:49`, so với khóa của `ASSISTANT_TOOLS`), trả về `existing_tool`. Không có bước `find_skills` nào trên đường đề xuất. Không có kiểm tra ép buộc nào trong code. Báo cáo 074c-2 cần ghi đúng như vậy. **Quyết định của advisor (xem mục cuối):** không đổi code ở bước này.
3. **(thấp, thiếu test) Tài liệu test chỉ phủ một phần vòng đời.** 13 test của `improvementRequests.test.ts` là số đúng với báo cáo. Các test đã phủ: gộp khi `open` (`:131`), giới hạn 10 evidence (`:141`), evidence không phải mảng (`:149`), giới hạn budget và gộp không tốn budget (`:159`), gộp khi `accepted` và `in_progress` (`:177`). **Chưa có test nào** cho việc tạo dòng mới sau `done`, `verified`, `failed_verification`. Đây là hành vi thiết kế đã cố ý, nên cần test khóa lại. Chỉ kiểm được bằng việc đọc: câu SQL có `status IN ('open', 'accepted', 'in_progress')`, nên ba trạng thái kia không gộp.
4. **(thấp) Phạm vi fingerprint so với budget.** Fingerprint là `tool:<kind>:<name>`, không có `operation`. Hai đề xuất cùng `name` và `kind` gộp vào một dòng dù mô tả khác nhau. `internal` và `external_mcp` cùng tên thì thành hai dòng (có test ở `:70`). Budget là toàn cục theo ngày, không theo fingerprint, khớp với guide "10 yêu cầu mới/ngày". Hệ quả: dòng gộp giữ nguyên `proposal` của lần đầu, chỉ `evidence` được cập nhật, nên mô tả hiển thị có thể lệch với lần lặp gần nhất. Ghi nhận, không sửa.
5. **(thấp) Impact bằng 1 cho mọi dòng.** Ranking chỉ là `weight / effort`. Đã ghi trong giả định của báo cáo. Ghi nhận.
6. **(quyết định mở) `failed_verification` mở dòng mới và tốn budget.** Báo cáo đã nêu đây là điểm reviewer cần quyết định. Lý do có thể gộp: nhu cầu chưa được đáp ứng. Lý do mở dòng mới: nhất quán với `done` và `verified`, và hợp với việc tạo lại sau khi thất bại. Không tự quyết ở đây.
7. **(xác minh) Full suite đã xanh.** Chạy `npx vitest run` trong `apps/server` (2026-11-20, log `scratchpad/server-full.log`): 277 file đạt, 4 file skip; 2234 test đạt, 8 skip; `EXIT=0`, 412 s. Không có lỗi `SKILL_EVAL_FAILED` hay worker khởi động lỗi lần này.
   - (Cập nhật 2026-11-20, sau fix1.) Lần chạy đầu sau fix1 (`scratchpad/server-full-fix1.log`, bắt đầu trước khi nối logger): 2236 test đạt, 1 lỗi, `EXIT=1`. Lỗi là SSE timeout trong `agentEventsSse.test.ts`; chạy riêng file đó thì đạt. Lần chạy sạch trên code cuối (`scratchpad/server-full-fix1-rerun.log`) đã có; kết quả ở dòng dưới.
   - (Cập nhật 2026-11-20, lần chạy sạch.) `scratchpad/server-full-fix1-rerun.log`: 277 file đạt, 2237 test đạt, 8 skip, `EXIT=0`. Xanh trở lại trên code cuối.
8. **(ghi nhận) Số test khớp.** `improvementRequests.test.ts` có 13 `it(`, `improvementRanking.test.ts` có 8 `it(`. Báo cáo ghi đúng. (Cập nhật 2026-11-20: sau fix1 file có 16 `it(`, gồm 3 test thêm của 074c-1 fix1.)

## Chưa kiểm trong lần đọc này

- (Cập nhật 2026-11-20) Lần đọc đầu chỉ thấy dòng gọi `recordToolProposal`. Handler `propose_missing_tool` (`assistant/tools.ts:1940-1951`) đã được đọc đầy đủ trong phiên trước: không có lời gọi `find_tools` hay `find_skills`, nên điểm 2 đúng như đã viết.
- (Cập nhật 2026-11-20) Test đã chạy lại: `improvementRequests.test.ts` 16 test và `improvementRanking.test.ts` 8 test, đạt cả 24.

## Quyết định do advisor đưa ra (thay người dùng, có thể đảo)

Theo mục tiêu người dùng đặt: "mọi thứ cần tôi quyết định thì để advisor quyết định thay". Người dùng có thể đảo lại bất kỳ quyết định nào dưới đây.

- Điểm 1 (cộng `weight` không giới hạn): không đổi code. Thêm dòng vào `docs/cursor/TASK-074c.md`: phải quyết định trần hoặc quy tắc evidence khác nhau trước khi digest đọc `weight`.
- Điểm 2 (pre-check): không đổi code ở bước này. Báo cáo ghi đúng: chỉ có lời nhắc và kiểm tra tên khớp đúng.
- Điểm 6 (`failed_verification` mở dòng mới và tốn budget): giữ như hiện tại, giống `done` và `verified`.
- Điểm 7 (full suite): đã xanh, xem trên.

## Việc tiếp theo đề xuất

Quyết định điểm 1 và điểm 6 trước khi gắn digest hoặc bật bất kỳ thứ gì đọc `weight`. Điểm 2 là việc còn thiếu của 074c-2 nếu muốn đạt đúng guide. Điểm 3 cần một test khóa lại hành vi trạng thái kết thúc.

(Cập nhật 2026-11-20: điểm 3 đã có test khóa (fix1). Điểm 1 và 6 đã được ghi là quyết định của advisor ở mục trên, có thể đảo. Việc còn lại là điểm 2: code kiểm `find_tools`/`find_skills` trước khi đề xuất.)

**Orientation điểm 2 (chỉ đọc, 2026-11-20, không viết code):**
- Tập ứng viên của `find_tools` (`operator/service.ts:1488`, `getToolCatalogForPrompt()`) và khóa của `ASSISTANT_TOOLS` đều lấy từ cùng mảng `toolDefs` (`assistant/tools.ts:337`, `:2141`). Hai tập trùng nhau, không có lọc theo quyền.
- Không có ngưỡng cắt trong `routeQuery` (`operator/routing.ts:177`): luôn trả về tối đa 3 kết quả, kể cả điểm thấp. Trọng số (`routing.ts:6-11`): BM25 0.45, trigger 0.25, lịch sử 0.15, khu vực 0.15. BM25 chia cho điểm lớn nhất, nên kết quả đứng đầu luôn được 0.45 khi có một token trùng.
- Hệ quả: với ngưỡng 0.35 của `shouldProposeSkill` (`operator/skills.ts:360`), chỉ một token trùng đã đạt khoảng 0.525 (0.45 + nền lịch sử 0.075). Vì vậy **không tái sử dụng 0.35** cho pre-check. Cần ngưỡng khác, dựa trên trigger hoặc BM25 chưa chuẩn hóa.
- Không có bảng ghi lời gọi công cụ theo run. Lời gọi công cụ của trợ lý được lưu trong `assistant_messages` với `role = 'tool'` (`assistant/service.ts:326`), theo cuộc hội thoại, nội dung là chuỗi `[tên] ...`. Không dùng được trực tiếp để biết "đã gọi `find_tools` trong cùng run" nếu không tự suy từ chuỗi.
- "Bản nháp skill" trong guide (`TASK-074.md` §4.1) là bản nháp trong DB qua `saveSkillDraft` (`operator/skillVersions.ts`), có giới hạn 3 bản nháp/ngày. Đường `notes/skill-proposals` (`service.ts:1586`) là ghi chú đề xuất, không phải bản nháp.
- `modelRuntime.ts:41-42`: khi có `eventScope`, danh sách công cụ mà operator thấy bị lọc còn `get_project` và `get_pipeline`. Nên `existing_tool` có thể trỏ đến công cụ mà operator không gọi được trong phạm vi đó.

**Quyết định của advisor (có thể đảo, ghi ở đây):**
- Phạm vi: chỉ `tool`. `feature` và `data_source` chưa có đường tạo (đã kiểm: chỉ `recordToolProposal` ghi `improvement_requests`).
- Khi hook của operator là null: giữ hành vi hiện tại, cho đề xuất đi qua; không chặn.
- Bullet cũ ở trên ("chưa viết code, nghiêng B") đã bị thay bởi mục **Quyết định hiện tại** ở cuối.

**Bổ sung orientation (2026-11-20, theo advisor, chỉ đọc):**
- Guide 074c dòng 60: "Trước khi đề xuất `tool`/`feature`/`data_source`, chạy `find_tools` và `find_skills`. Nếu có skill làm được việc thì tạo bản nháp skill, không tạo yêu cầu." Câu này nói "chạy trước khi đề xuất". Cổng quy trình (kiểm hai lời gọi đã chạy trong cùng run) thỏa mãn nghĩa đen; không cần ngưỡng điểm. Đây không phải "B hay A": đã bỏ cách hiểu cũ "không khớp công cụ nào".
- `operator_routing_log` (`service.ts:1559`) có cột `run_id`, nhưng chỉ đường `suggestion` (`service.ts:1412`) truyền `runId`. `findSkills` (`:627`) và `findTools` (`:648`) ghi `run_id = NULL`. Không dùng bảng này để kiểm lời gọi theo run.
- `find_skills` (`assistant/tools.ts:1679`) truyền `ctx.runId ?? ctx.turnId` vào `findSkills`, và `recordShadow` ghi dòng shadow theo run. `find_tools` không ghi gì theo run.
- Guide §4.1 (`docs/cursor/TASK-074.md:154`): bản nháp do một lời gọi LLM riêng (nhãn `OPERATOR_SKILL`) tạo từ bằng chứng. Hiện không có code nào ghi `improvement_requests` hay gọi `recordToolProposal` từ luồng bản nháp. Khi luồng đó được viết, phải gọi `recordToolProposal` trực tiếp, không đi qua handler đã gated.
- `propose_missing_tool` (`assistant/tools.ts:1940`) là đường duy nhất gọi `recordToolProposal` từ trợ lý. Đường MCP: `/api/registry/invoke` (`api/registry.ts`) → `invokeRegistryTool` (`registry/invoke.ts:44`), tra `ASSISTANT_TOOLS[name]`. Đã kiểm tra tra cứu; chưa kiểm tra dòng gọi `execute` trong nhánh đó. Operator chạy qua cùng đường. *(Đã thay thế bởi mục "Quyết định hiện tại" bên dưới: cổng nằm trước `execute` ở `registry/invoke.ts:73-77`.)*
- Đo (tạm thời, đã xóa file test; số liệu thô ở `scratchpad/routing-measure.jsonl`):
  - Tập ứng viên: 209 tool + 16 skill. Skill lấy từ `OPERATOR_SKILLS`, không phải `skillCandidates()`; các trường skill được đoán, chưa đối chiếu.
  - Nhóm "đã có" 5 câu và "chưa có" 6 câu do tôi tự đặt; chưa có nhãn đúng/sai thật. Chỉ xét hit đứng đầu.
  - BM25 chuẩn hóa theo max nên bằng 1.0 ở hầu hết câu, kể cả khớp sai (ví dụ "Cần gửi tin nhắn Zalo cho khách hàng" khớp `agent_ack`, total 0.525). Trigger khớp một câu; area khớp một câu. Không có khoảng tách giữa hai nhóm.
  - 4/5 câu "đã có" trả về tool không liên quan đứng đầu (ví dụ "hàng đợi render" → `get_account_health`). Chưa điều tra; không ảnh hưởng quyết định vì không dùng điểm để chặn.
- Bảng 11 dòng đo (nguyên văn từ jsonl; dòng đầu là kích thước tập ứng viên):

```
{"skillCount":16,"toolCount":209,"skillSample":["research-knowledge-refresh","research-change-event","research-market"]}
{"group":"covered","q":"Cần xem trạng thái hàng đợi render video","top":"get_account_health","b":{"bm25":1,"trigger":0,"history":0.5,"area":0,"anti":0,"total":0.525}}
{"group":"covered","q":"Cần đăng video lên kênh YouTube","top":"publish-project","b":{"bm25":0.6550043396113879,"trigger":1,"history":0.5,"area":0,"anti":0,"total":0.6197519528251245}}
{"group":"covered","q":"Cần tạo kịch bản video từ một chủ đề","top":"propose_skill","b":{"bm25":1,"trigger":0,"history":0.5,"area":0,"anti":0,"total":0.525}}
{"group":"covered","q":"Cần lấy danh sách dự án hiện có","top":"intel_next_research_batch","b":{"bm25":1,"trigger":0,"history":0.5,"area":1,"anti":0,"total":0.675}}
{"group":"covered","q":"Cần kiểm tra số dư ngân sách còn lại","top":"run_research","b":{"bm25":1,"trigger":0,"history":0.5,"area":0,"anti":0,"total":0.525}}
{"group":"uncovered","q":"Cần gửi tin nhắn Zalo cho khách hàng","top":"agent_ack","b":{"bm25":1,"trigger":0,"history":0.5,"area":0,"anti":0,"total":0.525}}
{"group":"uncovered","q":"Cần đặt lịch livestream trên Facebook","top":"get_llm_health","b":{"bm25":1,"trigger":0,"history":0.5,"area":0,"anti":0,"total":0.525}}
{"group":"uncovered","q":"Cần tải báo cáo doanh thu từ Shopee","top":"monthly_report","b":{"bm25":1,"trigger":0,"history":0.5,"area":0,"anti":0,"total":0.525}}
{"group":"uncovered","q":"Cần đồng bộ lịch với Google Calendar","top":"publish_calendar","b":{"bm25":1,"trigger":0,"history":0.5,"area":0,"anti":0,"total":0.525}}
{"group":"uncovered","q":"Cần dịch phụ đề sang tiếng Nhật bằng DeepL","top":"make_translation","b":{"bm25":1,"trigger":0,"history":0.5,"area":0,"anti":0,"total":0.525}}
{"group":"uncovered","q":"Cần gửi tin nhắn SMS nhắc lịch hẹn","top":"agent_ack","b":{"bm25":1,"trigger":0,"history":0.5,"area":0,"anti":0,"total":0.525}}
```

**Quyết định hiện tại (advisor, 2026-11-20, có thể đảo; cổng đã được xây và có test):**
- Không chặn theo điểm. Lý do: `routing.ts:132-134` cho hit đứng đầu `bm25 = 1` khi có bất kỳ token nào khớp, và `history` mặc định 0.5, nên mọi hit đứng đầu có total ít nhất 0.525. Điểm không quyết định được gì.
- Cổng quy trình đã xây: `propose_missing_tool` bị từ chối trước khi chạy `execute` (`registry/invoke.ts:73-77`, trả `kind: "refused"`, không ném lỗi nên lượt operator không bị hủy). Mã audit `ROUTE_CHECK_REQUIRED`. Yêu cầu có cả `find_tools` và `find_skills` trong cùng `runId`. Thông báo: "Cần gọi find_skills trong lượt này trước khi đề xuất công cụ." (hoặc cả hai tên khi thiếu cả hai).
- Ghi check: `find_tools` và `find_skills` chỉ ghi sau khi hook trả về (`assistant/tools.ts`, `recordRouteCheck`). Đã kiểm bằng đột biến: đưa ghi lên trước lời gọi hook làm test "records a check only after its hook returns" đỏ; đã hoàn tác và test xanh lại.
- Phạm vi thực tế:
  - Operator trong app (`modelRuntime.ts`) có `runId`: được cổng.
  - Cursor operator qua MCP: có `runId` khi có token hợp lệ (`x-vg-operator-managed` và `x-vg-operator-invocation`, `operator/service.ts:178-183`): được cổng. Có test HTTP `gates propose_missing_tool over HTTP...` trong `test/operator.test.ts`.
  - MCP không có token, và lượt chat (`assistant/service.ts`, `loop.ts` không truyền `runId` vào `runTool`): không được cổng; đề xuất đi qua. Không dùng `turnId` làm khóa vì mỗi lời gọi chat có `turnId` riêng.
  - `qualityRepair.ts:432` gọi `invokeRegistryTool` không có `runId`: không được cổng, nhưng không gọi `propose_missing_tool`.
  - Hook operator là null: đề xuất đi qua, không chặn.
- Giới hạn đã biết:
  - Trạng thái cổng nằm trong bộ nhớ, theo `runId`, LRU tối đa 500 lượt. Khởi động lại server xóa trạng thái, nên phải gọi lại cả hai.
  - Workflow được tiếp tục (`service.ts:472`) có `runId` mới, nên cũng phải gọi lại cả hai.
  - "Không tốn budget" là suy ra từ thứ tự (cổng nằm trước `execute`), chưa có assertion riêng về budget.
  - Quy tắc "trúng skill thì không tạo yêu cầu" không cưỡng chế được vì không có ngưỡng. Chỉ đưa vào hướng dẫn cho mô hình (`handbook.ts:110`, `modelRuntime.ts:51`, `SKILL.md`), không kiểm trong code.
  - Chưa xử lý: dòng `open` hỏng không bao giờ được lặp lại vẫn ẩn (lần lặp đã được sửa ở fix2); `weight` không giới hạn; `feature` và `data_source` chưa có đường tạo; luồng bản nháp §4.1 (`docs/cursor/TASK-074.md`) chưa có.
- Kết quả kiểm: `apps/server` full 278 file pass, 4 skipped, 2247 test pass, 8 skipped (chạy trước khi thêm case `find_skills` vào test ném lỗi; sau đó chạy lại 4 file liên quan: `proposalGate`, `operator`, `registry`, `agentSkillPack`: 51/51 pass). `apps/mcp` 65/65 pass. `tsc --noEmit` exit 0 (sau test cuối).
- Không ghi `runId` vào `operator_routing_log`. Không commit, push hay `.done`.
