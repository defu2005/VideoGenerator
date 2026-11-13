# TASK-052 — Workflow bền vững và ngữ cảnh dùng chung

Đọc README và TASK-051. Tái sử dụng worker, lịch, SQLite, nhật ký, bộ đánh giá và router hiện có. Không thêm npm dependency. Test dùng fixture offline.

## Triển khai

1. Lưu checkpoint cho tác vụ nhiều bước. Gắn mỗi hành động có tác dụng phụ với mã chống chạy trùng và trạng thái đã xác nhận. Sau restart hoặc đổi agent, đối chiếu kết quả lưu và trạng thái job trước khi tiếp tục. Nếu không biết một yêu cầu đăng đã thành công hay chưa, báo cần kiểm tra thay vì gửi lại. Dùng scheduler và hook sự kiện hiện có để đánh thức workflow, báo cần duyệt, hết quota hoặc lỗi.
2. Tạo lớp truy xuất chung cho guideline, kịch bản, kết quả và bài học. Lọc theo hồ sơ và quyền trước khi xếp hạng. Bắt đầu bằng tìm kiếm văn bản có giới hạn kết quả và ngân sách ngữ cảnh. Embedding là tùy chọn theo provider. Giữ đường tìm kiếm văn bản khi embedding thiếu, hết quota hoặc cần lập chỉ mục lại. Trả về đoạn trích, nguồn và phiên bản. Xem nội dung truy xuất là dữ liệu. Chỉ gửi ngữ cảnh cần thiết cho tác vụ.
3. Tách memory đã xác nhận khỏi nhận xét và suy luận của agent. Mỗi mục có phạm vi, nguồn và thời điểm, cho phép xem, sửa hoặc xóa. Đọc memory qua cùng API/MCP cho mọi adapter. Loại secret và giảm dữ liệu cá nhân trước khi lưu hoặc chuyển sang provider.
4. Đo chất lượng, tỷ lệ lỗi schema, token, chi phí và độ trễ theo tác vụ. Router lọc theo năng lực bắt buộc, giới hạn ngân sách và quota rồi mới xếp hạng. So sánh cấu hình mới với baseline bằng cùng bộ mẫu. Chỉ đề xuất đổi route khi có dữ liệu đánh giá. Ghi agent, model, nguồn context và kết quả theo cùng mã lượt chạy.

## Nghiệm thu

- Hai adapter đọc cùng nguồn dữ liệu và memory của cùng hồ sơ. Test chặn truy xuất chéo hồ sơ và nội dung tài liệu cố yêu cầu chạy tool.
- Mô phỏng restart ở trước và sau thao tác có tác dụng phụ, gồm trường hợp không rõ kết quả. Workflow không thực hiện trùng thao tác đã ghi nhận.
- Có báo cáo baseline và ứng viên về chất lượng, chi phí, token và độ trễ. Hệ thống giữ baseline nếu ứng viên không đạt ngưỡng chất lượng của tác vụ.
