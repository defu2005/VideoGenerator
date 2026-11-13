# TASK-051 — Vận hành app với nhiều provider

Đọc README, TASK-026, TASK-032, TASK-044, TASK-047 và mục 9 của kiến trúc. Dùng registry, pipeline và router hiện có. Test offline bằng fixture. Không thêm npm dependency.

## Mục tiêu

Người dùng chọn agent vận hành theo kênh và môi trường. Model cho từng tác vụ nội dung có cấu hình riêng. Mọi provider có đường tích hợp qua một giao diện chung. Mức hỗ trợ thực tế phụ thuộc giao thức, năng lực và quyền kết nối của runtime. Một model chỉ sinh văn bản vẫn có thể lập kế hoạch qua cầu nối của app nếu xuất được lệnh đúng schema.

## Triển khai

1. Khai báo năng lực ở adapter và model gồm giao tiếp, tool calling, structured output, vision, context, resume, streaming và cancel. Kiểm tra cấu hình, khả dụng và năng lực trước khi nhận việc. Hiện lý do khi lựa chọn chưa dùng được. Fallback phải theo cấu hình của người dùng và ghi rõ runtime/model thực tế.
2. Tách vòng đời agent khỏi nhà cung cấp nội dung. Chuẩn hóa khám phá runtime, bắt đầu hoặc nối phiên, tiến độ, tool call, kết quả và dừng. Đưa Cursor operator hiện có vào giao diện này. Dùng Claude làm adapter đối chứng đầu tiên. Giữ lựa chọn agent cho web, Telegram và lịch chạy. Ghi phiên theo adapter để không gửi session ID sang provider khác.
3. Chuẩn hóa hợp đồng tool gồm tên, JSON Schema, quyền, kết quả và lỗi. Xuất cùng hợp đồng cho MCP client, native function calling và cầu nối JSON có giới hạn bước. Cầu nối chỉ chạy lệnh qua validate và registry của app. Khi model không xuất lệnh hợp lệ sau lượt sửa giới hạn, báo lỗi hoặc hỏi người dùng.
4. Skill, RAG và memory do app cung cấp dưới dạng dữ liệu và công cụ dùng chung. Adapter chuyển sang định dạng giao tiếp phù hợp với provider. Khi runtime bên ngoài kết nối qua MCP, giữ quyền theo cấu hình nguồn đã được cấp. Agent chạy nền đi qua chính sách `operator`. Không tự mở cổng API cục bộ ra mạng, nâng quyền, bật fallback trả phí hay thực thi trên dự án được bảo vệ.

## Nghiệm thu

- Cùng yêu cầu đọc trạng thái và tạo đề xuất chạy được qua mock MCP, native function calling và cầu nối văn bản. Cả ba cùng validate tham số và chờ duyệt khi thao tác có rủi ro.
- Chạy cùng kịch bản thử bằng adapter Cursor và Claude. Đổi agent ở web/Telegram giữ được ngữ cảnh cấp app và route model tác vụ. Có fixture cho runtime vắng mặt, lỗi định dạng, dừng phiên và ngắt kết nối.
- Dùng bộ quyền an toàn mặc định cho adapter mới. Kiểm tra việc từ chối tự duyệt, ghi secret, và thao tác trên dự án được bảo vệ. Ghi kết quả thực nghiệm riêng với kết quả mô phỏng.
