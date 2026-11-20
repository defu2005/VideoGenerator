---
name: video-stage-nghien-cuu
description: >-
  Vận hành riêng bước RESEARCH: đọc ghi chú nghiên cứu, nhận biết nghiên cứu
  mỏng hoặc sai chủ đề, chạy lại đúng cách và biết khi nào báo người dùng.
operator: true
area: du-an-va-quy-trinh
triggers:
  - research
  - nghiên cứu
  - nghien cuu
  - ghi chú nghiên cứu
  - research mỏng
  - llm_research_disabled
antiTriggers:
  - kịch bản nhạt
  - render
tools:
  - get_project
  - get_pipeline
  - get_events
  - run_pipeline
  - search_lessons
  - record_lesson
risk: confirm
---

# Bước RESEARCH

## Khi nào dùng

- RESEARCH lỗi hoặc chạy quá lâu.
- Kịch bản sau đó sai sự thật hoặc thiếu ý vì nghiên cứu nghèo.

**Bước RESEARCH có thể do agent ngoài làm.** Khi dự án giao RESEARCH cho agent, agent nộp ghi chú qua `research_submit_notes`. App chỉ nhận ghi chú khi đủ 6 ý chính, ít nhất 60% ý có nguồn, trích dẫn tối đa 30 từ, và nguồn không trỏ máy nội bộ hay miền bị chặn. Nếu bị từ chối, lỗi `RESEARCH_AGENT_INVALID` kèm danh sách `problems`. Nghiên cứu nghèo do agent vẫn phải xử lý như ở đây: chạy lại đúng cách, không tự bịa nguồn.

## Bước này nhận gì, ra gì

- **Nhận:** chủ đề, ngôn ngữ, thời lượng, recipe định dạng và hồ sơ kênh.
- **Ra:** ghi chú nghiên cứu gồm:
  - `summary`;
  - `keyFacts`: 5 đến 16 ý, mỗi ý có độ tin cậy và gợi ý nguồn;
  - `timeline`, `angles`, `outline` và `cautions`.
- **Chế độ ngân sách gộp:** RESEARCH và SCRIPT chạy chung một lần gọi. Khi đó lỗi nghiên cứu hiện ra ở SCRIPT.

## Các bước

1. Gọi `search_lessons` với từ khóa "research" và chủ đề để xem kinh nghiệm cũ.
2. Gọi `get_pipeline` rồi `get_project` để đọc ghi chú. Nghiên cứu kém khi có một trong các dấu hiệu sau:
   - dưới 6 `keyFacts`, hoặc phần lớn ý có độ tin cậy thấp;
   - các ý trùng nhau, hoặc chỉ có ngày tháng mà không có sự kiện;
   - lệch chủ đề, ví dụ nhầm tác phẩm hoặc nhầm người cùng tên;
   - `cautions` báo nguồn mâu thuẫn mà không đưa ý thay thế.
3. **Lỗi tạm thời** (`LLM_INVALID_OUTPUT`, `STAGE_TIMEOUT`): gọi `run_pipeline` với `stage: RESEARCH` đúng một lần. Nếu lỗi lặp lại, đọc skill `video-mo-hinh-ai` để xem model nào đang được dùng.
4. **Lệch chủ đề vì chủ đề mơ hồ:** không tự đổi chủ đề. Báo người dùng và đề xuất cách viết chủ đề rõ hơn.
5. **Trước khi đề xuất chạy lại**, nói rõ rằng chạy lại RESEARCH làm SCRIPT và mọi bước sau thành cũ, nên phải làm lại các bước tốn tiền.
6. **Khi tìm ra nguyên nhân lặp lại được**, gọi `record_lesson` kèm bằng chứng: dự án, mã lỗi và cách sửa.

## Kiểm tra kết quả

- Ghi chú mới có đủ `keyFacts` đúng chủ đề.
- `cautions` không còn mâu thuẫn chưa giải quyết.

## Lỗi hay gặp

| Mã | Ý nghĩa | Cách xử lý |
|---|---|---|
| `LLM_RESEARCH_DISABLED` | Chế độ ngân sách đang tắt bước nghiên cứu riêng | Đổi chế độ ngân sách là việc của người dùng |
| `LLM_INVALID_OUTPUT` | Model trả sai định dạng | Chạy lại một lần, rồi mới tính đổi model |
| `LLM_QUOTA_WAIT` | Hết hạn mức tạm thời | Chờ, không chạy lại liên tục |

## Không được làm

- Không bịa thêm sự kiện vào ghi chú.
- Không chạy bước nào trên dự án được bảo vệ (`PROJECT_PROTECTED`).
