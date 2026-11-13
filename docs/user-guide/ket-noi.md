# Kết nối {#ket-noi}

Nhập mọi khoá, nhà cung cấp AI và tài khoản nền tảng ngay trong app. Không cần sửa file `.env`.

## Trang Kết nối {#trang-ket-noi}

Dùng để xem một chỗ cái gì đã sẵn sàng, cái gì còn thiếu. Menu: **Cài đặt** → **Kết nối**.

1. Mục **Tổng quan** liệt kê AI, kho ảnh, tìm ảnh web và nền tảng, kèm trạng thái **Sẵn sàng**, **Thiếu key** hoặc **Lỗi**. Bấm vào dòng để nhảy tới chỗ sửa.
2. Mỗi ô khoá cho biết nguồn: **Đã lưu trong app**, **Từ file .env** hoặc **Chưa có key**. Khoá lưu trong app được ưu tiên hơn `.env`.
3. Ô nhập khoá chỉ ghi, không hiện lại khoá cũ. App chỉ cho xem 4 ký tự cuối.
4. **Kiểm tra** gọi thử nhà cung cấp và báo kết quả. **Xoá** chỉ xoá khoá đã lưu trong app; khoá trong `.env` vẫn còn.

Nếu thấy **Không đọc được**, khoá đã lưu không giải mã được (thường vì mất file `data/secrets/token.key`). Hãy nhập lại khoá.

## Nhà cung cấp AI {#nha-cung-cap-ai}

Dùng để bật, tắt và nhập khoá cho từng nhà cung cấp mô hình.

1. Trong mục **AI**, mỗi nhà cung cấp có công tắc **Bật**, ô khoá, ô địa chỉ (base URL) và model.
2. Với OpenRouter, bấm **Đăng nhập OpenRouter**. Sau khi bạn cho phép, app tự lưu khoá và quay lại trang này.
3. **Thêm nhà cung cấp** cho phép nhập một dịch vụ tương thích OpenAI: tên, base URL, model, khoá. Bật **Model đọc được ảnh** nếu model hỗ trợ ảnh.
4. Bấm **Lưu**, rồi **Kiểm tra**.

## Khoá ảnh và tìm kiếm {#khoa-anh}

Khoá Pexels, Pixabay, Unsplash và Brave nhập trong mục **Kho ảnh** và **Tìm ảnh web**, hoặc ngay trên trang **Nguồn ảnh** và **Nguồn ảnh web**.

## Nhập từ .env {#nhap-tu-env}

Nếu bạn đã có file `.env` cũ, thẻ **Nhập từ .env** chép các khoá còn thiếu vào app. App chỉ báo tên khoá, không hiện giá trị, và không ghi đè khoá đã lưu.

## Tài khoản nền tảng {#tai-khoan-nen-tang}

Dùng để quản lý mọi kênh của mọi hồ sơ ở một chỗ. Menu: **Tài khoản**.

1. Lọc theo nền tảng, hồ sơ hoặc trạng thái. Khi có tài khoản hết hạn hoặc lỗi, thanh cảnh báo hiện **Chỉ xem các tài khoản này**.
2. **Kiểm tra tất cả** kiểm các tài khoản đã kết nối, hết hạn hoặc lỗi. Kết quả đếm riêng số hoạt động, cần kết nối lại và chưa kết nối. Khi mọi tài khoản đều chưa kết nối, nút tắt và trang giải thích chưa có gì để kiểm tra.
3. **Chuyển hồ sơ** đưa tài khoản sang hồ sơ khác. Lịch đăng đã tạo vẫn giữ tài khoản đó.
4. Dùng **Kết nối** hoặc **Kết nối lại** ngay trên dòng tài khoản. **Xoá** hỏi lại trước khi gỡ tài khoản và dừng các bài đăng đã lên lịch cho tài khoản đó.

## Thêm tài khoản {#them-tai-khoan}

