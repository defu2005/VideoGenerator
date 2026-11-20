# TASK-074c-4b-3a — số IMP và dấu đã soạn bản nháp (DB only) (báo cáo)

Trạng thái: migration `0100_improvement_imp_number`, `assignImpNumber` và hai trường trong danh sách accepted đã code và test trong cây làm việc. Không có LLM, không gọi bộ ghi `writeProposalDraft`, không tạo `docs/proposals/`, không chạy app. Chưa commit, chưa push, chưa có `.done`.

## Đã làm

- `apps/server/src/db/schema.ts`: thêm `impNumber` (`imp_number`, integer, null) và `draftedAt` (`drafted_at`, text, null) vào `improvementRequests`, cùng unique index `improvement_requests_imp_number_idx`.
- `apps/server/drizzle/0100_improvement_imp_number.sql` (sinh bằng `drizzle-kit generate --name improvement_imp_number`, không sửa tay, không sửa journal bằng tay). Nội dung chỉ có ba câu lệnh: hai `ALTER TABLE ... ADD` và một `CREATE UNIQUE INDEX`. Không có thay đổi schema nào khác.
- `apps/server/src/operator/toolProposals.ts`:
  - `assignImpNumber(db, id)`: trong transaction `.immediate()`, chỉ với dòng `kind='tool' AND status='accepted'`. Dòng đã có số thì trả lại số đó. Dòng chưa có số thì nhận `MAX(imp_number)+1`. Không khớp dòng nào thì trả `null`.
  - `listAcceptedToolProposals`: mỗi item có thêm `impNumber` (null nếu chưa đánh số) và `draftedAt` (null cho đến khi có bản nháp). Không có trạng thái mới; "đã accepted, chưa có bản nháp" là `draftedAt === null`.
  - Danh sách mở (`listToolProposals`), `acceptToolProposal`, `dismissToolProposal`, route không đổi.
- `apps/server/test/toolProposalImpNumber.test.ts` (mới): 5 test.

## Lý do thiết kế

- Số được cấp muộn, lúc soạn bản nháp (3b), không cấp trong lúc accept. Dòng đã accepted trước migration cũng cần số, và `acceptToolProposal` (4b-1) giữ nguyên.
- Không dùng rowid (có thể đổi khi VACUUM) và không đếm file trong `docs/proposals/` (đua tranh, không ổn định khi thử lại).
- `MAX+1` an toàn ở hiện tại vì không có đường nào xoá dòng `improvement_requests` (đã grep 2026-11-20 không phân biệt hoa thường, trong `apps/server`, `apps/mcp`, `apps/web`: không có `DELETE FROM improvement_requests` và không có `delete(improvementRequests)`). Nếu sau này có xoá, số có thể bị dùng lại. Grep xoá chỉ khớp tên bảng viết thẳng trên một dòng; xoá qua vòng lặp chung không bị bắt. Unique index vẫn làm việc đó thất bại, không ghi đè. Unique index làm việc đó thất bại thay vì ghi đè. Ghi nhận như một giới hạn.

## Kết quả kiểm tra

- Red trước code: 5 test đỏ (`assignImpNumber is not a function`).
- Xanh sau code: 5 file, 63 test (`toolProposalImpNumber` 5, `toolProposalAcceptedList` 7, `toolProposalAccept` 13, `improvementRequests`, `operator`).
- Mutation: bỏ nhánh "đã có số" (`if (row.imp_number !== null) return row.imp_number;`): 2 test đỏ ("cùng số khi gọi lại", "mỗi dòng một số theo thứ tự cấp"). Đã hoàn nguyên và xanh lại (63/63).
- Mutation `draftedAt: null` cố định trong `listAcceptedToolProposals`: 1 test đỏ ("shows impNumber and draftedAt ..."), 4 xanh. Đã hoàn nguyên; file chạy lại 5/5; `npx tsc --noEmit` trong `apps/server` EXIT 0.
- `npx tsc --noEmit` trong `apps/server`: exit 0 (sau khi hoàn nguyên).
- Unique index: test "cơ sở dữ liệu từ chối hai dòng cùng số" kiểm `toThrow(/UNIQUE/)` và xanh với index có mặt. Chưa chạy đỏ khi thiếu index: lần đỏ duy nhất là do thiếu hàm, nên đây là suy luận từ thiết kế, chưa kiểm bằng thực nghiệm.

