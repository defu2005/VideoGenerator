# TASK-074c-6e — check-done có cổng `.done`, migration 0101 `task_ref` (báo cáo)

Trạng thái: đã code và test trong cây làm việc. Chưa commit, chưa push, chưa có `.done` thật. Không khởi động app. Không ghi vào `data/`, `data-dev/` hoặc `docs/proposals/`. Không ghi `.done` thật dưới `docs/tasks` (test dùng thư mục tạm). Migration 0100 và 0101 chưa áp dụng vào DB thật hay bản sao nào. Không đổi `writeGuard.ts`, không đổi `selfImprovementBudgetStatus` hay shape của `improvementSelfTuneStats`.

## Phạm vi

- Chỉ phía server. Không có giao diện web, không có MCP.
- Thiết kế theo `docs/tasks/TASK-074c-6d.design.md` (phương án A): `POST /api/operator/tool-proposals/:id/check-done` nhận `{ task }`, kiểm tra regex, kiểm tra file `.done` tồn tại, rồi UPDATE có điều kiện đặt `task_ref` và `status = 'done'`.
- Không làm: MCP, giao diện, chuyển `done` sang trạng thái khác, đọc nội dung acceptance.

## Thay đổi

- `apps/server/drizzle/0101_improvement_task_ref.sql` (mới): `ALTER TABLE improvement_requests ADD task_ref text`.
- `apps/server/drizzle/meta/0101_snapshot.json` (mới): sinh từ snapshot 0100 bằng script, thêm cột `task_ref` sau `drafted_at`.
- `apps/server/drizzle/meta/_journal.json`: thêm mục `idx 101`, tag `0101_improvement_task_ref`.
- `apps/server/src/db/schema.ts`: cột `taskRef: text("task_ref")` trên `improvementRequests`.
- `apps/server/src/operator/toolProposals.ts`: `ToolProposalTaskRef` (regex `^[A-Za-z0-9][A-Za-z0-9-]{0,63}$`) và `checkToolProposalDone(db, id, task, tasksRoot)`. Hàm parse tên, kiểm tra `existsSync(<tasksRoot>/<name>.done)` (không có thì 409 `OPERATOR_TASK_NOT_DONE`), rồi UPDATE có điều kiện `kind = 'tool' AND status = 'in_progress'`. Không khớp dòng nào thì 409 `OPERATOR_TOOL_PROPOSAL_NOT_IN_PROGRESS`.
- `apps/server/src/api/operator.ts`: route `POST /api/operator/tool-proposals/:id/check-done`. Thứ tự: chỉ user (API key 403 `OPERATOR_TOOL_PROPOSAL_USER_ONLY`), parse uuid, có `tasksRoot` (không có thì 503 `OPERATOR_TASKS_ROOT_UNAVAILABLE`), parse body strict `{ task }`, gọi hàm. Thành công trả `{ ok: true }`. `registerOperatorRoutes` nhận thêm tham số thứ 5 `tasksRoot`.
- `apps/server/src/app.ts`: `buildApp({ ..., tasksRoot })` truyền xuống route.
- `apps/server/src/index.ts`: `tasksRoot: join(repoRoot(), "docs", "tasks")`.
- `apps/server/test/toolProposalCheckDone.test.ts` (mới): 38 test.

## Kiểm tra red trước

- Chạy file test khi chưa có hàm và route: 36 đỏ, 2 xanh. Một trong hai là tripwire (đúng). Test còn lại xanh vì hàm chưa tồn tại, nên đã sửa để khẳng định `ZodError` cho tên sai định dạng.
- Sau khi cài: 38/38 xanh.

## Mutation (mỗi cái một lần, hoàn nguyên từ bản sao, `cmp` giống hệt)

