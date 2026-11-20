# TASK-074c-1 fix1 — báo cáo (2026-11-20)

Sửa hai điểm review của [074c-1](TASK-074c-1.review.md) (điểm 1 và 2) và thêm test khóa vòng đời. Không commit. Không `.done`. Không ghi vào `data/` hay `data-dev/`.

## Thay đổi

- `apps/server/src/operator/toolProposals.ts`: `listToolProposals` đọc từng dòng bằng `parseLegacyDetails` (đã là `safeParse` trong `try`). Dòng `proposal` hỏng bị bỏ qua và ghi cảnh báo kèm `id`. Danh sách không còn bị lỗi cả khi một dòng hỏng. Nhận `logger` tùy chọn; không có thì rơi về `console.warn`.
- `apps/server/src/operator/service.ts`: thêm `warn` vào kiểu `Logger` và mặc định; `learningReport()` truyền `this.logger` vào `listToolProposals`.
- `apps/server/src/api/operator.ts`: `GET /api/operator/tool-proposals` truyền `app.log`.
- `apps/server/src/db/migrate.ts`: bước chép legacy có `try` riêng. Lỗi chép ném thông báo "Legacy tool proposal copy into improvement_requests failed. operator_tool_proposals was not changed; fix the cause and restart." Không còn khuyên xóa `data/app.db`. Lỗi migration thường giữ nguyên thông báo cũ.
- `apps/server/test/improvementRequests.test.ts`: 3 test mới:
  1. Danh sách bỏ qua dòng `proposal` không phải JSON và dòng không qua schema; trả về đúng dòng tốt; `warn` được gọi 2 lần, mỗi lần nêu đúng `id` của dòng hỏng.
  2. Chép legacy lỗi: thông báo chứa "legacy tool proposal", không chứa "delete data/app.db". Test có chèn một dòng legacy để vòng chép cũng chạy. Việc xóa bảng `improvement_requests` làm câu INSERT lỗi ngay ở bước `prepare`, trước vòng lặp; đã kiểm (2026-11-20) bằng cách bỏ dòng chèn: test vẫn đạt, nên dòng chèn không phải thứ làm test lỗi.
  3. Khóa vòng đời: lặp lại sau `done`, `verified`, `failed_verification`, `rejected` đều mở dòng mới và tốn budget.

## Kiểm chứng

- **Đỏ trước khi sửa:** `npx vitest run test/improvementRequests.test.ts` → 2 failed, 14 passed. Hai test đỏ là danh sách (`SyntaxError` ở `listToolProposals`) và thông báo chép legacy (trả về thông báo migration cũ). Test khóa vòng đời xanh ngay, đúng như dự kiến cho một test khóa.
- **Khóa vòng đời đã kiểm đỏ:** thêm `done` vào `status IN (...)` trong `toolProposals.ts` → test khóa đỏ (`expected 'duplicate' to be 'proposed'`). Đã khôi phục về `('open', 'accepted', 'in_progress')` và đọc lại được ở dòng 57. Không so với HEAD: `toolProposals.ts` là file đã sửa lớn so với HEAD (97 dòng thêm, 14 dòng bớt) và HEAD không có dòng này. Chỉ `done` được kiểm bằng đột biến; ba trạng thái còn lại nằm trong cùng vòng lặp nhưng không được đột biến riêng.
- **Sau khi sửa (trước khi nối logger):** `improvementRequests` + `improvementRanking` → 2 file, 24 test đạt.
- **Sau khi nối logger, code cuối:** bộ `operator*` + `improvementRanking` + `improvementRequests` + `selfImprovementBudget` → 17 file, 184 test đạt.
- `npx tsc --noEmit -p .` trong `apps/server` → không lỗi, exit 0 (chạy hai lần, lần sau cùng khi đã nối logger).
- **Full suite `npx vitest run` trong `apps/server`:** xem mục "Full suite" bên dưới.

## Giới hạn đã biết (ghi nhận, không sửa)

- Giới hạn cũ, đã đóng cho lần lặp (xem 074c-2 fix2): một dòng `open` có `proposal` hỏng từng gộp lần lặp mà không hiện trong danh sách. Từ fix2, lần lặp hợp lệ sửa dòng đó tại chỗ và dòng hiện lại. Còn mở: dòng hỏng không bao giờ được lặp lại thì vẫn ẩn; dòng `accepted` hoặc `in_progress` hỏng không được sửa.
- Dòng legacy hỏng vẫn cảnh báo mỗi lần khởi động cho đến khi sửa hoặc xóa (chủ ý, theo báo cáo gốc).

## Full suite

Chạy 2026-11-20, `npx vitest run` trong `apps/server`, log `scratchpad/server-full-fix1.log`. Chạy bắt đầu trước khi nối logger, nên không phủ đúng code cuối.

- Kết quả: 276 file đạt, 1 file lỗi, 4 skip; 2236 test đạt, 1 lỗi, 8 skip; `EXIT=1` (vitest).
- Lỗi duy nhất: `test/agentEventsSse.test.ts` › "agent events SSE over HTTP is scoped to the viewer's workspace" › "B's live stream gets B's message and never A's", hết thời gian 11002 ms.
- Chạy lại riêng file đó trên cùng code: 1 đạt / 1, 11.8 s. Kết luận: lỗi chỉ xuất hiện khi chạy cả bộ; chưa tìm được nguyên nhân gốc. Chưa xác nhận là flaky vì chưa chạy lại cả bộ. (Cập nhật 2026-11-20: đã chạy lại cả bộ sạch, xem mục dưới; không tái tạo được lỗi.)
- Bộ operator* cùng hai file improvement và `selfImprovementBudget` chạy lại trên code cuối (sau khi nối logger): 17 file, 184 test đạt.
- `npx tsc --noEmit -p .` trong `apps/server`: exit 0.

**Chạy sạch trên code cuối (2026-11-20, log ghi xong lúc 14:19; chưa kiểm xem có tiến trình nào khác chạy song song không):** `npx vitest run` trong `apps/server` → 277 file đạt, 4 skip; 2237 test đạt, 8 skip (tổng 2245); `EXIT=0`; log `scratchpad/server-full-fix1-rerun.log`. Không có lỗi nào, kể cả `agentEventsSse.test.ts`.

Quyết định của advisor (có thể đảo): chạy lại sạch là điều kiện đóng fix1; không sửa test SSE khi chưa tái tạo được lỗi.

**Kiểm bổ sung (2026-11-20):** bỏ dòng chèn legacy khỏi test "names the legacy copy…": test vẫn đạt. Dòng chèn được khôi phục để vòng chép cũng chạy trong test; nó không phải thứ làm test lỗi.

Chưa kiểm: nguyên nhân gốc của lỗi SSE của lần chạy đầu (không tái tạo được trong lần chạy sạch).

**Kiểm trạng thái cuối của file test (2026-11-20, 14:21):** `grep old-broken-copy` thấy dòng chèn đã được khôi phục; `npx vitest run test/improvementRequests.test.ts` → 1 file đạt, 16 test đạt. Đây là bằng chứng cho trạng thái cuối của file, không thay cho lần chạy sạch ở trên.
