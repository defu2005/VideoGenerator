# TASK-074c-6g — danh sách đề xuất đã xong, chỉ đọc (báo cáo)

Trạng thái: đã code và test trong cây làm việc (chỉ phía server). Chưa commit, chưa push, chưa có `.done` thật. Không khởi động app, không dùng `preview_start`. Không ghi vào `data/`, `data-dev/`, `docs/proposals/`. Không ghi `.done` thật dưới `docs/tasks` (test dùng thư mục tạm). Không đổi `writeGuard.ts`, không đổi MCP, không đổi web. Không có migration mới (cột `task_ref` đã có từ 074c-6e, migration 0101).

## Phạm vi

- Chỉ đọc: `listDoneToolProposals(db, logger?)` và route `GET /api/operator/tool-proposals/done`.
- Hàng `done` là đầu đọc đầu tiên của `task_ref`. Trước 6g, `task_ref` chỉ được ghi (bởi check-done, 074c-6e), chưa có nơi nào đọc.
- Không làm: không chuyển trạng thái, không soạn bản nháp, không đọc nội dung `.done`, không MCP, không web (mục "Đã xong" trên trang là 074c-6h).

## Thay đổi

- `apps/server/src/operator/toolProposals.ts`:
  - `listDoneToolProposals`: `SELECT id, proposal, created_at, imp_number, drafted_at, task_ref FROM improvement_requests WHERE kind = 'tool' AND status = 'done' ORDER BY updated_at DESC, id LIMIT 50`. Mỗi item có thêm `taskRef` (null khi cột NULL), `impNumber`, `draftedAt`. Cùng quy tắc bỏ qua hàng lỗi (`toListedProposals`, không đổi).
  - Thêm kiểu `DoneToolRow` (`AcceptedToolRow` + `task_ref`).
  - `listToolProposals`, `listAcceptedToolProposals`, `listInProgressToolProposals` và `toListedProposals` không đổi. Ba danh sách đó không có `taskRef`.
- `apps/server/src/api/operator.ts`: import `listDoneToolProposals`; route `GET /api/operator/tool-proposals/done` ngay sau route in-progress, không có kiểm tra chỉ-user (cùng quy tắc với các danh sách đọc khác).
- `apps/server/test/toolProposalDoneList.test.ts` (mới): 10 test (8 đơn vị/tích hợp và 2 route).

## Chạy đỏ trước

Chạy file test khi chưa có hàm và route: 9 đỏ, 1 xanh.

- 7 test lỗi `listDoneToolProposals is not a function`.
- 2 test route lỗi `expected 404 to be 200`.
- 1 test xanh: "the other lists keep their shape: no taskRef key, even when the row has a task_ref". Đây là tripwire cho danh sách cũ. Nó xanh trước khi cài đặt là đúng, vì hành vi đó đã có.

## Chạy xanh sau khi cài

- File mới: 10/10 xanh.
- Cùng với `toolProposalInProgressList.test.ts` (7) và `toolProposalAcceptedList.test.ts` (7): 24/24 xanh, `EXIT=0`.
- Sau đổi tên test (xem dưới): file mới chạy lại 10/10.

Đổi tên test: tiêu đề của test sắp xếp đã bỏ cụm "and caps the result at 50", vì test đó không kiểm tra giới hạn (test kế tiếp mới kiểm tra). Tiêu đề mới: "orders by updated_at newest first, not by created_at". Đổi tên diễn ra sau cả full suite lẫn lần chạy mutation; bảng mutation dùng tên mới ở hàng M2.

## Mutation

Mỗi mutant áp dụng một lần lên mã nguồn cuối (sau lần sửa mã cuối). File gốc được sao lưu trong scratchpad, khôi phục rồi `cmp` giống hệt. Helper là replacement theo neo chính xác, có kiểm tra độ duy nhất của neo.

