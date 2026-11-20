# TASK-074c-5e (lát 5e-1) — cột `done_at` khi check-done (báo cáo)

Trạng thái: lát đầu của phần xác minh còn lại của 074c-5. Chỉ thêm `done_at` và đặt nó khi check-done thành công. Chưa làm: đọc `acceptance`, `verification_result`, `verified_at`, so sánh 14/28 ngày, writer của `expected_impact`. Thiết kế đầy đủ và các điểm còn mở: `docs/tasks/TASK-074c-5e.design.md`. Chưa commit, chưa push, chưa có `.done`. Không khởi động app. Không áp dụng migration vào DB thật hay bản sao nào.

## Thay đổi

- `apps/server/drizzle/0102_improvement_done_at.sql` (mới): `ALTER TABLE \`improvement_requests\` ADD \`done_at\` text;`
- `apps/server/drizzle/meta/0102_snapshot.json` (mới): sao từ `0101_snapshot.json`, thêm cột `done_at` sau `task_ref`, id mới `44a09d14-cefc-4082-a9b4-0836c7ad9791`, `prevId` = `901e0d8d-077e-4bf4-a103-d93a6a93acda`.
- `apps/server/drizzle/meta/_journal.json`: thêm entry idx 102, tag `0102_improvement_done_at`, `breakpoints: true`.
- `apps/server/src/db/schema.ts`: thêm `doneAt: text("done_at")` ngay sau `taskRef`.
- `apps/server/src/operator/toolProposals.ts` (`checkToolProposalDone`): một biến `now` dùng chung; UPDATE đặt `updated_at = now` và `done_at = now` trong cùng câu lệnh. Không đổi điều kiện `status = 'in_progress'`, không đổi mã lỗi, không đổi `listDoneToolProposals`.
- `apps/server/test/toolProposalDoneAt.test.ts` (mới, 5 test): check-done đặt `done_at` bằng `updated_at`; check-done bị từ chối vì thiếu `.done` để `done_at` NULL và hàng ở `in_progress`; hàng không ở `in_progress` (kể cả hàng đã `done` với `done_at` cũ) không bị đổi `done_at`; accept và start không đặt `done_at` (test này xanh ngay từ đầu, là test ghim hành vi, không phải test đỏ); không ghi `.done` nào vào `docs/tasks`.
- `apps/server/test/toolProposalCheckDone.test.ts` (6e): cập nhật một test. Test cũ khẳng định check-done chỉ đổi `status`, `task_ref`, `updated_at`. Giờ `done_at` cũng đổi, nên test bỏ `done_at` khỏi danh sách so sánh và thêm khẳng định `done_at` bằng `updated_at`. Đây là đổi kỳ vọng do chính cột mới, không phải hồi quy.

## Chạy đỏ trước

Chạy `toolProposalDoneAt.test.ts` sau khi thêm migration và cột schema, trước khi sửa `toolProposals.ts`: `1 failed | 3 passed`. Test đỏ là `expected null not to be null` (check-done chưa đặt `done_at`). Ba test còn lại xanh vì mô tả hành vi đã có sẵn. Con số `1 failed | 3 passed` là trước khi có test pin accept/start (test thứ năm); test pin đó xanh ngay từ đầu.

## Kiểm tra

- Focused, lần chạy đầu (trước khi thêm test pin accept/start): `toolProposalDoneAt`, `toolProposalCheckDone`, `toolProposalDismissUserOnly`, `registry`, `toolProposalAccept`, `toolProposalStart`: `Test Files 6 passed (6)`, `Tests 86 passed (86)`, `FOCUSED_EXIT=0`.
- Focused, sau khi thêm test pin accept/start: 4 file (`toolProposalDoneAt`, `toolProposalCheckDone`, `toolProposalAccept`, `toolProposalStart`): `Test Files 4 passed (4)`, `Tests 68 passed (68)`, `FOCUSED_EXIT=0`.
- Server typecheck: `npx tsc -p tsconfig.json --noEmit`, `TSC_EXIT=0`. Chạy lại sau khi sửa comment trong `schema.ts`, log `scratchpad/tsc-5e1-final.log`.
- Full server suite (sau mọi thay đổi): `Test Files 297 passed | 4 skipped (301)`, `Tests 2463 passed | 9 skipped (2472)`, `FULL_EXIT=0`. Log: `scratchpad/full-server-5e1-final.log`. So với 6k (2458), tăng 5 test mới.

## Mutation

Driver: `scratchpad/mut5e1.cjs`. Log: `scratchpad/mut5e1.log`. Bản sao gốc: `scratchpad/toolProposals.5e1.good.ts`.

