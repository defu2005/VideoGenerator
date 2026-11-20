# TASK-074c-6f — nút "Kiểm tra đã xong" trên mục "Đang làm" (báo cáo)

Trạng thái: đã code và test trong cây làm việc (chỉ phía web). Chưa commit, chưa push, chưa có `.done` thật. Không khởi động app, không dùng `preview_start`, chưa kiểm tra trên trình duyệt. Không ghi vào `data/`, `data-dev/`, `docs/proposals/`. Không ghi `.done` thật dưới `docs/tasks`. Không đổi server, không đổi MCP.

## Phạm vi

- Chỉ `apps/web`. Thêm điều khiển check-done vào từng hàng trong mục "Đang làm" của `ToolProposals.tsx`, gọi `POST /api/operator/tool-proposals/:id/check-done` đã có từ 074c-6e.
- Không làm: MCP, nút trên hàng "Đã chấp nhận", đọc nội dung acceptance, kiểm tra nội dung hay độ mới của `.done`.

## Thay đổi

- `apps/web/src/features/operator/ToolProposals.tsx`:
  - `taskInputs`: tên task gõ vào theo từng id hàng. Chỉ xóa mục của hàng khi check của chính hàng đó thành công.
  - `checkDone` (mutation dùng chung): `POST` với body `JSON.stringify({ task })`, `onSettled: refresh` (luôn làm mới danh sách sau mọi kết quả), `onSuccess` xóa mục của hàng.
  - Trong mục "Đang làm": mỗi hàng có `<input aria-label="Tên task cho <tên>">` và nút "Kiểm tra đã xong" (`type="button"`, không có `<form>`). Nút bị vô hiệu khi tên task rỗng sau khi trim, hoặc khi `checkDone` đang chờ (mọi nút, không chỉ hàng vừa bấm).
  - `checkDone.error` nằm trong chuỗi hiển thị lỗi, đặt trước `inProgress.error`.
  - Dòng kết quả nằm ngoài hàng, `role="status"`, một chuỗi duy nhất: `Đã đánh dấu xong: <tên> (task <TASK>)`. Lấy tên và task từ `checkDone.variables` (task đã trim), không đọc từ danh sách.
- `apps/web/src/features/operator/ToolProposals.test.tsx`: `stubApi` ghi thêm `body` và `contentType`. Thêm 8 test cho check-done (xem dưới).

## Chỉnh sửa sau lần chạy đầu

- Ô nhập có placeholder `Ví dụ: TASK-074c-6e`.
- Test lỗi 400 trước dùng một thông báo tự viết. Đã đổi sang thông báo thật của server: `Request validation failed` (handler lỗi toàn cục trong `apps/server/src/app.ts`, ZodError và validation Fastify trả 400 `VALIDATION_ERROR` với thông báo này). Lỗi 400 hiện hiển thị đúng chuỗi tiếng Anh này.
- Lỗi 409 hiển thị theo thông báo thật của server cho `OPERATOR_TASK_NOT_DONE` (chưa có `.done`): `Chưa có file .done cho task này.`
- Lỗi 409 thứ hai, `OPERATOR_TOOL_PROPOSAL_NOT_IN_PROGRESS`: `Đề xuất này không ở trạng thái đang làm.` Không có test riêng; đi cùng đường hiển thị lỗi chung của test 409 đầu tiên.
- Sau hai chỉnh sửa trên: chạy lại focused `ToolProposals.test.tsx` (32/32, exit 0), `npm run typecheck` (exit 0) và full web suite (95 file, 291 test, exit 0).
- Đối chiếu số test: 283 test trước 6f + 8 test mới = 291.
- M8 chạy riêng, file được sao lưu trước và `cmp` giống hệt sau khi khôi phục. Test đỏ duy nhất: `disables every check-done button while one request is in flight, then settles`. Kiểu lỗi: AssertionError (`expected false to be true`), không phải timeout (log không có dòng `Test timed out`). Thời gian ghi nhận 10061 ms; nguyên nhân thời gian dài chưa xác định.
- `git status --short -- docs/proposals data data-dev`: không có thay đổi (exit 0).

