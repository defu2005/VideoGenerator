# TASK-004I report

## Đã hoàn thành

- Thêm tổng hợp mức dùng trực tiếp từ `jobs.usage`, không thêm bảng hay migration. Bao gồm job lỗi/hủy, retry, dữ liệu cũ không có `calls`, cache, fallback, lỗi từng call, token không rõ và premium requests.
- Thêm schema Zod dùng chung và API `GET /api/projects/:id/usage`, `GET /api/usage` với lọc ngày và nhóm theo ngày, provider, model hoặc project.
- Thêm cấu hình tỷ giá `USD_VND_RATE` (mặc định `26000`) trong server và `.env.example`.
- Thêm tab **Token** cho project: tổng token/lượt/chi phí, quá trình có thể mở để xem tác vụ và lần chạy, model, ước tính so với thực tế, VND/USD và cập nhật khi nhận SSE job event.
- Thêm badge token/lượt vào thẻ project và trang **Mức sử dụng** toàn ứng dụng với bộ lọc ngày, nhóm dữ liệu và top video.
- Thêm MCP tool `get_project_usage`.
- Không thêm dependency, không sinh migration, không gọi LLM hay chạy CLI bên ngoài.

## Kiểm tra

Các lệnh sau chạy từ thư mục gốc và đều thành công:

- `npm run typecheck`
- `npm run build`
- `npm test` — 52 test files, 406 tests passed:
  - shared: 10 files / 117 tests
  - MCP: 1 file / 10 tests
  - server: 27 files / 229 tests
  - web: 14 files / 50 tests

Build có cảnh báo hiện hữu của Rollup về annotation trong Zod và kích thước bundle; build vẫn thành công.

## Chưa thực hiện

- Không chạy thử trực tiếp với provider/CLI thật hoặc project BALANCED: yêu cầu này cần gọi LLM và bị loại trừ theo chỉ dẫn.
- Không chạy `npm audit`; chỉ chạy ba lệnh kiểm tra được yêu cầu.
- Chưa xác minh trực quan qua trình duyệt ở các viewport 375/768/1280 px; responsive behavior được xử lý bằng CSS và được kiểm tra qua build/test.
