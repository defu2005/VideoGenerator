# TASK-074c-5e — thiết kế phần xác minh còn lại của 074c-5 (bản thiết kế)

Trạng thái: thiết kế đã được advisor duyệt có sửa. Lát 5e-1 (`done_at`) đã làm, có test đỏ trước; xem `TASK-074c-5e.report.md`. Chưa commit, chưa push, chưa có `.done`. Không khởi động app. Không ghi vào `data/`, `data-dev/` hoặc `docs/proposals/`. Các đề xuất ở mục 2–5 chưa làm, chờ advisor. Ghi chú 2026-11-21: dòng này là trạng thái cũ. Gạch 1 dừng, gạch 2 dừng, gạch 3 đã làm; xem bảng và `TASK-074c-5e.report.md`.

## Ba gạch đầu mục 074c-5 và trạng thái

Nguồn spec: `docs/cursor/TASK-074c.md:68-71`.

| Gạch của spec | Trạng thái | Bằng chứng |
|---|---|---|
| 1. Khi trạng thái chuyển sang `in_progress` và có `docs/tasks/<TASK>.done` cho task người dùng gắn, đọc các mục `acceptance` kiểm được bằng công cụ đọc | Làm một phần: cổng `.done` và `task_ref` đã có (6e), `done_at` đã có (5e-1). Phần đọc `acceptance` chưa làm. | `checkToolProposalDone` (`apps/server/src/operator/toolProposals.ts`) chỉ kiểm `existsSync(<tên>.done)`, không đọc `acceptance`. Check-done là lệnh người dùng gửi (`apps/server/src/api/operator.ts:143-149`), không tự chạy khi trạng thái đổi. Ghi chú 2026-11-21: `recordAcceptanceResult` và migration 0103 đã có trong cây nhưng chưa có caller (xem 5e-2a-1). |
| 2. So `expectedImpact.metric` sau 14 và 28 ngày với trước đó; kết quả `verified` hoặc `failed_verification` | Chưa làm, và chưa có nguồn dữ liệu | Không có `verified` hay `failed_verification` nào trong `apps/server/src`. `failedVerificationCount` (`schema.ts:1934`) thuộc bảng `two_factor`, không liên quan. |
| 3. Tự hiệu chỉnh: dưới 30% trong 20 yêu cầu gần nhất thì giảm nửa hạn mức, và hiển thị tỉ lệ | Đã làm theo báo cáo 5a–5d | Đọc tiêu đề báo cáo `TASK-074c-5a` đến `5d`: 5a quy tắc, 5b hiển thị, 5c lời từ chối, 5d loại hàng cũ. Chạy lại 2026-11-21: server 3 file 26/26 (`scratchpad/selftune-server-rerun.log`); web `ResearchPage.selfTune.test.tsx` 5/5 (`scratchpad/selftune-web-rerun.log`). Vị trí: `apps/server/src/operator/improvementSelfTune.ts:10` (`SELF_TUNE_WINDOW = 20`), `:32` (`halved = ready && accepted * 10 < 3 * SELF_TUNE_WINDOW`). |

Đã kiểm (5e-2 orientation): giá trị `status` của `improvement_requests` là `open`, `accepted`, `in_progress`, `done`, `rejected` (`toolProposals.ts:60,108,116,129,146,175,181,190,209`). Không có CHECK trên `status` trong `0099_improvement_requests.sql`. Bản sao cũ (`copyLegacyToolProposals`, `toolProposals.ts:244-267`) chỉ ghi `open` hoặc `rejected`, nên không thêm giá trị nào. Các file ghi bảng này (grep `improvementRequests|improvement_requests` trong `apps/server/src`, bỏ hit ngân sách `api/research.ts:18`): `toolProposals.ts` ghi `status` (`:175,181,190,209`; `:97` và `:247` là INSERT), ghi `acceptance` và `proposal` ở đường gộp trùng (`:66`), và `weight` và `evidence` (`:69`); cả hai chỉ khi status là open, accepted hoặc in_progress, không bao giờ với done, và ghi `imp_number` (`:225`). `proposalDraft.ts:82` chỉ ghi `drafted_at`, điều kiện `status = 'accepted'`. `improvementOpenSource.ts:62` chỉ ghi `open_source`, không có điều kiện `status`, không có caller production. Đọc thuần: `improvementSelfTune.ts:18`, `improvementRanking.ts`. `db/migrate.ts` gọi bản sao. Web: chỉ kiểm `acceptance` (`ToolProposals.tsx:18,221`); chưa kiểm giá trị status ở web.

