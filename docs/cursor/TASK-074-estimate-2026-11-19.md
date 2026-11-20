# TASK-074b/c — ước lượng và cách chia nhỏ (2026-11-19)

Phạm vi: `docs/cursor/TASK-074.md` §4–§8, đối chiếu với code hiện có và lịch trong `docs/cursor/README.md`. Đây là ước lượng để viết guide cho từng phần. Chưa viết code.

**Cỡ:** S = một cụm file, không migration, vài trăm dòng hoặc ít hơn. M = vài file, có test, có thể có migration. L = module mới, harness và test riêng, nhiều rủi ro.

## Phụ thuộc đã kiểm tra

- **TASK-088** không phải phụ thuộc kỹ thuật của 074. `README.md` xếp 074b/074c vào đợt 7 cùng với 088 ("song song được"). 088 chỉ phụ thuộc TASK-085 đã commit. Ràng buộc thật là luật lịch: **mỗi lúc chỉ một task có migration**. Vì vậy 074 không chờ 088 có `.done`. Chỉ cần không có task migration khác đang chạy khi bắt đầu một phần có migration.
- **TASK-148e** chờ "shadow run qua đường shadow của 074b" (`TASK-148.md`, mục 148e). Đường này là cơ chế ghi lại lệnh dự kiến. Nó **không** cần behaviour eval (074b-2) để chạy. Đó là lý do tách 074b-3 thành 3a và 3b (xem bên dưới).
- 074c không phụ thuộc phần nào của 074b, và ngược lại.

## Hiện trạng trong code (đã đọc)

- `apps/server/src/operator/skillVersions.ts`: `SkillEvidence.source` gồm `repeated_failure | user_review | user_edit | agent_proposal`. Có `checkSkill`, giới hạn 10 bản nháp/ngày, `activateSkillVersion` (chặn khi điểm < 80). Trạng thái: `draft | active | archived | needs_merge`. Không có shadow, outcome hay rollback.
- `apps/server/src/operator/skillEval.ts`: `evaluateSkill` chỉ đo định tuyến qua `scoreCandidates`. Không có dry run hay LLM judge. Behaviour eval (4.2) phải viết mới.
- `apps/server/src/operator/routing.ts`: `scoreCandidates`, `routeQuery`, `historicalSuccess`. Được gọi từ `service.ts:44` và `skillEval.ts:3`.
- `apps/server/src/operator/undo.ts`: `undoAudit`, được gọi từ `api/autonomy.ts:153`. Đây là nguồn cho quay lui.
- `apps/server/src/db/schema.ts:1244` `operator_runs`: đã có cột `outcome` và `toolChips`. Chưa thấy liên kết giữa một run và một phiên bản skill.
- `apps/server/src/db/schema.ts:1280` `operator_tool_proposals` và `:1307` `operator_skill_versions` (cột: name, version, markdown, evidence, score, status, createdAt).
- `apps/server/src/operator/autonomyBudget.ts`: có `selfImprovementSettings`, `consumeSelfImprovementBudget` (`researchRuns`, `skillDrafts`). Chưa có `behaviourEvals`, `improvementRequests`, `llmCalls`, `webFetches`.
- `apps/server/src/operator/evalBudget.ts`: có `runSuccessiveElimination`. Chưa có hạn mức theo ngày cho behaviour eval.
- `apps/server/src/operator/toolProposals.ts` và alias `propose_missing_tool` (gặp ở `assistant/tools.ts:1938`, `auth/toolActions.ts:57`, `operator/handbook.ts:110`, `operator/modelRuntime.ts:51`).
- `operator/runtime.ts` tồn tại nhưng **chưa đọc**. Điểm móc cho shadow (3a) phải tìm ở đó hoặc ở `service.ts`. Đây là việc đầu tiên của 3a.
- Không có shadow path ở đâu trong operator (đã tìm).
- 074a đã xong (`docs/tasks/TASK-074a.done`), có `research/service.ts`.
- Migration mới nhất: `0097_script_agent_author` (idx 97 trong `apps/server/drizzle/meta/_journal.json`).

