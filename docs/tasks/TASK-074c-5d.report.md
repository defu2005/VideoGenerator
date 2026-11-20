# TASK-074c-5d — hàng chép từ bảng cũ không được làm giảm hạn mức (báo cáo)

Trạng thái: đã code và test trong cây làm việc. Chưa commit, chưa push, chưa có `.done`. Không khởi động app. Không ghi vào `data/`, `data-dev/` hoặc `docs/proposals/`. Không có migration mới, không ghi `app_settings`, không đổi `selfImprovementBudgetStatus`, không đổi shape của `improvementSelfTuneStats`.

Quyết định của advisor (2026-11-20): loại các hàng đã quyết từ bảng cũ khỏi cửa sổ tự hiệu chỉnh, chỉ trong câu truy vấn thống kê. Một hàng được coi là từ bảng cũ khi cả ba điều kiện đúng: `status = 'rejected'`, `updated_at = created_at`, và `evidence` chứa `"ref":"operator_tool_proposals:`.

## Vì sao cần

Bảng cũ chỉ có `pending` và `dismissed`, không có trạng thái chấp nhận. `copyLegacyToolProposals` (`apps/server/src/operator/toolProposals.ts`) map `dismissed` thành `rejected`, nên mọi hàng đã quyết cũ thành `rejected` mà không có tín hiệu chấp nhận nào đằng sau. Hai mươi hàng như vậy đủ để hạ hạn mức khi nâng cấp, dù không có bằng chứng tỉ lệ chấp nhận thấp.

## Căn cứ đọc mã (không sửa trước khi đọc)

- `copyLegacyToolProposals` ghi `evidence = [{type:"error", ref:"operator_tool_proposals:<id>", note}]`, `created_at` = thời điểm cũ, `updated_at` = `created_at`.
- Mọi `UPDATE improvement_requests` trong `apps/server/src`: `toolProposals.ts` (cộng dồn `weight` và `evidence` cho hàng `open`/`accepted`/`in_progress`; `dismissToolProposal` chỉ đổi hàng `open` thành `rejected` và đặt `updated_at = now`; `acceptToolProposal` chỉ đổi hàng `open`; `imp_number`), `improvementOpenSource.ts` (`open_source`), `proposalDraft.ts` (`drafted_at`). Không có đường nào đổi `updated_at` của hàng `rejected`. Không có ghi bằng drizzle `.set` lên bảng này.
- Hàng native có `evidence` do `JSON.stringify` tạo ra, nên dấu `"` trong ghi chú được escape thành `\"`. Chuỗi `"ref":"operator_tool_proposals:` vì vậy không thể xuất hiện trong hàng native qua ghi chú. Đây là lý do điều kiện evidence không bị giả mạo được.
- Hàng cũ đã copy rồi user dismiss sau đó: `dismissToolProposal` đặt `updated_at` bằng thời điểm dismiss, nên điều kiện timestamp không khớp và hàng vẫn được tính.

## Thay đổi

- `apps/server/src/operator/improvementSelfTune.ts`: câu truy vấn trong `improvementSelfTuneStats` thêm `AND NOT (status = 'rejected' AND updated_at = created_at AND instr(evidence, '"ref":"operator_tool_proposals:') > 0)`. Hàng bị loại không chiếm slot trong cửa sổ 20 hàng. `instr` dùng thay cho `LIKE` để không có ký tự đại diện `_`.
- `apps/server/test/improvementSelfTuneLegacy.test.ts` (mới): 4 test.

## Kiểm tra red trước

- Chạy file test mới trước khi sửa `improvementSelfTune.ts`: 2 đỏ, 2 xanh.
  - Đỏ: "20 legacy rows copied as rejected are not decided and do not halve the limit" (decided 20, halved true).
  - Đỏ: "legacy copies take no slot in the 20-row window…" (cửa sổ lấy hàng cũ mới hơn, accepted 0, halved true).
  - Xanh trước khi sửa, đúng dự kiến, là hai test pin hành vi: "a copied open row that the user later dismisses still counts" và "a native rejected row with equal timestamps counts, with or without the marker text in its note". Chúng không đỏ trước vì hành vi cũ đã đếm chúng; chúng là pin chống hồi quy.

## Kết quả sau khi sửa

- `improvementSelfTuneLegacy.test.ts`: 4/4 pass.
- Năm file liên quan (`improvementSelfTuneLegacy`, `improvementSelfTune`, `improvementRequests`, `researchSelfTuneRoute`, `toolProposalAccept`): 56/56 pass.
- Server typecheck (`npx tsc -p tsconfig.json --noEmit`): exit 0.

## Mutation (mỗi cái một lần, hoàn nguyên, `cmp` giống hệt)

- M-ts: bỏ `updated_at = created_at AND `. Đỏ đúng 1: "a copied open row that the user later dismisses still counts".
- M-ev: bỏ `AND instr(evidence, …) > 0`. Đỏ đúng 1: "a native rejected row with equal timestamps counts, with or without the marker text in its note".

## Giới hạn đã biết

