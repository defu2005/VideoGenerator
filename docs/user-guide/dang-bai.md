# Đăng bài {#dang-bai}

Kết nối tài khoản một lần, rồi mỗi video bấm **Đăng** hoặc để lịch đưa vào slot.

## Tài khoản {#tai-khoan}

Dùng để YouTube, TikTok, Facebook Reels và Instagram Reels nhận video của đúng hồ sơ. Menu: **Hồ sơ** → tab **Tài khoản**.

Muốn xem mọi kênh của mọi hồ sơ hoặc thêm tài khoản theo từng bước, mở menu **Tài khoản**. Xem [Tài khoản nền tảng](ket-noi.md#tai-khoan-nen-tang).

1. Nếu chưa có dòng nào, bấm để mở **Thêm tài khoản**, chọn nền tảng, bấm **Thêm tài khoản**.
2. Dán thông tin ứng dụng của bạn (Client ID và Client Secret, hoặc App ID và App Secret). Bấm **Lưu thông tin ứng dụng**. Redirect URI lấy đúng ô trên trang.
3. Bấm **Kết nối**. Trạng thái **Đã kết nối** là xong. **Sửa** đổi tên hiển thị. **Hủy sửa** bỏ dở.
4. Khi thấy **Sắp hết hạn**, **Hết hạn** hoặc **Cần kết nối lại**, bấm **Kết nối lại**.
5. **Xóa** tài khoản, **Ngắt kết nối** và **Xóa thông tin ứng dụng** hỏi lại trước khi xóa. Video đã đăng trên nền tảng không bị xóa.

Mặc định chưa kết nối. YouTube Testing hết hạn khoảng 7 ngày. Meta khoảng 60 ngày và báo trước khoảng 7 ngày. Bản Reels cần video dọc 9:16. Instagram không hẹn giờ gốc: ứng dụng giữ job đến giờ rồi mới tải lên.

Kết nối không đăng video. Quyền thống kê và bình luận có nút riêng **Kết nối lại để bật thống kê** và **Kết nối lại để quản lý bình luận** khi tài khoản cũ thiếu quyền. Xem [OAuth hết hạn](xu-ly-su-co.md#oauth-het-han).

## Lịch đăng {#lich-dang}

Dùng để xem slot và bài đã xếp. Menu: **Lịch đăng**.

1. Mở **Lịch đăng**.
2. Xem các ô theo hồ sơ và giờ.
3. Bài hỏng hoặc cần huỷ: làm trên dự án, hoặc nhờ trợ lý huỷ lượt đang chờ (trợ lý hỏi trước).

Lịch đọc dữ liệu local. **Tạm dừng tất cả** trên Dashboard ngừng tạo job mới. Job đã **UPLOADING** không rút lại bằng nút tạm dừng.

## Đăng từ dự án {#dang-tu-du-an}

Dùng để đưa một bản render lên tài khoản. Tab **Render**, mục **Đăng**.

1. Render xong một bản đúng tỉ lệ.
2. Chọn tài khoản, giờ nếu muốn hẹn, và các ô nền tảng đang hiện (playlist YouTube nếu có).
3. Bấm **Đăng**.

Nút tắt khi chưa có file hoặc chưa có tài khoản. Trợ lý cũng có thể tạo lượt đăng, nhưng luôn cần bạn xác nhận. App luôn gửi chế độ hiển thị bạn chọn. Nếu YouTube trả về chế độ khác, app hiện cảnh báo để bạn kiểm tra trong YouTube Studio.

Tiêu đề và mô tả lấy từ [Thông tin đăng tải](render-va-thumbnail.md#thong-tin-dang). Sửa chúng trước khi bấm **Đăng**.

Nếu lượt tải lên bị gián đoạn và app báo **Chưa rõ bài đã đăng hay chưa**, hãy kiểm tra trên nền tảng trước khi bấm **Thử lại**. Sau khi server khởi động lại, app dùng kết quả đã lưu cho bài đã đăng thành công. Lượt chưa bắt đầu tải có thể tiếp tục từ hàng đợi.

## Nguồn và tính nguyên bản {#nguon-va-tinh-nguyen-ban}

Dùng để xem video được ghép từ đâu và phần app tự làm. Tab **Render**, trong mục **Đăng**, thẻ **Nguồn & tính nguyên bản**.

1. Khi đã có timeline, app lập bản kê: nguồn nghiên cứu, số từ lời dẫn, giọng đọc, từng ảnh hoặc footage kèm giấy phép và link.
2. App so kịch bản, tiêu đề và ảnh với các video đã render của cùng hồ sơ.
3. Nếu kịch bản quá giống, ảnh dùng lại nhiều, phần tự làm thấp, hoặc thiếu lời dẫn, nguồn nghiên cứu hay giấy phép, thẻ hiện **Cần bạn kiểm tra**. Lượt đăng công khai tự chuyển sang riêng tư. Sửa nội dung rồi bấm **Kiểm tra lại tính nguyên bản**, hoặc ghi lý do và bấm **Đã tự duyệt, bỏ qua kèm lý do**.
4. Checklist YouTube, TikTok, Facebook và Instagram chỉ là lời nhắc, mỗi dòng có link chính sách. App giữ lý do bỏ qua trong lịch sử của bản kê.

Ngưỡng độ giống kịch bản, số ảnh dùng lại, phần tự làm và số video đem so là ngưỡng an toàn của app. Sửa theo hồ sơ ở menu **Định hướng nội dung**. Dashboard mục **Cần bạn xử lý** hiện yêu cầu khi còn cảnh báo mở. Trợ lý đọc báo cáo bằng công cụ `get_originality_report`.

Nếu lần lập bản kê bị lỗi, timeline và render vẫn chạy xong; app chỉ ghi một cảnh báo. Nút **Kiểm tra lại tính nguyên bản** và cổng trước khi đăng vẫn báo lỗi khi lần kiểm tra đó không chạy được. Đồ họa toàn màn hình của timeline là lớp trong suốt, nên thời gian ảnh bên dưới vẫn tính vào giấy phép.