| Mutant | Thay đổi | Kết quả |
|---|---|---|
| D1 | bỏ `done_at = ?` khỏi UPDATE và bỏ tham số tương ứng | đỏ 2: test mới ("sets done_at, equal to updated_at…") và test 6e ("changes no other column but updated_at", nhánh khẳng định `done_at`) |

`RESTORED_SAME true`, và `cmp` của `toolProposals.ts` với bản sao gốc giống hệt.

D1 chạy trước khi thêm test pin accept/start, và không chạy lại sau đó. Test pin không đi qua check-done nên không ảnh hưởng kết quả của D1.

## Giới hạn

1. Chỉ lát 5e-1. Không có đọc `acceptance`, không có `verification_result`/`verified_at`, không có so sánh 14/28 ngày, không có writer cho `expected_impact`.
2. `done_at` là NULL trừ khi check-done đặt nó. Không suy từ `updated_at`. Migration 0102 chưa áp dụng vào DB nào, nên không có hàng thật nào để kiểm.
3. `done_at` chỉ ghi thời điểm check-done. Nó không chặn các writer khác. `improvementOpenSource.ts:62` ghi `open_source` không có điều kiện `status`, nhưng grep trong `apps/server/src` chỉ thấy file đó và test của nó, không có caller production. Chưa kiểm liệt kê giá trị `status` và phần web.
4. Chỉ check-done (lệnh của người dùng qua `POST /api/operator/tool-proposals/:id/check-done`) đặt `done_at`. MCP không gọi route này (xem 074c-6i).
5. Chưa chạy migration trên DB thật, `data/` hay `data-dev/`. Test chỉ dùng `:memory:`.
6. Snapshot `0102_snapshot.json` được tạo bằng script (sao từ 0101, thêm cột), chưa kiểm bằng drizzle-kit. Cùng cách làm với 6e.
7. `tsc` của server loại trừ `test/`, nên file test mới không được kiểm kiểu bằng tsc. Test chạy bằng Vitest.
8. Kiểm tra đường dẫn được bảo vệ sau khi làm xong: `git status --short -- docs/proposals data data-dev` cho 0 dòng, nhưng `data/` và `data-dev/` nằm trong `.gitignore` (`.gitignore:4`, `:23`), nên kết quả đó chỉ chứng minh cho `docs/proposals`. Với `data/` và `data-dev/`, chỉ khẳng định được là test dùng `:memory:`. Số `.done` dưới `docs/tasks` là 142 (không đổi). `apps/server/src/operator/writeGuard.ts` không có thay đổi (`git status` và `git diff --stat` đều rỗng).

## Chưa làm (cố ý)

- Đọc `acceptance` (cần tập kiểm được bằng công cụ đọc, do advisor quyết).
- `verification_result`, `verified_at` và so sánh 14/28 ngày: chờ nguồn metric và dữ liệu thật.
- Đường ghi `expected_impact`.

---

# TASK-074c-5e-2a-1 (lát lưu trữ) — ghi kết quả kiểm `acceptance` (báo cáo)

Trạng thái: chỉ lưu trữ. `recordAcceptanceResult` có sẵn nhưng chưa có caller. Không route, không mục đăng ký công cụ, không runner, không đổi danh sách hay web. Chưa commit, chưa push, chưa có `.done`. Không khởi động app. Không áp dụng migration vào DB thật hay bản sao nào. Thiết kế: `docs/tasks/TASK-074c-5e.design.md`, mục 5e-2a.

## Thay đổi

- `apps/server/drizzle/0103_acceptance_result.sql` (mới): hai `ALTER TABLE … ADD` (`acceptance_result` text, `acceptance_checked_at` text), ngăn bằng `--> statement-breakpoint`, cùng cách 0002.
- `apps/server/drizzle/meta/0103_snapshot.json` (mới): sao từ `0102_snapshot.json`, thêm hai cột sau `done_at`, id `7c1e5b2a-3f0d-4e8a-9b61-2d4a8f0c5e13`, `prevId` = `44a09d14-cefc-4082-a9b4-0836c7ad9791`. Tạo bằng script, chưa kiểm bằng drizzle-kit.
- `apps/server/drizzle/meta/_journal.json`: entry idx 103, tag `0103_acceptance_result`, `when` 1795198452556 (thời điểm kiểm, lớn hơn idx 102).
- `apps/server/src/db/schema.ts`: `acceptanceResult`, `acceptanceCheckedAt` sau `doneAt`.
- `apps/server/src/operator/toolProposals.ts`: `AcceptanceVerdict`, `AcceptanceResults` (mảng `{ verdict }`, 1–6 mục, `.strict()`), `recordAcceptanceResult(db, id, results)`.
  - Thứ tự kiểm: input; id (không có thì `NOT_FOUND`); `proposal` đọc được bằng `ToolProposalArgs` (không thì `OPERATOR_TOOL_PROPOSAL_UNREADABLE`); số kết quả bằng số mục trong `proposal.acceptance` (không thì `OPERATOR_ACCEPTANCE_MISMATCH`); rồi UPDATE có điều kiện `kind = 'tool' AND status = 'done' AND acceptance_result IS NULL`.
  - Chỉ khi UPDATE không đổi dòng nào mới phân loại: không tồn tại hoặc không phải tool → `NOT_FOUND`; không done → `OPERATOR_TOOL_PROPOSAL_NOT_DONE`; đã có kết quả → `OPERATOR_ACCEPTANCE_ALREADY_RECORDED`.
  - Chỉ ghi `acceptance_result` (JSON) và `acceptance_checked_at`. Không đổi `status`, `updated_at`, `done_at`, `task_ref`.
