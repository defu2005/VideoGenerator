---
name: video-hinh-anh-va-giong
description: >-
  Tìm hình cho từng cảnh, kiểm tra ảnh bằng vision, xử lý VISUAL_NEEDS_USER,
  cắt và loại ảnh trùng, và xử lý giọng đọc (TTS). Dùng khi bước hình ảnh
  hoặc giọng đọc lỗi, ảnh không liên quan, cảnh thiếu ảnh, hoặc agent ngoài nhận stage tìm ảnh.
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
  - agent nhận stage
  - stage_claim_next
tools:
  - research_scene_visuals
  - crop_scene_images
  - dedupe_scene_visuals
  - repair_scene
  - get_project
  - get_pipeline
  - stage_claim_next
  - stage_heartbeat
  - stage_complete
  - stage_release
  - visual_submit_candidates
  - visual_get_candidate_image
  - visual_record_verdict
  - visual_select
risk: confirm
---

# Hình ảnh và giọng đọc

## Khi nào dùng

Bước hình ảnh hoặc giọng đọc chưa xong, ảnh sai chủ đề, trùng nhau, hoặc cảnh đang chờ người dùng chọn ảnh.

## Các bước

1. `get_pipeline` để biết bước nào lỗi; `get_project` để xem các cảnh.
2. Tìm thêm ảnh cho cảnh thiếu: `research_scene_visuals`. Ảnh chỉ được giữ khi vision xác nhận liên quan đến lời đọc của cảnh.
3. Ảnh trùng: `dedupe_scene_visuals`. Ảnh sai khung: `crop_scene_images`.
4. Cảnh vẫn không đạt: `repair_scene`. Nếu stage đã giao cho agent ngoài, dùng quy trình bên dưới. Nếu chưa giao mà app gắn `VISUAL_NEEDS_USER`, người dùng chọn hoặc tải ảnh trong giao diện.
5. Giọng đọc lỗi: kiểm tra nhà cung cấp TTS đã chọn (xem `video-mo-hinh-ai` cho chế độ ngân sách; nhà cung cấp trả phí chỉ dùng khi được ghim).

## Quy tắc ảnh

- Ảnh phải liên quan đến nội dung cảnh, không chỉ đúng từ khóa.
- Giữ nguyên `copyrightMode`: `off` không cho agent chọn ảnh chưa xác minh giấy phép; `commentary` vẫn phải qua các cổng nguồn, chủ thể và chất lượng. Không chọn ảnh còn watermark hoặc tự đổi chế độ để vượt lỗi.
- Ưu tiên nguồn mở có ghi nguồn.

## Agent ngoài nhận toàn bộ stage

Chỉ khóa máy được người dùng gắn loại agent và tên instance cố định mới nhận được việc; operator trong app không dùng nhánh này. Skill không cấp thêm quyền.

1. `stage_claim_next` với bộ lọc dự án hoặc hồ sơ nếu có. `null` nghĩa là chưa có việc phù hợp. Đọc các cảnh còn mở, truy vấn đã thử, ảnh đã loại, style pack, giới hạn kích thước và `copyrightMode` trong ngữ cảnh trả về. Giữ nguyên các cảnh đã có ảnh hợp lệ hoặc do người dùng giữ.
2. Giữ `jobId` và `leaseId`; gọi `stage_heartbeat` khoảng mỗi phút, kèm tiến độ và ghi chú thật. Tìm ảnh bằng công cụ riêng. Không dùng khóa provider của app.
3. `visual_submit_candidates`: gửi URL ảnh và trang nguồn, tiêu đề, lý do phù hợp và ghi chú giấy phép có căn cứ. App tự tải an toàn và bỏ ảnh trùng; không gửi multipart hoặc đường dẫn máy agent. Chưa xác minh giấy phép thì giữ nguyên trạng thái đó.
4. `visual_get_candidate_image` để nhìn đúng tệp app đã lưu. Kiểm tra chủ thể, chất lượng, khung ảnh và watermark; `visual_record_verdict` ghi pass/reject cùng lý do và model thực sự đã dùng. Không duyệt ảnh chưa nhìn, sai chủ thể hoặc có watermark.
5. `visual_select` cho ảnh đã pass. App kiểm tra SHA, giấy phép, nguồn và ảnh trùng; một kết quả pass không bỏ qua các cổng khác. Không đổi `copyrightMode` để vượt lỗi.
6. Khi mọi cảnh còn mở đã xong, `stage_complete` kèm tóm tắt. Có thể báo `usage.calls` với model, token và chi phí thực biết; không bịa số khi chưa biết. App tự gắn provider của instance.
7. Không làm được thì `stage_release` với `reason: cannot_do` để trả về app; lý do khác trả về hàng đợi agent. `LEASE_LOST` hoặc người dùng lấy lại stage: dừng mọi lần ghi bằng lease cũ. Không tự nhận lại bằng danh tính khác.

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
