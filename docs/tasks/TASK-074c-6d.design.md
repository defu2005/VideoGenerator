# TASK-074c-6d — thiết kế: liên kết đề xuất với task và cổng `.done` (chỉ tài liệu, đã sửa theo advisor)

Trạng thái: bản thiết kế đã sửa theo nhận xét advisor (2026-11-20). Chưa code, chưa migration, chưa test đỏ, chưa ghi `.done`, không đụng `data/`, `data-dev/` hay `docs/proposals/`. Migration `0100_improvement_imp_number` vẫn chưa áp dụng vào DB thật hay bản sao.

## Hiện trạng (đã đọc, 2026-11-20)

- `improvement_requests` (`apps/server/src/db/schema.ts:1292`) không có cột nào nối tới task. Các cột: `id, kind, title, problem, proposal, evidence, acceptance, data_vs_code, expected_impact, effort, risk, open_source, status, weight, fingerprint, created_at, updated_at, imp_number, drafted_at`.
- Migration: `apps/server/drizzle/0100_improvement_imp_number.sql` đã có. Không có file `010[1-9]*.sql`, nên số kế tiếp là `0101`.
- `evidence` là mảng JSON. Mỗi lần trùng fingerprint, `mergeEvidence` (`apps/server/src/operator/toolProposals.ts:35`) thêm một mục và chỉ giữ `MAX_EVIDENCE` mục mới nhất (`toolProposals.ts:64`, `:67`). Link đặt trong `evidence` sẽ bị đẩy ra sau vài lần trùng.
- `docs/tasks/*.done` đặt tên tự do, khoảng 142 file (ví dụ `TASK-007.done`, `TASK-067b-part3.done`, `BUGFIX-117.done`, `HERMES-GUIDE.done`). Không có quy ước `IMP-<n>.done`.
- Guide `docs/cursor/TASK-074c.md:69` viết: "Khi trạng thái chuyển sang `in_progress` và có `docs/tasks/<TASK>.done` cho task người dùng gắn". Guide không nói gắn task ở đâu, và không có cột nào để lưu.
- Guide nằm trong `docs/cursor/`, báo cáo nằm trong `docs/tasks/`.

## Hai điểm guide chưa chốt (đã chốt)

1. **Thời điểm kiểm `.done`.** Chốt: kiểm **sau** khi hàng đã ở `in_progress`, khi người dùng yêu cầu. Lý do: `.done` được ghi sau khi làm xong, nên lúc chuyển sang `in_progress` file gần như chắc chắn chưa có. Chữ "khi chuyển sang `in_progress`" trong guide được coi là sai thời điểm.
2. **Ai đặt link và ở đâu.** Chốt: người dùng đặt, nhưng qua route kiểm `.done`, không qua `start`. Lý do: route `start` của 6c không gửi body, nên nếu link bắt buộc ở `start` thì mọi hàng do web chuyển sẽ không có `task_ref` và `check-done` trả 400 mãi mãi.

## Phương án A (chọn)

- **Lưu:** cột mới `task_ref TEXT NULL` trên `improvement_requests`, migration `0101_improvement_task_ref` (ADD COLUMN, không backfill, không xóa gì).
- **Route `start`:** giữ nguyên như 6a. Không body, không đổi hành vi.
- **Route mới** `POST /api/operator/tool-proposals/:id/check-done`, user-only, body `{ "task": "TASK-…" }` bắt buộc. Trình tự:
  1. Route kiểm `request.actor?.kind === "user"`; không thì 403 `OPERATOR_TOOL_PROPOSAL_USER_ONLY`.
  2. Parse `id` bằng `z.string().uuid()`; `task` phải khớp `^[A-Za-z0-9][A-Za-z0-9-]{0,63}$`, không thì 400 `VALIDATION_ERROR`.
  3. Kiểm `fs.existsSync(path.join(tasksRoot, task + ".done"))` (chỉ kiểm tồn tại, không đọc nội dung). Không có thì 409 `OPERATOR_TASK_NOT_DONE`, không đổi gì. Đường dẫn chỉ được ghép sau khi regex đã qua.
  4. Một UPDATE có điều kiện: `UPDATE improvement_requests SET task_ref = ?, status = 'done', updated_at = ? WHERE id = ? AND kind = 'tool' AND status = 'in_progress'`. Nếu số dòng đổi bằng 0 thì trả 409 (mã lỗi chọn ở 6e).
- **Thư mục gốc** `tasksRoot` được inject vào hàm (mặc định `docs/tasks`). Không hard-code trong hàm kiểm.
- **Ưu:** rõ ràng; người dùng kiểm soát link; không đụng `evidence`; không quét thư mục; `start` không đổi.
- **Nhược:** cần một migration (advisor đã duyệt tạo migration ở slice 6e); người dùng phải gõ tên task.

## Hậu quả của `done` (advisor yêu cầu nêu rõ)

