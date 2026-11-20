# TASK-074c-4b-1 — chuyển trạng thái `accepted` cho yêu cầu công cụ (báo cáo)

Trạng thái: chỉ có thao tác chấp nhận (open → accepted) và route POST đi kèm, đã code và test trong cây làm việc. Không có LLM, không có bộ ghi bản nháp nào gọi vào, không đánh số, không migration, không giao diện, không tool registry hay MCP. Chưa commit, chưa push, chưa có `.done`.

## Đã làm

- `apps/server/src/operator/toolProposals.ts`: `acceptToolProposal(db, id)`, đặt cạnh `dismissToolProposal`. Chỉ đổi dòng `kind = 'tool' AND status = 'open'`, cập nhật `updated_at`. Không khớp dòng nào thì im lặng, như dismiss.
- `apps/server/src/api/operator.ts`: `POST /api/operator/tool-proposals/:id/accept`. Kiểm `request.actor.kind === "user"` trước (403 `OPERATOR_TOOL_PROPOSAL_USER_ONLY`), rồi parse uuid giống dismiss, rồi gọi thao tác.
- `apps/server/test/toolProposalAccept.test.ts` (mới): 13 test.
- `auth/routePermissions.ts` không đổi. Route dùng catch-all `ANY /api/operator/*` → `operator.use`, giống dismiss.
- Chỉ route mới gọi `acceptToolProposal`. Không có caller nào ở giao diện web hay MCP (đã kiểm bằng grep).
- Cách ly test: `testActor` được đổi trong `try` và khôi phục trong `finally`. Vitest cách ly module theo file (project `parallel`, `isolate` mặc định), nên đổi actor không lọt sang file khác.

## Lý do thiết kế

- Chấp nhận là quyết định của người dùng, nên operator không được tự chấp nhận yêu cầu của mình. Route bắt buộc `actor.kind === "user"`.
- Mirror dismiss: không ném lỗi khi không khớp dòng, và chỉ tác động lên dòng `open` của kind `tool`.

## Kết quả kiểm tra

- Red trước khi có code: 12 test đỏ (hàm không tồn tại; route trả 404). Test "id không phải uuid" là test duy nhất xanh ngay từ đầu, vì assertion lúc đó chỉ kiểm 4xx và 404 cũng thoả. Assertion sau đó được siết thành 400 + `VALIDATION_ERROR`. Mutation 3 chứng minh assertion siết này đỏ khi bỏ parse uuid.
- Xanh: `toolProposalAccept.test.ts` 13/13. Chạy chung `improvementRequests`, `registry`, `toolProposalAccept`: 49/49.
- Mutation 1 — bỏ `AND status = 'open'` khỏi WHERE: 6 test đỏ (second accept; rejected, done, in_progress, verified, failed_verification). Đã hoàn nguyên.
- Mutation 2 — bỏ kiểm `actor.kind` nội tuyến trong route accept (không phải helper `userOnly`, helper này không bị đụng): 1 test đỏ (refusal của API key). Đã hoàn nguyên và xanh lại.
- Mutation 3 — bỏ parse uuid (zod) khỏi route, lấy `request.params.id` thô: 1 test đỏ ("id không phải uuid", kỳ vọng 400). Đã hoàn nguyên và xanh lại (13/13).
- `npx tsc --noEmit` trong `apps/server`: exit 0 (chạy lại sau khi hoàn nguyên mutation 3).

## Test phủ (xanh ngay, không phải test đỏ)

- Sau khi accept, dòng biến mất khỏi `listToolProposals` (vì nó chỉ chọn `status='open'`).
- Sau accept, một yêu cầu lặp với cùng fingerprint làm tăng `weight` của dòng đã accepted, không tạo dòng mới, không tiêu ngân sách `improvementRequests`, và status vẫn `accepted`.
- Dismiss sau accept không đổi gì.

## Giới hạn đã biết (ghi nhận, chưa sửa)

1. Không endpoint nào liệt kê dòng `accepted`. (Cập nhật 2026-11-20: đã đóng bởi 074c-4b-2, `GET /api/operator/tool-proposals/accepted`. Mục này là trạng thái của lát 4b-1.)
2. Accept không kiểm `proposal` đã lưu. Một dòng hỏng vẫn có thể được accept theo id.
3. "Đã accepted, chưa có bản nháp" không có dấu hiệu lưu trữ nào.
4. Bất đối xứng có sẵn: dismiss không có kiểm user-only, trong khi draft và activate của skill có. Không đổi trong lát này. Cần quyết định riêng nếu muốn đồng bộ.
5. Dòng `accepted` không quay lại được: dismiss là no-op trên nó. (Cập nhật 2026-11-20: phần "không endpoint nào liệt kê nó" đã đóng bởi 074c-4b-2; phần không quay lại vẫn còn.)

## Full suite

- `npx vitest run` trong `apps/server`, chạy nền sau khi xong code và trước mutation 3: **Test Files 281 passed | 4 skipped (285); Tests 2306 passed | 9 skipped (2315); EXIT 0.** Log: `scratchpad/server-full-4b1.log`.
- Sau mutation 3 và hoàn nguyên, chỉ chạy lại file tập trung (`toolProposalAccept.test.ts` 13/13) và `tsc --noEmit` (exit 0). Chưa chạy lại full suite sau mutation 3. Mã route sau hoàn nguyên khớp với mã đã đọc lại trong `operator.ts`.
- Đối chiếu số: lần 15:00 (279 file, 2265 test) cộng `proposalWriter.test.ts` (1 file, 28 pass) cộng `toolProposalAccept.test.ts` (1 file, 13 pass) = 281 file và 2306 test. Khớp với kết quả full suite. Log `server-full-4b1.log` chỉ có tổng số, không liệt kê từng file, nên đối chiếu này là theo phép cộng, không phải theo tên file. Log nằm trong thư mục scratchpad tạm của phiên (không nằm trong repo) và có thể bị xoá. Số liệu trong báo cáo này là bản ghi bền vững.
- Lưu ý: số 2265 của lần 15:00 chưa được đối chiếu theo từng file (xem 074c-3 report). Đối chiếu này chỉ kiểm tra cộng số, không kiểm tra từng file.

## Chưa làm (cố ý)

- Commit, push, `.done`.
- Đường liệt kê dòng accepted, bộ sinh bản nháp, LLM, đánh số `IMP-<n>`, nối `proposalWriter` vào bất cứ đâu.
- Ghi vào `docs/proposals/` thật, `data/`, `data-dev/`.
