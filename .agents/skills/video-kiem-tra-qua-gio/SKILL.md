---
name: video-kiem-tra-qua-gio
description: >-
  Quy trình khi một bước pipeline chạy quá thời gian dự kiến: đọc các lần kiểm
  tra, tìm nguyên nhân (đang tiến triển hay kẹt), rồi quyết định chờ thêm,
  dừng và thử lại, dừng hẳn hoặc hỏi người dùng. Dùng khi nhận cảnh báo
  "Bước chạy quá giờ" hoặc app nói một bước đang quá dự kiến.
operator: true
area: du-an-va-quy-trinh
triggers:
  - quá giờ
  - qua gio
  - quá thời gian
  - chạy quá lâu
  - bước bị kẹt
  - job_overdue
  - overdue
tools:
  - list_overdue_jobs
  - get_overdue_checks
  - decide_overdue
  - get_pipeline
  - get_events
  - request_user_action
risk: confirm
---

# Kiểm tra bước chạy quá giờ

## Khi nào dùng

Một bước vẫn đang chạy nhưng đã vượt thời gian dự kiến. App không tự dừng bước; nó kiểm tra rồi chờ bạn (Hermes) hoặc người dùng quyết định.

## Thứ tự làm

1. `list_overdue_jobs` xem bước nào đang quá giờ, quá bao lâu, đang `checking` hay `waiting_decision`.
2. `get_overdue_checks` với `jobId` đọc từng lần kiểm tra: dấu hiệu làm việc (log mới, file đang ghi, tiến trình con, gọi model), lý do của lần kiểm trước.
3. Phân loại nguyên nhân rồi chọn một hành động:
   - Còn tiến triển (log hoặc file mới, bước đang nặng như render) → `wait`, kèm `extendMs` hợp lý.
   - Không có dấu hiệu nào qua nhiều lần kiểm, nguyên nhân tạm thời (mạng, quota) → `abort_retry`.
   - Lỗi chắc chắn lặp lại nếu thử lại (đầu vào hỏng, thiếu khóa) → `abort_fail`.
   - Không chắc, hoặc cần người xem → `ask_user`.
4. `decide_overdue` với `jobId`, `action`, `reason` (tiếng Việt, nêu nguyên nhân cụ thể) và `extendMs` nếu chờ.
5. Theo dõi lại bằng `get_pipeline` sau lần kiểm kế tiếp. Không quyết định lại khi bước không còn quá giờ.

## Kiểm tra kết quả

- Bước chạy xong, hoặc đã dừng đúng cách và có một dòng lý do trong lịch sử kiểm tra.

## Không được làm

- Không dừng một bước chỉ vì đã quá giờ; phải có bằng chứng không tiến triển.
- Dự án được bảo vệ (id trong `AGENTS.md`): chỉ được `wait` hoặc `ask_user`, cấm dừng.
- Không đổi giới hạn thời gian hay ngưỡng của app; chúng là hằng số trong code.
- Không gọi `decide_overdue` lặp liên tục; một quyết định rồi chờ lần kiểm sau.
