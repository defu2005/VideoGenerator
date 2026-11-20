# TASK-074c-1 — review (chỉ đọc, 2026-11-20)

**Phạm vi:** `docs/tasks/TASK-074c-1.report.md`; `apps/server/drizzle/0099_improvement_requests.sql`; `apps/server/drizzle/meta/_journal.json` và `0099_snapshot.json`; `apps/server/src/db/schema.ts` (`operatorToolProposals` ~1280, `improvementRequests` ~1292); `apps/server/src/operator/toolProposals.ts`; `apps/server/src/db/migrate.ts`; `apps/server/test/improvementRequests.test.ts`.
**Không sửa code.** Không có `.done`. Không commit.

**Kết luận:** chấp nhận có điều kiện cho phần 074c-1. Migration khớp schema, journal và snapshot có đủ. Bước chép legacy idempotent. Không thấy lỗi làm sai dữ liệu trong đường chạy bình thường. Có một rủi ro tiềm ẩn ở `migrate.ts` và một chỗ dễ vỡ ở `listToolProposals`, nên sửa trước khi promote.

## Đã kiểm bằng đọc mã

- SQL `0099` khớp bảng `improvementRequests` (`schema.ts:1292`) về cột, NOT NULL và hai index.
- `_journal.json` có entry `idx: 99`, tag `0099_improvement_requests`. `meta/0099_snapshot.json` có tồn tại.
- `copyLegacyToolProposals` (`toolProposals.ts:109`): bảng legacy có `id, kind, name, details, status, created_at` đều NOT NULL (`schema.ts:1280`), và câu INSERT cung cấp đủ giá trị. `INSERT OR IGNORE` theo id cũ, nên chạy lại không thêm dòng và dòng đã `rejected` không bị mở lại. `pending` → `open`, `dismissed` → `rejected`, trạng thái khác và `details` lỗi bị đếm vào `skipped`.
- `recordToolProposal` (`toolProposals.ts:46`): budget `improvementRequests` có trong `packages/shared/src/selfImprovement/schema.ts:7` (mặc định 10). Việc kiểm tra trùng, tiêu budget và ghi dòng nằm trong một transaction `immediate`, nên lỗi giữa chừng không để lại budget đã trừ. Lỗi budget được đổi thành 429 `TOOL_PROPOSAL_LIMIT`.

## Phát hiện

1. **(thấp, rủi ro tiềm ẩn) `migrate.ts:15-17` đặt bước chép trong `try` của `migrateDatabase`.** `catch` (`migrate.ts:21-29`) ghi log và ném lỗi "Database migration <migration> failed … delete data/app.db in development". Nếu bước chép lỗi, thông báo sẽ gọi đó là lỗi migration và khuyên xóa DB. Không thấy đường lỗi nào với dữ liệu hiện có, vì mọi cột legacy đều NOT NULL và câu chèn có đủ giá trị. **Sửa đề xuất:** tách bước chép ra khỏi `try`, hoặc bọc riêng với thông báo đúng.
2. **(thấp) `listToolProposals` (`toolProposals.ts:87`) dùng `ToolProposalArgs.parse`, không `safeParse`.** Một dòng `proposal` không còn hợp lệ sẽ làm cả danh sách lỗi. **Sửa đề xuất:** `safeParse`, bỏ qua dòng hỏng và ghi log.
3. **(thấp, chủ ý) Dòng legacy hỏng làm `skipped > 0` và cảnh báo mỗi lần khởi động** cho đến khi xóa hoặc sửa dòng đó. Báo cáo ghi đây là chủ ý. Ghi nhận, không sửa.
4. **(thông tin) Số test không khớp.** Báo cáo ghi "8 test". File `improvementRequests.test.ts` hiện có 13 `it(`. Năm test thêm thuộc 074c-2 vì cùng file. Báo cáo 074c-1 nên ghi rõ số của riêng nó.
5. **(quy trình) Báo cáo tự ghi đã mở `data-dev/app.db` chỉ đọc một lần**, trái quy tắc chỉ làm việc trên bản copy. Không có lệnh ghi nào. Giữ nguyên ghi nhận này.

## Chưa kiểm trong lần đọc này

- "Promote sẽ backup DB trước, rồi áp 13 migration": chưa đọc `deploy/product/start.ps1` hoặc luồng promote.
- Full suite 2182 test: không chạy lại.

## Việc tiếp theo đề xuất

Sửa điểm 1 và 2 trong bước riêng, rồi thêm một test đỏ cho điểm 2 (dòng `proposal` hỏng không làm hỏng danh sách) trước khi promote.

**Đã làm sau review (fix1):** điểm 1 và 2 đã sửa, test đỏ đã viết trước và chạy đỏ. Xem [fix1 report](TASK-074c-1.fix1.report.md). Review gốc giữ nguyên ở trên.

## Quyết định do advisor đưa ra (thay người dùng, có thể đảo)

Theo mục tiêu người dùng đặt: "mọi thứ cần tôi quyết định thì để advisor quyết định thay". Người dùng có thể đảo lại bất kỳ quyết định nào dưới đây.

- Điểm 1 và 2: sửa trong fix1, không để lại như "ghi nhận". Lý do: review đã đánh dấu là điều kiện trước promote.
- Điểm 3: giữ nguyên, cảnh báo mỗi lần khởi động cho dòng legacy hỏng.
- Thông báo lỗi chép legacy: không nhắc `delete data/app.db`, vì chép legacy chạy trong một transaction và lỗi không làm đổi `operator_tool_proposals`.
- `listToolProposals` bỏ qua dòng hỏng và ghi cảnh báo (không im lặng), để lộ dữ liệu hỏng mà không làm hỏng danh sách.
- Dòng bị bỏ qua được ghi qua logger của server: `api/operator.ts` truyền `app.log`, `operator/service.ts` truyền `this.logger` (đã thêm `warn` vào kiểu `Logger` của service). Chỉ khi không có logger mới rơi về `console.warn` (dùng trong test).
- Hệ quả ban đầu: một dòng `open` hỏng gộp các lần lặp cùng fingerprint nhưng không hiện trong danh sách. **Đã đóng ở fix2** (xem [TASK-074c-2 report](TASK-074c-2.report.md), mục "Sửa thêm (fix2)"): lần lặp hợp lệ sửa dòng `open` hỏng tại chỗ và dòng hiện lại. Còn mở: dòng `open` hỏng chưa bao giờ được lặp lại vẫn ẩn; dòng `accepted` hoặc `in_progress` hỏng không được sửa.
