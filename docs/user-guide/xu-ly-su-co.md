# Xử lý sự cố {#xu-ly-su-co}

Đọc đúng câu trên màn hình rồi làm bước tương ứng. Không cần xoá dữ liệu cho các lỗi dưới đây.

## Lỗi thường gặp {#loi-thuong-gap}

### Hết quota miễn phí. Chờ đến … {#llm-quota-wait}

Nghĩa là model miễn phí đã hết lượt. Mã lỗi là `LLM_QUOTA_WAIT`. Ở chế độ **AUTO** câu có thể là `Chờ quota reset lúc …`.

1. Mở **Mô hình AI** → **Quota**.
2. Xem giờ chờ. Nếu bạn chấp nhận đợi, cứ để **Chờ reset**.
3. Muốn đổi model khác còn lượt, sửa **Định tuyến** hoặc chuỗi dự phòng.
4. Chỉ khi bạn chịu chi tiền: chọn **Dùng model trả phí**, đặt trần, bấm **Lưu chính sách quota**.

Nếu câu là `Hết credit, cần nạp hoặc tạo quy tắc mới` thì hạn mức không có giờ reset. Nạp credit ở nhà cung cấp hoặc thêm quy tắc mới. Nút **Xoá chờ** chỉ bỏ bộ đếm chờ local, không nạp thêm tiền.

### Cần token quản trị {#needs-token}

Tab **Quota** hiện **Cần token quản trị** hoặc trạng thái `needs_token`, kèm câu `OmniRoute từ chối quyền đọc quota.`

1. Tạo token chỉ đọc trên OmniRoute của bạn.
2. Dán `<token của bạn>` vào ô token, bấm **Lưu token**.
3. Bấm **Làm mới**.

Không có token thì ước tính local vẫn chạy. Thẻ số thật để trống. **Xoá token** gỡ quyền đọc.

### Giọng đọc báo lỗi mạng {#loi-mang-giong}

Câu có `getaddrinfo`, `ENOTFOUND`, `ECONNRESET` hoặc `TTS_NETWORK` nghĩa là máy không ra được mạng của giọng đọc.

App tự thử 4 lần, mỗi lần cách khoảng 30 giây (khoảng 90 giây). Hết lượt thì bước Giọng đọc được xếp lại sau 5 phút, tối đa 3 vòng. Lỗi 401 hoặc 403 không thử lại.

1. Kiểm tra mạng hoặc DNS của máy.
2. Nếu vẫn lỗi sau các vòng trên, mở **Giọng đọc (TTS)** và chọn nhà cung cấp khác.
3. Không bấm Render khi cảnh chưa có giọng.

### Bước chạy quá lâu {#buoc-qua-gio}

Giới hạn thời gian của mỗi bước chỉ là mức dự kiến, không còn là giờ giới hạn cứng. Khi quá mức đó, dự án hiện nhãn **Quá dự kiến** và hệ thống tự kiểm tra xem bước còn làm việc không (tiến độ, tiến trình con, lệnh gọi mô hình). Còn tín hiệu thì chờ thêm; hết tín hiệu thì hỏi Hermes hoặc bạn.

Trên thẻ bước có ba nút: **Chờ thêm**, **Dừng và thử lại**, **Dừng hẳn**, cùng lịch sử các lần kiểm tra. Sau 30 phút chưa ai quyết, bạn nhận một thông báo (tối đa 2 giờ một lần cho mỗi việc) và bước vẫn chạy tiếp.

Muốn kiểu cũ (dừng ngay khi hết giờ), đặt **Khi quá thời gian** thành `Dừng ngay`; `Chỉ báo` thì chỉ thông báo, không gọi mô hình. Bước dừng sẽ ghi `STAGE_TIMEOUT` (thử lại được) hoặc `STAGE_OVERDUE_ABORTED` (dừng hẳn). Dự án được bảo vệ chỉ cho phép chờ hoặc hỏi bạn.

Chỗ chỉnh mức dự kiến: khối **Thời gian tối đa mỗi bước** trên trang dự án. Trợ lý chỉ được đề xuất bằng `update_stage_timeouts`; số đổi sau khi bạn duyệt.

### Không tạo được giọng đọc {#loi-giong}

Câu `Không tạo được giọng đọc.` nghĩa là nhà TTS lỗi hoặc chưa cài.

1. Mở **Giọng đọc (TTS)**. Xem nhà cung cấp mặc định còn dùng được không.
2. Với Edge, máy cần lệnh edge-tts. Đổi sang nhà khác nếu bạn đã có khoá của nhà đó.
3. Trên tab **Voice** của dự án, bấm **Tạo lại** cho cảnh lỗi.
4. Giọng mạng có thể cần thử lại. Ứng dụng tự thử lại Edge vài lần trước khi báo lỗi.

Không bấm **Render** khi chưa có đủ giọng: video sẽ thiếu tiếng. Mã liên quan là `TTS_FAILED`.

### Render thất bại {#loi-render}

