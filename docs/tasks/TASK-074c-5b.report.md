# TASK-074c-5b — hiển thị tỉ lệ tự hiệu chỉnh trên trang (báo cáo)

Trạng thái: đã code và test trong cây làm việc. Chưa commit, chưa push, chưa có `.done`. Không khởi động app. Không ghi vào `data/`, `data-dev/` hoặc `docs/proposals/`. Không đổi `selfImprovementBudgetStatus`, không ghi `app_settings`.

## Đã làm

- `apps/server/src/api/research.ts`: `GET /api/research` tính `selfImprovementBudgetStatus(db)` một lần, rồi thêm khóa ngang hàng `selfTune` = `{ ...improvementSelfTuneStats(db), userLimit, effectiveLimit }`. `budget` giữ nguyên hình dạng (`day`, `limits`, `used`).
- `apps/web/src/features/research/ResearchPage.tsx`: thẻ "Ngân sách hôm nay" có thêm một dòng `selfTuneText`. `selfTune` là tùy chọn trong kiểu `Overview`, nên server cũ vẫn hiển thị được.
- Test server mới: `apps/server/test/researchSelfTuneRoute.test.ts` (3 test).
- Test web mới: `apps/web/src/features/research/ResearchPage.selfTune.test.tsx` (5 test; test thứ 5 thêm sau khi sửa lỗi 1/0).

## Ba trạng thái hiển thị

- Chưa đủ 20 dòng đã quyết: "Tự hiệu chỉnh: chưa đủ dữ liệu (N/20 đề xuất đã quyết)."
- Tỉ lệ ≥ 30%: "Tỉ lệ chấp nhận X% (20 đề xuất gần nhất)."
- Tỉ lệ < 30% và E < U: thêm "Hạn mức đề xuất hôm nay giảm còn E (bạn đặt U)." Khi E = U (hạn mức 0 hoặc 1, nên không có gì bị hạ), chỉ hiện dòng tỉ lệ, không có câu "giảm còn".

## Kiểm tra red trước

- Server: 3 test đỏ, đúng lý do (`selfTune` không có trong body). Một lỗi giả của chính test (`budget` có thêm `day`) được sửa trước khi implement.
- Web: 3 test đỏ (thiếu text), 1 test "server cũ không gửi selfTune" pass ngay, đúng dự kiến.
- Web (sửa lỗi hiển thị hạn mức 1/0, advisor yêu cầu): test mới `userLimit: 1, effectiveLimit: 1, halved: true` đỏ trước khi sửa, đúng lý do (câu "giảm còn 1 (bạn đặt 1)" bị in ra sai). Sau khi sửa điều kiện thành `s.halved && s.effectiveLimit < s.userLimit`, test xanh.

## Kết quả kiểm tra

- Server focused (3 file: `researchSelfTuneRoute`, `researchApi`, `selfImprovementBudget`): 8/8 pass, sau khi hoàn nguyên mutation cũng pass lại.
- Web `src/features/research` (4 file): 9/9 pass (sau khi sửa lỗi 1/0).
- Web typecheck: lệnh thật là `npm run typecheck` trong `apps/web` = `tsc -p tsconfig.json --noEmit`. Exit 0. tsconfig có `include: ["src/**/*.ts", "src/**/*.tsx", ...]` (không phải references-only), và `ResearchPage.tsx` nằm trong danh sách file được biên dịch.
- Server typecheck: exit 0 (tsconfig loại trừ `test/`, nên không kiểm file test mới).
- Web full suite: 95 file, 278 test, exit 0 (sau khi sửa lỗi 1/0). Trước 5b là 94/273; khớp với file mới (+1 file, +5 test).
- Mutation phía server (`effectiveLimit: userLimit`): đỏ 1 test ("reports the self-tune stats…"). Đã hoàn nguyên, `cmp` giống hệt.
- Mutation phía web (nhánh `halved` bị vô hiệu): đỏ 1 test ("shows the reduced effective limit…"). Đã hoàn nguyên, `cmp` giống hệt.
- Mutation phía web (điều kiện 1/0 bị bỏ, `return s.halved ? …`): đỏ đúng 1 test mới ("does not claim a reduction when the user's limit is already 1…"). Đã hoàn nguyên từ bản sao, `cmp` giống hệt.
- Full server suite: xem mục "Kết quả full server suite" bên dưới.

## Kết quả full server suite

- Lệnh: `npx vitest run` trong `apps/server`, chạy nền từ 22:17. Lỗi 1/0 được sửa ở phía web trong lúc suite đang chạy, nên suite không chứa bản sửa đó. Bản sửa chỉ đụng `apps/web` (`ResearchPage.tsx`, `ResearchPage.selfTune.test.tsx`), không nằm trong đồ thị import của server, và không file server nào bị sửa trong lúc suite chạy. Phần web của bản sửa đã được kiểm riêng: web full 95/278 và typecheck.
- Log: `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\074f5dd9-9e4f-4407-b442-670a7f5dc0ae\scratchpad\server-full-5b.log`, `SUITE_EXIT=0`.
- Kết quả: Test Files 290 passed, 4 skipped (294); Tests 2377 passed, 9 skipped (2386). Không có dòng timeout hay FAIL.
- Đối chiếu: 289 file + 1 file mới = 290; 2374 test + 3 test mới = 2377. Khớp.

## Giới hạn đã biết (cập nhật)

- Hạn mức 1 hoặc 0: `halved` có thể là true nhưng không hạ gì (`effectiveLimit === userLimit`). Trang không còn nói "giảm còn" trong trường hợp này. Server giữ nguyên số liệu, không đổi.

1. Tỉ lệ là toàn cục, còn hạn mức theo từng workspace (`improvement_requests` không có `workspace_id`).
2. Thông báo 429 không đổi: "Đã đạt giới hạn đề xuất công cụ trong ngày." Người dùng không biết hạn mức đã bị hạ, trừ khi nhìn thẻ. (Đã đóng bởi 074c-5c, 2026-11-20: khi việc hạ là nguyên nhân, thông báo nêu hạn mức đã hạ; web và MCP vẫn không hiển thị `details`.)
3. Giao diện chưa được xem trong trình duyệt; app chưa khởi động.
4. Hạn mức hiệu lực chỉ hiển thị trên trang nghiên cứu; trang đề xuất công cụ không hiện gì.
5. Từ 5a: legacy `dismissed` → `rejected` có thể làm hạ hạn mức ngay sau migrate. (Đã đóng bởi 074c-5d, 2026-11-20.)

## Chưa làm (cố ý)

- Quy tắc chuyển trạng thái gated bằng `.done`, và `accepted → in_progress`.
- So sánh 14/28 ngày.
- Đường ghi `effort` và ánh xạ đầu ra cho 074c-3.