- `apps/server/test/toolProposalAcceptanceResult.test.ts` (mới, 9 test, chỉ `:memory:`).

## Chạy đỏ trước

Chạy `toolProposalAcceptanceResult.test.ts` với hàm stub không làm gì: `9 failed (9)`. Lỗi là assertion (`expected null not to be null`, `expected null to be '[{"verdict"…'`, và `expected the call to throw`), không phải lỗi import.

## Kiểm tra

- Focused sau khi cài đặt, 5 file (`toolProposalAcceptanceResult`, `toolProposalDoneAt`, `toolProposalCheckDone`, `toolProposalAccept`, `toolProposalStart`): `Test Files 5 passed (5)`, `Tests 77 passed (77)`, `FOCUSED_EXIT=0`.
- Typecheck server: `npx tsc -p tsconfig.json --noEmit`, `TSC_EXIT=0`. Log `scratchpad/tsc-5e2a1.log`.
- Full server (chạy lại sau khi đổi `when` trong journal): `Test Files 298 passed | 4 skipped (302)`, `Tests 2472 passed | 9 skipped (2481)`, `FULL_EXIT=0`. Log `scratchpad/full-server-5e2a1-final.log`. So với 5e-1 (2463) tăng 9 test mới.

## Mutation

Driver `scratchpad/mut5e2a1.cjs`, log `scratchpad/mut5e2a1.log`, bản gốc `scratchpad/toolProposals.5e2a1.good.ts`. Mỗi mutant đổi một chuỗi neo chính xác, chạy Vitest trên file test mới, rồi khôi phục.

| Mutant | Thay đổi | Kết quả |
|---|---|---|
| M1 | bỏ `status = 'done'` khỏi UPDATE | đỏ, 1 failed / 8 passed |
| M2 | bỏ `acceptance_result IS NULL` | đỏ, 1 failed / 8 passed |
| M3 | bỏ kiểm tra số lượng | đỏ, 1 failed / 8 passed |
| M4 | bỏ kiểm tra mã kết quả (`z.string()`) | đỏ, 1 failed / 8 passed |
| M5 | bỏ `kind = 'tool'` khỏi UPDATE | đỏ, 1 failed / 8 passed |

`RESTORED_SAME`: `cmp` của `toolProposals.ts` với bản gốc giống hệt sau mỗi mutant và sau cùng. Log chỉ ghi số test lỗi, không ghi tên test giết từng mutant.

## Giới hạn

1. Chưa có caller của `recordAcceptanceResult`. Không có route, không có công cụ đăng ký, không có runner. Ai ghi kết quả và bằng cách nào là quyết định của lát sau (A/B, còn mở).
2. Migration 0103 chưa áp dụng vào DB nào (kể cả `data/`, `data-dev/`). Test chỉ dùng `:memory:`. Snapshot tạo bằng script, chưa kiểm bằng drizzle-kit.
3. Hình dạng `results` (`.strict()`, giới hạn 1–6 mục) chưa có test riêng.
4. Id lạ trả `NOT_FOUND`, còn check-done gộp vào lỗi trạng thái. Lát route sẽ chọn một quy ước.
5. Kiểm tra đường dẫn được bảo vệ: `git status --short -- docs/proposals data data-dev` cho 0 dòng, nhưng `data/` và `data-dev/` nằm trong `.gitignore`, nên chỉ `docs/proposals` được chứng minh. Với `data/` và `data-dev/`, chỉ khẳng định được test dùng `:memory:`. Số `.done` dưới `docs/tasks` là 142 (không đổi). `apps/server/src/operator/writeGuard.ts` không có thay đổi (`git diff` rỗng).

## Chưa làm (cố ý)

