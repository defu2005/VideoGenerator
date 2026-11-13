# TASK-069

## Đã làm

- Vòng sửa kịch bản đọc điểm, sự kiện chặn, finding MUST và ghi chú duyệt. Khi `revise_round > 0` và kịch bản vẫn do agent viết, prompt thêm khối "Bản trước chưa đạt" cùng kịch bản trước. Khóa cache thêm vòng và hash lý do. Vòng 0 giữ nguyên prompt và khóa cũ.
- Người dùng lưu kịch bản hoặc bấm chạy lại bước kịch bản thì `revise_round` về 0.
- `runStage` được chờ. Nếu lần sửa ném lỗi, cổng được giữ và có việc `approve`.
- Cổng đăng kiểm metadata và ảnh bìa một lần, rồi kiểm tra từng tài khoản. Một tài khoản lỗi thì không tạo lượt đăng nào. Thông báo dùng tên kênh, ví dụ "Kênh B: quota".
- Lệnh nguồn `agent` bật `ctx.gated`. `approve_gate` và `publish_project` dùng cờ này cho cổng. Thẻ chờ và lần bấm của người dùng không bật cờ. Quyền tự vận hành của nguồn `agent` không đổi.

## Cách xử lý nhiều tài khoản

Tất cả hoặc không. Tài khoản nào lỗi được nêu tên và lý do. Không đăng phần còn lại.

## Kiểm tra

`npm run typecheck` đạt. `npm test` khoảng 21:15 giờ Bangkok (UTC+7) ngày 10/11/2026: shared 375, mcp 19, server 806 đạt và 1 bỏ qua, web 178.

Kiểm tra trực tiếp, server trong tiến trình, cổng không mở, mock LLM, thư mục dữ liệu tạm, khoảng 21:11 giờ Bangkok (UTC+7) ngày 10/11/2026:

- Dự án mới, điểm kịch bản lưu là 8. Mục tiêu hồ sơ đặt điểm tối thiểu 10.
- Ba lần `approve_gate` từ nguồn operator: sửa vòng 1, sửa vòng 2, rồi giữ với điểm 9 và việc "Giữ cổng kịch bản".
- `publish_project` với header `x-vg-tool-source: agent` khi chưa có ảnh bìa trả 409, câu "Chưa đăng được: thumbnail."

Không chạy tiếp tới render. Bước sau kịch bản tìm ảnh trên mạng và render cần ffmpeg. Không đụng dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Khác hướng dẫn

Điểm tối thiểu đặt trong mục tiêu hồ sơ (`operator_goals.spec.minQualityScore`). Ghi vào `settings` của dự án bị lần lưu kịch bản ghi đè vì schema dự án không có trường đó.