Tab **Render** có thể ghi **Lệch thời lượng**, **Sai kích thước**, **Không có hình**, **Không có tiếng**, **Khung đen**, **Lỗi ảnh xem trước**, **Frame không khớp**, **Phụ đề khó đọc**, **Lỗi AI nhìn sau render**, hoặc **Bản dọc quá dài**.

1. Đọc đúng dòng cảnh báo.
2. **Không có tiếng**: quay lại tab **Voice**, bấm **Tạo giọng đọc**.
3. **Không có hình** hoặc **Khung đen**: tab **Visuals**, chọn lại ảnh, **Approve**.
4. **Phụ đề khó đọc**: tab **Subtitles**, giảm ký tự mỗi dòng (mặc định 42).
5. **Bản dọc quá dài**: rút thời lượng hoặc chọn **Ngang 16:9**.
6. Bấm **Render lại** sau khi sửa. Bản cũ vẫn nằm trong lịch sử cho đến khi hết chỗ giữ.

### Không có ảnh nào được chọn {#khong-co-anh}

Ở chế độ **MAX**, bước tìm ảnh chỉ chọn ảnh mà AI đã nhìn và thấy khớp cảnh. Nếu bước kết thúc với **0 ảnh được chọn**, dòng tóm tắt của bước nói rõ lý do, và tab **Visuals** ghi lý do cho từng cảnh:

- **vision_reject**: AI nhìn thấy mọi ảnh ứng viên đều lạc đề (ví dụ ảnh stock chung chung). Chọn tay một ảnh khác, hoặc sửa mô tả cảnh rồi chạy lại.
- **vision_unavailable**: có ảnh nhưng AI chưa nhìn được (hết ngân sách, nguồn tạm dừng, hoặc mô hình nhìn lỗi). Ảnh vẫn nằm trong danh sách ứng viên của cảnh nhưng không được tự chọn. Chạy lại **Tìm ảnh** khi ngân sách và mô hình sẵn sàng, hoặc tự duyệt ảnh trong tab **Visuals**.
- **no_candidates**: không nguồn ảnh nào trả về ảnh cho cảnh này. Đổi từ khoá của cảnh rồi tìm lại.
- **web_failed**: lượt tìm web bổ sung bị lỗi. Chạy lại sau khi kiểm tra khoá Brave ở trang **Kết nối**.

Từ TASK-126, chạy lại **Tìm ảnh** tự kiểm tra bằng AI những ảnh đã lưu mà chưa từng được nhìn, nên không cần xoá dữ liệu thủ công. Ảnh tìm thêm trên web sau khi AI loại ảnh đầu tiên cũng được AI nhìn trước khi được chọn. Quy tắc chặn ảnh chưa kiểm tra không bị nới.

### OAuth hết hạn {#oauth-het-han}

Tab **Tài khoản** hiện **Hết hạn**, **Sắp hết hạn**, hoặc **Cần kết nối lại**.

1. Mở hồ sơ → **Tài khoản**.
2. Bấm **Kết nối lại** (hoặc **Kết nối lại để bật thống kê** / **Kết nối lại để quản lý bình luận** nếu dòng đó hiện).
3. YouTube còn Testing: làm lại khoảng mỗi 7 ngày cho đến khi bạn publish consent screen.
4. Meta: token dài hạn khoảng 60 ngày, cảnh báo trước khoảng 7 ngày.

Hết hạn thì lịch không đăng được và thống kê không cập nhật. Video đã đăng không bị xoá. Ứng dụng không gia hạn hộ.

### Google báo 401 invalid_client {#oauth-invalid-client}

Mở **Cài đặt → Kết nối**, tìm ứng dụng YouTube và bấm **Nhập lại**. Chép Client ID loại Web application từ Google Cloud. Client ID có đuôi `.apps.googleusercontent.com`. Dán Secret vào ô riêng và bấm **Kiểm tra ứng dụng** sau khi lưu. Nếu đang chờ trong wizard, mở **Trang đăng nhập báo lỗi?** để quay lại bước ứng dụng.

### Giữ cổng hoặc khiếu nại bản quyền {#giu-cong}

App giữ cổng kịch bản khi chưa có điểm hoặc điểm chưa đạt, và giữ cổng render khi thiếu file, âm thanh im, phụ đề lệch hoặc độ dài lệch. Mở việc cần bạn trên trang tổng quan rồi duyệt nếu bạn chấp nhận. Nếu YouTube báo bản quyền hoặc khiếu nại, tự động hóa của hồ sơ tắt. Bật lại sau khi bạn xử lý video đó.

### Việc khác {#viec-khac}

- `Thao tác đã hết hạn`: trợ lý hỏi quá lâu. Gửi lại yêu cầu.
- `Dự án đang chạy, không thể xóa.`: đợi job xong hoặc bấm **Cancel** trên pipeline.
- `Chủ đề đang sản xuất, không thể xóa.`: đợi video xong rồi xoá.
- Trang trắng sau khi sửa mã: chạy lại `npm run dev`.