## `expectedImpact`: điều đã xác nhận từ mã

- Cột `expected_impact` là `text` (`schema.ts:1301`, migration `0099_improvement_requests.sql`).
- Spec định nghĩa giá trị là `{ metric, direction, note }` (`docs/cursor/TASK-074.md:222`).
- **Không có chỗ nào ghi cột này.** Các câu INSERT trong `toolProposals.ts` (dòng 98–100 và 247–249) không liệt kê cột đó. Tìm trong `apps/server/src` không có writer nào. Cột luôn là NULL.
- Chỉ `improvementRanking.ts:10` đọc khai báo, và không dùng để chấm điểm (hệ số 1, theo 074c-2).

Kết luận: hiện không có `metric` nào tồn tại. Đây là điều kiện chặn cho gạch 2.

## Đề xuất cần advisor duyệt

1. **Hình dạng dữ liệu.** Giữ cột `expected_impact` là JSON `{ metric, direction, note }`, đúng spec, nên không cần đổi kiểu cột. Đề xuất hàng không có `metric` được đánh dấu `no_metric` khi so sánh, không đếm là `failed_verification`.
2. **Lưu kết quả.** Spec nói kết quả là `verified` hoặc `failed_verification`, nhưng không nói đó là giá trị của `status`. Đề xuất giữ `status = 'done'`, để không ảnh hưởng dedupe, danh sách done và cửa sổ tự hiệu chỉnh. Cột `verification_result` (NULL, `verified`, `failed_verification`, `no_metric`) và `verified_at` sẽ thêm ở lát sau, khi có writer của chúng. (2026-11-21: đã dừng; không có writer nào được lên kế hoạch, xem "Lát 5e-2a-2" và mục "Chưa làm" bên dưới.)
3. **Thời điểm done.** `updated_at` không đáng tin (6g: các lần ghi khác có thể đổi nó). Thêm cột `done_at`, đặt trong `checkToolProposalDone` cùng lúc đặt `status = 'done'`, cùng timestamp với `updated_at`. Kiểm kê các chỗ ghi hàng done: `improvementOpenSource.ts:62` ghi `open_source` không có điều kiện `status`, nên có thể đổi hàng done; nhưng grep trong `apps/server/src` chỉ thấy file đó và test của nó, không có caller production. Vì vậy `done_at` hiện chỉ ghi thời điểm check-done, và không chặn các chỗ ghi khác. Hàng có `done_at` NULL không đưa vào phép tính 14/28 ngày.
4. **Nguồn metric và cửa sổ "trước".** Chưa có bảng số liệu nào cho đề xuất công cụ, và chưa chọn nguồn. Mục này bị chặn cho đến khi có 14 và 28 ngày dữ liệu thật. Test chỉ có thể dùng fixture.
5. **Đọc `acceptance`.** Không đề xuất tập kiểm được cụ thể ở đây. Quyết định nằm ở mục 5e-2 bên dưới: không có tập kiểm được. Người kiểm đã được quyết (2026-11-21: B bị loại, xem "Người kiểm: A hay B"). Mục 5e-2 đã dừng ở thiết kế, xem "Lát 5e-2a-2".

## Lát đầu tiên đề xuất (đi được qua test đỏ, không cần dữ liệu thật) — 2026-11-21: đã làm, là lát 5e-1 (`done_at`); giữ để tham khảo

- **Migration `0102`** (sau `0101_improvement_task_ref.sql`): chỉ thêm `done_at`, nullable. Không áp dụng vào DB thật hay bản sao nào.
- **Đổi `checkToolProposalDone`**: đặt `done_at = now` cùng lần đặt `status = 'done'`.
- **Test đỏ trước** (`apps/server/test/toolProposalDoneAt.test.ts`): sau check-done thành công, `done_at` không null và bằng `updated_at`; check-done bị từ chối (`OPERATOR_TASK_NOT_DONE`) hoặc hàng không ở `in_progress` (`OPERATOR_TOOL_PROPOSAL_NOT_IN_PROGRESS`) thì `done_at` không đổi.

## Chưa làm, và vì sao

