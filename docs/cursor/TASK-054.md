# TASK-054 — Tự động hóa theo sự kiện và theo dõi xuyên suốt

Đọc README, TASK-028, TASK-031 và TASK-051–053. Dùng lại scheduler, hook, thông báo, nhật ký và checkpoint hiện có. Test offline bằng fixture. Không thêm npm dependency.

## Phạm vi

1. Chuẩn hóa các sự kiện job lỗi, render xong, hết quota và chờ duyệt. Sự kiện có mã ổn định, thời điểm, hồ sơ và liên kết đến job hoặc hành động chờ. Phát sau khi lưu trạng thái nguồn. Nếu server dừng giữa hai bước, dùng trạng thái đã lưu để tìm và giao lại sự kiện còn thiếu.
2. Cho người dùng bật từng loại thông báo hoặc quy tắc đánh thức agent theo hồ sơ. Cấu hình thông báo web và Telegram theo kênh đã ghép. Dùng mã sự kiện và quy tắc để chống xử lý trùng. Chặn vòng lặp tự đánh thức và tuân thủ nút tạm dừng, trần lượt chạy, ngân sách và quyền của registry. Một sự kiện chờ duyệt chỉ thông báo và liên kết đến thẻ duyệt.
3. Liên kết tin nhắn gốc, lượt agent, tool call, job, model, usage và kết quả. Hiển thị agent và model thực tế, lần thử lại, lý do fallback và lỗi đã lọc dữ liệu nhạy cảm. Chỉ đưa metadata cần thiết vào nhật ký mặc định. Cho phép mở từ thông báo tới lượt chạy liên quan.

## Nghiệm thu

- Fixture phát lặp hoặc mô phỏng restart. Mỗi quy tắc tạo tối đa một lượt cho cùng sự kiện. Trạng thái tạm dừng và quyền theo hồ sơ được giữ khi giao lại.
- Người dùng lần được từ thông báo job lỗi tới nguyên nhân và model thực tế. Fixture kiểm che secret và kiểm sự kiện chờ duyệt không thực thi hành động.
- Dùng cùng kịch bản trên dự án thử cho Cursor và adapter Claude. Giao việc qua web hoặc Telegram, gọi MCP hoặc function calling, kiểm model theo tác vụ, theo dõi tiến độ và xác nhận app dừng ở bước cần duyệt. Báo cáo riêng kết quả chạy thật và mô phỏng, kèm số liệu baseline về token, chi phí và chất lượng.