- M1, bỏ `AND status = 'in_progress'` khỏi UPDATE: đỏ 7 test (accepted, open, done, verified, failed_verification, rejected, và route accepted có `.done`).
- M2, bỏ `AND kind = 'tool'`: đỏ 1 test (hàng feature in_progress bị đánh dấu done).
- M3, nới regex cho phép dấu chấm: đỏ 2 test (`TASK-OK.txt` ở route, `a.b` ở unit).
- M4, bỏ cổng `existsSync`: đỏ 2 test (route và unit, khi không có `.done`).
- M5, bỏ kiểm tra chỉ-user trên route: đỏ 1 test (test API key bị đỏ, 1 trên 38). Chỉ thấy dòng FAIL, không đọc được mã trạng thái trả về từ output.

Ghi chú: M5 dùng `sed` theo số dòng (dòng 141). Diff sau đó hiển thị toàn file khác nhau, nhưng `cmp` với bản sao xác nhận file đã trở lại đúng từng byte.

## Kết quả kiểm tra

- Focused, 9 file (`toolProposalCheckDone`, `toolProposalStart`, `toolProposalInProgressList`, `toolProposalAcceptedList`, `toolProposalAccept`, `toolProposalImpNumber`, `improvementRequests`, `improvementSelfTune`, `improvementSelfTuneLegacy`): 124/124 pass.
- Server typecheck (`npx tsc -p tsconfig.json --noEmit`): không có lỗi, exit 0 (chạy không qua pipe).
- Đối chiếu với route start của 6a: grep `tool-proposals` trong `apps/server/src` và `apps/server/test` chỉ thấy `api/operator.ts` và các file test. Grep này không thấy quy tắc tiền tố `/api/operator` trong bảng auth nếu có. Vì vậy chỉ khẳng định ngang bằng với route start 6a, không khẳng định không có bảng auth nào bao phủ.
- Tên thiết bị Windows (`NUL`, `CON`, `COM1`): `existsSync(<tasksRoot>/<tên>.done)` trả false cho cả ba trên máy này, nên cổng `.done` không bị qua mặt bằng tên thiết bị.

## Kết quả full server suite

- Lệnh: `npx vitest run` trong `apps/server`, chạy nền. Log: `scratchpad/full-suite-6e.log`.
- Kết quả: Test Files 294 passed, 4 skipped (298); Tests 2446 passed, 9 skipped (2455); `EXIT=0`. Không có dòng FAIL.
- Đối chiếu: 6b là 293/4 (297) và 2408/9 (2417). 6e thêm đúng 1 file (`toolProposalCheckDone.test.ts`) và 38 test. Khớp dự kiến.
- `git status --short -- docs/proposals data data-dev`: không có thay đổi.
- Không có file `.done` nào được tạo dưới `docs/tasks` (chỉ có báo cáo này).

## Giới hạn đã biết

1. `existsSync` trên Windows không phân biệt hoa thường. `task-x.done` có thể khớp `TASK-X.done`. Chưa có test cho việc này.
2. Khoảng 142 file `.done` có sẵn đều qua được cổng. Cổng chỉ chặn tên chưa có file `.done`, không kiểm tra nội dung hay độ mới.
3. `done` là một chiều. Không có đường quay lại từ `done`.
4. `tasksRoot` gắn với từng worktree. Worktree sản phẩm chỉ thấy `.done` sau khi promote.
5. MCP không đọc check-done. Giao diện web không có nút check-done. (Ghi chú ngày 2026-11-20: phần giao diện web đã được đóng bằng TASK-074c-6f, nút nằm trong mục "Đang làm". MCP vẫn chưa đọc check-done.)
6. Migration 0101 chỉ được test trên `:memory:` và DB trong thư mục tạm. Chưa áp dụng vào DB thật.
7. Nội dung acceptance của task không được đọc. Việc này nằm ngoài phạm vi.
8. `0101_snapshot.json` được sinh bằng script từ 0100, chưa kiểm tra bằng `drizzle-kit`. Lần `drizzle-kit generate` sau có thể sinh diff thừa. Không chạy generate trong repo để kiểm tra.

## Chưa làm (cố ý)

- MCP đọc hoặc gọi check-done.
- Nút check-done trên giao diện web.
- Kiểm tra nội dung hoặc độ mới của `.done`.
- Đường quay lại từ `done`.
- Áp dụng migration 0100/0101 vào DB thật.
