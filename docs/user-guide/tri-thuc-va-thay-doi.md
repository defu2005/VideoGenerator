# Tri thức và thay đổi bên ngoài

## Tri thức trong Cài đặt {#tri-thuc-ben-ngoai}

Mở **Cài đặt → Tri thức** để xem dữ kiện đang áp dụng. Chọn nhóm như Guideline, API hoặc Năng lực nền tảng. Mỗi mục hiện nguồn, ngày kiểm và mốc cần đọc lại. Nhãn **Mới**, **Cần kiểm tra** và **Cũ** cho biết tuổi của bằng chứng.

Mục **Nhập JSON** nhận một mảng từ tệp research hoặc ô dán nội dung. Đặt nhãn nguồn để nhận ra lần nhập. App báo từng dòng sai, làm mới ngày kiểm nếu dữ kiện giống hệt và đưa thay đổi cần xem vào **Chờ duyệt**.

Trong **Chờ duyệt**, xem từng trường thay đổi, nguồn, câu trích, mức rủi ro và nơi dùng. Chọn **Duyệt** hoặc **Bỏ qua** trong giao diện cục bộ. Dữ kiện rủi ro cao luôn cần bạn duyệt. Bản sửa thấp có thể tự áp dụng nếu có độ tin cậy cao và mọi câu trích chính thức khớp nội dung trang nguồn app đã kiểm. Thay đổi mức vừa mặc định cần duyệt.

Bấm ID để xem lịch sử của một mục. Tab **Lịch sử** cũng liệt kê các mục từng có phiên bản, kể cả khi đã ngừng áp dụng. Chọn **Khôi phục** để tạo một phiên bản mới từ bản đã chọn. Với guideline, bộ riêng của bạn có ưu tiên cao hơn bộ chung có cùng ID.

Khi YouTube trả về chế độ hiển thị khác yêu cầu, kiểm tra video trong YouTube Studio. App đếm quota tải lên riêng khỏi quota chung, nên đầy một loại hạn mức không đồng nghĩa các thao tác khác đều bị hết quota.

## Thay đổi bên ngoài {#thay-doi}

Tab **Thay đổi** trên cùng trang liệt kê sự kiện theo trạng thái và mức. Mỗi dòng có tóm tắt, detector và nút **Tiếp tục** để nhấc lần giữ của riêng sự kiện đó. **Đóng** đánh dấu đã xử lý.

Sự kiện mức cao hoặc nghiêm trọng còn mở cũng hiện ở **Bảng điều khiển → Cần bạn xử lý**. Một lần giữ chỉ chặn nơi dùng dữ kiện đó: YouTube bị giữ thì đăng TikTok vẫn chạy.

App không hạ một sự kiện tài khoản mức nghiêm trọng xuống dưới mức giữ. Bạn vẫn bấm **Tiếp tục** khi đã xử lý xong. Ngân sách đọc trang mặc định 20 lượt mỗi ngày. Chế độ ECO chỉ lưu hash, không gọi mô hình.

## Kiểm tra tài khoản và video {#tai-khoan-video}

Mở **Cài đặt → Tri thức → Tài khoản và video**. Checklist hiện tài khoản đã kết nối, độ phủ **API**, **Một phần** hoặc **Kiểm tra thủ công**, và đường dẫn màn hình trong nền tảng để bạn đối chiếu. Hướng dẫn này lấy từ tri thức đang áp dụng; app không tự đọc trang đã đăng nhập.

Hằng tuần, mở từng mục đến hạn, chọn **Không có gì** hoặc **Có vấn đề** rồi bấm **Ghi lần kiểm tra**. Khi có vấn đề, ghi tên chính sách/thông báo, điều bạn thấy và ID video nếu có. App lưu thời điểm, tài khoản và video vào báo cáo thủ công. Strike đã xác nhận chỉ giữ đăng ở tài khoản đó.

Không thấy video, lỗi kết nối, danh sách trống hay doanh thu bằng 0 đều là **Chưa rõ**, không chứng minh strike, bị gỡ hay mất kiếm tiền. App dùng polling khi chưa có webhook HTTPS công khai; tín hiệu chỉ xuất hiện qua webhook cần bạn đối chiếu thủ công. Nhiều mục kiếm tiền, quảng cáo và bản quyền vốn không có API công khai.

