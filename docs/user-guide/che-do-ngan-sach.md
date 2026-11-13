# Chế độ ngân sách {#ngan-sach}

Chế độ này chọn AI làm những gì, không khoá các nút tay.

## Chế độ ngân sách {#che-do-ngan-sach}

Dùng lúc tạo dự án, **Edit**, hoặc **Brief mặc định** của hồ sơ. Ô **Chế độ AI / Budget mode**.

1. **ECO — Rẻ nhất (~2 lượt gọi AI/video)**: ít gọi AI. Một lượt tính thời gian tối đa mỗi bước. Bạn làm nhiều bước hơn.
2. **BALANCED — Cân bằng chất lượng/chi phí (~11–17 lượt)**: mặc định. Có metadata, gợi ý nhạc, chọn mẫu video, và các trợ lý thường dùng.
3. **QUALITY — Chất lượng cao**: thêm vòng AI đọc và sửa kịch bản.
4. **MAX — Không tiết kiệm token — kiểm tra ảnh bằng AI nhìn**: thêm nhìn ảnh và frame, chọn thumbnail bằng AI.
5. **CUSTOM**: hiện từng công tắc (kiểm tra ảnh, số vòng tìm lại, ngưỡng điểm, tìm web, v.v.).

Dòng **Ước tính** dưới ô cho biết số lượt gọi. Trên **Overview**, pipeline cũng hiện ước tính theo model đang chọn. Đổi chế độ không hoàn tiền lượt đã gọi. **MAX** tốn hơn nhiều. Không có model thì ước tính vẫn hiện nhưng stage AI sẽ lỗi khi chạy.

## Mức dùng {#muc-dung}

Dùng để xem token của cả ứng dụng. Menu: **Mức dùng**.

1. Mở **Mức dùng**.
2. Đổi kỳ và cách nhóm nếu có bộ lọc.
3. Đối chiếu với [Doanh thu](phan-tich-va-tai-chinh.md#doanh-thu) khi bạn muốn lãi ước tính.

Số là ước tính theo bảng giá trong ứng dụng, không phải hoá đơn nhà cung cấp. Không bấm gì cũng không phát sinh thêm lượt gọi. Câu hỏi gửi cho trợ lý cũng cộng vào tổng này. Khi nhóm theo Video, trợ lý hiện một dòng riêng.

## Token của dự án {#token-du-an}

Dùng để xem một video tốn bao nhiêu. Tab **Token** trong dự án (đường dẫn kết thúc bằng `usage`).

1. Mở tab **Token**.
2. Bấm một stage để xem từng lượt gọi, model và chi phí ước tính.
3. Khi dự án đã có bản đề xuất, tab này và trang tổng quan hiện **Ước tính vs thực tế**: token và ký tự đọc đã ước tính, cạnh số đã dùng.

Dự án chưa chạy AI thì các số bằng không. Tab này chỉ đọc. Muốn giảm lần sau, chuyển **ECO** hoặc tắt bớt mục trong **CUSTOM** trước khi **Generate All**.

<a id="tri-thuc-ngan-sach"></a>
## Ngân sách tri thức

**knowledgeContext** giới hạn token ngữ cảnh mỗi lần gọi: ECO 600, BALANCED 1 500, QUALITY/MAX 3 000. CUSTOM có thể chọn 0 để tắt. **knowledgeEmbeddings** tắt ở ECO, bật từ BALANCED khi đã chọn nhà cung cấp embedding. Tìm từ khoá vẫn hoạt động khi không có embedding. Ước tính tính thêm ngữ cảnh cho các lần viết và embedding cho các đoạn mới; chi phí thực tế phụ thuộc model, bộ nhớ đệm và số đoạn thay đổi.