| Mutant | Thay đổi | Kết quả (đỏ) | Test đỏ |
|---|---|---|---|
| M1 | bỏ `kind = 'tool'` khỏi truy vấn done | 1 | "lists done tool rows and nothing else" (hàng feature done) |
| M2 | sắp xếp theo `created_at` thay cho `updated_at` | 2 | "orders by updated_at newest first, not by created_at" và "caps at 50 and keeps the newest by updated_at" |
| M3 | bỏ `taskRef` khỏi map | 4 | item shape, taskRef null, route `{items}`, và e2e |
| M4 | nới trạng thái thành `IN ('done', 'in_progress')` | 3 | "lists done tool rows and nothing else", route, và e2e |
| M5 | bỏ `LIMIT 50` | 1 | "caps at 50 and keeps the newest by updated_at" |
| M6 | thêm `taskRef: 'leak'` vào danh sách accepted | 1 | "the other lists keep their shape…" |

M6 chỉ chứng minh được việc rò `taskRef` vào danh sách accepted. Danh sách open và in-progress được bảo vệ bằng cùng assertion (`not.toHaveProperty`), chưa qua mutation.

## Kiểm tra

- Typecheck server: `npx tsc -p tsconfig.json --noEmit`, không qua pipe, `TSC_EXIT=0`.
- Focused 10 file (`toolProposalDoneList`, `toolProposalCheckDone`, `toolProposalStart`, `toolProposalInProgressList`, `toolProposalAcceptedList`, `toolProposalAccept`, `toolProposalImpNumber`, `improvementRequests`, `improvementSelfTune`, `improvementSelfTuneLegacy`): 10 file, 134/134 xanh, `EXIT=0` (124 của 6e + 10 mới).
- Protected paths: `git status --short -- docs/proposals data data-dev` không có thay đổi.
- `.done` dưới `docs/tasks`: vẫn 142 file, như trước. Không tạo `.done` nào. Test e2e dùng thư mục tạm.
- Full server suite: xem mục dưới.
- Mutation chạy sau lần sửa mã cuối cùng. Kiểm tra lại sau full suite: `git -C <repo> status --short -- docs/proposals data data-dev` trống, `.done` dưới `docs/tasks` vẫn 142, `toolProposals.ts` giống hệt bản sao lưu (`cmp` không khác biệt).

### Full server suite

Chạy `npx vitest run` đầy đủ trong `apps/server` (log: `scratchpad/full-suite-6g.log`):

- Test Files: 295 passed, 4 skipped (299).
- Tests: 2456 passed, 9 skipped (2465).
- `FULL_EXIT=0`, không có dòng FAIL.
- Trong lúc suite chạy có chạy song song typecheck và focused 10 file. Không có file nào hết thời gian chờ, không cần chạy lại.
- Suite chạy trước khi đổi tên test (xem Chạy xanh sau khi cài). Đổi tên chỉ đổi tiêu đề, không đổi thân test, nên không cần chạy lại suite.

## Giới hạn đã biết

1. `updated_at` không nằm trong item. Nó là thời điểm ghi cuối cùng của hàng, không phải thời điểm chuyển sang done. Hai thời điểm này chỉ trùng khi không còn gì khác ghi vào hàng done.
2. Giới hạn 50 không có phân trang, nên các hàng done cũ hơn không đến được qua API.
3. Khóa phụ `id` không được test (tie-break khi hai hàng có cùng `updated_at`).
4. Test e2e giả lập bản nháp bằng cách đặt trực tiếp `drafted_at` và `imp_number`, không gọi `draftProposal`. Lý do: `draftProposal` ghi vào `docs/proposals`.
5. Test đọc bằng API key đi qua `testActor`. Khẳng định ngang bằng với route in-progress của 6b, không hơn.
6. Chưa có bên đọc nào của danh sách done: không MCP, không web. Mục "Đã xong" trên trang là 074c-6h.

## Chưa làm (cố ý)

- Mục "Đã xong" trên trang web (074c-6h, kế tiếp).
- MCP đọc danh sách done.
- Phân trang, và sắp xếp theo thời điểm chuyển sang done (cần cột riêng).
- Đường quay lại từ `done`.
- Áp dụng migration vào DB thật.