Trong lượt kiểm tra trạng thái, nếu nền tảng từ chối refresh token, app có thể giữ đăng ở tài khoản có kết nối lỗi để bạn kết nối lại; việc này không có nghĩa kênh bị phạt và không giữ các tài khoản khác.

Nếu có URL HTTPS công khai, điền **URL webhook** kết thúc bằng `/api/knowledge/webhooks/tiktok`, bấm **Lưu URL webhook** và nhập cùng URL trong TikTok Developer Portal. Chỉ công khai đúng endpoint webhook; giữ giao diện và các API còn lại ở máy cục bộ. App dùng thông tin ứng dụng TikTok đã lưu để kiểm chữ ký, thời gian gửi và sự kiện trùng. Chỉ lưu URL trong app chưa xác nhận TikTok đã đăng ký thành công; polling vẫn chạy. Không dán secret vào URL.

Trong **Số liệu eligibility**, ghi số người theo dõi, tuổi và số liệu đúng cửa sổ ngày trong dashboard. Chỉ đánh dấu lượt/giờ xem hợp lệ nếu nền tảng xác nhận loại số liệu đó; tổng lượt xem không thay được lượt đủ điều kiện. Khi có mục tri thức chương trình kiếm tiền đang áp dụng và các ngưỡng số liệu đều đạt, app tạo lời nhắc kiểm tra. Đạt số liệu vẫn cần nền tảng xét duyệt. Số liệu thủ công cần được kiểm lại sau 7 ngày.

Trong **Lịch kiểm tra**, bật chế độ offline để tạm dừng detector; ECO chỉ so hash nguồn, không gọi AI. App kiểm tra nguồn theo độ biến động, rà tri thức cũ/phụ thuộc hằng tuần và dọn hit quá 7 ngày. Các lịch này chạy khi worker của app hoạt động.

Lệch chỉ số được so theo kênh/nền tảng và thể loại. Detector cần đủ ngày và đủ mẫu, bỏ qua dữ liệu thiếu và không nối chuỗi qua thay đổi định nghĩa metric. Khi lệch được xác nhận, tab **Thay đổi** mở việc điều tra: so kênh khác, nền tảng khác, mùa vụ, phiên bản tri thức và lỗi đồng bộ. Đây là giả thuyết để kiểm tra, không tự đổi hướng kênh hay tự sửa chính sách.

Mục **Số liệu gần nhất** hiện giá trị, ngày, số mẫu và nguồn đồng bộ/nhập tay. **Ghi số liệu ngày từ dashboard** bổ sung chỉ số connector chưa lấy được: lượt xem mỗi video tại 48 giờ, CTR, phần trăm xem trung bình, impressions theo nguồn traffic và RPM. Chọn ngày đã kết thúc, ghi link nguồn; CTR dùng tỉ lệ 0–1 và RPM dùng USD/1.000 lượt xem. Không đổi phạm vi hay định nghĩa giữa các ngày. Dòng nhập tay được giữ khi app đồng bộ lại.

Mặc định cần 14 ngày làm mốc, rồi ít nhất 3 ngày lệch liên tiếp và 3 mẫu mỗi ngày. Thiếu dữ liệu hoặc đổi định nghĩa thì làm mốc lại. Lượt xem tại 48 giờ chỉ nhận snapshot trong khoảng 48–50 giờ; bỏ lỡ thì để thiếu. RPM tự tính cần doanh thu và lượt xem cùng toàn kênh/ngày, không ghép doanh thu một phần video với lượt xem toàn kênh. Nhập từ dashboard là phương án cho CTR/impressions mà connector hiện chưa có; app không tự đọc trang đăng nhập.

Nếu tri thức ngành có khoảng tham khảo định lượng cùng chỉ số, phạm vi và định nghĩa, số đo đủ mẫu nằm ngoài khoảng sẽ thành **đề xuất G1**. Bạn xem bằng chứng và duyệt; app giữ nguyên khoảng tham khảo cho đến khi được chấp nhận. Sự kiện cao/nghiêm trọng được chuyển qua hệ thống thông báo đã cấu hình, theo giờ yên lặng và giới hạn gửi hiện có.
