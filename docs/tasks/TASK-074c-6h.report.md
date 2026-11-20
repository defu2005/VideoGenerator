# TASK-074c-6h — mục "Đã xong" chỉ đọc trên trang web (báo cáo)

Trạng thái: đã code và test trong cây làm việc (chỉ phía web). Chưa commit, chưa push, chưa có `.done` thật. Không khởi động app, không dùng `preview_start`. Không ghi vào `data/`, `data-dev/`, `docs/proposals/`. Không đổi server, không đổi MCP, không đổi `writeGuard.ts`. Không có migration.

## Phạm vi

- Mục "Đã xong" trên trang "Đề xuất công cụ": đọc `GET /operator/tool-proposals/done` (route của 074c-6g) và hiện mỗi hàng với tên, nhãn IMP và taskRef.
- Chỉ đọc. Hàng done không có ô nhập, không có nút, không có mutation.
- Không làm: MCP, chuyển trạng thái từ done, phân trang, kiểm tra trên trình duyệt.

## Thay đổi

- `apps/web/src/features/operator/ToolProposals.tsx`:
  - Kiểu `DoneProposal` = `AcceptedProposal` + `taskRef: string | null`.
  - `doneKey = [...queryKey, "done"]`: cùng tiền tố với các danh sách khác, nên `refresh` (`invalidateQueries({ queryKey })`) của check-done cũng làm mới mục này. Không sửa `refresh`.
  - Truy vấn `done` có `enabled: open`, nên không tải khi chưa mở.
  - `alertText`: `done.error` đặt cuối chuỗi, để không che lỗi khác.
  - Mục `<section aria-labelledby="done-heading">` với `<h3 id="done-heading">Đã xong</h3>`, gồm dòng tải, dòng rỗng và danh sách hàng. Hàng dùng `ProposalRow` không có children (`children` đổi thành tùy chọn).
  - `doneLabel(item)`: ghép "IMP-n" và taskRef, chỉ lấy phần có giá trị. Thứ tự là thứ tự server trả về, không sắp xếp ở client.
- `apps/web/src/features/operator/ToolProposals.test.tsx`:
  - Thêm stub `GET /operator/tool-proposals/done → {items: []}` cho 5 test có assert alert: draft 503, draft 500, start 500, check-done 409, check-done 400. Nếu thiếu stub, route trả 404 và lỗi đó hiện ở alert chung.
  - 8 test mới trong `TASK-074c-6h: read-only done section`.

## Chạy đỏ trước

Chạy file test sau khi thêm test và trước khi cài đặt: `Tests 7 failed | 33 passed (40)`.

- 6 test đỏ vì thiếu mục: danh sách đúng thứ tự, dòng rỗng, dòng đang tải, không có điều khiển trên hàng done, lỗi done-list hiện ở alert, làm mới sau check-done.
- 1 test đỏ vì thiếu truy vấn done: "when the done list and a check-done both fail…". Lỗi là `expected false to be true` ở khẳng định GET done, không phải ở văn bản alert. Khẳng định về văn bản 409 nằm trước và đã đúng từ trước.
- 1 test xanh: "does not fetch the done list before the section opens". Đây là tripwire: hành vi này đã đúng trước khi cài, vì chưa có truy vấn nào.
- 32 test cũ xanh. Con số này khớp với 6f (32 test sau khi cài).

## Kết quả sau khi cài

- Focused `ToolProposals.test.tsx`: `Tests 40 passed (40)`, `EXIT=0`.
- Typecheck web: `npx tsc -p tsconfig.json --noEmit`, `TSC_EXIT=0`.
- Full web suite `npx vitest run` trong `apps/web`: `Test Files 95 passed (95)`, `Tests 299 passed (299)`, `FULL_EXIT=0`. Log: `scratchpad/full-web-6h.log`. 291 của 6f cộng 8 test mới khớp với 299.

## Sửa sau lần chạy đầu (chỉ test)

Advisor rà soát và yêu cầu hai sửa, đều trong `ToolProposals.test.tsx`. Không đổi `ToolProposals.tsx`.

1. Test alert-order: alert lỗi done-list đã hiện trước khi bấm check-done. `findByRole("alert")` trả về ngay alert cũ, nên khẳng định văn bản 409 có thể chạy trước khi lỗi mới render. Đổi thành `waitFor(...)` để thử lại cho tới khi văn bản "Task chưa xong." xuất hiện.
2. Test "shows a done-list error…": gọi `renderWithProviders` trước `stubApi`, nên truy vấn done chạy khi chưa có stub. Đổi thứ tự cho giống các test khác. Trước đó, mutant A đỏ thêm một test vì lý do không liên quan.

