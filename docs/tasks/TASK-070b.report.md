# TASK-070b

Mặc định giữ **compose**. Video compose của lần kiểm tra trực tiếp hết 69,1 giây, bản cổ điển 54,7 giây (khoảng 1,26 lần). Compose không có khung đen, bản cổ điển có 1. Ảnh compose ở 15% thời lượng là footage biển thật. Khung đứng hình nhiều hơn (9 so với 6) vì ảnh tĩnh có Ken Burns, `freezedetect` ngưỡng n=0,003 và d=1,5. Không đổi `resolveEditEngine`.

Lần đo chạy trên mã trước khi nối đạo diễn và `targetShortSide`. Bắt đầu 01:22, xong 01:27 ngày 12/11/2026, giờ Bangkok (UTC+7). Dự án thử `ecd9c862-03ff-46a1-b696-4104e9db2f93`, đã lưu trữ. Không đụng dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Kiểm tra trực tiếp

| Mục | Cổ điển | Compose (ECO) |
| --- | ---: | ---: |
| Khoá Pixabay / Pexels | có / không | có / không |
| Kích thước | 1280×720, 30 fps, 57,6 giây | 1280×720, 30 fps, 57,6 giây |
| Giây render | 54,7 | 69,1 |
| Cảnh mỗi phút | — | 22,9 |
| Ảnh tĩnh | — | 33,8% |
| Footage | — | 66,2% |
| Cắt đúng nhịp | — | chưa có nhạc |
| Đoạn đứng hình | 6 | 9 |
| Đoạn đen | 1 | 0 |
| File footage mới | 0 | 13 |

Mười ba file `pixabay-*-720.mp4` đúng 13 clip khác nhau trong kế hoạch, và cả 13 shot footage đều có đường file. Ngưỡng giữ clip là 0,45. Clip được giữ thấp nhất là `pixabay:846` (thư viện), điểm 0,95. Không có clip dưới 0,45 được giữ. Không có điểm trong khoảng 0,43–0,47. 77 clip điểm từ 0,47 trở lên không được dùng vì mỗi cảnh chỉ nhận khoảng hai shot footage, không phải vì bị loại nhầm. Điểm lần này chưa nhân hệ số độ phân giải.

Sáu cảnh: Biển, Rừng, Phố, Cà phê, Núi, Thư viện. Clip được giữ: Biển `4006`, `275633`, `198488`; Rừng `49981`, `111101`; Phố `53902`, `21118`; Cà phê `34`, `331175`; Núi `34608`, `367684`; Thư viện `21710`, `846`.

Ba khung mỗi bản:

- Cổ điển 15%: nền xanh biển (ảnh thử).
- Cổ điển 50%: nâu cà phê.
- Cổ điển 85%: vàng đất.
- Compose 15%: footage bãi biển, khớp cảnh Biển.
- Compose 50% và 85%: ảnh màu của fixture. ECO tắt đồ hoạ nên hai khung này là ảnh tĩnh, đúng chế độ đã đo.

Cả hai bản ghi dòng render rồi báo `no such table: source_manifests` khi kiểm lại nguồn. Bảng đó thuộc phần nguyên bản (TASK-084). File mp4 và dòng `renders` đã có: cổ điển `2bfea789-372f-4567-86e0-37f75979b8e4` (164.324 byte), compose `659df68d-3af2-4866-b0a9-3f24f94ee9ca` (15.645.313 byte). Phần này không tạo bảng và không sửa originality.

## Đã làm