## Quy tắc migration (không đặt số trước)

- Lấy số kế tiếp **lúc bắt đầu phần đó**: đọc lại `_journal.json` và thư mục `drizzle/`, không dùng số đã ghi trong estimate này.
- Một phần có migration tại một thời điểm, theo luật lịch.
- Migration chỉ bằng `drizzle-kit generate`. Không sửa file đã áp dụng.

## Các phần

### 074b — skill do operator viết

| Phần | Nội dung | Cỡ | Rủi ro | Migration | Cần trước | File chính |
|---|---|---|---|---|---|---|
| **074b-1** | Nguồn bằng chứng mới (`pattern`, `research`, `change_event`, `outcome`, `improvement`). Kiểm tra cụm từ bị cấm (tiếng Việt và Anh). Giới hạn 25 từ trích web. | S | thấp | không | 074a (xong) | `skillVersions.ts`, `skills.ts` |
| **074b-3a** | **Cơ chế shadow:** khi router chọn skill có bản shadow, ghi lại lệnh dự kiến của bản đó, **không chạy**. Bản đang dùng vẫn chạy bình thường. Có cổng tắt. Chưa có điều kiện "đã qua" (đó là 3b). | M | trung bình (chạm đường định tuyến đang chạy) | **có** (bảng log shadow) | 074b-1 (lấy bản nháp); không cần 074b-2 | `routing.ts`, `service.ts` hoặc `runtime.ts` (chưa đọc), bảng mới |
| **074b-2** | Behaviour eval (`skillBehaviourEval.ts`, mới): dry run 3–8 kịch bản với công cụ trả kết quả ghi sẵn; công cụ `confirm` chỉ ghi lại. Kiểm tra cứng: ngoài danh sách khai báo, gọi bị chặn, dự án được bảo vệ, không dừng chờ duyệt. Một lần LLM judge mỗi kịch bản, rubric cố định. Đạt khi ≥ bản đang dùng. Có hạn mức `behaviourEvals`. | **L** | trung bình (chi phí judge; harness dry run là phần chưa biết nhất) | không | 074b-1 | `skillEval.ts` (mở rộng), file mới, `autonomyBudget.ts` |
| **074b-3b** | Cổng: chỉ bản đã qua 074b-2 mới vào shadow. Đếm lượt và so sánh số bước và số lệnh gọi với bản đang dùng. | S–M | trung bình | không | 074b-2, 074b-3a | như 3a |
| **074b-4** | Quy tắc kích hoạt: người dùng kích hoạt ở trang "Tự cải tiến". `operator.autoActivateReadSkills` mặc định tắt. `safe`/`confirm` luôn cần người dùng. Thay điều kiện cũ (điểm định tuyến ≥ 80). | S | thấp | không | 074b-3b | `skillVersions.ts` |
| **074b-5** | Kết quả và quay lui: tỷ lệ thành công, chỉnh sửa, hoàn tác, từ chối, lỗi và loop-guard. Quy tắc quay lui có số lượt tối thiểu. Lưu trữ đề xuất sau 90 ngày. | M | trung bình | **có thể**: `operator_runs` có `outcome`, nhưng chưa có liên kết run → phiên bản skill. Nếu không có liên kết, cần bảng hoặc cột mới | 074b-4 | `undo.ts`, `operator_runs`, `skillVersions.ts` |

**Shadow: cổng và điều kiện kết thúc.** Spec §4.3 viết "N lượt định tuyến thật (cài đặt, mặc định 5) hoặc 7 ngày". Câu này không nói rõ điều kiện nào đến trước. **Mặc định tôi chọn:** shadow kết thúc khi đủ N lượt; nếu sau 7 ngày chưa đủ N thì báo cáo với số lượt thực có và đánh dấu "chưa đủ mẫu", không tự kích hoạt. Ghi vào decisions log. Nếu người dùng muốn khác, đổi một dòng ở 3b.

### 074c — yêu cầu cải tiến

