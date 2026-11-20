# TASK-149 — review chỉ đọc, 2026-11-19

**Kết luận:** chấp nhận có điều kiện. Ghi chú không chặn; xem mục "Cần sửa tài liệu".

## Đã kiểm
- `apps/server/src/operator/findingEvents.ts` (file mới, chưa theo dõi bằng git): `workspaceForProfile` đúng quy tắc guide. Profile null không lọc; profile có workspace dùng workspace đó; profile không có workspace rơi về workspace mặc định.
- `autonomyBudget.ts:177`: `publishBudgetWait` chỉ khi `stop` (100%), sau `publishFindingOpened`. Đúng.
- `autopilot.ts:238–243`: `needs_user` phát sau INSERT, trong try/catch có log. Đúng.
- `budgetNeedsUserEvents.test.ts`: chạy lại 11/11 pass.
- Hai sự kiện mới đi đường fan-out chung tới webhook (`app.ts:936–945`, loại trừ mailbox). Không có consumer nào của hai loại trong code; đã grep lại.

## Cần sửa tài liệu (không chặn)
- Báo cáo ghi "`app.ts:927`" cho fan-out webhook. Vị trí đúng là `app.ts:936–945` (`subscribeAgentEvents`).
- `findingEvents.ts` là file mới, nên không có diff git để chứng minh "hành vi không đổi" khi tách helper. Bằng chứng hiện tại là các test cũ của `publishFindingOpened` vẫn pass trong suite đầy đủ. Nên ghi rõ điều này.
- Báo cáo ghi suite `apps/server` 1948 test pass (lần chạy trước). Theo nhật ký quyết định ngày 2026-11-19, suite `apps/server` hôm nay là 262 file, 2059 test (4 skip), pass. Chỉ số này chỉ cho `apps/server`, không phải toàn repo.

## Rủi ro còn lại
- Webhook của người dùng sẽ nhận `budget_wait` và `needs_user`. Đây là thay đổi hành vi có chủ đích, nên người dùng cần biết trước khi bật webhook rộng.

## Lượt bổ sung 2026-11-20

- Chạy lại cùng lượt với 074b-4 và 150 (7 file gồm `budgetNeedsUserEvents.test.ts`): **95/95 pass**. Không chạy lại full suite trong lượt này; con số 262 file / 2059 test ở trên là từ nhật ký cũ.
- Đã đối chiếu vị trí fan-out webhook: `subscribeAgentEvents` tại `app.ts:937`, comment loại mailbox ở `:938`. Dòng 927 trong báo cáo cũ không còn đúng; đã ghi lại ở mục trên.
- Grep `budget_wait|needs_user` trong `apps/` lượt này chỉ thấy publisher và test (`autopilot.ts`, `findingEvents.ts`, `budgetNeedsUserEvents.test.ts`). Không có consumer trong web hoặc mcp.
- Đã đọc lại các dòng đã trích: `autonomyBudget.ts:177` (`publishBudgetWait` khi `stop`) và `autopilot.ts:238–243` (`needs_user` và log lỗi). Khớp báo cáo.
