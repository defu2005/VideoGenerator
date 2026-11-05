# Đăng bài {#dang-bai}

Kết nối tài khoản một lần, rồi mỗi video bấm **Đăng** hoặc để lịch đưa vào slot.

## Tài khoản {#tai-khoan}

Dùng để YouTube, TikTok, Facebook Reels và Instagram Reels nhận video của đúng hồ sơ. Menu: **Hồ sơ** → tab **Tài khoản**.

1. Nếu chưa có dòng nào, bấm để mở **Thêm tài khoản**, chọn nền tảng, bấm **Thêm tài khoản**.
2. Dán thông tin ứng dụng của bạn (Client ID và Client Secret, hoặc App ID và App Secret). Bấm **Lưu thông tin ứng dụng**. Redirect URI lấy đúng ô trên trang.
3. Bấm **Kết nối**. Trạng thái **Đã kết nối** là xong. **Sửa** đổi tên hiển thị. **Hủy sửa** bỏ dở.
4. Khi thấy **Sắp hết hạn**, **Hết hạn** hoặc **Cần kết nối lại**, bấm **Kết nối lại**.

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

Nút tắt khi chưa có file hoặc chưa có tài khoản. Trợ lý cũng có thể tạo lượt đăng, nhưng luôn cần bạn xác nhận. Ứng dụng không đổi video đã công khai thành riêng tư hộ bạn. YouTube có thể để video API ở chế độ riêng tư nếu dự án Google chưa được xác minh: đó là cảnh báo, bạn xử lý trên YouTube.

Tiêu đề và mô tả lấy từ [Thông tin đăng tải](render-va-thumbnail.md#thong-tin-dang). Sửa chúng trước khi bấm **Đăng**.
