---
name: video-stage-nhac
description: >-
  Vận hành riêng bước MUSIC_SEARCH và gate MUSIC_REVIEW: đọc ứng viên nhạc,
  hiểu MUSIC_AUTO_PICKED và MUSIC_NONE, khi nào tìm lại và khi nào để người
  dùng chọn.
operator: true
area: render-va-thumbnail
triggers:
  - nhạc
  - nhac
  - music
  - music_review
  - music_none
  - music_auto_picked
  - nhạc nền
antiTriggers:
  - giọng đọc
  - kịch bản
tools:
  - get_project
  - get_pipeline
  - get_events
  - repair_render_stage
  - approve_gate
  - search_lessons
  - record_lesson
risk: confirm
---

# Bước nhạc

## Khi nào dùng

- MUSIC_SEARCH lỗi.
- Gate MUSIC_REVIEW đang chờ duyệt.
- Video không có nhạc, hoặc nhạc lệch không khí.

**MUSIC_SEARCH có thể do agent ngoài làm.** Agent nộp tối đa 8 bản nhạc cho mỗi việc qua `music_submit_candidates`. App chỉ nhận bản có giấy phép thương mại, URL hợp lệ, tải được và đo được thời lượng; bản bị loại được trả lại kèm lý do. Agent không chọn bản cuối. Khi đọc ứng viên, kiểm giấy phép từng bản. Lỗi `MUSIC_AGENT_INVALID` kèm `problems` nghĩa là không bản nào được nhận từ lượt đó.

## Bước này nhận gì, ra gì

- **MUSIC_SEARCH** nhận mood, mức năng lượng và từ khóa nhạc của kịch bản. Ra danh sách ứng viên có xếp hạng và thông tin giấy phép.
- **MUSIC_REVIEW** là một gate.
  - Ở chế độ tự động, app chọn bản xếp hạng cao nhất và ghi `MUSIC_AUTO_PICKED`.
  - Khi không có bản phù hợp hoặc tải thất bại, app ghi `MUSIC_NONE`, và video không có nhạc.

## Các bước

1. Gọi `get_project` để xem ứng viên, bản đã chọn và mood của kịch bản. Gọi `get_events` để tìm các mã về nhạc.
2. **`MUSIC_SEARCH_FAILED`, hoặc `MUSIC_NONE` vì không có ứng viên:** gọi `repair_render_stage` cho bước nhạc một lần. Nếu vẫn không có, báo người dùng rằng họ có thể tải nhạc của mình lên.
3. **Gate MUSIC_REVIEW đang chờ:**
   - so mood của từng ứng viên với mood của kịch bản;
   - chỉ tạo việc chờ duyệt, kèm lý do chọn; người dùng là người duyệt;
   - không duyệt khi chưa đọc ứng viên.
4. **Nhạc lệch không khí lặp lại ở cùng kênh:** gọi `record_lesson`, ghi mood đã chọn và mood đáng lẽ phải dùng.

## Kiểm tra kết quả

- Dự án có đúng một bản nhạc đã chọn, rõ giấy phép.
- Hoặc có ghi chú rõ rằng video cố ý không có nhạc.

## Lỗi hay gặp

| Mã | Mức | Ý nghĩa |
|---|---|---|
| `MUSIC_AUTO_PICKED` | INFO | Chế độ tự động đã chọn bản xếp hạng cao nhất |
| `MUSIC_NONE` | WARN | Tải thất bại hoặc không có ứng viên phù hợp |
| `MUSIC_SEARCH_FAILED` | lỗi | Bước tìm nhạc không chạy được |

## Không được làm

- Không chọn nhạc không rõ giấy phép.
- Không duyệt gate trên dự án được bảo vệ.