## Kiểm tra

- Lần chạy đỏ đầu (trước khi cài đặt, 7 test mới): `Tests 7 failed | 24 passed (31)`. 24 test cũ vẫn xanh.
- Sau lần chạy đỏ đầu, thêm 1 test (chờ-gửi, pending) và 1 assertion xác nhận lại dòng kết quả sau khi làm mới (nằm trong test thành công). Tổng vẫn là 8 test mới. Test chờ-gửi được thêm **sau** lần chạy đỏ đầu, nên chưa chạy đỏ riêng trên bản trước cài đặt. Bằng chứng gián tiếp: mutant M8 (bỏ vô hiệu hóa khi chờ) làm đỏ 1 test, tên test dưới đây.
- Focused `ToolProposals.test.tsx` sau khi cài: `Tests 32 passed (32)`, `EXIT=0`.
- Mutation (mỗi cái một lần, file gốc được sao lưu trong scratchpad, khôi phục rồi `cmp` giống hệt):

| Mutant | Thay đổi | Kết quả |
|---|---|---|
| M1 | chỉ làm mới khi thành công (bỏ `onSettled`) | đỏ 2 |
| M2 | bỏ `checkDone.error` khỏi chuỗi lỗi | đỏ 2 |
| M3 | bỏ `trim()` | đỏ 2 |
| M4 | bỏ vô hiệu hóa khi ô rỗng | đỏ 1 |
| M5 | dòng kết quả chỉ hiện khi hàng còn trong danh sách | đỏ 1 |
| M6 | thêm ô nhập vào hàng "Đã chấp nhận" (nhánh nút soạn bản nháp), bọc bằng fragment | đỏ 1 |
| M7 | một ô nhập dùng chung cho mọi hàng | đỏ 2 |
| M8 | bỏ vô hiệu hóa khi đang chờ | đỏ 1 |

  M1–M7 chạy trước các sửa placeholder và 400-text, không chạy lại sau đó. Chỉ M8 được chạy lại sau các sửa. Lần chạy đầu của M6 cho "no tests" vì JSX lỗi cú pháp (hai phần tử anh em trong một nhánh ba ngôi, thiếu fragment). Đó không phải kết quả kiểm thử. Đã sửa bằng fragment và chạy lại toàn bộ 8 mutant. Lần chạy lại không có lỗi parse.
- `npm run typecheck` trong `apps/web`: exit 0.
- Full web suite `npx vitest run` trong `apps/web`: `Test Files 95 passed (95)`, `Tests 291 passed (291)`, `EXIT=0`. Log: `scratchpad/6f-web-suite2.log` (lần chạy cuối, sau các sửa placeholder và 400-text). Không có test nào lỗi, nên không cần chạy lại.
- Server không chạy lại trong 6f (không đổi server).

## Giới hạn đã biết

1. Chưa kiểm tra trên trình duyệt. Không khởi động app, không dùng `preview_start`. Mục "Đang làm" nằm trong `<details>` của từng hàng, nên người dùng phải mở hàng trước khi thấy ô nhập và nút.
2. Dòng kết quả được hiển thị đúng khi thành công. Với lỗi, thông báo đi vào khung lỗi chung của mục, không có dòng kết quả riêng.
3. Trên Windows, `existsSync` không phân biệt hoa thường (giới hạn đã ghi ở 6e). Giao diện không thêm cách kiểm tra mới.
4. Server vẫn là nguồn quyết định định dạng tên task. Giao diện chỉ trim và chặn rỗng.
5. MCP chưa đọc hay gọi check-done.
6. Lỗi cũ trong chuỗi lỗi chung (dismiss, accept, draft, start) có thể che lỗi 409 mới của check-done cho tới khi mutation đó chạy lại. Đã ghi nhận, chưa sửa.
7. Hàng "Đã chấp nhận" đã soạn bản nháp (`draftedAt` có giá trị) chưa được test bằng test "không có điều khiển check-done" hay M6. Chỉ nhánh chưa soạn được kiểm tra.

## Chưa làm (cố ý)

