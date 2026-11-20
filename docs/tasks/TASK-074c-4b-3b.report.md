# TASK-074c-4b-3b — soạn bản nháp IMP-<n>.md (runner và thư mục gốc được tiêm) (báo cáo)

Trạng thái: `draftProposal` trong `apps/server/src/operator/proposalDraft.ts` và 13 test trong `apps/server/test/proposalDraft.test.ts` đã code và test trong cây làm việc. Runner và thư mục gốc đều được tiêm; test chỉ dùng thư mục tạm, không bao giờ `docs/proposals/`. Không có route, không có trang, không có LLM thật, không có migration mới. Chưa commit, chưa push, chưa có `.done`.

## Đã làm

- `apps/server/src/operator/proposalDraft.ts` (mới): `draftProposal(db, id, { runner, root })`.
  - Thứ tự: đọc dòng (chỉ `kind='tool' AND status='accepted'`); không khớp thì `skipped not_accepted`, không chi, không gọi runner. Có `drafted_at` thì `skipped already_drafted`, không chi, không gọi runner. Gán số bằng `assignImpNumber` (4b-3a). Chi `llmCalls` bằng `consumeSelfImprovementBudget`. Gọi runner (một `await`). Ghi bằng `writeProposalDraft(root, "IMP-<n>.md", content)`. Đặt `drafted_at`.
  - Thứ tự: số → chi `llmCalls` → `await runner` → ghi file → marker. Không có transaction nào bao quanh runner.
  - Đặt marker bằng lệnh UPDATE có điều kiện `WHERE id = ? AND status = 'accepted' AND drafted_at IS NULL`, kiểm `changes`. Nếu 0 thì trả `skipped state_changed`, đúng như cách sửa race của 074c-3.
  - Runner ném lỗi thì lỗi được ném lại. Dòng giữ `accepted`, số được giữ, `drafted_at` là NULL.
  - Hết ngân sách `llmCalls` thì trả `pending budget_limit` trước khi gọi runner, và giữ số.
  - Ghi bị từ chối (`bad_content`, `exists`, v.v.) thì trả `refused` kèm lý do, và `drafted_at` vẫn NULL.
- `apps/server/test/proposalDraft.test.ts` (mới): 13 test. 11 test chạy trong full suite; 2 test nhánh `state_changed` được thêm sau đó (xem mục Full suite).

## Lý do thiết kế

- Số được gán trước khi chi, đúng thứ tự advisor đưa ra. Nếu gán sau, một lần chi có thể không có số để ghi.
- `drafted_at` chỉ được đặt sau khi file đã ghi thành công. Vì vậy `drafted_at` không NULL nghĩa là file đã tồn tại.
- Chi `llmCalls` (40/ngày mặc định). Đường `research/` đã dùng `llmCalls` (`research/service.ts:77`, `research/toolDefs.ts:17`); `improvementOpenSource.ts` chỉ chi `researchRuns`. Eco không chặn `llmCalls`.

## Kết quả kiểm tra

- Đỏ trước code: `Cannot find module '../src/operator/proposalDraft.js'`.
- Xanh sau code (trước khi thêm hai test `state_changed`): `proposalDraft.test.ts` 11/11.
- Mutation chuyển lời gọi runner lên trước chi tiêu (một `await` được dời): 2 test đỏ ("rejects when the runner throws ..." và "stops at the llmCalls limit before the runner ..."). Đã hoàn nguyên; xanh lại.
- Sau khi thêm hai test `state_changed`: `proposalDraft.test.ts` 13/13 xanh.
- Mutation bỏ cả hai điều kiện `AND status = 'accepted' AND drafted_at IS NULL` khỏi lệnh UPDATE đánh dấu: đúng 2 test đỏ, là hai test `state_changed` mới. Đã hoàn nguyên.
- Ba tệp (`proposalDraft` 13, `toolProposalImpNumber` 5, `improvementOpenSource` 14): 32/32 xanh sau khi hoàn nguyên.
- `npx tsc --noEmit` trong `apps/server`: EXIT 0 sau khi hoàn nguyên. Không chạy tsc trong lúc mutation.
- Sau lần chạy mutation, thêm `readFileSync` (kiểm nội dung `IMP-1.md`) vào hai test `state_changed`. Chạy lại ba tệp: 32/32 xanh; `npx tsc --noEmit`: EXIT 0 (đo sau khi thêm).

