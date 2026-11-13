# Hồ sơ {#ho-so}

Hồ sơ là một kênh. Định hướng, brief, chủ đề, lịch và tài khoản không trộn với hồ sơ khác.

## Danh sách hồ sơ {#danh-sach-ho-so}

Dùng để tạo kênh mới. Menu: **Hồ sơ**.

1. Bấm **＋ Hồ sơ mới**.
2. Chọn thị trường nếu đã biết khán giả mục tiêu. Chọn ngôn ngữ trong danh sách hoặc chọn **Khác** để nhập mã ngôn ngữ, rồi nhập tên hồ sơ.
3. Bấm nút tạo. **Hủy** đóng hộp thoại.

Mặc định hồ sơ mới chưa bật lịch, chưa có tài khoản, ngôn ngữ lấy theo ô bạn chọn lúc tạo. Hồ sơ lưu trữ biến mất khỏi danh sách thường. Không ai duyệt hộ bước tạo hồ sơ.

## Định hướng {#dinh-huong}

Dùng để AI viết đúng giọng kênh. Menu: **Hồ sơ** → mở một hồ sơ → tab **Định hướng**.

1. Sửa tên, mô tả, đoạn định hướng, ngôn ngữ và màu.
2. Bấm **Lưu**.
3. Muốn giấu hồ sơ: **Lưu trữ hồ sơ**. Đưa lại: **Bỏ lưu trữ**.

Định hướng để trống thì AI chỉ dựa vào brief từng video. Đổi định hướng qua trợ lý cần bạn xác nhận. **Lưu** trên trang này áp dụng ngay, không hỏi thêm.

## Thị trường mục tiêu {#thi-truong-muc-tieu}

Trong **Hồ sơ → Định hướng**, tìm theo tên hoặc mã quốc gia rồi chọn **Thị trường**. Hộp thoại liệt kê giá trị đang dùng và đề xuất mới cho ngôn ngữ, múi giờ khán giả, giờ đăng và xu hướng. Tích những trường bạn muốn đổi rồi bấm **Áp dụng**. Những trường có ghi nhận bạn đã sửa trong 30 ngày qua mặc định bỏ tích. Bạn có thể lưu lựa chọn thị trường với tất cả ô bỏ tích. Nếu chưa có dữ kiện giờ đăng cho nền tảng của kênh, app giữ giờ đang dùng.

- **Múi giờ khán giả** dùng cho lịch đăng, số video trong ngày và ngày tham chiếu khi gợi ý chủ đề. **Múi giờ của bạn** trong Cài đặt thông báo dùng cho giờ yên lặng, bản tin và ngày hiện tại của trợ lý.
- Dự án mới nhận thị trường của hồ sơ để dùng quy tắc nội dung theo nước, đơn vị, tiền tệ và ví dụ địa phương. Khi bạn chưa chọn giọng đọc, app ưu tiên giọng phù hợp ngôn ngữ và locale của thị trường. Ý tưởng chủ đề có thể dùng các sự kiện sắp tới mà nguồn đã ghi ngày.
- Thẻ **RPM ước tính** cho biết khoảng doanh thu tham khảo trên mỗi 1.000 lượt xem và độ mới của nguồn. Doanh thu thực tế phụ thuộc kênh, chủ đề và người xem. Tình trạng nền tảng và chương trình kiếm tiền là thông tin tham khảo. Nếu dữ kiện ghi nền tảng chưa khả dụng, app hiện cảnh báo khi kết nối.

