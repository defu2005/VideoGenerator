# TASK-074c-4b-2 — đường đọc danh sách dòng `accepted` (báo cáo)

Trạng thái: chỉ có thao tác đọc (read-only) cho dòng tool đã chấp nhận, đã code và test trong cây làm việc. Không chuyển trạng thái, không có LLM, không đánh số `IMP-<n>`, không migration, không giao diện, không tool registry hay MCP. Chưa commit, chưa push, chưa có `.done`.

## Đã làm

- `apps/server/src/operator/toolProposals.ts`:
  - `listAcceptedToolProposals(db, logger?)`: đọc `kind = 'tool' AND status = 'accepted'`, sắp `created_at DESC, id`, giới hạn 50.
  - Tách vòng lặp dựng item chung thành `toListedProposals(rows, logger)`. `listToolProposals` giữ nguyên SQL (`status = 'open'`) và hành vi.
  - Cùng dạng item, cùng thứ tự, cùng giới hạn, cùng luật bỏ qua dòng hỏng (ghi cảnh báo kèm `id`) với danh sách mở.
- `apps/server/src/api/operator.ts`: `GET /api/operator/tool-proposals/accepted`, trả `{ items }`. Không có kiểm user-only, vì đọc không phải quyết định. Việc chấp nhận vẫn là user-only (4b-1).
- `apps/server/test/toolProposalAcceptedList.test.ts` (mới): 7 test.
  - Mức DB: chỉ dòng tool accepted; dạng item (id, createdAt, kind, name, reproduction, acceptance); mới nhất trước và giới hạn 50 (chèn 51 dòng); bỏ qua dòng hỏng và cảnh báo `{ id }`; dòng xuất hiện sau accept và biến mất khi không còn accepted.
  - Mức route: user nhận `{ items }` và không có dòng open; API key nhận 200, khoá hành vi "đọc không có kiểm user-only".
- `acceptToolProposal`, `dismissToolProposal` và route POST `/:id/accept`, `/:id/dismiss` không đổi.

## Lý do thiết kế

- Dòng accepted nằm ở view riêng, không trộn vào danh sách mở. Danh sách mở (`ToolProposals.tsx`) không đổi.
- Route đọc không có kiểm user-only, vì đọc không phải quyết định. Chấp nhận vẫn user-only. Advisor đã quyết định hướng này.
- Không có chuyển trạng thái `accepted` → `in_progress` ở lát này. Spec (TASK-074 §5, dòng 250–251) định nghĩa nó là việc người dùng đánh dấu hoặc có file `.done`, và chưa có code nào làm việc đó.

## Kết quả kiểm tra

- Red trước khi có code: 7 test đỏ (hàm không tồn tại; route trả 404). Trạng thái đỏ được ghi nhận trước khi viết implementation.
- Xanh sau implementation: 4 file, 58 test (`toolProposalAcceptedList`, `toolProposalAccept`, `improvementRequests`, `operator`).
- Mutation 1 — bỏ `AND status = 'accepted'` khỏi WHERE (đọc mọi trạng thái): 3 test đỏ. Đã hoàn nguyên và xanh lại.
- Mutation 2 — bỏ `kind = 'tool'` khỏi WHERE: 1 test đỏ. Đã hoàn nguyên và xanh lại.
- `npx tsc --noEmit` trong `apps/server`: exit 0 (kiểm sau implementation, trước mutation). Chạy lại sau khi hoàn nguyên mutation: exit 0 (2026-11-20, 15:4x).

## Phát hiện khi đọc code (orientation cho 4b-3)

- `docs/cursor/TASK-074c.md` dòng 64: "Khi chấp nhận, một lần gọi LLM ghi `docs/proposals/IMP-<n>.md` theo mẫu `docs/cursor/TASK-*.md`...". Guide không nói ai cấp số `<n>`. Mở cho 4b-3.
- `docs/cursor/TASK-074c.md` dòng 66: trang hiển thị "Bản nháp guide — cần Claude xem lại trước khi giao Codex/Cursor". Đây là yêu cầu cho 4b-3, chưa làm.
- `apps/server/src/operator/improvementRanking.ts:35` chỉ xếp hạng dòng `status === "open"`. `improvementOpenSource.ts:40,62` đọc và ghi theo id. Không đường nào đưa dòng accepted vào xếp hạng hay open-source.
- Guide không nói dòng accepted có quay lại được không. Enum trạng thái không có chuyển ngược, nên dòng accepted giữ nguyên. Đây là giới hạn đã ghi nhận.

## Giới hạn đã biết (ghi nhận, chưa sửa)

1. Dòng accepted không có đường quay lại. Dismiss là no-op trên nó.
2. Dòng accepted hỏng bị ẩn khỏi danh sách và không sửa được.
3. Dismiss không có kiểm user-only (bất đối xứng có sẵn, không đổi).
4. Accept không kiểm `proposal` đã lưu.
5. "Đã accepted, chưa có bản nháp" không có dấu hiệu lưu trữ. Để 4b-3 (cần số `IMP-<n>` và migration).
6. `list_improvement_requests` (spec §5) và `propose_improvement` chưa có. Route HTTP là lối tạm; bản qua tool registry là bước sau.
7. Reject chỉ user-only theo spec chưa có.

## Full suite

- `npx vitest run --reporter=verbose` trong `apps/server`, chạy nền sau khi xong code và mutation (lần chạy 15:34, 372 giây): **Test Files 282 passed | 4 skipped (286); Tests 2313 passed | 9 skipped (2322); EXIT 0.** Log: `scratchpad/server-full-4b2.log` (đường dẫn đầy đủ: `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\074f5dd9-9e4f-4407-b442-670a7f5dc0ae\scratchpad\server-full-4b2.log`, có thể bị xoá).
- Đối chiếu theo tên file, không theo phép cộng: log verbose liệt kê từng test. Cả 7 test của `toolProposalAcceptedList.test.ts` đều ✓ (5 mức DB, 2 mức route).
- Đối chiếu số: 4b-1 là 281 file và 2306 test. 4b-2 thêm đúng 1 file và 7 test: 282 file và 2313 test. Khớp.
- Chuỗi "FAIL" trong log chỉ xuất hiện trong tên test (ví dụ "fails with ACTION_FAILED", "records ... as FAILED"), không có test nào đỏ.

## Chưa làm (cố ý)

- Commit, push, `.done`.
- Bộ sinh bản nháp, LLM, đánh số `IMP-<n>`, migration, dấu hiệu "accepted chưa có bản nháp" (4b-3).
- Chuyển `accepted` → `in_progress`.
- Ghi vào `docs/proposals/` thật, `data/`, `data-dev/`.