## Kiểm tra trước khi viết red (theo advisor)

1. Bộ đếm cho bản nháp LLM là `llmCalls` (mặc định 40/ngày trong `packages/shared/src/selfImprovement/schema.ts`). Đã grep (2026-11-20, phân biệt hoa thường, trong `apps/server/src`) `consumeSelfImprovementBudget(` và `"llmCalls"`: `llmCalls` được tiêu trong đường nghiên cứu, cụ thể `research/service.ts:77` (`spend("llmCalls")`) và `research/toolDefs.ts:17`. Đường fill open-source (`improvementOpenSource.ts`) chỉ tiêu `researchRuns` (dòng 46), không tiêu `llmCalls`. `consumeSelfImprovementBudget` (`autonomyBudget.ts:43`) khi eco chỉ chặn `researchRuns` và `skillDrafts`, nên `llmCalls` không bị eco chặn. Dùng cho 3b; 3b sẽ là chỗ tiêu `llmCalls` đầu tiên trong luồng soạn đề xuất.
2. Không có `DELETE FROM improvement_requests`. Xem phần lý do thiết kế.
3. Migration chỉ được áp dụng trong test (`:memory:`, qua `migrateDatabase`). Không áp dụng lên bản sao `data-dev` và không khởi động app. Ghi nhận như một việc chưa làm.

## Full suite

Chạy đầy đủ `npx vitest run --reporter=verbose` trong `apps/server` (log: `scratchpad/server-full-4b3a.log`, EXIT=0):
- Tệp: 283 đạt, 4 bỏ qua (287).
- Test: 2318 đạt, 9 bỏ qua (2327). 0 lỗi.
- Đúng 5 test mới của `toolProposalImpNumber.test.ts` có trong log và đều ✓.
- Các dòng khớp "FAIL" hoặc "×" trong log đều là tên test (ví dụ "role × action", "scoreImprovement: weight × impact"), không phải lỗi.

Sau khi chạy đầy đủ, thêm một khẳng định `draftedAt` vào test danh sách accepted (đặt `drafted_at` bằng SQL, mong danh sách trả đúng giá trị), để một `null` cứng không qua được. Không thêm test mới, nên tổng vẫn là 2318. Chạy lại riêng `toolProposalImpNumber.test.ts`: 5/5 đạt. `npx tsc --noEmit` trong `apps/server`: EXIT 0.

## Giới hạn đã biết (ghi nhận, chưa sửa)

1. `MAX+1` không an toàn nếu sau này có xoá dòng. Unique index bảo vệ việc ghi (thất bại, không ghi đè), nhưng số có thể bị dùng lại.
2. Dòng đã được đánh số rồi chuyển khỏi `accepted` vẫn giữ số. Hiện chưa có đường chuyển như vậy. Khi `in_progress` được thêm, cần xem lại `assignImpNumber` (hiện nó trả `null` cho dòng không còn accepted, kể cả khi đã có số).
3. Migration 0100 chưa áp dụng lên DB thật (dev hay product). Áp dụng khi app khởi động hoặc khi promote.
4. "Đã accepted, chưa có bản nháp" chỉ là `draftedAt === null`. Chưa có cách nào để đánh dấu bản nháp đã ghi (3b làm việc đó).

## Chưa làm (cố ý)

- Commit, push, `.done`.
- Bộ soạn bản nháp, runner LLM, gọi `writeProposalDraft`, ghi `drafted_at` (3b).
- Tạo `docs/proposals/`, route bật bản nháp, dòng nhãn trên trang (3c).
- Chuyển `accepted` → `in_progress`.
- Áp dụng 0100 lên bản sao của DB dev.
