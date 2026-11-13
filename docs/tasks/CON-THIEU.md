# Phần còn thiếu

Ghi lúc khoảng 23:58 ngày 2026-11-05 (Asia/Bangkok), sau khi dừng việc làm tiếp các task trong `docs/cursor/README.md`.

Mỗi task trong bảng README đã có `docs/tasks/TASK-XXX.report.md` và file `.done` rỗng. File `.done` không có nghĩa guide đã được kiểm hết. Dự án `56374fb2-54cf-48ff-9441-2e6c653295d4` không bị duyệt cổng và không bị render.

## Checklist README chưa chạy lại

Lần đầy đủ gần nhất là khoảng 23:20 (Asia/Bangkok):

- `npm test --workspaces`: shared 334, mcp 14, server 649 qua và 1 bỏ qua, web 149.
- `npm run typecheck` và `npm run build` đã qua sau đó, trước các sửa giao diện và kế hoạch dựng buổi tối.
- `npx drizzle-kit generate` lần hai in `No schema changes`.

Sau 23:20 chỉ chạy từng nhóm test nhỏ. Chưa có lượt typecheck, build và test toàn workspace cho cây mã hiện tại. Chưa bấm thử trên trình duyệt.

Thẻ **Bản đề xuất** vừa được thêm dàn ý từng phần và số giây. Lệnh test của thay đổi đó bị dừng trước khi có kết quả.

## Kiểm tra trực tiếp còn mở

Các mục dưới đây nằm trong guide. Chưa làm vì sẽ ghi `data/`, gọi mô hình hoặc CLI thật, hoặc cần trình duyệt.

| Task | Còn thiếu |
|---|---|
| TASK-013 | Mở dự án thử, render hai lần, mở file zip. |
| TASK-018, TASK-019, TASK-020, TASK-021 | Bấm trên dự án thử. TASK-021B chưa kiểm edge-tts và URL ảnh NASA trên dự án thử. |
| TASK-025, TASK-029, TASK-030 | OAuth và tải lên bằng tài khoản thật. |
| TASK-026 | OmniRoute thật với `OMNIROUTE_API_KEY`. |
| TASK-031 | Bot Telegram với token thật. |
| TASK-032 | Chat với mô hình thật. |
| TASK-033 | Đồng bộ thống kê từ API thật. |
| TASK-036 đến TASK-039 | Bấm trên dự án thử. TASK-037 chưa chạy CLI nhận dạng giọng. |
| TASK-041 | Render `eb02c679-26a3-4a42-8ea9-bb4e1a25288d` theo từng phong cách dựng và lưu ảnh khung hình. |
| TASK-042 | Đo thời gian render cả video có và không có đồ họa. Ca khói `HYPERFRAMES_SMOKE=1` vẫn bỏ qua. Khung mẫu trong `docs/tasks/TASK-042-frames/` đã có. |
| TASK-043 | Chọn mẫu danh sách, chạy tới cổng kịch bản, áp dụng chat, hoàn tác, xem nhanh 10 giây, kèm ảnh chụp. |
| TASK-044 | Chưa đổ usage quota trên dự án thử vì sẽ ghi `data/`. Chưa có ảnh tab Quota. |
| TASK-045 | Chưa lưu token quản trị OmniRoute. Thẻ used/total thật còn trống. Đã thấy `needs_token` khi OmniRoute chạy mà chưa có token. |
| TASK-046 | Chưa có phiên operator đọc trang Scaleway hoặc DeepSeek. Chưa bấm **Áp dụng** hoặc **Cập nhật OmniRoute**. Danh mục vẫn là hồ sơ chờ kiểm chứng. |
| TASK-047 | CLI có ở `%LOCALAPPDATA%/cursor-agent/versions/2026.11.05-86047df` nhưng chưa được chạy. Chưa bật tick. |
| TASK-048 | Chưa hỏi trợ lý câu Telegram trên mô hình thật. Trang Hướng dẫn chỉ được kiểm trong jsdom. |
| TASK-049 | Chưa mở các trang chính ở 1280 px và 390 px. Chưa có ảnh trước và sau. |
| TASK-050 | Chưa bấm **Tính lại** trên một dự án thử. |

Việc người dùng phải tự làm, app không làm hộ:

- Tạo token đọc OmniRoute và dán vào tab Quota.
- Bật lệnh nghiên cứu tuần và tháng nếu muốn. Lệnh một lần đã được gieo ở trạng thái bật.
- Tự xem dashboard nhà cung cấp rồi bấm **Tôi đã kiểm tra trên dashboard**.

## MCP `app_api` chưa làm được (2026-11-06)

- Tải file lên: ảnh cảnh, giọng, nhạc, thumbnail. Các route này nhận multipart, `app_api` chỉ gửi JSON.
- Tải file nhị phân về: mp4, ảnh, audio. `app_api` chỉ đọc JSON.
- Token Telegram, token quản trị OmniRoute, khóa TTS. Cố ý không đưa vào MCP.

## Mã còn lệch so với guide

- **Xem nhanh 10 giây** trả cửa sổ thời gian, độ phân giải thấp và tên đồ họa. Chưa xuất file video 10 giây.
- **TASK-049:** cảnh, giọng, nhạc và timeline đã dùng token màu. Các trang khác vẫn còn mã màu riêng. Chưa đổi hết trang sang component mới. “Tải thêm” cắt danh sách đã tải hết, chưa có `limit` và `cursor` trên API bình luận, chủ đề, phân tích, nhật ký và job clip. Shell JS lần đo trước khoảng 512 kB, chưa đo lại.
- Nhãn còn tiếng Anh vì test đang tìm đúng chữ: trạng thái `Draft` và `Review`, nút cảnh **Save changes** và **Split after**, một số câu trên trang kịch bản trống và hộp thoại sửa dự án.
- Các câu `window.confirm` còn lại (bỏ sửa chưa lưu, rời trang, kiểm tra ảnh bằng AI, tạo lại metadata) đã chuyển sang hộp xác nhận trong app ngày 2026-11-06. Xóa gói hướng dẫn và xóa chờ quota không còn gọi `window.confirm`.
- **TASK-032:** usage trợ lý ghi job `ASSISTANT` không gắn dự án và hiện trên trang Mức dùng (2026-11-06).
- **TASK-034:** không có rút tiền tự động, không có API doanh thu TikTok, Facebook, Instagram, và không có xuất PDF. Guide để các mục này ngoài phạm vi. Doanh thu nhập tay và CSV.
- Báo cáo cũ của TASK-010, TASK-011, TASK-012, TASK-017 và TASK-022 đến TASK-024 còn câu “task sau chưa làm”. Các task sau đã có mã và báo cáo riêng. Những câu đó trong báo cáo cũ là dấu vết, không phải trạng thái hiện tại.
