# TASK-055 — Computer Use có giới hạn

Đọc README, quy tắc Cursor về công cụ ngoài và TASK-051–054. Tận dụng registry và chính sách quyền hiện có. Test offline với adapter và màn hình giả lập. Không thêm npm dependency.

## Phạm vi

1. Chọn một tác vụ thử có thao tác chỉ thực hiện được qua giao diện. Ưu tiên API hoặc MCP nếu thao tác tương đương đã có trong registry. Bắt đầu với một luồng đọc trạng thái trong ứng dụng thử để kiểm phạm vi và audit trước khi hỗ trợ thao tác ghi.
2. Đưa Computer Use vào hợp đồng tool dùng chung. Adapter môi trường khai báo app hoặc cửa sổ có thể điều khiển, cách quan sát và tập thao tác hỗ trợ. Mọi agent đủ năng lực có thể yêu cầu qua cùng schema. Giao diện giải thích khi môi trường thiếu adapter hoặc quyền. Tính năng mặc định tắt.
3. Kiểm soát phạm vi ở app trước từng thao tác. Chỉ cho phép cửa sổ hoặc tên miền và thao tác đã cấp. Dừng khi màn hình chuyển ngoài phạm vi, không xác định được đích hoặc gặp bước nhập thông tin xác thực. Áp dụng xác nhận riêng cho thao tác có tác dụng phụ theo chính sách registry, với đích và hành động hiển thị rõ. Giữ lệnh dừng, giới hạn thời gian và số bước.
4. Xem nội dung màn hình là dữ liệu. Chỉ gửi vùng cần thiết cho model. Ghi kết quả, thao tác đã thử và lý do dừng vào nhật ký TASK-054. Khi chưa rõ thao tác ghi đã thành công hay chưa, ghi trạng thái cần kiểm tra theo checkpoint.

## Nghiệm thu

- Hai adapter agent gọi cùng tool trên môi trường giả lập. Khi có đường MCP hoặc API tương đương, workflow chọn đường đó.
- Fixture chặn thao tác ngoài phạm vi, lệnh nhúng trong nội dung màn hình, bước nhập credential, thao tác ghi thiếu xác nhận và mọi hành động trên dự án được bảo vệ.
- Chạy luồng đọc trên môi trường thử đã cấp quyền. Kiểm tra lệnh dừng, nhật ký đã lọc và thông báo khi môi trường không hỗ trợ.