Sau hai sửa: focused `Tests 40 passed (40)`, typecheck `TSC_EXIT=0`. Full suite không chạy lại: đây là sửa test trong một file, nên chỉ chạy lại file đó và các mutant bị ảnh hưởng. Full suite 299/299 vẫn là kết quả của lần chạy đầu.

## Mutation

Chạy bằng `scratchpad/mut6h.cjs`, mỗi mutant một lần trên bản sao của file tốt, rồi khôi phục và so sánh `cmp`. Log chạy lại (sau sửa test): `scratchpad/mut6h-rerun.log`. Log đầu: `scratchpad/mut6h.log`.

| Mutant | Thay đổi | Kết quả (đỏ) | Test đỏ |
|---|---|---|---|
| A | bỏ `enabled: open` khỏi truy vấn done | 2 | tripwire 6h "does not fetch…", tripwire 6c "does not fetch either list…" (sau sửa thứ tự stub, test "shows a done-list error…" không còn đỏ giả) |
| B | `doneKey` đặt ngoài tiền tố danh sách | 1 | "…refetched and shows the row with its task" |
| C | bỏ `done.error` khỏi chuỗi lỗi | 1 | "shows a done-list error in the section alert" |
| D | đặt `done.error` đầu chuỗi | 1 | "when the done list and a check-done both fail…" |
| E | bỏ taskRef khỏi nhãn | 3 | thứ tự/nhãn; "no controls" (đỏ ở bước chờ `findByText(…TASK-A)`, không phải ở khẳng định điều khiển); "refetched and shows the row" |
| F | thêm nút vào hàng done | 1 | "has no input, button or draft or start control on done rows" |
| G | đảo thứ tự hàng done | 1 | "lists done rows in server order…" |
| H1 | bỏ `draft.error` khỏi chuỗi (mutant cũ) | 2 | 503 và 500 của draft (khớp số đỏ đã ghi trước đó: 2) |
| H2 | bỏ `start.error` khỏi chuỗi (mutant cũ) | 1 | "failed start … 500" (khớp) |
| H3 | bỏ `checkDone.error` khỏi chuỗi (mutant cũ) | 3 | 409 và 400 của 6f (khớp 6f: 2), cộng test alert-order 6h |

H3 có 3 đỏ, không phải 2 như ở 6f. Test thứ ba là test alert-order mới của 6h. Nó đỏ vì nếu bỏ `checkDone.error` thì alert hiện lỗi done-list, không phải lỗi 409. Đây là bằng chứng đúng cho thứ tự alert. Mọi mutant đều khôi phục được file gốc (`RESTORED_SAME true`), và `cmp` của `ToolProposals.tsx` với `scratchpad/ToolProposals.good.tsx` giống hệt.

## Kiểm tra phạm vi (sau lần chạy cuối)

- `git status --short -- docs/proposals data data-dev`: 0 dòng.
- Số `.done` trong `docs/tasks/`: 142, không đổi so với 6g.


## Giới hạn đã biết

1. Không kiểm trên trình duyệt: không khởi động app (ràng buộc của task). Mọi kiểm tra là jsdom.
2. Các chuỗi "Đã xong", "Đang tải đề xuất đã xong…" và "Chưa có đề xuất đã xong." là văn bản tôi chọn, chưa được duyệt.
3. Hàng không hiện `updated_at` hay thời điểm chuyển sang done, vì API không trả các trường đó.
4. Tripwire "không tải trước khi mở" xanh trước và sau khi cài. Nó chỉ bắt được lỗi khi `enabled` bị bỏ (mutant A).
5. Thứ tự alert chỉ được phủ khi cả hai lỗi cùng có mặt (done 500 và check-done 409). Trường hợp chỉ có lỗi done được phủ bởi test lỗi done-list.
6. Hàng có taskRef mà không có IMP chưa có test. `doneLabel` xử lý được, nhưng không khẳng định.
7. Không có test phân trang. Server giới hạn 50 hàng và không có "tải thêm".
8. Các test cũ mở mục "Đã xong" nhưng không có stub `/done` sẽ nhận 404 và hiện lỗi đó ở alert chung. Không test nào khẳng định điều này. Đây là cùng kiểu với 6c.

## Chưa làm (cố ý)

- MCP đọc danh sách done.
- Kiểm trực quan trên trình duyệt.
- Phân trang, và sắp xếp theo thời điểm chuyển sang done (cần cột riêng).
