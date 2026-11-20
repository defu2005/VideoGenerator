---
name: video-stage-phan-canh
description: >-
  Vận hành riêng bước SCENE_PLAN: kiểm tra cách cắt kịch bản thành cảnh, số
  cảnh, thời lượng cảnh và truy vấn ảnh; xử lý cảnh quá dài, quá ngắn hoặc
  truy vấn chung chung trước khi tốn tiền tìm ảnh.
operator: true
area: du-an-va-quy-trinh
triggers:
  - scene plan
  - phân cảnh
  - phan canh
  - số cảnh
  - cảnh quá dài
  - truy vấn ảnh
antiTriggers:
  - nhạc
  - thumbnail
tools:
  - get_project
  - get_pipeline
  - get_stage_timeouts
  - run_pipeline
  - compose_plan_preview
  - get_continuity_plan
  - check_continuity
  - search_lessons
  - record_lesson
risk: confirm
---

# Bước SCENE_PLAN

## Khi nào dùng

- SCENE_PLAN lỗi.
- Số cảnh bất thường.
- Ảnh tìm được sai vì truy vấn của cảnh quá chung.

## Bước này nhận gì, ra gì

- **Nhận:** kịch bản (lời đọc và truy vấn ảnh gợi ý của từng phần) và recipe (`targetSceneSec`).
- **Ra:** danh sách cảnh. Mỗi cảnh có một đoạn lời đọc, thời lượng ước tính, một truy vấn ảnh chính và các truy vấn phụ.
- **Định hướng hình ảnh & nhịp (Continuity):** sau khi lập cảnh, app tự động tạo định hướng hình ảnh (bảng màu Lab/hex, nhân vật xuyên suốt, nhịp cắt hook/body/outro, mô-típ). Đọc bằng `get_continuity_plan`.
- **Khử lặp:** phần mở đầu và chỗ nối giữa các phần đã được khử lặp bằng code từ TASK-130.

## Các bước

1. Gọi `get_project` để đọc danh sách cảnh. Gọi `get_stage_timeouts` để xem số cảnh và thời gian chờ.
2. Cần xử lý khi gặp một trong các dấu hiệu sau:
   - cảnh dài hơn khoảng 2 lần `targetSceneSec`, nên hình đứng quá lâu;
   - nhiều cảnh dưới 2 giây, nên video bị cắt vụn;
   - truy vấn chỉ là từ chung ("history", "people");
   - lời đọc có tên riêng mà truy vấn không có.
3. **Lỗi bắt nguồn từ kịch bản** (phần quá dài, thiếu tên riêng): sửa ở bước SCRIPT bằng skill `video-stage-kich-ban`.
4. **Lỗi tạm thời:** gọi `run_pipeline` với `stage: SCENE_PLAN` một lần.
   - Khi đã có cảnh, lệnh này hỏi xác nhận ghi đè.
   - Chạy lại làm ảnh đã chọn thành cũ.
5. **Cần xem trước kiểu cảnh quay:** gọi `compose_plan_preview`. Lệnh này chỉ xem, không đổi gì.
6. **Kiểm tra định hướng hình ảnh & nhịp:** gọi `get_continuity_plan` để đọc kế hoạch liên tục; gọi `check_continuity` để kiểm tra độ lệch màu, lệch nhịp cắt hoặc thiếu tag mô-típ.

## Kiểm tra kết quả

- Thời lượng các cảnh nằm quanh `targetSceneSec`.
- Mỗi truy vấn có tên riêng hoặc vật cụ thể khi lời đọc có.

## Lỗi hay gặp

| Mã | Ý nghĩa | Cách xử lý |
|---|---|---|
| `SCRIPT_MISSING` | Chưa có kịch bản | Chạy SCRIPT trước |
| `STAGE_TIMEOUT` | Chạy quá thời gian cho phép | Chạy lại một lần, rồi xem `get_stage_timeouts` |

## Không được làm

- Không chạy lại SCENE_PLAN khi người dùng đã chọn ảnh bằng tay mà chưa hỏi họ.
- Không chạy bước nào trên dự án được bảo vệ.
