# TASK-074c-6a — chuyển accepted → in_progress bằng dấu của người dùng (báo cáo)

Trạng thái: đã code và test trong cây làm việc. Chưa commit, chưa push, chưa có `.done`. Không khởi động app. Không ghi vào `data/`, `data-dev/` hoặc `docs/proposals/`. Không có migration mới, không đổi `writeGuard.ts`, không đổi `selfImprovementBudgetStatus` hay shape của `improvementSelfTuneStats`.

## Phạm vi

- Chỉ một chuyển trạng thái mới: `accepted → in_progress`, do người dùng đánh dấu, và chỉ khi hàng đã có bản nháp (`drafted_at IS NOT NULL`). Lý do điều kiện: bản nháp đang chạy không được mất cập nhật trạng thái.
- Chỉ phía server. Không nối vào giao diện web hay MCP.
- Không làm: kiểm tra gated bằng `.done`, danh sách hàng `in_progress`, migration thêm cột liên kết task. Đây là phần sau, cần advisor duyệt trước.

## Thay đổi

- `apps/server/src/operator/toolProposals.ts`: thêm `startToolProposal(db, id)`, đặt ngay sau `acceptToolProposal`. Câu lệnh: `UPDATE improvement_requests SET status = 'in_progress', updated_at = ? WHERE id = ? AND kind = 'tool' AND status = 'accepted' AND drafted_at IS NOT NULL`.
- `apps/server/src/api/operator.ts`: thêm `POST /api/operator/tool-proposals/:id/start`. Route kiểm `request.actor?.kind === "user"` (không thì 403 `OPERATOR_TOOL_PROPOSAL_USER_ONLY`), parse `id` bằng `z.string().uuid()` và trả `{ ok: true }`. Route nằm trong guard chung `ANY /api/operator/*` (`auth/routePermissions.ts:122`), không cần sửa quyền.
- `apps/server/test/toolProposalStart.test.ts` (mới): 12 test = 10 unit + 2 route. Unit (10): hàng drafted accepted chuyển sang in_progress, `updated_at` đổi, các cột khác giữ nguyên; hàng accepted chưa có bản nháp không đổi; sáu trạng thái open, rejected, done, in_progress, verified, failed_verification có bản nháp không đổi (sáu case của `it.each`); hàng kind khác không đổi; id lạ là no-op. Route (2): một test gộp — API key nhận 403 và hàng vẫn accepted, rồi user nhận 200 `{ok:true}` và hàng thành in_progress; một test id không phải uuid nhận 400 `VALIDATION_ERROR` và không đụng hàng.

## Kiểm tra red trước

- Chạy `toolProposalStart.test.ts` trước khi có hàm và route: 12/12 đỏ (`startToolProposal is not a function`; route trả 404).
- Sau khi cài: 12/12 xanh.

## Mutation (mỗi cái một lần, hoàn nguyên từ bản sao lưu, `cmp` giống hệt)

- M1, bỏ `AND status = 'accepted'`: đỏ 6 test (6 trạng thái không accepted có bản nháp bị đổi).
- M2, bỏ `AND drafted_at IS NOT NULL`: đỏ 1 test (hàng accepted chưa có bản nháp bị chuyển).
- M3, bỏ kiểm `actor.kind === "user"`: đỏ 1 test (API key được chuyển trạng thái).
- M4, đổi `z.string().uuid()` thành `z.string()`: đỏ 1 test (id không phải uuid được chấp nhận).
- Sau khi hoàn nguyên bốn lần: 12/12 xanh.

## Kết quả kiểm tra

- Focused, 7 file (`toolProposalStart`, `toolProposalAccept`, `toolProposalAcceptedList`, `toolProposalImpNumber`, `improvementRequests`, `improvementSelfTune`, `improvementSelfTuneLegacy`): 79/79 pass.
- Server typecheck (`npx tsc -p tsconfig.json --noEmit`): exit 0.
- Full server suite: xong, log `scratchpad/server-full-6a.log` (task `b4t5l1utn`, 274.75 s, `SUITE_EXIT=0`). Xem mục "Kết quả full server suite" bên dưới.

## Giới hạn đã biết

1. `assignImpNumber` trả null cho hàng không accepted, kể cả in_progress. Hàng in_progress luôn đã có bản nháp (`drafted_at` đặt sau khi số đã được cấp trong `draftProposal`, `proposalDraft.ts:55`), nên số đã có sẵn. Chỉ một caller tương lai gọi `draftProposal` trên hàng in_progress mới gặp null, và khi đó trả `skipped not_accepted`. Cần xác nhận cách xử lý trước khi nối luồng số hiệu.
2. Không có migration: `improvement_requests` chưa có cột liên kết task, nên kiểm tra `.done` chưa thể làm. Đây là việc của slice sau.
3. Không có đường nối MCP tới route `start`. Giao diện web đã nối ở 074c-6c. Chỉ gọi được qua API hoặc giao diện web với user đăng nhập.
4. Không có kiểm tra `.done`. Trạng thái in_progress hiện không tự chuyển tiếp sang done/verified.
5. Không có danh sách hàng in_progress trong API. (Đã đóng bởi 074c-6b, `GET /api/operator/tool-proposals/in-progress`; full suite `b38lxw8h8` xác nhận 293/4 (297), 2408/9 (2417), `SUITE_EXIT=0`.)
6. Không chạy trong trình duyệt; app chưa khởi động.
7. Thống kê tự hiệu chỉnh (`improvementSelfTune`) đếm `in_progress` là đã quyết và được chấp nhận (pin tại `apps/server/test/improvementSelfTune.test.ts:86-90`). Vì vậy chuyển accepted → in_progress không đổi tỉ lệ. Chỉ kiểm bằng test, chưa đo trên dữ liệu thật.
8. Sau khi chuyển, hàng không còn trong danh sách accepted (`listAcceptedToolProposals` chỉ lấy `status='accepted'`). Đã đóng bởi 074c-6b: danh sách in_progress đọc được qua `GET /api/operator/tool-proposals/in-progress`, và 074c-6c hiện danh sách đó trên giao diện web.
9. Chuyển chỉ một chiều. Route trả `{ok:true}` cả khi không có gì đổi (id lạ, hàng chưa có bản nháp, trạng thái khác), giống route accept, nên người gọi không biết việc chuyển có xảy ra hay không. Muốn biết phải đọc lại hàng.

## Chưa làm (cố ý)

- Kiểm tra gated bằng `.done` và migration thêm cột liên kết task.
- Danh sách hàng in_progress. (Đã làm ở 074c-6b; full suite `b38lxw8h8` đã xác nhận.)
- So sánh 14/28 ngày.
- Đường ghi `effort` và ánh xạ đầu ra cho 074c-3.

## Kết quả full server suite

- Lệnh: `npx vitest run` trong `apps/server`, chạy nền (task `b4t5l1utn`). Log: `scratchpad/server-full-6a.log`.
- Kết quả: Test Files 292 passed, 4 skipped (296); Tests 2401 passed, 9 skipped (2410); Duration 274.75 s; `SUITE_EXIT=0`. Không có dòng FAIL.
- Đối chiếu: fix1 là 291/4 (295) và 2389/9 (2398). 6a thêm đúng 1 file (`toolProposalStart.test.ts`) và 12 test. Khớp dự kiến của advisor.
- `git status --short -- docs/proposals data data-dev`: không có thay đổi.
- Trạng thái: 074c-6a đã đóng trên full server suite. Chưa commit, chưa push, chưa có `.done`.