- Đọc `acceptance` và so sánh 14/28 ngày: **đã dừng (2026-11-21), không phải chờ.** Lý do: không có writer cho `expected_impact`, nên không có `metric` để so sánh; số lần dùng không phải so sánh theo metric; tên đề xuất không nối được với công cụ đã đăng ký; kiểm `acceptance` tự động chưa có cơ chế (xem "Lát 5e-2a-2").
- Ghi `expected_impact`: chưa có đường ghi, nên chưa có gì để kiểm.
- Không đổi `writeGuard.ts`, không migration vào DB thật, không `.done` thật.

## 5e-2 orientation (chưa duyệt)

Chỉ đọc, không sửa mã và không test đỏ. Đang chờ advisor duyệt.

- **Ghi `acceptance`:** `ToolProposalArgs` (`toolProposals.ts:24`) là `z.array(z.string().trim().min(5).max(300)).min(1).max(6)`. Hai câu INSERT (`toolProposals.ts:100` và `:262`) ghi `JSON.stringify(proposal.acceptance)`. Dòng `:67` cập nhật cột này khi gộp trùng lặp.
- **Đọc `acceptance`:** không có bộ đọc nào cho cột `acceptance` trong server (các hàm list, `toolProposals.ts:106-150`, SELECT cột `proposal`, không SELECT `acceptance`). Có hai bản: cột `acceptance` và `proposal.acceptance` bên trong JSON. Web (`apps/web/src/features/operator/ToolProposals.tsx:18,221`) hiển thị bản trong `proposal`. `apps/mcp/src` không có chữ `acceptance` nào.
- **"Công cụ đọc":** `apps/server/src/auth/toolActions.ts` xếp mỗi tên công cụ vào một nhóm hành động. Các nhóm có hậu tố `.read` là `project.read`, `channel.read`, `analytics.read`, `finance.read`, `settings.read`. Đây là phân loại có sẵn, nên tập kiểm được nên dựa trên nó.
- **Ví dụ `acceptance` thật:** không có. `docs/proposals` không tồn tại. Mọi fixture trong `apps/server/test` dùng cùng một chuỗi: "Trả bản chép lời đúng dự án". Đây là văn xuôi tự do, không phải điều kiện máy kiểm được.
- **Thời điểm kiểm:** `docs/cursor/TASK-074.md:250-253` và `docs/cursor/TASK-074c.md:68-71` cùng mô tả chuyển `in_progress` → `done`. Không mâu thuẫn; hai câu chỉ khác cách nói.

**Quyết định của advisor (chưa duyệt chi tiết, xem 5e-2a):**
- Tập kiểm được: không có. Mọi mục `acceptance` là văn xuôi chỉ được kiểm độ dài (`toolProposals.ts:24`), và không có proposal thật nào. Không đề xuất trường có cấu trúc (`path_exists`, `text_in_file`), vì đó là đổi hợp đồng propose-tool mà spec không yêu cầu.
- Thời điểm: sau khi row đã `done`, trong một lượt riêng. Xem "Lát 5e-2a-2". Không chặn và không hoàn tác `done`. `checkToolProposalDone` giữ nguyên.
- Người kiểm: **B bị loại** (advisor, 2026-11-21; xem "Người kiểm: A hay B"). Lần trước ghi "operator, bằng công cụ `.read`" là giả định chưa kiểm, không còn đúng. Nhập tay không khớp đặc tả kiểm tự động (`docs/cursor/TASK-074c.md:69`); xem "Lát 5e-2a-2".

## 5e-2a: kiểm `acceptance` sau khi done (lát 5e-2a-1 đã duyệt: chỉ lưu trữ)

