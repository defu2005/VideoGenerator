# Render và thumbnail {#render-trang}

Render ghép timeline thành một file MP4 trên máy bạn.

## Render {#render}

Dùng để xuất video. Tab **Render**.

1. Timeline phải có. Nếu chưa, làm tab **Timeline** và **Approve All**.
2. Chọn **Định dạng**: **Ngang 16:9** hoặc **Dọc 9:16**. Dòng **(mặc định)** là tỉ lệ của brief.
3. Bấm **Render**. Lần sau nút là **Render lại**. Trước đó trang có dòng **Ước tính: ~N–M phút cho phần dựng cảnh**. Đây là khoảng ±40%, không gồm giọng đọc, nhạc, phụ đề và lần ghép cuối, và không phải lời hứa.
4. Xem thanh tiến độ. Xong thì phát file trên trang.

Nút tắt khi đang render hoặc thiếu timeline. **Cancel** trên pipeline dừng job. Lỗi thường gặp nằm ở [Render thất bại](xu-ly-su-co.md#loi-render). Render không đăng lên mạng.

`RENDER_CONCURRENCY` (mặc định 1, tối đa 4) là số video được xuất cùng lúc. Các bước nhẹ của dự án khác vẫn chạy bên cạnh. Health hiện `render: x/y đang chạy`.

## Kiểu dựng nhiều cảnh quay {#kieu-dung}

Dùng khi muốn một cảnh có nhiều đoạn: ảnh tĩnh, footage, chữ động, biểu đồ, bản đồ, so sánh, câu trích hoặc danh sách. Đây là cách dựng mặc định.

1. Mở form **Kiểu dựng** của dự án hoặc hồ sơ.
2. Để trống hoặc chọn **Nhiều cảnh quay (thử nghiệm)** thì render dựng nhiều cảnh quay. Chọn **Cổ điển (ảnh tĩnh)** để giữ cách cũ. Dự án tạo trước đó mà chưa chọn kiểu cũng dựng nhiều cảnh quay.
3. **Đạo diễn**: **ECO** dùng luật sẵn và không gọi AI. Chế độ chất lượng gọi AI một lần cho cả video. Lượt gọi được tính cùng mục kế hoạch dựng.
4. Ngân sách chọn đồ hoạ của cảnh. **ECO** tắt mọi kiểu đồ hoạ, gồm chữ, biểu đồ, bản đồ, so sánh, câu trích và danh sách (đoạn đó thành footage hoặc ảnh, lý do có `+mode-off`). **BALANCED** lấy một khung đã xong rồi thêm mờ 0,2 giây và zoom chậm. **QUALITY** chạy chuyển động. **MAX** chạy chuyển động và thêm hạt nhiễu. **CUSTOM** chọn tắt, một khung hoặc chuyển động, và bật hạt. Một khung nhanh hơn nhiều; chuyển động chậm hơn.
5. Render xong, tab **Render** hiện số cảnh mỗi phút, phần ảnh tĩnh và phần cắt đúng nhịp. Bấm từng cảnh để xem kiểu, thời gian và lý do.
6. Trên cùng mục, mỗi đoạn có **Đổi kiểu** (kiểu khác còn hợp độ dài), **Đổi footage** (clip xếp sau) và **Khoá**. Đoạn khoá giữ nguyên khi dựng lại. Đoạn không khoá được làm lại.
7. Bản đồ hiện khi lời thoại nêu một nước hoặc một tỉnh và dạng video là giải thích hoặc điểm tin. So sánh hiện khi lời thoại đặt hai vế cạnh nhau, hoặc dạng video là sự thật và hiểu lầm. Câu trích hiện khi có câu trong ngoặc kép và tên người nói. Danh sách hiện khi dạng video là danh sách hoặc hướng dẫn và có từ 3 đến 6 mục ngắn. Danh sách dùng màu thương hiệu của dự án nếu bạn đã chọn, cùng kiểu của dạng video. Cùng một video thì cách xếp không đổi.
8. Footage ghi tác giả, giấy phép và trang nguồn vào file credits. Đoạn nào dựng lỗi thì cảnh đó quay về ảnh tĩnh, video vẫn xong.

## Định dạng {#dinh-dang}

Dùng để một video có cả bản ngang và bản dọc cho từng loại tài khoản.

1. Gắn dự án với hồ sơ đã có tài khoản.
2. Trên tab **Render**, bấm **Render cho mọi tài khoản của hồ sơ**.
3. Đợi dòng **Đang render các định dạng…** kết thúc. Mỗi tỉ lệ là một bản trong lịch sử.

Tài khoản Shorts, TikTok, Reels cần bản dọc. YouTube dài thường dùng ngang. Nút này không đăng. Bản dọc quá dài sẽ báo **Bản dọc quá dài**.

## Lịch sử render {#lich-su-render}

Dùng để giữ vài bản và tải file. Cùng tab **Render**.

1. Chọn một bản trong danh sách.
2. Ghim bản muốn giữ.
3. Tải file từ nút xuất của bản đó. **Xoá** hỏi lại trước khi xóa file của bản đó.

Menu **Render** (cài đặt) có **Số bản giữ lại (1–50)**. Mặc định trên form là 5. Bấm **Lưu**. Bản đã ghim không bị xoá khi đủ số. Bản không ghim cũ hơn sẽ nhường chỗ.

## Cài đặt render {#cai-dat-render}

Dùng để chỉnh số bản giữ trên đĩa. Menu: **Render**.

1. Nhập **Số bản giữ lại (1–50)**.
2. Bấm **Lưu**. Trang báo **Đã lưu.**
3. Ở khối **Đồ họa động**, bấm **Cài trình render đồ họa** nếu Chrome chưa có, rồi **Render thử** để đo một thẻ tiêu đề 3 giây.

Giảm số không xoá ngay bản ghim. Không ảnh hưởng video đã đăng.

## Thông tin đăng tải {#thong-tin-dang}

Dùng cho tiêu đề, mô tả, tag trước khi bấm **Đăng**. Khối **Thông tin đăng tải** trên tab **Render**.

1. Đợi AI viết nháp nếu chế độ từ **BALANCED** trở lên có metadata.
2. Sửa tiêu đề, mô tả, **Tags**, **Hashtags**, **Gợi ý chữ thumbnail**.
3. Lưu các ô trên form.

**ECO** có thể bỏ bước AI này và để bạn tự viết. Sửa chữ không render lại video. **Đăng** dùng bản chữ đang lưu.

## Thumbnail {#thumbnail}

Dùng làm ảnh bìa. Khối **Thumbnail** trên tab **Render**.

1. Chọn một khung hình.
2. **Tạo lại** ghép lại chữ với khung đang chọn. **Tạo lại tự động** xin khung mới.
3. **Tải ảnh lên** nếu bạn có sẵn ảnh (PNG hoặc JPEG).

**MAX** có thể để AI chọn khung (**Chọn thumbnail bằng AI nhìn**). Bạn vẫn đổi tay được. Ảnh bìa không tự lên YouTube cho đến khi bạn **Đăng** và nền tảng nhận thumbnail.