- Caller ghi kết quả (route hoặc công cụ đăng ký), đang chờ quyết A hoặc B.
- Đọc hoặc hiển thị kết quả (danh sách, web).
- So sánh 14/28 ngày, `verification_result`, `verified_at`, writer của `expected_impact`.

## TASK-074c-5e: quyết định sau 5e-2a-1 (2026-11-21, chỉ đọc)

- Người kiểm: B bị loại (advisor). Ghi kết quả chỉ trong tiến trình, sau route chỉ người dùng (`OPERATOR_TOOL_PROPOSAL_USER_ONLY`). Chưa xác minh: khóa API có nhận vai trò owner/admin không.
- Đề xuất cơ học (tên công cụ trong `ASSISTANT_TOOLS` thì `passed`) bị loại: ghi `passed` sai, và lượt ghi một lần sẽ chiếm chỗ kiểm thật sau này. Không xây lát 5e-2a-2. Không LLM, không trừ ngân sách.
- Migration `0103_acceptance_result` và `recordAcceptanceResult` còn trong cây, không có caller, không có kế hoạch caller. Không revert. Quyết định (advisor, 2026-11-21): giữ, nhưng bị chặn chờ một bộ chạy công cụ chỉ đọc (read-only tool runner) mới có caller.
- Đặc tả `docs/cursor/TASK-074c.md:69` yêu cầu kiểm tự động khi chuyển `in_progress`. Nhập tay không khớp đặc tả kiểm tự động.
- Bằng chứng 14/28 ngày: `operator_tool_audit` (`db/schema.ts:1395`) có `tool`, `decision`, `created_at`; lọc `decision = 'executed'`. Không có lệnh xoá cho bảng này. `expected_impact` không có writer, nên không có chỉ số mục tiêu để so sánh.
- Không đạt / chưa làm: không commit, không `.done`, không migration trên DB nào, không route, không caller.

## 2026-11-21: đóng 074c-5 (quyết định advisor; chỉ đọc và tài liệu, không có mã mới, không có `.done`)

- **Gạch 3 (tự hiệu chỉnh, guide dòng 71): đã làm.** `apps/server/src/operator/improvementSelfTune.ts:10` (`SELF_TUNE_WINDOW = 20`), `:32` (`halved`). Gọi ở `apps/server/src/api/research.ts:15-21` và `apps/server/src/operator/toolProposals.ts:78-80`. Hiển thị ở `apps/web/src/features/research/ResearchPage.tsx:20-21`. Chạy lại 2026-11-21: server 3 file 26/26 (`scratchpad/selftune-server-rerun.log`); web `ResearchPage.selfTune.test.tsx` 5/5 (`scratchpad/selftune-web-rerun.log`). Chưa kiểm trên trình duyệt.
- **Gạch 1 (đọc `acceptance` tự động): dừng.** Lưu trữ kết quả (5e-2a-1, migration 0103, `recordAcceptanceResult`) có trong cây, chưa có caller. Thiết kế kiểm tự động bị loại (5e-2a-2): không có bằng chứng theo từng mục.
- **Gạch 2 (so 14/28 ngày): dừng.** Lý do: (1) không có writer cho `expected_impact`, nên không có `metric` để so sánh; (2) đếm `operator_tool_audit` có `decision = 'executed'` trước và sau `done_at` chỉ là số lần dùng, không phải so sánh theo metric; (3) tên đề xuất không nối được với công cụ đã đăng ký; (4) số đếm trước `done_at` bằng 0 theo cấu tạo.
- **Sửa chữ đã áp dụng vào `TASK-074c-5e.design.md`:** bảng ba gạch, dòng 1 (ghi chú migration 0103 và `recordAcceptanceResult` không có caller) và dòng 3 (kết quả chạy lại, `improvementSelfTune.ts:10`, `:32`); mục 2 (`verification_result` dừng); mục 5 (người kiểm đã quyết, B bị loại); tiêu đề "Lát đầu tiên" (đã làm là 5e-1); "Chưa làm" gạch 1 (dừng, không phải chờ); "Thời điểm" còn "trong một lượt riêng", câu "không phải cùng mốc" đã bỏ (đặc tả dòng 69 kích hoạt cùng trigger với check-done); nhãn ghi nhật ký audit (chưa xác minh là đúng một hàng mỗi lần gọi, liệt kê các nơi khác ghi bảng này).
- **Migration 0103 và `recordAcceptanceResult`:** còn trong cây, không có caller, không revert. Quyết định advisor 2026-11-21: giữ, bị chặn chờ bộ chạy công cụ chỉ đọc.
- **Không có `.done` cho 5e.** Không sửa `writeGuard.ts`. Không áp dụng migration vào DB thật. Không khởi động app.
