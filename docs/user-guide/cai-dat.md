# Cài đặt {#cai-dat}

Bạn tự chạy ứng dụng trên máy mình và tự nhập mọi khoá. Ô nhập chỉ nhận giá trị bạn dán. Hướng dẫn này dùng chỗ trống `<token của bạn>`, không có giá trị thật.

## Khởi động {#khoi-dong}

Dùng để mở giao diện và API trên máy bạn.

1. Mở terminal tại thư mục mã nguồn.
2. Chạy `npm run dev`.
3. Mở trình duyệt tại địa chỉ web mà terminal in ra (cổng web thường là 5180, API thường là 3001).

Không có nút cài đặt nào cho bước này. Máy cần FFmpeg đã đi kèm ứng dụng. Không cần tài khoản đám mây chỉ để xem Dashboard.

Giới hạn: đây là công cụ local. Tắt terminal là ứng dụng dừng. Đừng chạy lệnh này trên máy người khác.

## Docker {#docker}

Dùng khi bạn muốn chạy app trên một máy Linux hoặc VPS, không mở terminal `npm run dev`.

1. Cài Docker Engine và Compose v2 theo hướng dẫn của Docker. Script không tự cài.
2. Trong thư mục mã nguồn, chạy `bash deploy/install.sh`.
3. Chọn control. Nhập tên miền, hoặc Enter nếu chỉ dùng trong mạng nội bộ.
4. Mở địa chỉ script in ra.

Dữ liệu nằm trong `/opt/vg/data` (đổi thư mục bằng biến `VG_HOME`). Chạy lại script không ghi đè file `.env` và thư mục dữ liệu đã có.

Giới hạn: image không chứa đăng nhập Claude CLI, agy, cursor-agent hay OmniRoute. Cách gắn các thứ đó ghi trong file `deploy/README.md` của repo. `bash deploy/install.sh worker` hiện thoát ngay và chưa làm việc. Đăng nhập người dùng chưa có, nên đừng mở cổng ra Internet.

## Mô hình AI {#cai-dat-mo-hinh}

Dùng để các bước viết, chọn ảnh và trợ lý có model. Menu: **Mô hình AI**.

1. Cài OmniRoute trên máy bạn và trỏ ứng dụng tới địa chỉ cổng đó. Chi tiết ở [OmniRoute](mo-hinh-ai.md#omniroute).
2. Tab **Định tuyến**: chọn nhà cung cấp và model cho từng tác vụ, rồi lưu.
3. Tab **Quota**: để **Chờ reset** nếu bạn không muốn chi tiền. Xem [Quota](mo-hinh-ai.md#quota).

Mặc định chính sách quota là **Chờ reset**. Trần chi phí trả phí mỗi ngày là 1 USD, chỉ dùng khi bạn đổi sang **Dùng model trả phí**.

Bạn phải tự dán token. Ứng dụng không xin khoá hộ và không hiện full token sau khi lưu.

## Telegram {#cai-dat-telegram}

Dùng để nhận báo và nói chuyện với trợ lý trên điện thoại. Menu: **Thông báo**.

1. Tạo bot bằng BotFather trên Telegram của bạn. Sao chép token.
2. Dán vào ô token (`<token của bạn>`), lưu.
3. Bấm **Ghép nối**, gửi lệnh hiện ra cho bot trong chat riêng (mã hết hạn sau 10 phút).
4. Bấm **Gửi thử**.

Mặc định Telegram **tắt**, giờ tóm tắt ngày là 21:00, giờ im lặng để trống. Xem [Kết nối Telegram](tro-ly-va-telegram.md#telegram).

Ghép nối không tự gửi tin cho người lạ. Chỉ chat bạn vừa ghép mới nhận thông báo.

## Nền tảng (OAuth) {#cai-dat-oauth}

Dùng để đăng video và đọc thống kê. Menu: **Hồ sơ** → tab **Tài khoản**.

1. Tạo ứng dụng trên Google, TikTok hoặc Meta bằng tài khoản của bạn.
2. Bấm **Thêm tài khoản**, chọn nền tảng, bấm **Thêm tài khoản**.
3. Dán Client ID / Client Secret (hoặc App ID / App Secret) vào **Thông tin ứng dụng**, bấm **Lưu thông tin ứng dụng**. Redirect URI lấy đúng dòng ứng dụng đang hiện.
4. Bấm **Kết nối** và đồng ý trên trang của nền tảng.

Mặc định chưa có tài khoản nào. YouTube ở chế độ Testing hết hạn refresh khoảng 7 ngày: bấm **Kết nối lại**. Meta báo **Cần kết nối lại** trước khoảng 7 ngày khi token dài hạn sắp hết (khoảng 60 ngày).

Ứng dụng không tạo giúp bạn ứng dụng Google hay Meta. Không đăng video chỉ vì đã kết nối. Xem [Tài khoản](dang-bai.md#tai-khoan).
