---
name: video-hoc-theo-buoc
description: >-
  Bài học theo bước và chất lượng theo bước trong app Video Agent: đọc phản hồi
  đã ghi nhận từng bước, đề xuất ghi chú bài học, xem xu hướng điểm chất lượng
  14 ngày và cảnh báo khi điểm giảm. Dùng khi người dùng hỏi bước nào đang kém,
  muốn rút bài học từ sửa kịch bản hoặc duyệt, hay hỏi điểm chất lượng có đổi không.
operator: true
area: kenh
triggers:
  - bài học theo bước
  - bai hoc theo buoc
  - chất lượng theo bước
  - chat luong theo buoc
tools:
  - list_stage_feedback
  - stage_quality_report
  - propose_stage_note
  - decide_stage_note
risk: confirm
---

# Bài học theo bước và chất lượng theo bước

## Công cụ

- `list_stage_feedback` (chỉ đọc): các phản hồi chưa rút bài học của một bước (sửa kịch bản, sửa lời dẫn, duyệt có chỉnh sửa).
- `stage_quality_report` (chỉ đọc): xu hướng 14 ngày so với 14 ngày trước của một bước. Số liệu hiện chỉ có `quality_score` cho bước SCRIPT.
- `propose_stage_note` (đề xuất): ghi tối đa 5 ghi chú cho một bước. Mỗi ghi chú phải dẫn chiếu tới phản hồi có thật trong danh sách vừa đọc. Ghi chú vào trạng thái **Chờ duyệt**.
- `decide_stage_note` (cần xác nhận): duyệt, từ chối, gỡ hoặc hoàn tác. Agent chỉ được từ chối; duyệt là việc của người dùng.

## Quy trình

1. Đọc `list_stage_feedback` cho bước cần xem. Nếu dưới 5 phản hồi mới, dừng và nói là chưa đủ.
2. Viết ghi chú ngắn, cụ thể, chỉ dựa trên phản hồi đã đọc. Không nêu số liệu không có trong dữ liệu.
3. Gọi `propose_stage_note`. Báo cho người dùng biết ghi chú đang chờ duyệt ở trang Hồ sơ → Bài học.
4. Với xu hướng, gọi `stage_quality_report`. Nếu điểm giảm trên 20% với ít nhất 5 lần chạy, nói rõ đã có cảnh báo trong hộp thư Cần xử lý. Không tự đổi prompt, model hay cài đặt.

## Ranh giới

- Không duyệt ghi chú. Không gỡ ghi chú đã duyệt nếu người dùng chưa yêu cầu.
- Không đổi prompt của bước, không bật tự động đề xuất theo tuần.
- Không dùng ghi chú chưa duyệt để trả lời như là quy tắc đã áp dụng.

Chi tiết: docs/user-guide/phan-tich-va-tai-chinh.md (mục Bài học theo bước và Chất lượng theo bước).
