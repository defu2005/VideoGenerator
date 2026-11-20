# Phân tích và tài chính {#phan-tich}

Số liệu chỉ có sau khi tài khoản đã cấp quyền thống kê và video đã đăng.

## Thống kê {#thong-ke}

Dùng để xem lượt xem và tương tác. Menu: **Phân tích**.

1. Chọn khoảng thời gian và hồ sơ hoặc nền tảng.
2. Mở một video để xem chuỗi theo ngày.
3. Nếu ô trống, về tab **Tài khoản** và bấm **Kết nối lại để bật thống kê**.

Ứng dụng không tự sinh lượt xem. Đồng bộ đọc API nền tảng. Kênh chưa vào chương trình kiếm tiền sẽ không có doanh thu YouTube dù đã bật quyền tiền.

## Doanh thu {#doanh-thu}

Dùng để đối chiếu tiền vào với chi phí AI. Menu: **Tài chính**.

1. Nhập một khoản thu hoặc chi, bấm nút lưu của form đó.
2. Dán CSV nếu bạn có bảng xuất, rồi bấm nút nhập CSV.
3. Đặt tỷ giá và ngưỡng nhắc, bấm **Lưu tỷ giá** hoặc **Lưu ngưỡng**.
4. Chọn tháng, bấm **Tạo lại** nếu muốn viết lại báo cáo. **Tải CSV** để mang đi.

Chi phí AI là ước tính từ token, không phải hoá đơn. Doanh thu tự động chỉ tới khi bạn bật quyền tiền và nền tảng trả số. Nhập tay là của bạn, trợ lý thêm khoản thì phải hỏi. Báo cáo tháng có thể kèm nhận xét AI từ **BALANCED** trở lên.

## Bài học {#bai-hoc}

Dùng để AI đề xuất hướng nội dung và giờ đăng từ số liệu thật. Menu: **Hồ sơ** → tab **Bài học**.

1. Cần vài video đã có điểm. Dòng **Đã có … video đủ điểm** cho biết đủ chưa.
2. Bấm **Phân tích ngay**. Tối đa khoảng một lần mỗi giờ.
3. Đọc đề xuất. Áp những mục bạn muốn. **Hoàn tác** nếu vừa áp nhầm.
4. **Thử 2 tiêu đề** chỉ hiện khi tài khoản YouTube có đủ quyền.

**ECO** vẫn phân tích nhưng thưa hơn, khoảng hai tuần một lần. Áp bài học đổi định hướng hoặc giờ đăng của hồ sơ. Không áp thì không có gì đổi. Chưa có số liệu thì trang nói **Chưa có bài học.**

## Bài học theo bước {#bai-hoc-theo-buoc}

Bài học theo bước là ghi chú ngắn cho từng bước pipeline (nghiên cứu, kịch bản, phân cảnh, duyệt hình, duyệt nhạc, duyệt cuối). Chúng được rút ra từ phản hồi của bạn: sửa kịch bản, sửa lời dẫn, duyệt có chỉnh sửa. Menu: **Hồ sơ** → tab **Bài học**, mục **Bài học theo bước**.

1. Mỗi tuần, khi một bước có đủ ít nhất 5 phản hồi mới, hệ thống đề xuất tối đa 5 ghi chú cho bước đó. Ghi chú mới luôn ở trạng thái **Chờ duyệt**.
2. Đọc từng ghi chú và số mục phản hồi làm căn cứ. Bấm **Duyệt** để dùng, **Từ chối** để bỏ, hoặc **Hoàn tác** nếu bấm nhầm.
3. Ghi chú đã duyệt được đưa vào prompt của bước tương ứng (nghiên cứu và kịch bản hiện đã dùng). Bấm **Gỡ** để ngừng dùng một ghi chú đã duyệt; lịch sử vẫn được giữ.
4. Agent và trợ lý không bao giờ tự duyệt. Chúng chỉ đề xuất hoặc từ chối.

Ghi chú chung của mọi hồ sơ hiện ra với nhãn **chung**. Tự động đề xuất theo tuần đang tắt mặc định; chỉ bật khi bạn đã chấp nhận cách làm này.

## Mẫu truy vấn ảnh {#mau-truy-van-anh}

Mỗi khi công cụ kiểm ảnh cho kết quả đạt hoặc không đạt, hệ thống ghi nhận truy vấn đã tìm ra ảnh đó theo nhóm chủ đề (từ tên chủ đề, không lưu nội dung dài). Lần sau, công cụ tra cache ảnh trả các truy vấn có nhiều kết quả đạt hơn không đạt cho chủ đề tương tự, kèm theo gợi ý. Ngữ cảnh của agent tìm ảnh cũng có các gợi ý này khi có kết quả cùng chủ đề trong cùng workspace. Gợi ý chỉ khớp khi tên chủ đề giống nhau sau khi bỏ khoảng trắng thừa và đổi chữ hoa thành thường. Gợi ý chỉ là gợi ý: agent vẫn tự quyết truy vấn cuối. Mẫu truy vấn không tự thay đổi ảnh đã chọn và không gửi dữ liệu ra ngoài.

## Phong cách viết đã duyệt {#phong-cach-viet}

Bước **Kịch bản** có thể đọc một đoạn phong cách viết do bạn đã duyệt. Đoạn này chỉ được đưa vào prompt sau khi bạn chọn duyệt; agent và các thử nghiệm không tự kích hoạt. Phong cách đã duyệt áp dụng chung cho mọi hồ sơ, theo bước Kịch bản (không theo từng hồ sơ). Hiện chưa có giao diện để chạy thử nghiệm, và lệnh `bench:script` chưa nối bộ chạy thử này (đang chờ bước nối judge thật). Kết quả thử, khi có, chỉ là bằng chứng để bạn quyết định: hệ thống chỉ khuyến nghị khi có ít nhất 10 lần thử và tỷ lệ thắng từ 60% trở lên.

## Chất lượng theo bước {#chat-luong-theo-buoc}

Mục **Chất lượng theo bước** trên trang **Phân tích** cho biết điểm chất lượng trung bình của mỗi bước trong 14 ngày gần đây, so với 14 ngày trước đó. Hiện chỉ bước **Kịch bản** có điểm chất lượng (điểm giám khảo trên 100). Các bước khác chỉ hiện số lần chạy.

Khi điểm của một bước giảm quá 20% và bước đó có ít nhất 5 lần chạy trong 14 ngày, hệ thống mở một mục trong hộp thư **Cần xử lý** cho bạn. Cảnh báo không tự đổi prompt, model hay cài đặt. Mỗi bước và mỗi tuần chỉ có một cảnh báo.

