---
name: video-hinh-anh-va-giong
description: >-
  Tìm hình cho từng cảnh, kiểm tra ảnh bằng vision, xử lý VISUAL_NEEDS_USER,
  cắt và loại ảnh trùng, và xử lý giọng đọc (TTS). Dùng khi bước hình ảnh
  hoặc giọng đọc lỗi, ảnh không liên quan, hoặc cảnh thiếu ảnh.
operator: true
area: hinh-anh-va-giong-doc
triggers:
  - tìm ảnh
  - tim anh
  - ảnh không liên quan
  - visual_needs_user
  - vision
  - giọng đọc
  - tts
  - cảnh thiếu ảnh
tools:
  - research_scene_visuals
  - crop_scene_images
  - dedupe_scene_visuals
  - repair_scene
  - get_project
  - get_pipeline
risk: confirm
---

# Hình ảnh và giọng đọc

## Khi nào dùng

Bước hình ảnh hoặc giọng đọc chưa xong, ảnh sai chủ đề, trùng nhau, hoặc cảnh đang chờ người dùng chọn ảnh.

## Các bước

1. `get_pipeline` để biết bước nào lỗi; `get_project` để xem các cảnh.
2. Tìm thêm ảnh cho cảnh thiếu: `research_scene_visuals`. Ảnh chỉ được giữ khi vision xác nhận liên quan đến lời đọc của cảnh.
3. Ảnh trùng: `dedupe_scene_visuals`. Ảnh sai khung: `crop_scene_images`.
4. Cảnh vẫn không đạt: `repair_scene`. Nếu app gắn `VISUAL_NEEDS_USER`, người dùng phải tự chọn hoặc tải ảnh; agent không tải file lên qua MCP.
5. Giọng đọc lỗi: kiểm tra nhà cung cấp TTS đã chọn (xem `video-mo-hinh-ai` cho chế độ ngân sách; nhà cung cấp trả phí chỉ dùng khi được ghim).

## Quy tắc ảnh

- Ảnh phải liên quan đến nội dung cảnh, không chỉ đúng từ khóa.
- Không dùng ảnh có bản quyền hoặc ảnh còn watermark.
- Ưu tiên nguồn mở có ghi nguồn.

## Kiểm tra kết quả

- Mỗi cảnh có ít nhất một ảnh đã được vision duyệt; không còn cảnh `VISUAL_NEEDS_USER` ngoài những cảnh người dùng phải xử lý.
- `get_pipeline`: bước hình ảnh sang trạng thái xong.

## Lỗi hay gặp

- `VISION_PROVIDER_REQUIRED`: chưa gán model nhìn ảnh. Xem `video-mo-hinh-ai`.
- `VISUAL_NEEDS_USER`: không tìm được ảnh phù hợp; chờ người dùng.
- `LLM_BAD_REQUEST` kèm "tối đa 1 ảnh": trần ảnh do app đặt; hiện là 10 ảnh khi model OmniRoute bật vision. Khởi động lại API rồi chạy lại.
- `TTS_NETWORK`, `TTS_FAILED`: lỗi mạng hoặc nhà cung cấp giọng. Thử lại sau; đổi nhà cung cấp là việc của người dùng nếu cần trả phí.
- `LLM_QUOTA_WAIT`: chờ reset lượt.

## Không được làm

- Không bật fallback trả phí để "cho xong".
- Không gửi hoặc dán khóa TTS.
- Không tải file multipart (ảnh, giọng, nhạc) qua MCP.
- Không đụng dự án được bảo vệ.