- **Seam:** `draftProposal` (`proposalDraft.ts:29`) là mẫu: runner được truyền vào, không gọi model trong module. Bước kiểm dùng seam tương tự, một `checker` được truyền vào.
- **Runner thật:** `createProposalRunner` (`proposalRunner.ts:28-45`) là một lần sinh văn bản, không nhận danh sách công cụ. Đã kiểm: không có runner nào nhận danh sách công cụ giới hạn theo hành động. Đường chạy của operator dùng toàn bộ `getToolCatalogForPrompt()`, chỉ lọc theo `eventScope` (`operator/modelRuntime.ts:41-42`). Quyền khi gọi công cụ: chưa kiểm (`registry/invoke.ts:40-79` chỉ có chặn cứng và route check; `can(...)` mới đọc được ở `assistant/service.ts:509`; chưa grep toàn bộ nên chưa kết luận gì về các chỗ khác).
- **Cột đọc:** `proposal.acceptance`, vì đó là bản hiển thị và là bản được list trả về.
- **Kết quả từng mục:** `đạt`, `không đạt`, hoặc `không kiểm được`. Mục không có công cụ đọc phù hợp ghi `không kiểm được`, không bao giờ tự đánh dấu đạt.
- **Nơi lưu:** cột mới (ví dụ `acceptance_result` dạng JSON). Cần migration 0103. Chưa làm.
- **Guard:** chỉ row `status = 'done'`. Không đổi `status`. Ghi có điều kiện `WHERE status = 'done'`.
- **Ngân sách:** giả định cách A: mục văn xuôi cần mô hình, nên lượt kiểm tiêu `llmCalls` trước khi gọi, giống `draftProposal` (`proposalDraft.ts:70`). Với cách B, hàm ghi kết quả không gọi mô hình và không tiêu `llmCalls`. Không có nhánh "chỉ công cụ đọc".
- **Test lưu trữ dự kiến (chưa viết, chờ quyết người kiểm):**
  1. kết quả mỗi mục chỉ là một trong ba giá trị `đạt`, `không đạt`, `không kiểm được`; giá trị khác bị từ chối;
  2. số kết quả bằng số mục trong `proposal.acceptance`;
  3. row có `proposal` không parse được bị từ chối;
  4. chỉ row `status = 'done'` được nhận; `status` không đổi sau khi ghi;
  5. ghi lần hai không ghi đè lần đầu.

## Người kiểm: A hay B (đã quyết: B bị loại, 2026-11-21)

- **Đường chạy operator:** `operator/modelRuntime.ts:41-42` dùng toàn bộ `getToolCatalogForPrompt()`, chỉ lọc theo `eventScope`. Không có danh sách theo hành động.
- **Liệt kê đề xuất:** `listToolProposals` có hai caller. `api/operator.ts:72` là route HTTP. `operator/service.ts:859` nằm trong `learningReport()` (`service.ts:847`), và `learningReport` chỉ được gọi từ `api/operator.ts:95` (`GET /api/operator/learning-report`). Không có công cụ đăng ký nào liệt kê đề xuất. Đoạn 859 chỉ lấy id, name, kind, operation, createdAt, không có `acceptance`. Đây không phải snapshot cho prompt.
- **Đăng ký công cụ:** `api/registry.ts:19-21` (`/api/registry/tools`) và `:23-68` (`/api/registry/invoke`) không lọc theo công cụ. Một công cụ đăng ký mới sẽ đến được MCP qua `apps/mcp/src/apiClient.ts:387,413`, trừ khi có chặn khác. Chưa kiểm chỗ chặn đó.
- **`propose_missing_tool`:** `assistant/tools.ts:1944-1956`, nhóm `settings.write` (`auth/toolActions.ts:57`), route check ở `registry/invoke.ts:73`.
- **Lý do lean A hiện tại:** B đưa công cụ đăng ký mới đến MCP qua `/api/registry/invoke` (`api/registry.ts:23-68`, `apiClient.ts:413`), và chưa đọc được chỗ chặn cho công cụ đó. Đây là lý do nghiêng, chưa phải bằng chứng quyết định.
- **Bằng chứng đã đọc (chỉ đọc):**
  - Quyền khi gọi registry: `registry/invoke.ts:115-124` lấy `TOOL_ACTIONS[name]` rồi gọi `can(actor, action, resource)`. `can` (`auth/policy.ts:83-95`) chỉ kiểm workspace, kênh và vai trò, không kiểm `actor.kind`. Nếu khóa API nhận vai trò owner hoặc admin thì qua được mọi công cụ `settings.write`; chưa kiểm cách khóa API nhận vai trò (chưa xác minh).
  - Route: `routePermissions.ts:177` `POST /api/registry/invoke` có action `null`, nghĩa là không kiểm ở tầng route. `api/registry.ts:30` chỉ chặn công cụ không phải read khi gọi từ operator được quản lý mà thiếu token lượt.
  - Tiền lệ: `propose_missing_tool` (`toolActions.ts:57`, `settings.write`) đến được từ MCP qua `invoke`.
  - `get_agent_context` (`assistant/tools.ts`): các chỗ có chữ "proposal" không đọc đề xuất công cụ (`:1406`, `:1805`, `:1827`, `:1951-1975`). Không có đường đưa đề xuất vào prompt qua công cụ này.
  - `registry/policy.ts:83-91` `hardBlockMessage`: chặn theo tên (`APPROVE_PENDING_TOOLS`), dự án được bảo vệ, và `walkForbidden(args)`. Không kiểm `actor.kind`, nên chặn theo tên áp dụng cho mọi người gọi, kể cả operator. Đây là tiền lệ để giữ một công cụ ra khỏi đường registry hoàn toàn, không phải tiền lệ cho chặn chỉ riêng khóa API.
