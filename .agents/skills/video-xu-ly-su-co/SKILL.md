---
name: video-xu-ly-su-co
description: >-
  Quy trình chẩn đoán khi app hoặc một bước pipeline lỗi: đọc sự kiện, mã lỗi,
  tra hướng dẫn, rồi mới sửa; và khi nào ghi vào PROPOSALS_AND_BUGS.md hoặc xin
  người dùng ra tay. Dùng khi có lỗi chưa rõ nguyên nhân.
operator: true
area: xu-ly-su-co
triggers:
  - lỗi
  - loi
  - thất bại
  - failed
  - sự cố
  - không chạy
  - bị kẹt
tools:
  - get_events
  - get_pipeline
  - get_project
  - find_tools
  - search_user_guide
  - propose_missing_tool
  - request_user_action
risk: safe
---

# Xử lý sự cố

## Khi nào dùng

Một bước FAILED, app chậm, kẹt hoặc cho kết quả lạ và chưa rõ vì sao.

## Thứ tự chẩn đoán

1. `get_pipeline` xem bước lỗi; `get_events` đọc mã lỗi và thông báo gốc.
2. `search_user_guide` tra mã lỗi trong trang Xử lý sự cố.
3. Phân loại theo mã (xem bên dưới) rồi chọn skill đúng: model và quota `video-mo-hinh-ai`; hình và giọng `video-hinh-anh-va-giong`; render `video-render-va-thumbnail`; đăng `video-dang-bai`.
4. Sửa nguyên nhân gốc rồi mới chạy lại một lần. Lỗi lặp lại thì dừng và báo.
5. Cần công cụ app chưa có: `find_tools` thử tìm trước; không có thì `propose_missing_tool`.
6. Cần người dùng làm tay (kết nối, tải file, duyệt): `request_user_action` kèm một câu nói rõ cần làm gì.

## Khi nào ghi vào PROPOSALS_AND_BUGS.md

Chỉ khi chắc đó là lỗi của app (tái hiện được, có mã lỗi và bước) hoặc là thiếu tính năng thật. Ghi: hiện tượng, cách tái hiện, mã lỗi, việc đã thử. Không ghi lỗi do cấu hình, hết quota hay mạng. Việc này là sửa tài liệu, không phải sửa code.

## Kiểm tra kết quả

- Bước chạy lại xong, hoặc người dùng nhận được một yêu cầu rõ ràng.

## Lỗi hay gặp (mã thật)

- `STAGE_TIMEOUT`, `LLM_QUOTA_WAIT`, `LLM_INVALID_OUTPUT`, `LLM_BAD_REQUEST`, `VISION_PROVIDER_REQUIRED`
- `VISUAL_NEEDS_USER`, `TTS_NETWORK`, `TTS_FAILED`
- `PROJECT_PROTECTED`, `TOOL_BLOCKED`, `UNKNOWN_TOOL`, `INVALID_TOOL_ARGS`

## Không được làm

- Không chạy lại liên tục khi chưa đổi gì.
- Không đụng dự án được bảo vệ (id trong `AGENTS.md`).
- Không tìm đường vòng quanh `TOOL_BLOCKED`.
- Không dán khóa, token vào báo cáo lỗi.
