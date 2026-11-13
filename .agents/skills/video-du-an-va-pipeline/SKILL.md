---
name: video-du-an-va-pipeline
description: >-
  Tạo dự án video, chạy pipeline, duyệt gate, chạy lại bước lỗi, sửa chất lượng
  kịch bản/cảnh và xử lý dự án bị SHELVED. Dùng khi người dùng muốn làm một
  video mới, hỏi dự án đang ở bước nào, hoặc một bước bị FAILED.
operator: true
area: du-an-va-quy-trinh
triggers:
  - tạo dự án
  - tao du an
  - chạy pipeline
  - chay pipeline
  - duyệt gate
  - bước failed
  - shelved
  - dự án đang ở đâu
antiTriggers:
  - đăng bài
tools:
  - list_projects
  - get_project
  - get_pipeline
  - create_project
  - run_pipeline
  - approve_gate
  - repair_script
  - repair_scene
  - get_events
risk: confirm
---

# Dự án và pipeline

## Khi nào dùng

Làm video mới, xem tiến độ, duyệt các gate (kịch bản, hình ảnh, giọng, render), chạy lại bước lỗi, sửa chất lượng.

## Các bước

1. Xem danh sách bằng `list_projects`, chi tiết bằng `get_project`, từng bước bằng `get_pipeline`.
2. Tạo mới bằng `create_project` (chủ đề, hồ sơ kênh, kiểu video). Không đoán hồ sơ; hỏi nếu thiếu.
3. Chạy bằng `run_pipeline`. Đây là việc `confirm`: thành thẻ chờ duyệt, người dùng bấm duyệt.
4. Tại gate, đọc nội dung bước vừa xong rồi mới đề xuất `approve_gate`. Người dùng duyệt thẻ.
5. Bước FAILED: đọc `get_events` và mã lỗi trước (xem `video-xu-ly-su-co`), sửa nguyên nhân rồi mới chạy lại (`retry_stage` qua MCP).
6. Kịch bản kém: `repair_script`. Cảnh kém: `repair_scene`. Cả hai chỉ sửa phần bị đánh dấu.
7. Dự án SHELVED (sửa chất lượng đã hết số lần cho phép): không lặp vô hạn. Báo người dùng lý do và để họ quyết định sửa tay, đổi model hoặc bỏ.

## Kiểm tra kết quả

- `get_pipeline` cho thấy bước chuyển sang trạng thái mới; không còn `FAILED`.
- Sau `run_pipeline`, sự kiện mới xuất hiện trong `get_events`.

## Lỗi hay gặp

- `STAGE_TIMEOUT`: lần chạy lại được nới 1.5 lần (tối đa 30 phút; render, clip, đăng tối đa 2 giờ). Hết thời gian mà bước vẫn tiến triển thì cho gia hạn một lần.
- `LLM_INVALID_OUTPUT`: model trả sai định dạng. Chạy lại một lần; vẫn lỗi thì đổi model (xem `video-mo-hinh-ai`).
- `LLM_QUOTA_WAIT`: đang chờ reset lượt. Không tạo thẻ chạy mới.
- `PROJECT_PROTECTED`: dự án được bảo vệ. Dừng, không có cách vòng.

## Không được làm

- Không duyệt gate hoặc render trên dự án được bảo vệ (id trong `AGENTS.md`).
- Không duyệt gate khi chưa đọc nội dung.
- Không xoá dự án; việc đó là của người dùng.
- Không chạy lại liên tục một bước lỗi mà không đổi gì.