- **Quyết định (advisor, 2026-11-21): B bị loại.** Lý do: (1) lượt ghi kết quả chỉ một lần (`acceptance_result IS NULL`), nên một lần gọi sai khóa vĩnh viễn; (2) mọi chuyển trạng thái khác của hàng đều chỉ người dùng, B sẽ là lần đầu có actor khác; (3) B cần một chặn theo `actor.kind` mới, không có sẵn, và đó là cơ chế bảo mật mới chứ không phải một lát của task. Kết quả: `recordAcceptanceResult` chỉ gọi trong tiến trình server, sau route chỉ người dùng. Chưa xác minh: khóa API có nhận vai trò owner/admin không.

## 5e-2a-1 (đã duyệt): lưu kết quả kiểm, không route, không đăng ký, không runner

- Migration `0103_acceptance_result`: thêm hai cột nullable `acceptance_result` (text, JSON) và `acceptance_checked_at` (text). Journal hiện có idx 102 là cuối, nên 0103 là kế tiếp. Chỉ kiểm trên `:memory:`.
- Mã kết quả ASCII: `passed`, `failed`, `not_checkable`. Nhãn tiếng Việt thuộc lớp web.
- `recordAcceptanceResult(db, id, results)`: parse `proposal` bằng `ToolProposalArgs`; số kết quả bằng số mục; một UPDATE có điều kiện `kind = 'tool' AND status = 'done' AND acceptance_result IS NULL`; không ghi `status` và `updated_at` (danh sách done sắp xếp theo `updated_at`).
- Test đỏ: chín test trong `apps/server/test/toolProposalAcceptanceResult.test.ts` (ghi đúng, số lượng sai, mã sai, status không done, id lạ, dòng không phải tool, proposal hỏng, ghi lần hai, không đổi cột khác).
- Mutant: bỏ guard status; bỏ guard `IS NULL`; bỏ kiểm tra số lượng; bỏ kiểm tra mã kết quả; bỏ guard `kind = 'tool'`.

**Đã làm (5e-2a-1):** migration `0103_acceptance_result` (hai cột `acceptance_result`, `acceptance_checked_at`, dùng `--> statement-breakpoint`); journal idx 103; snapshot `7c1e5b2a-3f0d-4e8a-9b61-2d4a8f0c5e13`, prevId `44a09d14-…`. Hình dạng `results`: mảng `{ verdict }` đúng thứ tự tiêu chí, từ 1 đến 6 mục. Lỗi: `INVALID_ACCEPTANCE_RESULT` (400), `NOT_FOUND` (404, id không có hoặc không phải tool), `OPERATOR_TOOL_PROPOSAL_UNREADABLE` (409, `proposal` không đọc được), `OPERATOR_ACCEPTANCE_MISMATCH` (409, số lượng khác), `OPERATOR_TOOL_PROPOSAL_NOT_DONE` (409), `OPERATOR_ACCEPTANCE_ALREADY_RECORDED` (409). Guard SQL là nguồn duy nhất; lỗi trạng thái chỉ phân loại sau khi UPDATE không đổi dòng nào. Thứ tự kiểm: input, id, proposal (đọc được), số lượng, rồi guard SQL. Vì vậy một dòng không phải tool có `proposal` không đúng dạng nhận `OPERATOR_TOOL_PROPOSAL_UNREADABLE`, và số lượng sai trên dòng không done nhận `OPERATOR_ACCEPTANCE_MISMATCH`. Id lạ trả `NOT_FOUND`, còn check-done gộp vào lỗi trạng thái; route của lát sau sẽ chọn một quy ước.
**Kết quả:** đỏ 9 test (lỗi assertion); focused 77 pass; mutant M1–M5 mỗi cái đỏ đúng 1 test, bản gốc khôi phục `cmp` giống hệt; tsc exit 0; full server 298 file pass / 4 skip, 2472 test pass / 9 skip, EXIT 0.