- Nút check-done trên hàng "Đã chấp nhận".
- MCP wiring cho check-done.
- Kiểm tra trên trình duyệt.
- Đường quay lại từ `done`.

## 2026-11-21: 6f, một ô cảnh báo cho thao tác (quyết định advisor; chỉ web, không đổi server)

- **Advisor decided 2026-11-21:** giữ một ô cảnh báo. Một state `actionError` do năm mutation dùng chung (dismiss, accept, draft, start, check-done): `onMutate` xoá, `onError` ghi. Chuỗi: `proposals.error ?? accepted.error ?? actionError ?? inProgress.error ?? done.error` (`apps/web/src/features/operator/ToolProposals.tsx`). Không gọi `reset()` (giữ dòng `isSuccess` ở khối "Đã đánh dấu xong"); không dùng trường timestamp của mutation.
- **Test đỏ trước** (`apps/web/src/features/operator/ToolProposals.test.tsx`, describe mới "TASK-074c-6f: one alert slot for action errors", 2 test): `2 failed | 41 passed`. Test 1: dismiss lỗi rồi check-done 409. Lý do đỏ của test 1 chưa quan sát được (lần chạy đỏ bị pipe qua `tail`, chỉ thấy diff của test 2); "ô vẫn hiện lỗi dismiss" là suy luận từ thứ tự chuỗi cũ, chưa tái hiện. Test 2: draft lỗi rồi start thành công, ô vẫn hiện lỗi draft (cố ý xoá từ nay).
- **Test accept (thêm sau bước đỏ, advisor yêu cầu):** "a failed accept shows its message in the section alert". Mutant M3 (bỏ `...actionFailure` ở accept): 1 test đỏ (`6f-mut3-no-accept-spread.log`), khôi phục `cmp` giống hệt. Focused sau đó 44/44 (`6f-accept-green.log`).
- **Sau sửa:** focused `ToolProposals.test.tsx` 43/43 (trước khi thêm test accept; sau đó 44/44, xem trên); `tsc --noEmit` trong `apps/web` exit 0.
- **Mutant:** M1 (bỏ `onMutate`): 1 test đỏ. M2 (bỏ `onError`): 4 test đỏ. Mỗi lần khôi phục bằng `cp` từ bản sửa trong scratchpad, `cmp` giống hệt.
- **Full web:** lần 1 có 1 đỏ ở `apps/web/src/features/pipeline/OverdueCard.test.tsx` ("dự kiến còn ~3 phút"). Không liên quan 6f. Nguyên nhân (đã xác nhận, không phải đồng hồ): test chờ `getByRole("status")`, nhưng `LocationOutput` trong `apps/web/src/test/testUtils.tsx` là `<output>` luôn có mặt, mang role `status` ngầm, nên điều kiện chờ đậu ngay trước khi card tải xong; assertion chữ chạy đồng bộ và hỏng. DOM dump của lần đỏ (`6f-web-full.log`) chỉ có `<output data-testid="current-location">` và vùng toast, không có card. Tái hiện: trễ 50 ms cho fetch → 2 test đỏ. Sửa (chỉ file test): chờ `findByLabelText("Bước quá thời gian dự kiến")`, bỏ import `waitFor`. Kết quả: có trễ 50 ms 3/3 xanh; không trễ 10/10 lần chạy xanh; full web sau sửa 95 file, 303/303 (`overdue-fix-web-full.log`). Advisor đã rút giả thuyết đồng hồ (`formatEtaText` thuần, fixture cố định). `tsc --noEmit` trong `apps/web` exit 0 sau sửa này (`overdue-web-tsc.log`).
- **Full web 6f cuối (sau test accept):** 95 file, 303/303 (`6f-web-full-final.log`). Dòng 302 cũ đã thay.
- **Giới hạn ghi nhận:** lỗi truy vấn sống (`proposals`, `accepted`, `inProgress`, `done`) vẫn xếp trên lỗi thao tác. Chưa có test ghim thứ tự này (advisor: ghi làm giới hạn).
- **Không làm:** không đổi server hoặc MCP, không khởi động app, không chạy trình duyệt, không commit, không `.done`.
