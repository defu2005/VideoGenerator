# Tự cải tiến

## Nghiên cứu {#nghien-cuu}

Mở **Tự cải tiến**, chọn kỹ năng, nhập chủ đề rồi bấm **Bắt đầu nghiên cứu (dùng ngân sách)**. Có sáu hướng: làm mới tri thức, điều tra thay đổi, thị trường, kiếm tiền, nhà cung cấp và mã nguồn mở. Trong **Tri thức**, nút **Tìm hiểu lại** mở sẵn câu hỏi cho một mục.

App lập tối đa sáu câu hỏi, tìm nguồn, đọc trang, kiểm trích dẫn, đối chiếu rồi tạo đề xuất. Báo cáo nêu phần đổi, giữ nguyên, chưa xác nhận và liên kết nguồn. Bấm **Xem đề xuất** để kiểm tra và duyệt trong Tri thức. Hoàn tất nghiên cứu không có nghĩa là tri thức đã được áp dụng.

URL tìm kiếm chỉ lấy từ metadata của Gemini. Trang được kiểm robots, địa chỉ mạng và từng chuyển hướng; app không đăng nhập hoặc gửi cookie. Câu trích phải khớp trang đã đọc. Câu không kiểm được trở thành suy luận độ tin cậy thấp; hai nguồn chính thức mâu thuẫn được giữ cả hai, kèm ghi chú.

Tên tài khoản, email, khóa và số liệu kênh được loại khỏi truy vấn web. Chỉ hỏi thông tin công khai; đừng nhập dữ liệu riêng vào chủ đề. Nội dung trang và lời agent là dữ liệu, không có quyền ra lệnh duyệt đề xuất hoặc đổi ngân sách.

## Ngân sách và tự động

Giới hạn mặc định mỗi ngày theo giờ Việt Nam: 3 lượt nghiên cứu, 40 lượt gọi AI, 60 lượt đọc web, 3 bản nháp skill, 10 lượt đánh giá và 10 đề xuất cải tiến. Đọc robots và chuyển hướng cũng dùng ngân sách. Giới hạn trang mỗi lượt mặc định là 30; kỹ năng có thể chọn mức thấp hơn. Cache trang có hạn 6 giờ; kiểm câu trích không gọi mạng.

Chỉ người dùng có quyền sửa cài đặt được lưu giới hạn. Trong ECO, app không tự nghiên cứu hoặc soạn skill; bạn vẫn khởi chạy thủ công trong giới hạn còn lại. Khi bật tự nghiên cứu, app ưu tiên tri thức cũ rủi ro cao và thay đổi cần điều tra; tránh làm lại mục đã hoàn tất trong bảy ngày, mục lỗi được thử lại sau một ngày. Lệnh thường trực **Rà lại tri thức mỗi tuần** được tạo sẵn nhưng tắt, bạn bật trong Agent operator khi cần.

Mặc định dùng model của tác vụ Nghiên cứu trong trang Mô hình AI. Tìm web cần route Gemini có grounding; thiếu khóa hoặc route thì báo thiếu kết nối, không tự đổi nhà cung cấp. Chỉ agent có khả năng web mới xuất hiện trong danh sách cách nghiên cứu. Với agent ngoài, hub vẫn tự đọc nguồn và kiểm quote; token CLI có thể chưa biết và được ghi rõ.

## Phạm vi tự làm

| Việc | App tự làm | Cần bạn |
|---|---|---|
| Tìm và đọc trang công khai | Trong ngân sách | Khởi chạy thủ công cần xác nhận dùng ngân sách |
| Đề xuất đổi tri thức | Có, dưới dạng đề xuất | Duyệt rủi ro vừa/cao |
| Tự áp dụng tri thức | Chỉ rủi ro thấp, quote đã kiểm và đúng chính sách | Các trường hợp khác |
| Soạn skill, đánh giá, chạy shadow | Trong giới hạn khi tính năng tương ứng có sẵn | Kích hoạt skill ghi dữ liệu |
| Kích hoạt hoặc quay lại skill | Chỉ skill đọc khi bạn bật cài đặt tương ứng | Các skill khác |
| Đề xuất cải tiến, soạn guide nháp | Được đề xuất khi tính năng tương ứng có sẵn | Chấp nhận đề xuất |
| Sửa mã app, chạy git, tự giao CLI sửa code, nâng ngân sách, bật trả phí, tự duyệt hoặc chạm dự án bảo vệ | Không bao giờ | Người dùng tự xử lý ngoài vòng tự vận hành |

Hiện trang này có nghiên cứu và nhật ký; các bước shadow và guide cải tiến chưa xuất hiện trong giao diện.

## Khi chưa có kết quả

- **Thiếu nguồn hoặc kết nối:** kiểm route Gemini và khóa trong Kết nối; nguồn có thể chặn robots hoặc cần đăng nhập. Tri thức cũ được giữ nguyên.
- **Đã đạt hạn mức:** chờ ngày mới hoặc tự điều chỉnh cài đặt; agent không điều chỉnh thay bạn.
- **Chưa hoàn tất:** xem nguồn nào chưa đọc được trong nhật ký và thử câu hỏi hẹp hơn.
- **Agent không còn khả dụng:** chọn lại Model theo định tuyến; báo cáo cũ vẫn đọc được.