1. Bấm **Thêm tài khoản**, chọn nền tảng và hồ sơ, bấm **Tiếp**.
2. Nếu app đã có ứng dụng nhà phát triển, bấm **Dùng ứng dụng hiện có**. Nếu chưa, làm theo hướng dẫn trên màn hình: bấm **Chép** để lấy Redirect URI, dán vào trang quản lý ứng dụng của nền tảng, rồi nhập Client ID và Client Secret. Chọn **Mọi hồ sơ** hoặc **Chỉ hồ sơ này**, bấm **Lưu và tiếp**.
3. Bấm **Đăng nhập**. Với YouTube và TikTok, tab mới báo kết quả và cho phép đóng để quay lại app. Với Meta, tiếp tục chọn Page hoặc tài khoản Instagram. Nếu không thành công, app hiển thị lý do và bước xử lý.
4. Ở bước **Xong**, bạn có thể đổi tên gợi nhớ. App cảnh báo nếu kênh đã có trong hồ sơ khác. Huỷ trước bước này sẽ dọn tài khoản chưa kết nối hoặc đang lỗi do chính wizard vừa tạo.

### Thiết lập YouTube

1. Tạo hoặc chọn dự án Google Cloud. Bật **YouTube Data API v3** trong **APIs & Services → Library**.
2. Trong màn hình đồng ý OAuth, chọn **External**, điền tên app và email liên hệ, rồi thêm email đăng nhập của từng kênh vào **Test users**.
3. Tạo **OAuth client ID** loại **Web application** trong **Credentials**. Chép Redirect URI mà app hiển thị vào **Authorized redirect URIs**.
4. Dán Client ID có đuôi `.apps.googleusercontent.com` và Client Secret vào app. Secret mới thường bắt đầu bằng `GOCSPX-`. Bạn có thể bấm **Kiểm tra ứng dụng** trước khi đăng nhập.

Ở chế độ **Testing**, refresh token YouTube hết hạn sau 7 ngày. Chọn **Publish app** để đưa ứng dụng ra khỏi Testing và thực hiện xác minh nếu Google yêu cầu. Quota dùng chung cho các kênh dùng cùng dự án Google Cloud. Chọn **Chỉ hồ sơ này** nếu muốn dùng dự án Google Cloud riêng cho một hồ sơ.

| Trang Google báo | Cách xử lý |
|---|---|
| 401 `invalid_client` | Bấm **Nhập lại** và chép đúng ID và Secret của OAuth client. |
| 400 `redirect_uri_mismatch` | Chép nguyên Redirect URI của app vào **Authorized redirect URIs**. |
| 403 `access_denied` | Nếu app ở Testing, kiểm tra **Test users**, sau đó đăng nhập lại và chọn **Cho phép**. |

## Thiết lập ban đầu {#thiet-lap-ban-dau}

Trên **Bảng điều khiển**, thẻ **Thiết lập ban đầu** hiện khi còn thiếu một trong bốn việc: nhà cung cấp AI, giọng đọc, nguồn ảnh, tài khoản nền tảng. Mỗi dòng dẫn tới chỗ cần làm. Thẻ tự ẩn khi xong cả bốn, hoặc khi bạn bấm **Ẩn**.

## An toàn {#an-toan-khoa}

Khoá được mã hoá bằng `data/secrets/token.key`. Hãy sao lưu file này cùng thư mục `data`; mất file thì phải nhập lại mọi khoá. Trợ lý và MCP không đọc, lưu hay xoá khoá, và không tự mở đăng nhập nền tảng.

<a id="embedding-tri-thuc"></a>
## Embedding tri thức

Trong Kết nối → AI → **Embedding**, chọn nhà cung cấp và model, bấm **Lưu embedding**, rồi **Kiểm tra** để thử một câu cố định. Nhà cung cấp tùy chỉnh chỉ xuất hiện sau khi bật **Hỗ trợ embedding**. Chọn model có chức năng embedding trên OmniRoute, không chọn model chat. Đổi model sẽ lập lại chỉ mục trong nền.

Không có nhà cung cấp embedding, hết quota hoặc lỗi mạng thì app vẫn tìm theo từ khoá. Kiểm tra và lập chỉ mục có thể tính token, xem tác vụ retrievalEmbed trong Chi phí. App không yêu cầu nhập thêm key ở hàng này.
