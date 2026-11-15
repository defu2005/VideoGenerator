# Tài nguyên máy {#tai-nguyen-may}

Bộ điều tiết tài nguyên (`ResourceGovernor`) giúp hệ thống tự động tận dụng tối đa năng lực phần cứng của máy chủ mà không gây quá tải, đơ máy hay tràn bộ nhớ. Tính năng này hoạt động liên tục trong nền và mặc định được bật.

## Thẻ tài nguyên trên bảng điều khiển {#tai-nguyen}

Đọc trạng thái tải máy cần quyền xem cài đặt (vai trò biên tập viên trở lên); thay đổi cấu hình cần quyền sửa cài đặt. Người chỉ xem không được gọi API tải máy.

Trên trang **Bảng điều khiển** (Dashboard), thẻ **Tài nguyên** hiển thị tình trạng phần cứng hiện thời:

- Tải CPU (%), bộ nhớ RAM (%), dung lượng ổ đĩa còn trống (GB) và tải GPU (nếu máy có card đồ hoạ NVIDIA).
- Số việc đang chạy trên số slot cho phép của từng nhóm công việc, cùng số việc đang chờ trong hàng đợi.
- Nếu phần cứng vượt ngưỡng an toàn (CPU trên 85%, RAM trên 85%, GPU trên 90% hoặc đĩa trống dưới 5 GB), thẻ sẽ thông báo cảnh báo máy đang quá tải và hệ thống đang tự động giảm bớt số việc chạy cùng lúc.
- Bấm liên kết **Cài đặt** ở góc trên thẻ để chuyển nhanh đến phần cài đặt tài nguyên tại [Cài đặt render](render-va-thumbnail.md#cai-dat-render).

## Nhóm công việc {#nhom-viec}

Để điều tiết chính xác, hệ thống phân loại các bước trong quy trình sản xuất video thành 4 nhóm tài nguyên:
1. **Dựng và xử lý (CPU)**: các bước tốn CPU nhiều nhất như dựng video (`RENDER`), cắt clip (`CLIP`), ghép timeline (`TIMELINE`), tạo phụ đề (`SUBTITLE`).
2. **GPU**: các bước tận dụng card đồ hoạ như tạo giọng đọc cục bộ hoặc mô hình thị giác cục bộ (nếu có cấu hình).
3. **Tải và đăng (mạng, đĩa - IO)**: tìm và tải hình ảnh (`VISUAL_SEARCH`, `MEDIA_FETCH`), tải nhạc (`MUSIC_SEARCH`), tạo giọng đọc từ xa (`VOICE`) và đăng bài lên các nền tảng (`PUBLISH`).
4. **Gọi AI (LLM)**: các bước giao tiếp với mô hình ngôn ngữ lớn như tạo chủ đề (`TOPIC`), nghiên cứu nội dung (`RESEARCH`), viết kịch bản (`SCRIPT`), lập kế hoạch cảnh (`SCENE_PLAN`), đánh giá hình ảnh và âm nhạc (`VISUAL_REVIEW`, `MUSIC_REVIEW`). Nhóm này cũng tự động tuân thủ thời gian nghỉ khi nhà cung cấp AI hết hạn ngạch.

## Cơ chế điều tiết thích ứng (AIMD) {#dieu-tiet-aimd}

Bộ điều tiết lấy mẫu thông số máy mỗi 5 giây:
- **Tăng dần (Additive Increase)**: Khi các chỉ số tài nguyên đều còn cách xa ngưỡng quá tải ít nhất 5% và có việc đang chờ hoặc các slot hiện tại đã dùng hết, hệ thống sẽ tăng thêm 1 slot cho nhóm việc cần chạy.
- **Giảm nhanh (Multiplicative Decrease)**: Khi bất kỳ chỉ số nào vượt ngưỡng quá tải (CPU trên 85%, RAM trên 85%, GPU trên 90%, hoặc ổ đĩa trống dưới 5 GB), hệ thống lập tức giảm một nửa số slot của các nhóm nhạy cảm với tài nguyên đó để máy hồi phục nhanh chóng, nhưng không giảm dưới mức tối thiểu đã cấu hình.
- Tổng số việc chạy cùng lúc trên toàn hệ thống luôn bị giới hạn bởi trần trên `WORKER_CONCURRENCY` (mặc định gấp đôi số nhân CPU, tối đa 32). Riêng việc dựng video đồng thời vẫn bị giới hạn bởi `RENDER_CONCURRENCY`.

## Cài đặt bộ điều tiết {#cai-dat-tai-nguyen}

Mở **Cài đặt → Render**, kéo xuống mục **Tài nguyên máy**:
- **Tự điều tiết theo tải máy**: Bật hoặc tắt tính năng điều tiết tự động. Khi tắt, hệ thống sẽ chạy theo số lượng việc cố định `WORKER_CONCURRENCY`.
- **Tối thiểu và tối đa**: Bạn có thể tuỳ chỉnh giới hạn slot nhỏ nhất và lớn nhất cho từng nhóm việc (`CPU`, `GPU`, `IO`, `LLM`) phù hợp với cấu hình máy của bạn.

## Cảnh báo và phát hiện rảnh rỗi {#canh-bao-va-su-kien}

- **Cảnh báo thiếu tài nguyên (`resource_starved`)**: Khi có việc phải xếp hàng chờ hơn 15 phút do tất cả slot của nhóm đó đều đã kín, hệ thống giám sát tự động phát hiện và đưa ra gợi ý: thêm [Máy worker](may-worker.md#may-worker), bổ sung tài nguyên hoặc nâng trần tối đa trong Cài đặt.
- **Sự kiện máy rảnh (`capacity_idle`)**: Khi máy rảnh rỗi liên tục hơn 10 phút và các kênh đang bật tự vận hành có sẵn chủ đề đã duyệt, hệ thống sẽ phát tín hiệu cho Agent trực ca để hỏi xem có muốn sản xuất thêm video sớm hơn lịch hay không. Hệ thống không bao giờ tự ý tạo video vượt quá ngân sách hay lịch đăng đã đặt.
