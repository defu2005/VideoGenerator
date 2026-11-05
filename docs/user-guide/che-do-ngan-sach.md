# Chế độ ngân sách {#ngan-sach}

Chế độ này chọn AI làm những gì, không khoá các nút tay.

## Chế độ ngân sách {#che-do-ngan-sach}

Dùng lúc tạo dự án, **Edit**, hoặc **Brief mặc định** của hồ sơ. Ô **Chế độ AI / Budget mode**.

1. **ECO — Rẻ nhất (~1 lượt gọi AI/video)**: ít gọi AI. Bạn làm nhiều bước hơn.
2. **BALANCED — Cân bằng chất lượng/chi phí (~8–14 lượt)**: mặc định. Có metadata, gợi ý nhạc, và các trợ lý thường dùng.
3. **QUALITY — Chất lượng cao**: thêm vòng AI đọc và sửa kịch bản.
4. **MAX — Không tiết kiệm token — kiểm tra ảnh bằng AI nhìn**: thêm nhìn ảnh và frame, chọn thumbnail bằng AI.
5. **CUSTOM**: hiện từng công tắc (kiểm tra ảnh, số vòng tìm lại, ngưỡng điểm, tìm web, v.v.).

Dòng **Ước tính** dưới ô cho biết số lượt gọi. Trên **Overview**, pipeline cũng hiện ước tính theo model đang chọn. Đổi chế độ không hoàn tiền lượt đã gọi. **MAX** tốn hơn nhiều. Không có model thì ước tính vẫn hiện nhưng stage AI sẽ lỗi khi chạy.

## Mức dùng {#muc-dung}

Dùng để xem token của cả ứng dụng. Menu: **Mức dùng**.

1. Mở **Mức dùng**.
2. Đổi kỳ và cách nhóm nếu có bộ lọc.
3. Đối chiếu với [Doanh thu](phan-tich-va-tai-chinh.md#doanh-thu) khi bạn muốn lãi ước tính.

Số là ước tính theo bảng giá trong ứng dụng, không phải hoá đơn nhà cung cấp. Không bấm gì cũng không phát sinh thêm lượt gọi.

## Token của dự án {#token-du-an}

Dùng để xem một video tốn bao nhiêu. Tab **Token** trong dự án (đường dẫn kết thúc bằng `usage`).

1. Mở tab **Token**.
2. Bấm một stage để xem từng lượt gọi, model và chi phí ước tính.

Dự án chưa chạy AI thì các số bằng không. Tab này chỉ đọc. Muốn giảm lần sau, chuyển **ECO** hoặc tắt bớt mục trong **CUSTOM** trước khi **Generate All**.
