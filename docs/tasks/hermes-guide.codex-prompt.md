Viết mục hướng dẫn kết nối Hermes Agent với MCP server của app. Đây là việc tài liệu, không đổi code của app.

Bối cảnh:
- Người dùng đã cài Hermes Agent (Nous Research) trong WSL trên máy này.
- MCP server của app nằm ở apps/mcp. Nó chạy qua stdio (StdioServerTransport) và file chạy là apps/mcp/dist/index.js.
- MCP server gọi API của app qua biến VG_API_URL, mặc định http://127.0.0.1:3001. API phải đang chạy (`npm run dev`).
- Tool đi qua registry chung. Thao tác rủi ro thành thẻ chờ duyệt, và dự án được bảo vệ bị chặn.
- Có một phiên TASK-057 khác đang sửa code và docs cùng lúc. Chỉ sửa đúng file docs/user-guide/tro-ly-va-telegram.md. Không đụng file nào khác, kể cả featureMap và nhat-ky-thay-doi.md.

Việc cần làm:
1. Đọc tài liệu chính thức của Hermes tại https://hermes-agent.nousresearch.com/docs để biết đúng cách khai báo MCP server: file cấu hình, khoá, cách truyền command, args và env. Đừng đoán.
2. Tìm cách hợp lý nhất để Hermes chạy trong WSL gọi được MCP server stdio của app chạy trên Windows. Phương án ưu tiên: gọi node.exe của Windows qua WSL interop, với args là đường dẫn Windows tới apps/mcp/dist/index.js. Khi đó 127.0.0.1:3001 vẫn trỏ tới API trên Windows. Nếu tài liệu Hermes hay thử nghiệm cho thấy cách khác tốt hơn thì dùng cách đó và ghi lý do.
3. Thử thật nếu làm được mà không đổi cấu hình của người dùng. Ví dụ: từ WSL chạy lệnh node.exe đó, gửi một yêu cầu MCP `initialize` và `tools/list` qua stdin, rồi kiểm tra có danh sách tool. Không sửa ~/.hermes của người dùng; chỉ đưa cấu hình mẫu vào tài liệu. Nếu không thử được thì ghi rõ trong báo cáo.
4. Thêm mục `## Kết nối Hermes Agent {#hermes}` vào docs/user-guide/tro-ly-va-telegram.md, đặt sau mục Agent operator. Viết tiếng Việt, ngắn, theo giọng các mục khác. Nội dung gồm:
   - Hermes dùng được những gì: cùng bộ tool với trợ lý, thao tác rủi ro vẫn chờ bạn duyệt trong app, dự án bảo vệ bị chặn.
   - Điều kiện: chạy `npm run build` (để có apps/mcp/dist) và `npm run dev`.
   - Khối cấu hình mẫu cho Hermes, có đường dẫn thật của repo này.
   - Cách kiểm tra đã kết nối.
   - Lưu ý: không ghép thêm bot Telegram thứ hai vào cùng chat với bot của app; Hermes không lấy được khoá vì MCP không có tool đọc khoá.
   - Lỗi hay gặp: API chưa chạy, chưa build, đường dẫn WSL sai.
5. Chạy test web và shared để chắc coverage test của user guide vẫn qua (`npm test` trong apps/web và packages/shared, hoặc lệnh trong docs/cursor/README.md).

Luật cứng: không commit, không push, không đổi branch; không động vào .env, .claude/, data/, scripts/; không đưa khoá hay token thật vào tài liệu.

Khi xong, viết docs/tasks/HERMES-GUIDE.report.md gồm: cấu hình đã dùng, nguồn tài liệu Hermes đã đọc, kết quả thử thật (hoặc lý do không thử được), kết quả test. Cuối cùng tạo file rỗng docs/tasks/HERMES-GUIDE.done.
