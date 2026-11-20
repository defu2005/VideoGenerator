# TASK-074c-6b — danh sách chỉ đọc các hàng in_progress (báo cáo)

Trạng thái: đã code và test trong cây làm việc. Chưa commit, chưa push, chưa có `.done`. Không khởi động app. Không ghi vào `data/`, `data-dev/` hoặc `docs/proposals/`. Không có migration, không đổi `writeGuard.ts`, không đổi `selfImprovementBudgetStatus` hay shape của `improvementSelfTuneStats`.

## Phạm vi

- Chỉ đọc. Không có chuyển trạng thái mới, không có bản nháp, không có cấp số, không có migration.
- Chỉ phía server. Không nối vào giao diện web hay MCP.
- Không làm: kiểm tra gated bằng `.done`, migration thêm cột liên kết task. Advisor đã ghi các phần này là thiết kế riêng, cần duyệt trước.

## Thay đổi

- `apps/server/src/operator/toolProposals.ts`: thêm `listInProgressToolProposals(db, logger?)`, đặt ngay sau `listAcceptedToolProposals`. Truy vấn: `kind = 'tool' AND status = 'in_progress'`, mới nhất trước, giới hạn 50. Cùng dạng item, cùng quy tắc bỏ qua hàng lỗi (ghi cảnh báo qua logger) và cùng `impNumber`/`draftedAt` với danh sách accepted. Hàm dùng chung vòng lặp `toListedProposals`. Danh sách accepted không đổi.
- `apps/server/src/api/operator.ts`: thêm `GET /api/operator/tool-proposals/in-progress`, trả `{ items }`. Không có kiểm tra chỉ-user, giống route accepted (đọc không phải quyết định).
- `apps/server/test/toolProposalInProgressList.test.ts` (mới): 7 test. Hàm (5): chỉ lấy hàng tool in_progress; dạng item có `impNumber` và `draftedAt`; sắp xếp mới nhất trước và giới hạn 50; bỏ qua hàng lỗi và cảnh báo đúng id; hàng vừa chuyển bằng `startToolProposal` xuất hiện ở đây và rời danh sách accepted. Route (2): user nhận `{ items }` đúng; API key cũng đọc được.

## Kiểm tra red trước

- Chạy file test trước khi có hàm và route: 7/7 đỏ. Hàm báo `listInProgressToolProposals is not a function`; route trả 404.
- Sau khi cài: 7/7 xanh.

## Mutation (mỗi cái một lần, hoàn nguyên từ bản sao lưu, `cmp` giống hệt)

- M1, đổi `status = 'in_progress'` thành `status = 'accepted'` trong truy vấn mới: đỏ 7 test.
- M2, bỏ `kind = 'tool' AND` trong truy vấn mới: đỏ 1 test (hàng feature in_progress bị lấy).
- Sau khi hoàn nguyên hai lần: 7/7 xanh.

## Kết quả kiểm tra

- Focused, 8 file (`toolProposalInProgressList`, `toolProposalAcceptedList`, `toolProposalStart`, `toolProposalAccept`, `toolProposalImpNumber`, `improvementRequests`, `improvementSelfTune`, `improvementSelfTuneLegacy`): 86/86 pass.
- Server typecheck (`npx tsc -p tsconfig.json --noEmit`): exit 0.
- Full server suite: xong, task `b38lxw8h8`, log `scratchpad/server-full-6b.log`, 290.34 s, `SUITE_EXIT=0`. Xem mục dưới.

## Giới hạn đã biết

1. MCP chưa đọc danh sách in_progress. Giao diện web đã đọc nó từ 074c-6c, nên chỉ MCP còn mở.
2. Hàm sao chép phần map `impNumber`/`draftedAt` của danh sách accepted (không gộp thành hàm chung). Đây là chọn lựa để không đụng vào code đã test; có thể gộp sau.
3. Không có kiểm tra `.done`. Trạng thái in_progress không tự chuyển tiếp sang done hay verified.
4. Không chạy trong trình duyệt; app chưa khởi động.

## Chưa làm (cố ý)

- Kiểm tra gated bằng `.done` và migration thêm cột liên kết task (cần thiết kế riêng, advisor duyệt trước).
- So sánh 14/28 ngày.
- Đường ghi `effort` và ánh xạ đầu ra cho 074c-3.

## Kết quả full server suite

- Lệnh: `npx vitest run` trong `apps/server`, chạy nền (task `b38lxw8h8`). Log: `scratchpad/server-full-6b.log`.
- Kết quả: Test Files 293 passed, 4 skipped (297); Tests 2408 passed, 9 skipped (2417); Duration 290.34 s; `SUITE_EXIT=0`. Không có dòng FAIL.
- Đối chiếu: 6a là 292/4 (296) và 2401/9 (2410). 6b thêm đúng 1 file (`toolProposalInProgressList.test.ts`) và 7 test. Khớp dự kiến.
- Assertion thêm sau suite (số test không đổi, vẫn 7/7): test "a row moved from accepted by start…" trước đó chưa kiểm danh sách accepted. Đã thêm `listAcceptedToolProposals` trước và sau `startToolProposal`. Chạy lại file: 7/7 xanh. Cùng kiểu với 4b-3a.
- `git status --short -- docs/proposals data data-dev`: không có thay đổi.
- Trạng thái: 074c-6b đã đóng trên full server suite. Chưa commit, chưa push, chưa có `.done`.