| Phần | Nội dung | Cỡ | Rủi ro | Migration | Cần trước | File chính |
|---|---|---|---|---|---|---|
| **074c-1** | Bảng `improvement_requests`. Sao chép dữ liệu từ `operator_tool_proposals` bằng code, không đổi bảng cũ. `propose_missing_tool` giữ nguyên là alias ghi `kind: tool`. | M | trung bình (migration trên dữ liệu thật: kiểm tra trên bản sao) | **có** | không | `toolProposals.ts`, `schema.ts`, drizzle |
| **074c-2** | Gộp theo `fingerprint` (cộng bằng chứng và trọng số, không thêm dòng). Giới hạn 10 yêu cầu/ngày. Xếp hạng trọng số × tác động ÷ nỗ lực. Digest tối đa 3 mục/tuần. | S–M | thấp | không | 074c-1 | `toolProposals.ts` |
| **074c-3** | Điền `openSource` cho yêu cầu M/L bằng `research-open-source`, trong ngân sách. | M | thấp | không | 074c-1 (074a đã xong) | `research/service.ts` |
| **074c-4** | Bản nháp guide vào `docs/proposals/` qua bộ ghi hẹp (không mở rộng `writeGuard`). Trang hiển thị "Bản nháp guide — cần Claude xem lại". | S–M | trung bình (ghi file) | không | 074c-1 | `writeGuard.ts` (không mở rộng), file mới |
| **074c-5** | Xác minh: `acceptance` đọc được; so `expectedImpact.metric` sau 14 và 28 ngày. Tự hiệu chỉnh: dưới 30% trong 20 yêu cầu gần nhất thì giảm nửa hạn mức. | M | trung bình (dữ liệu theo thời gian) | không | 074c-1, 074c-2 | `toolProposals.ts`, `autonomyBudget.ts` |

### Phần chung (§7–§8)

Ngân sách `selfImprovement` đầy đủ, trang "Tự cải tiến" (4 tab, phía web), digest tuần, bảng "được làm / không được làm" trong hướng dẫn người dùng, và test "lệnh cấm bị từ chối ở tầng registry". Cỡ M. Phần web chỉ làm sau khi phần server có dữ liệu.

## Thứ tự

1. **074b-1** (không migration).
2. **074b-3a** (migration; khi xong, **148e được mở khóa**).
3. **074b-2** (behaviour eval, L).
4. **074b-3b**, **074b-4**, **074b-5**.
5. **074c-1** (migration; có thể làm song song với 074b-2 nếu không có task migration khác đang chạy, nhưng vì luật lịch thì làm sau 3a).
6. **074c-2**, **074c-3**, **074c-4**, **074c-5**, phần chung.

Mỗi phần có guide `docs/cursor/TASK-074<phần>.md`, báo cáo `docs/tasks/TASK-074<phần>.report.md` và `.done` riêng, theo checklist §10 trong spec.

## Rủi ro chính

- Harness dry run (074b-2) là phần chưa biết nhất. Công cụ có thể có tác dụng phụ nếu không ghi sẵn kết quả. Chạy trên bản sao dữ liệu, không trên dự án được bảo vệ.
- Shadow (3a) chạm đường định tuyến đang chạy. Phải có cổng tắt và có test rằng shadow không bao giờ thực thi lệnh.
- Migration 074c-1 sao chép bảng cũ. Các alias `propose_missing_tool` phải còn hoạt động.
- Chi phí LLM của judge và nghiên cứu. Ngân sách §7 là điều kiện bắt buộc.

## Quyết định đã chốt (ghi vào `docs/tasks/GOAL-2026-11-18.decisions.md`)

- 074 không chờ TASK-088 `.done`; chỉ tuân luật "một migration tại một thời điểm".
- Ai làm gì: Claude viết guide; opencode code; Codex review (quy tắc 2026-11-17). Không tự dispatch.
- Số migration: lấy lúc bắt đầu từng phần, không đặt trước.
- Điều kiện kết thúc shadow: xem mục trên.