## Giới hạn đã biết (ghi nhận, chưa sửa)

1. **Ghi xong nhưng cập nhật marker lỗi (chưa có test).** Khi đó file `IMP-<n>.md` đã có, `drafted_at` vẫn NULL, và không test nào ghim trường hợp này. Lần thử lại sẽ chi `llmCalls` lần nữa và nhận `refused exists`. Test "pins the known limit" ghim một trường hợp khác: thử lại khi `IMP-1.md` đã có sẵn từ trước, chi thêm và vẫn `exists`. Việc xử lý thuộc quyết định 3c.
2. **Runner ném lỗi thì chi tiêu đã xảy ra.** Đây là chủ đích, giống `fillOpenSource`: lần chạy đã được tính.
3. **Dòng accepted đã có số rồi bị đổi trạng thái** thì `assignImpNumber` trả `null` và `draftProposal` trả `skipped not_accepted`. Hiện không có đường chuyển như vậy; khi thêm `in_progress` phải xem lại (đã ghi ở 4b-3a).
4. **Chưa có route, chưa có trang, chưa có runner LLM thật.** Không có đường nào gọi `draftProposal` ngoài test.
5. **`docs/proposals/` chưa tồn tại,** và chưa được tạo trong slice này.
6. **File `IMP-<n>.md` còn lại ở nhánh `state_changed`.** File được ghi trước bước đánh dấu, và hai test `state_changed` có kiểm nội dung file. Nếu dòng rời `accepted` trong lúc runner chạy, file này mồ côi và không ai dọn; code không xoá nó. Nếu `drafted_at` đã được lần chạy khác đặt, file vừa ghi vẫn là của lần này, vì lần kia đã ghi trước thì lần này nhận `exists`. Trường hợp này chưa có test riêng ngoài hai test đã nêu.
7. **Hai lời gọi đồng thời trên cùng một dòng.** Cả hai có thể cùng chi `llmCalls` và cùng chạy LLM. Với một thư mục gốc, lần ghi sau nhận `exists` ngay ở bước ghi file; điều kiện `drafted_at IS NULL` chỉ là lớp dự phòng. Không có khoá. Chưa có test đồng thời.

## Full suite

Chạy đầy đủ `npx vitest run --reporter=verbose` trong `apps/server`, trước khi thêm hai test `state_changed` (log: `scratchpad/server-full-4b3b.log`, EXIT 0):
- Tệp: 284 đạt, 4 bỏ qua (288).
- Test: 2329 đạt, 9 bỏ qua (2338). 0 lỗi.
- Đủ 11 test `proposalDraft.test.ts` có trong log, đều ✓.

Hai test thêm sau khi chạy full suite (không nằm trong 2329): đã chạy lại file và tsc như mục Kết quả kiểm tra. Chưa chạy lại full suite sau khi thêm hai test này, nên tổng 2331 chỉ là kỳ vọng, chưa được xác nhận. ĐÃ XÁC NHẬN 2026-11-20 trong full suite của 3c-1 (log `scratchpad/server-full-3c1.log`, exit 0): 2335 đạt = 2329 + 2 test `state_changed` + 4 test mới của 3c-1.

## Chưa làm (cố ý)

- Commit, push, `.done`.
- Route kích hoạt soạn bản nháp, runner LLM thật, dòng nhãn trên trang, tạo `docs/proposals/` (3c, sau quyết định của advisor).
- Chuyển `accepted` → `in_progress`.
- Áp dụng migration 0100 lên DB thật (đã ghi ở 4b-3a).
