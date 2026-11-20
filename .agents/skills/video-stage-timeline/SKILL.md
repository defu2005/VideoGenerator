---
name: video-stage-timeline
description: >-
  Vận hành riêng bước TIMELINE và gate FINAL_APPROVAL: kiểm tra thời lượng,
  độ khớp giữa giọng và cảnh, metadata nháp, và cách hoàn tác một lần sửa
  timeline trước khi render.
operator: true
area: render-va-thumbnail
triggers:
  - timeline
  - final approval
  - duyệt cuối
  - duyet cuoi
  - metadata nháp
  - sửa timeline
antiTriggers:
  - nghiên cứu
  - tìm nhạc
tools:
  - get_project
  - get_pipeline
  - get_events
  - compose_plan_preview
  - repair_render_stage
  - undo_timeline_edit
  - approve_gate
  - search_lessons
  - record_lesson
risk: confirm
---

# Bước TIMELINE và duyệt cuối

## Khi nào dùng

- TIMELINE lỗi.
- Thời lượng video lệch mục tiêu.
- Dự án đang chờ FINAL_APPROVAL.

## Bước này nhận gì, ra gì

- **Nhận:**
  - ảnh đã duyệt từ VISUAL_REVIEW;
  - giọng và phụ đề từ SUBTITLE;
  - nhạc từ MUSIC_REVIEW.
- **Ra:**
  - timeline cho từng cảnh: ảnh, chuyển động, đoạn giọng, phụ đề và nhạc;
  - metadata nháp: tiêu đề, mô tả và thẻ.

## Các bước

1. Gọi `get_project` để đọc timeline và metadata. Gọi `compose_plan_preview` để xem thống kê kiểu cảnh quay.
2. Kiểm tra:
   - tổng thời lượng lệch mục tiêu hơn khoảng 15 phần trăm (nguyên nhân thường nằm ở độ dài kịch bản);
   - cảnh có hình đứng lâu hơn giọng đọc nhiều;
   - metadata lặp tiêu đề cũ của kênh, hoặc dùng từ sáo rỗng.
3. **Lỗi tạm thời:** gọi `repair_render_stage` cho TIMELINE một lần.
4. **Một lần sửa timeline làm hỏng thứ khác:** gọi `undo_timeline_edit`.
5. **FINAL_APPROVAL:**
   - agent chỉ tạo việc chờ duyệt, kèm tóm tắt: thời lượng, số cảnh, điểm kịch bản và những cảnh còn yếu;
   - người dùng là người duyệt;
   - cách render, xem skill `video-render-va-thumbnail`.

## Kiểm tra kết quả

- Thời lượng nằm trong khoảng mục tiêu.
- Không có cảnh nào thiếu ảnh hoặc thiếu giọng.
- Metadata không trùng với video cũ.

## Lỗi hay gặp

| Mã | Ý nghĩa | Cách xử lý |
|---|---|---|
| `VOICE_TRACK_MISSING` | Thiếu giọng của một cảnh | Xem skill `video-stage-giong-va-phu-de` |
| `STAGE_TIMEOUT` | Chạy quá thời gian cho phép | Chạy lại một lần |

## Không được làm

- Không duyệt FINAL_APPROVAL và không render trên dự án được bảo vệ.
- Không duyệt khi chưa đọc timeline.