- **Ra khỏi cả ba danh sách (đã đọc mã):** mỗi danh sách lọc đúng một trạng thái: `open` (`listToolProposals`), `accepted` (`listAcceptedToolProposals`), `in_progress` (`listInProgressToolProposals`). `done` không thuộc danh sách nào. Chưa có danh sách riêng cho `done` trong 6e.
- **Giải phóng fingerprint (đã đọc mã):** lookup trùng trong `recordToolProposal` (`apps/server/src/operator/toolProposals.ts:58`) chỉ khớp `status IN ('open', 'accepted', 'in_progress')`. Hàng `done` không khớp, nên một đề xuất trùng sau đó tạo hàng `open` mới và tốn ngân sách (`consumeSelfImprovementBudget`). Đây là hành vi hiện có; 6e chỉ ghim nó bằng test, không đổi.
- **Tác động lên tự hiệu chỉnh: không có (đã đọc mã).** `improvementSelfTuneStats` (`apps/server/src/operator/improvementSelfTune.ts:18–24`) lấy mọi hàng `status != 'open'` (trừ hàng cũ từ 5d bị loại), sắp xếp theo `created_at DESC, id` rồi cắt theo cửa sổ. `in_progress` và `done` đều là đã quyết và đã chấp nhận (không phải `rejected`), và thứ tự không dùng `updated_at`. Vì vậy chuyển `in_progress → done` không đổi `decided`, `accepted`, `rate` hay `halved`. 6e ghim điều này bằng test: thống kê không đổi khi một hàng đã trong cửa sổ chuyển sang `done`.

## Quy tắc test (advisor yêu cầu)

- Test inject `tasksRoot` và dùng thư mục tạm (`mkdtemp`) cho mọi trường hợp có và không có `.done`.
- **Không bao giờ** tạo `.done` dưới `docs/tasks` thật.
- **Tripwire:** một test chụp danh sách `*.done` dưới `docs/tasks` thật trước và sau khi chạy, và kiểm tên sentinel (ví dụ `TEST-074C-6E-SENTINEL.done`) không xuất hiện ở đó.

## Phương án đã loại

### B. Lưu link trong `evidence`
- Loại. `mergeEvidence` giữ N mục mới nhất, nên link bị đẩy ra. Operator ghi `evidence`, nên link của người dùng trộn với dữ liệu của operator.

### C. Không lưu, tra cứu `IMP-<n>` trong file task
- Chỉ dùng làm phương án dự phòng. Guide nằm trong `docs/cursor/`, không phải `docs/tasks/`.
- Đã grep `IMP-[0-9]` trong `docs/`: có 3 báo cáo nhắc tới `IMP-n` (`docs/tasks/TASK-074c-3c-2c.report.md`, `TASK-074c-4a.report.md`, `TASK-074c-4b-3b.report.md`). Đó là văn bản trong báo cáo, không phải liên kết với đề xuất, nhưng một tra cứu bằng chữ sẽ khớp chúng. Vì vậy C mơ hồ khi nhiều file khớp.

## Giới hạn đã biết (đã nêu)

1. Đọc `acceptance` (guide dòng 69) nằm ngoài phạm vi 6d.
2. `fs.existsSync` không phân biệt hoa thường trên Windows, còn trên Linux thì có. Trên Windows, `task-x` có thể khớp `TASK-X.done`. Regex không chặn việc này.
3. Khoảng 142 tên `.done` có sẵn đều qua cổng. `done` là một chiều. Cổng chỉ chứng minh task có file `.done` đúng tên, không chứng minh task đó đã tạo ra đề xuất này.

## Migration

- `0101_improvement_task_ref`: advisor đã duyệt tạo ở 6e. Test chỉ trên `:memory:`. Không áp dụng vào DB thật hay bản sao.
- `0100_improvement_imp_number` vẫn chưa áp dụng.

## Câu hỏi đã trả lời

1. Cổng `.done` kiểm **sau** `in_progress`, khi người dùng yêu cầu. Đã chốt.
2. `task` **không** bắt buộc ở `start`; **bắt buộc** ở `check-done`. Đã chốt.

## Không làm trong 6d

- Không code, không migration, không test đỏ, không ghi `.done`.
- Không kiểm `.done` theo lịch; không chuyển sang `verified` hay `failed_verification` (đó là 074c-5 với số liệu 14/28 ngày, vẫn hoãn).

## Bước tiếp: 074c-6e (chỉ server)

- Migration `0101_improvement_task_ref`, hàm `check-done` (có `tasksRoot` inject), route user-only.
- Test đỏ trước: regex; `.done` có và không có (thư mục tạm); user-only (API key 403); từ chối khi hàng không ở `in_progress`; body thiếu `task` (400); hậu quả `done` (ra khỏi ba danh sách; thống kê tự hiệu chỉnh không đổi; đề xuất trùng sau `done` tạo hàng `open` mới); tripwire.
- Không web, không MCP, không `.done` thật.
