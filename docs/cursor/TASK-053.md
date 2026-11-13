# TASK-053 — Tự học, bổ sung skill và đề xuất công cụ MCP

Đọc README, TASK-035, TASK-046, TASK-047 và TASK-052. Mở rộng cơ chế đề xuất và duyệt skill đã có. Dùng schema, registry và quyền của app. Test offline bằng fixture. Không thêm npm dependency.

## Chu trình học

1. Thu tín hiệu từ kết quả workflow, sửa đổi của người dùng, lỗi lặp lại, công cụ bị thiếu và điểm đánh giá. Gắn bài học với bằng chứng, độ tin cậy, hồ sơ và loại tác vụ. Gộp trùng, giới hạn tần suất và ngân sách học. Một lượt thất bại hoặc lời tự nhận thành công của model chỉ là tín hiệu.
2. Tự tạo bản nháp skill mới hoặc bản sửa skill hiện có. Dùng định dạng do app quản lý, gồm mục đích, điều kiện kích hoạt, workflow, tên tool trong registry, yêu cầu năng lực và ví dụ. Giữ skill dùng được từ mọi adapter phù hợp. So sánh với skill hiện có, kiểm schema, quyền và chạy bộ đánh giá trước khi đề nghị dùng. Lưu phiên bản, nguồn, điểm đánh giá và bản có thể khôi phục. Người dùng duyệt trước khi skill mới hoặc skill đã sửa được dùng chung.
3. Khi thiếu tool, tìm trong registry, MCP và các API đã được cấp quyền trước. Nếu vẫn thiếu, tự ghi đề xuất với thao tác mong muốn, ca tái hiện, tác động, schema vào/ra, quyền, dữ liệu gửi đi, yêu cầu xác nhận và tiêu chí kiểm thử. Gộp đề xuất trùng và hiển thị cho người dùng trên web. Thông báo qua Telegram theo cài đặt của người dùng.
4. Phân biệt bổ sung một tool cho API của app và kết nối MCP server bên ngoài. Tool nội bộ đi qua triển khai và kiểm thử. Server bên ngoài cần kiểm tra nguồn, phạm vi dữ liệu, credential và quyền thực thi trước khi người dùng bật. Đề xuất của agent không tự cài server, sửa code, truyền secret hoặc thay đổi quyền.

## Nghiệm thu

- Các lượt mô phỏng có cùng lỗi tạo một bản nháp skill có bằng chứng. Sau khi người dùng duyệt, hai adapter đủ năng lực tìm được cùng phiên bản và có thể quay lại phiên bản trước.
- Một tác vụ thiếu chức năng tạo được đề xuất MCP có schema, quyền và bước kiểm thử. Nếu công cụ phù hợp đã tồn tại, agent tìm thấy và không tạo đề xuất trùng.
- Fixture từ chối skill đòi quyền ngoài registry, secret trong bằng chứng và đề xuất tự cài MCP. Báo cáo phân biệt bài học, skill đang dùng và đề xuất công cụ đang chờ xử lý.
