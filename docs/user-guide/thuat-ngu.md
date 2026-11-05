# Thuật ngữ {#thuat-ngu}

Các từ trên giao diện và trong hướng dẫn này.

## Thuật ngữ {#thuat-ngu-bang}

| Từ | Nghĩa |
| --- | --- |
| Stage | Một giai đoạn của pipeline, ví dụ nghiên cứu, kịch bản, ảnh, giọng, render. |
| Gate | Cổng chờ bạn. Trạng thái **WAITING_USER**. Nút **Approve** cho đi tiếp. |
| MANUAL | Bạn bấm **Run** từng giai đoạn. |
| ASSISTED | **Generate All** chạy và dừng ở mỗi cổng. Đây là kiểu làm việc mặc định. |
| AUTO | Chạy tiếp qua các cổng, không hỏi. Vẫn có báo cáo cảnh báo. |
| Route | Cặp nhà cung cấp và model cho một tác vụ AI. Sửa ở **Mô hình AI** → **Định tuyến**. |
| Fallback | Model dự phòng khi model chính lỗi hoặc hết hạn mức. Kéo thứ tự trong chuỗi dự phòng. |
| Quota | Hạn mức miễn phí (số lần, token hoặc credit) trước khi phải chờ hoặc trả phí. |
| Combo | Một cụm model trên OmniRoute mà cổng đó chọn giúp. Ứng dụng chỉ việc gọi cổng. |
| OmniRoute | Chương trình cổng AI chạy trên máy bạn. Khoá nhà cung cấp nằm ở đó, không nằm trong Video Agent. |
| Hồ sơ | Một kênh: định hướng, brief, lịch, tài khoản. |
| Brief | Thông số video: nền tảng, thời lượng, ngôn ngữ, phong cách, ngân sách. |
| Pipeline | Hàng các stage từ nghiên cứu tới render. |
| Stale | Phần phía sau bị đánh dấu cũ vì bạn sửa phần trước. Chạy lại từ chỗ đó. |
| Lead time | Số giờ bắt đầu làm video trước giờ đăng. Mặc định 6. |
| Slot | Một ô giờ đăng trên lịch. |
| Thumbnail | Ảnh bìa video. |
| Short | Đoạn dọc cắt từ video dài. |
| Operator | Phiên Cursor dài hơi sẽ tới ở task sau. Hướng dẫn này là phần người dùng đọc; operator sẽ tra cùng bản đồ tính năng. |

## Chế độ ngân sách trong một câu {#ngan-sach-trong-mot-cau}

**ECO** gọi AI ít nhất. **BALANCED** là mặc định. **QUALITY** thêm vòng sửa kịch bản. **MAX** thêm AI nhìn ảnh và frame. **CUSTOM** để bạn tick từng mục. Xem [Chế độ ngân sách](che-do-ngan-sach.md#che-do-ngan-sach).
