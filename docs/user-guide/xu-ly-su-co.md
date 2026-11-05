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

### OAuth hết hạn {#oauth-het-han}

Tab **Tài khoản** hiện **Hết hạn**, **Sắp hết hạn**, hoặc **Cần kết nối lại**.

1. Mở hồ sơ → **Tài khoản**.
2. Bấm **Kết nối lại** (hoặc **Kết nối lại để bật thống kê** / **Kết nối lại để quản lý bình luận** nếu dòng đó hiện).
3. YouTube còn Testing: làm lại khoảng mỗi 7 ngày cho đến khi bạn publish consent screen.
4. Meta: token dài hạn khoảng 60 ngày, cảnh báo trước khoảng 7 ngày.

Hết hạn thì lịch không đăng được và thống kê không cập nhật. Video đã đăng không bị xoá. Ứng dụng không gia hạn hộ.

### Việc khác {#viec-khac}

- `Thao tác đã hết hạn`: trợ lý hỏi quá lâu. Gửi lại yêu cầu.
- `Dự án đang chạy, không thể xóa.`: đợi job xong hoặc bấm **Cancel** trên pipeline.
- `Chủ đề đang sản xuất, không thể xóa.`: đợi video xong rồi xoá.
- Trang trắng sau khi sửa mã: chạy lại `npm run dev`.
