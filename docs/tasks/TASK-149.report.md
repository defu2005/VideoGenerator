# TASK-149 — báo cáo: publisher `budget_wait` và `needs_user`

**Trạng thái:** đã implement và test. Chưa review, chưa commit, chưa push, chưa dispatch.
**Căn cứ:** `docs/cursor/TASK-149.md`. Phạm vi theo ruling advisor 2026-11-19 (ngoại lệ một lần, không commit, không push, không ghi `data/app.db`, không tạo tài khoản data-dev, không đổi code sản phẩm khác).

## Thay đổi

| Việc | File:dòng |
|---|---|
| Helper dùng chung quy tắc workspace theo profile (tách từ `publishFindingOpened`) | `apps/server/src/operator/findingEvents.ts:19` (`workspaceForProfile`) |
| `publishFindingOpened` gọi helper mới, hành vi không đổi | `apps/server/src/operator/findingEvents.ts:27` |
| Publisher `budget_wait`, có try/catch và log | `apps/server/src/operator/findingEvents.ts:32` (`publishBudgetWait`) |
| Gọi `publishBudgetWait` chỉ khi `stop`, ngay sau `publishFindingOpened` | `apps/server/src/operator/autonomyBudget.ts:177` |
| Publisher `needs_user` sau INSERT, có try/catch và log | `apps/server/src/operator/autopilot.ts:238–243` |
| Test mới (11 ca) | `apps/server/test/budgetNeedsUserEvents.test.ts` |

- `budget_wait` chỉ phát khi ngân sách đạt 100% (`budget_stop`). Ngưỡng 80% (`budget_warn`) không phát. `supervisor_finding` vẫn phát như cũ.
- `needs_user` chỉ phát khi có hàng `operator_requests` mới. Dedupe hit, nhánh Hermes (`openEscalation`) và `QUESTION_CAP` đều thoát trước khi phát.
- Payload chỉ có `type`, `summary`, `link`. Không gửi `whyVi`. `summary` của `needs_user` cắt tối đa 200 ký tự.
- `agentBus.ts` không đổi. Guard nằm ở publisher, theo guide.

## Kết quả kiểm tra

- `npx vitest run test/budgetNeedsUserEvents.test.ts`: **11/11 pass** (sau khi thêm ca Hermes).
- Full suite `apps/server`: **Test Files 243 passed, 4 skipped (247); Tests 1948 passed, 8 skipped (1956); exit 0**. Chạy trước ca Hermes; ca Hermes được chạy riêng và pass.
- `npx tsc --noEmit` trong `apps/server`: **exit 0**.
- Nhánh Hermes có ca test: Hermes trực (`agent_instances.on_duty = 1`) với `checkKind` agent-solvable tạo một `agent_escalations`, không tạo `operator_requests` và không phát `needs_user`.
- Các ca đã có: đúng một `budget_wait` khi vượt 100%; lặp cùng dedupe key không phát thêm; 80% không phát `budget_wait`; profile null không lọc workspace và dùng tiêu đề toàn ứng dụng; `needs_user` mới phát đúng một lần; dedupe hit không phát; `QUESTION_CAP` không phát; summary ≤ 200 ký tự; `sqlite.inTransaction === false` tại thời điểm publish cho cả hai đường; listener ném lỗi chỉ với `budget_wait`/`needs_user` thì ngân sách vẫn chạy đủ, `createUserRequest` vẫn trả `created: true`, hàng vẫn được ghi.

## Chưa được test

- Không chạy lại trên Hermes thật (việc của người dùng).

## Điều người dùng cần biết

- **Webhook sẽ nhận hai sự kiện mới.** `apps/server/src/app.ts:927` chuyển mọi sự kiện không phải mailbox cho các webhook đã đăng ký, nên `budget_wait` và `needs_user` sẽ đến webhook. Chưa có consumer nào trong `apps/server/src`, `apps/mcp/src`, `apps/web/src` đọc hai loại này.
- `budget_wait` và `needs_user` có workspace khi profile có workspace (qua `workspaceForProfile`). Khi profile null thì không có workspace, nên listener nào không lọc theo workspace vẫn nhận được. Không có consumer nào của hai loại này: đã grep `apps/server/src`, `apps/mcp/src`, `apps/web/src`, `packages/shared/src`, chỉ thấy publisher và khai báo enum.

## Thay đổi chưa commit có sẵn trước phiên này (không do TASK-149 tạo)

Các file sau đã có diff chưa commit trước khi bắt đầu, không được revert: `apps/server/src/node/agent.ts`, `apps/server/src/operator/autonomyBudget.ts`, `apps/server/src/operator/autopilot.ts`, `apps/server/src/services/composeBridge.ts`, `deploy/docker/Dockerfile`. Git cảnh báo CRLF. Thay đổi của TASK-149 nằm chồng lên các diff này.

## Dispatch

Theo quy tắc 2026-11-17, guide này không do Claude dispatch. Việc dispatch là bước của người dùng, và phần implement này là ngoại lệ một lần đã được advisor cho phép.