1. Điều kiện nhận diện dựa trên chuỗi evidence và việc `updated_at` chưa đổi. Một hàng cũ đã được chỉnh bằng tay trong DB có thể không khớp. Không có đường ghi nào như vậy trong code.
2. Tỉ lệ vẫn là toàn cục, còn hạn mức theo workspace (`improvement_requests` không có `workspace_id`). Từ 5a.
3. Thứ tự theo `created_at` là thời điểm cũ với hàng đã copy. Từ 5a.
4. Đây là thay đổi về số liệu thống kê. Không có migration, không xóa hay sửa hàng nào trong DB. Hàng cũ vẫn ở đúng trạng thái trong `improvement_requests`; chỉ không còn đếm vào tỉ lệ.
5. Không kiểm trong trình duyệt; app chưa khởi động.
6. Kiểm bổ sung (advisor, 2026-11-20, chỉ đọc): migration SQL `0099` tạo bảng, `0100` chỉ thêm cột `imp_number` và `drafted_at`; không migration nào copy hay backfill hàng. Đường duy nhất copy là `apps/server/src/db/migrate.ts:29`, gọi sau migrate. Không câu UPDATE nào trên `improvement_requests` sau bước copy đổi `updated_at` của hàng `rejected`: `improvementOpenSource.ts:62` và `proposalDraft.ts:82` không chạm hàng rejected; `toolProposals.ts:64,67` chỉ gộp vào hàng `open`/`accepted`/`in_progress` (đọc `toolProposals.ts:58`); `:141` và `:147` đổi `open`; `:162` chỉ đặt `imp_number`.
7. (Đã đóng bởi fix1, 2026-11-20, full suite `b6vd9hhi2` xác nhận.) Thiếu test cho hàng copy `pending` được chấp nhận sau đó, và thiếu mutation bỏ `status = 'rejected'`. Xem mục fix1 bên dưới.
8. (Đã đóng bởi fix1, 2026-11-20, full suite `b6vd9hhi2` xác nhận.) Comment đầu `improvementSelfTune.ts` không nhắc loại trừ 5d. Đã cập nhật (chỉ comment).
9. Đã đóng giới hạn "legacy dismissed → rejected hạ hạn mức ngay sau migrate" trong báo cáo 5a, 5b, 5c.

## Chưa làm (cố ý)

- Quy tắc chuyển trạng thái gated bằng `.done`, và `accepted → in_progress`.
- So sánh 14/28 ngày.
- Đường ghi `effort` và ánh xạ đầu ra cho 074c-3.

## Kết quả full server suite

- Lệnh: `npx vitest run` trong `apps/server`, chạy nền (task `bbulhjj58`). Log: `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\074f5dd9-9e4f-4407-b442-670a7f5dc0ae\scratchpad\server-full-5d.log`.
- Kết quả: Test Files 291 passed, 4 skipped (295); Tests 2387 passed, 9 skipped (2396); Duration 274.10 s; `SUITE_EXIT=0`. Không có dòng FAIL.
- Đối chiếu: 5c là 290/2383 (294/2392). 5d thêm đúng 1 file (`improvementSelfTuneLegacy.test.ts`) và 4 test. Khớp với dự kiến của advisor.
- Trạng thái: 074c-5d đã đóng trên full server suite. Chưa commit, chưa push, chưa có `.done`.

## fix1 (2026-11-20, advisor: bước tiếp theo sau 5d)

- Hai pin mới trong `improvementSelfTuneLegacy.test.ts` (tổng 6):
  - "a copied pending row that the user accepts later counts as accepted": pin, xanh ngay từ đầu (không tính là red-first). 20 hàng pending được copy, rồi accept; kết quả `{decided 20, accepted 20, rate 1, halved false}`.
  - "an accepted row with legacy-shaped evidence and equal timestamps still counts": pin cho điều kiện `status = 'rejected'`. Production không tạo hàng này (copy chỉ ra `open` hoặc `rejected`, accept đặt `updated_at = now`), nên điều kiện là phòng thủ.
- Mutation (bỏ `status = 'rejected' AND` trong mệnh đề `NOT`): đúng 1 test đỏ ("an accepted row with legacy-shaped evidence…"), các test còn lại xanh. Đã hoàn nguyên, `cmp` giống hệt bản sao lưu `scratchpad/improvementSelfTune-fix1-good.ts`.
- Comment đầu `improvementSelfTune.ts` cập nhật để nhắc loại trừ 5d (chỉ comment, không đổi truy vấn).
- Kiểm tra: focused 5 file 58/58 (56 cũ + 2 mới); server tsc exit 0.
- Full suite (task `b6vd9hhi2`, log `scratchpad/server-full-5d-fix1.log`, 2026-11-20): Test Files 291 passed, 4 skipped (295); Tests 2389 passed, 9 skipped (2398); Duration 276.50 s; `SUITE_EXIT=0`. Khớp kỳ vọng, không có dòng FAIL. Đối chiếu với 5d: +2 test, không thêm file.
- Kiểm tra thêm: `git status --short -- docs/proposals data data-dev` không có thay đổi.
- Limits 7 và 8 đóng. Không đổi dạng `improvementSelfTuneStats`.
