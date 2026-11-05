# Trợ lý và Telegram {#tro-ly}

Trợ lý dùng cùng các nút trên web. Việc nhạy cảm luôn có bước xác nhận.

## Trợ lý AI {#tro-ly-ai}

Dùng để hỏi số liệu hoặc nhờ làm giúp. Menu: **Trợ lý AI**.

1. Gõ tiếng Việt. Ví dụ: xem lịch hôm nay, thêm chủ đề, hỏi cách bấm.
2. Khi câu hỏi là "làm sao để…", trợ lý tìm trong hướng dẫn này và nêu tên mục.
3. Nếu thiếu hồ sơ hoặc dự án, trợ lý hỏi lại, không đoán.
4. Thẻ xác nhận hiện tóm tắt. Bấm nút đồng ý hoặc từ chối.
5. **Xoá dự án** và **xoá chủ đề** luôn hỏi, kể cả khi bạn bảo làm luôn.

Mặc định trợ lý bật ở mọi chế độ ngân sách (một lượt gọi cho mỗi câu). Trợ lý không giữ token nền tảng và không hiện token bot. Nó không tự **Đăng**, không tự đổi định hướng, không tự bật lịch nếu bạn chưa đồng ý trên thẻ.

Câu mẫu: "làm sao để kết nối Telegram?". Câu trả nên chỉ tới mục [Kết nối Telegram](#telegram).

## Kết nối Telegram {#telegram}

Dùng để nhận báo pipeline, bài đã đăng, việc đang chờ, và tóm tắt cuối ngày. Cũng chat với trợ lý trong Telegram. Menu: **Thông báo**.

1. Tạo bot trên Telegram của bạn. Sao chép token.
2. Dán `<token của bạn>` vào ô token và lưu. Dòng trạng thái báo đã lưu token bot.
3. Bấm **Ghép nối**. Gửi đúng lệnh hiện trong khung cho bot, trong chat riêng. Mã hết sau 10 phút.
4. Khi **Chat đã ghép** có số, bấm **Gửi thử**.
5. Tick sự kiện muốn nhận: cần xử lý, đã đăng, đang chờ duyệt, tóm tắt ngày.
6. **Giờ tóm tắt** mặc định 21:00. Múi giờ theo ô trên form. Giờ im lặng để trống là tắt. Form gợi ý 22:00–07:00 nếu bạn bật.
7. Bấm **Lưu** trên form cài đặt.

Mặc định Telegram **tắt** và chưa ghép chat. Thông báo không gửi cho đến khi có chat đã ghép. **Xoá token** ngắt bot. Trợ lý trên Telegram hỏi xác nhận giống trên web trước khi đăng, xoá hoặc đổi định hướng. Đừng gửi token vào nội dung chat.