1. `pickDirector`: ECO dùng luật, kể cả khi hồ sơ chọn đạo diễn chất lượng. Chất lượng gọi `createLlmDirector` một lần cho cả video, qua `generateRoutedStructured`, task `editPlan` (nhãn dùng lượng gần nhất; không thêm task `COMPOSE`). `renderExecutor` ghi usage khi `llmCalls` lớn hơn 0. Tìm footage lấy 12 kết quả. Đạo diễn vẫn thấy 6 clip điểm cao nhất. `planProject` nhận `targetShortSide`. Ghi chú điểm relevance, fit, giữ hay bỏ nằm trong `footageNotes` của plan.
2. Luật và prompt biết bốn kiểu: bản đồ khi dạng giải thích hoặc điểm tin và lời thoại nêu nước hoặc tỉnh có trong file địa giới; so sánh khi có hai vế hoặc dạng sự thật và hiểu lầm; câu trích khi có ngoặc kép 6–28 từ và tên người nói; danh sách khi dạng danh sách hoặc hướng dẫn và có 3–6 mục. Cả nhóm đồ hoạ vẫn không quá 30% thời lượng. ECO tắt đồ hoạ trước khi chọn các kiểu này.
3. Cảnh không có footage và có từ hai ảnh thì thân cảnh tách hai ảnh. Một ảnh thì giữ một shot.
4. Tab Render, mục Cảnh quay: Đổi kiểu, Đổi footage, Khoá. `PATCH /api/projects/:id/compose-plan/shots/:shotId`. Shot khoá nằm trên JSON plan, được giữ khi dựng lại. Mỗi lần sửa gọi `markUserTouch`. Kiểu không hợp độ dài hoặc chưa đủ chữ trả 400.
5. Khi đăng, `renders.report.compose.stats` vào hàng học: engine, cảnh mỗi phút, phần ảnh, phần đồ hoạ, cắt đúng nhịp, kiểu shot đầu, entropy. Video cổ điển để các cột này trống. Insight so nhóm xem nhiều và nhóm xem ít theo phần trăm xem trung bình. Câu gợi ý đi qua pattern sẵn, không ghi cài đặt.
6. Hướng dẫn `#kieu-dung`, nhật ký, `featureMap` khoá `compose-plan`, `docs/compose/README.md` và `docs/compose/EVAL.md`.

## Kiểm tra

Typecheck, giờ Bangkok 12/11/2026: server xong 02:05; web, mcp và shared xong 02:07. Cả bốn đạt.

`npm test`:

- `@vg/shared`: 597 đạt (suite workspace, khoảng 02:00–02:05).
- `@vg/mcp`: 19 đạt.
- `apps/web`: 185 đạt, 67 file (bắt đầu 02:03).
- `apps/server` đủ bộ, 02:06–02:10: 949 đạt, 4 bỏ qua, 7 lỗi, thêm 2 suite kẹt hook 30 giây vì máy đang bận. Chín file đó chạy lại 02:11–02:12: 110 đạt, gồm `review.test.ts` và `operator.test.ts`.
- Test của phần này (`composeDirector`, `composeRender`, `learning`) đạt trong lần đủ bộ lúc 02:06.
- `VG_COMPOSE_EVAL=1`: 2 đạt, 1 bỏ qua (mẫu PNG cần `VG_COMPOSE_SAMPLES=1`). Chạy 02:13–02:31, 1.069 giây. Bài đo ghi lại số trong `docs/compose/EVAL.md`. Mục bốn kiểu đồ hoạ còn nguyên.

Trình duyệt, khoảng 02:15, dự án tạm `2dbfd3de-dcd6-4924-9931-b57b8aa925ed` trên cổng 5192: mục Cảnh quay hiện Đổi kiểu, Đổi footage và Khoá. Bấm Khoá thì dòng thành «đã khoá» và nút thành «Bỏ khoá». Bấm Đổi kiểu Ảnh tĩnh thì dòng footage thành «Ảnh tĩnh · 2.0–4.0s · R4-footage+đổi» và vẫn khoá. Bấm Đổi kiểu Biểu đồ thì hiện «Chưa đủ chữ trên hình cho kiểu này.» và shot giữ nguyên. Máy chủ tạm đã tắt sau lần bấm.

## Chỗ lệch so với chữ trong guide

- Lượt AI ghi vào task `editPlan`, vì không có mã task `COMPOSE`.
- Lần đo ECO tắt đồ hoạ, nên bốn kiểu mới bằng 0 trên video mẫu. Khung từng kiểu đã có từ TASK-070.
- Điểm footage lần đo chưa có hệ số độ phân giải. Lần dựng sau truyền `targetShortSide`.
- Pool tìm kiếm là 12. Đạo diễn vẫn nhận 6 clip đầu.
- Ảnh thứ hai chỉ khi cảnh không có footage và có ít nhất hai ảnh.
- `locked` nằm trên JSON, không thêm cột cơ sở dữ liệu.
- Cụm so sánh nằm trong `kinds070.ts`.

## Chưa làm

Kiểu `screen` vẫn để sau, theo TASK-070. Giữ chân từng giây của YouTube nằm ngoài phần này. Không có migration.