## Lát 5e-2a-2: đề xuất cơ học bị loại (dừng 5e-2 tại thiết kế; 2026-11-21)

Advisor quyết: **dừng 5e-2 tại thiết kế, không xây lát cơ học.** Đề xuất "tên công cụ có trong `ASSISTANT_TOOLS` thì `passed`, còn lại `not_checkable`" có hai lỗi:
1. **Ghi nhận `passed` sai.** Mục nhắc tên một công cụ đã đăng ký không có nghĩa là mục đó đạt. Ví dụ "Công cụ X không gửi dữ liệu ra ngoài" chỉ nêu tên, không chứng minh gì về việc đăng ký.
2. **Lượt ghi chỉ một lần.** Một hàng toàn `not_checkable` sẽ chiếm vĩnh viễn chỗ mà một lần kiểm thật cần sau này.

**Bằng chứng đã đọc:**
- `docs/tasks`: 142 file `.done`. 130 rỗng. 12 có văn xuôi (số test, giới hạn), không có mục theo tiêu chí chấp nhận.
- `docs/tasks`: 194 file `*.report.md`. 136/142 task `.done` có báo cáo. Thiếu: `TASK-008-FIX`, `TASK-009-FIX`, `TASK-009-FIX2`, `TASK-147b`, `TASK-147c`, `TASK-147d`.
- Mục chấp nhận là câu tiếng Việt tự do, không có khóa nối với bằng chứng nào.
- Runner LLM thật (`apps/server/src/operator/proposalRunner.ts:28-45`) không có công cụ. Không dùng LLM trong lát này.

**Đặc tả yêu cầu kiểm tự động:** `docs/cursor/TASK-074c.md:69` viết: khi chuyển sang `in_progress` và có `.done`, đọc các mục `acceptance` có thể kiểm bằng công cụ đọc. Nghĩa là đặc tả yêu cầu kiểm **tự động**. Nhập kết quả tay qua route chỉ người dùng **không khớp** đặc tả này. 
**Migration 0103 và `recordAcceptanceResult`:** không có caller và không có kế hoạch caller. Giữ trong cây, không revert. Quyết định (advisor, 2026-11-21): giữ, nhưng bị chặn chờ một bộ chạy công cụ chỉ đọc (read-only tool runner) mới có caller.

## Bằng chứng cho so sánh 14/28 ngày (chỉ đọc, chưa có thiết kế)

- **Bảng dùng công cụ:** `operator_tool_audit` (`db/schema.ts:1395`). Các cột dùng được: `tool`, `decision`, `created_at`, `run_id`, `source`, `agent_kind`, `agent_name`. Theo đọc mã, `registry/invoke.ts:62-215` ghi các giá trị `refused`, `pending`, `executed`. Chưa xác minh là đúng một hàng cho mỗi lần gọi. Các nơi khác cũng ghi bảng này: `assistant/loop.ts:324,350`, `assistant/tools.ts:2245,2267`, `operator/qualityRepair.ts:536`, và INSERT trực tiếp ở `operator/service.ts:1643`. Chưa xác minh rằng `decision = 'executed'` là dấu hiệu gọi thành công; cần đếm trên dữ liệu thật trước khi dùng.
- **Lưu giữ:** không có lệnh xoá nào trên `operator_tool_audit`, `operator_routing_log` hay `operator_events` (tìm `DELETE`/`deleteFrom` trong `apps/server/src`, không thấy). Bảng `audit_log` có xoá sau 180 ngày (`auth/auditLog.ts:9,163-164`), nhưng đó là bảng khác. `operator_action_attempts` chỉ xoá trong `operator/loopGuard.ts:17`, không liên quan.
- **`expected_impact`:** cột tồn tại (`db/schema.ts:1301`), nhưng không có chỗ nào ghi. Chỉ có kiểu đọc (`operator/improvementRanking.ts:10`). Vì vậy không có chỉ số mục tiêu để so sánh.
- **Hệ quả:** chỉ có thể so đếm lần dùng trước và sau `done_at`. Đó là số lần dùng, không phải `expectedImpact.metric` theo đặc tả (`docs/cursor/TASK-074c.md:70`). Kết quả "verified" không có căn cứ đúng nghĩa cho đến khi có writer cho `expected_impact`.