Để bổ sung một quốc gia, nhập entry `market.<CC>` có nguồn và ngày kiểm vào **Cài đặt → Tri thức**, rồi duyệt đề xuất. Trợ lý, MCP và operator có thể đọc dữ kiện bằng `get_market_pack`. [Tri thức và thay đổi bên ngoài](tri-thuc-va-thay-doi.md#tri-thuc-ben-ngoai)

## Brief mặc định {#brief-mac-dinh}

Dùng để dự án mới của hồ sơ khỏi phải chọn lại thời lượng, tỉ lệ, phong cách. Tab **Brief mặc định**.

1. Chỉnh các ô brief. Huy hiệu **Gợi ý** là giá trị ứng dụng đề xuất. Nút **↺** trả một ô về gợi ý.
2. Chọn **Chế độ AI / Budget mode**. Mặc định thường là **BALANCED**.
3. Bấm **Lưu brief**.

Dự án đã tạo không tự đổi theo brief mới. AUTO và render tự động nằm trong brief. Đừng bật auto render nếu bạn vẫn muốn xem cổng duyệt. Xem [Chế độ ngân sách](che-do-ngan-sach.md#che-do-ngan-sach).

## Phong cách {#phong-cach}

Tab **Phong cách** của hồ sơ cho biết kênh đang dùng màu, phông chữ và nhịp dựng nào, và cho bạn đổi chúng.

- **Bản hiện tại**: bảng màu, phông, nhịp, bố cục. Nút **Xem thử 3 khung** dựng ba khung mẫu (tiêu đề, chữ chuyển động, danh sách) đúng tỷ lệ khung hình của kênh. Nếu không dựng được, tab hiện bảng màu và một cảnh báo.
- **Bốn cách tạo bản mới**: **Chọn mẫu** (có sẵn), **Chọn nhanh** (màu chủ đạo, nền sáng/tối, năng lượng, bố cục), **Từ màu thương hiệu** (dán 1 đến 6 màu #RRGGBB) và **Gợi ý bằng AI** (có ô ghi chú, ví dụ "sạch, hiện đại"). Bản AI gợi ý chỉ là bản nháp: bạn xem, đọc phần AI đề xuất nhưng không dùng được, rồi mới bấm **Lưu bản nháp**. Ở chế độ ngân sách ECO, hệ thống không gọi AI mà chọn mẫu chưa kênh nào dùng và nói rõ như vậy.
- **Chỉnh chi tiết**: màu nền, màu nhấn, phông tiêu đề và nội dung, kiểu nhịp và tốc độ cắt. Màu chữ khó đọc hiện cảnh báo ngay và chặn nút **Lưu thay đổi**. Hệ thống cũng tự chỉnh nhẹ màu để chữ đủ rõ và nói đã chỉnh gì.
- **Giống kênh khác**: nếu phong cách mới quá giống một kênh khác của bạn, tab nhắc để người xem dễ phân biệt các kênh.
- **Lịch sử phiên bản**: mỗi lần lưu là một phiên bản mới. **Quay lại bản này** chỉ tạo thêm một phiên bản; bản cũ không bao giờ bị xóa.
- Mọi lần lưu đều hỏi xác nhận. Phong cách mới **chỉ áp dụng cho video render sau**, video đã render không bị dựng lại.
- Trợ lý và agent dùng được `get_style_pack`, `propose_style_pack` (chỉ ra bản nháp) và `set_style_pack` (luôn cần bạn duyệt).

## Ghi nhớ của hồ sơ {#ghi-nho-ho-so}

Mở **Hồ sơ** → **Ghi nhớ** để thêm, sửa hoặc xóa nội dung bạn muốn agent dùng khi làm việc với hồ sơ này. Ghi nhớ được lưu riêng với phần **Bài học**.

Agent có thể dùng `search_profile_context` để tìm ghi nhớ, guideline, kịch bản và kết quả liên quan. Mỗi đoạn trả về có nguồn và phiên bản. Nếu chỉ định một dự án, dự án đó phải thuộc hồ sơ đang tra cứu.

## Dự án của hồ sơ {#du-an-cua-ho-so}

Dùng để thấy video thuộc kênh này. Tab **Dự án**.

1. Mở tab **Dự án**.
2. Bấm một dòng để vào dự án.

Tab chỉ liệt kê. Tạo video mới ở **Dự án** → **＋ New project** và chọn hồ sơ. Xoá dự án làm ở trang dự án, nút **Delete**, có hộp xác nhận.

<a id="tri-thuc-cua-kenh"></a>
## Tri thức của kênh

Vào Hồ sơ → **Tri thức** để xem số đoạn theo nguồn, độ phủ embedding, lần lập chỉ mục và giới hạn 20 000 đoạn. Khi chưa có dữ liệu, tab hiện **Đang lập chỉ mục…**. **Lập lại chỉ mục** đưa công việc vào hàng đợi nền. Bật/tắt nguồn cho từng hồ sơ; nhập câu hỏi trong **Thử tìm** để xem đoạn, nguồn và điểm tìm kiếm. Tìm không dấu vẫn nhận tiếng Việt có dấu.

Bình luận mặc định tắt. Nếu bật, app chỉ lấy tối đa 10 bình luận nhiều thích, bỏ spam; không đưa tên tác giả, tài khoản hoặc mã người dùng vào chỉ mục. Tri thức chỉ dùng trong đúng hồ sơ. Cập nhật chỉ mục không tự làm cũ hoặc chạy lại video.
