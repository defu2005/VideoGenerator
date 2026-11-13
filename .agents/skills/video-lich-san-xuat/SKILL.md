---
name: video-lich-san-xuat
description: >-
  Lập và chạy nhịp sản xuất đều đặn trong app Video Agent: video dài mỗi tuần,
  cắt Shorts từ video của chính kênh, bản dịch cho kênh tiếng Anh, lịch đăng
  YouTube/TikTok/Facebook. Dùng khi người dùng muốn sản xuất liên tục, lập lịch
  tuần, hay hỏi nên đăng bao nhiêu video.
operator: true
area: kenh
triggers:
  - lịch sản xuất
  - lich san xuat
  - sản xuất liên tục
  - cắt shorts
  - bao nhiêu video
  - lịch đăng tuần
  - pipeline bị kẹt
  - stage timeout
  - hết quota
antiTriggers:
  - xoá
  - xoa
  - bật trả phí
tools:
  - get_profile
  - list_topics
  - publish_calendar
  - automation_status
  - get_autonomy_status
  - save_standing_order
  - set_profile_automation
  - create_project
  - run_pipeline
  - make_shorts
  - list_clips
  - make_translation
  - usage_summary
  - get_llm_quota_status
  - get_pipeline
  - get_stage_timeouts
  - update_stage_timeouts
  - update_llm_settings
risk: confirm
---

# Lịch sản xuất

## Nhịp gợi ý cho một kênh

- **1–2 video dài mỗi tuần** (8–15 phút). Đây là nguồn tiền chính.
- **3–5 Shorts từ mỗi video dài** bằng `make_shorts`. Đây là nội dung của chính kênh nên không vướng luật reused content.
- **TikTok và Facebook**: đăng bản dài hơn 1 phút (TikTok chỉ trả tiền cho video trên 1 phút); không đăng file có watermark của nền tảng khác.
- **Kênh tiếng Anh** (nếu có): `make_translation` cho video tốt nhất của tuần, không dịch tất cả.
- Chất lượng hơn số lượng: thà ít video có giá trị riêng hơn nhiều video na ná nhau.

## Các bước lập lịch tuần

1. Đọc: `get_profile`, `list_topics` (đã duyệt), `publish_calendar`, `automation_status`, `get_autonomy_status`.
2. Thiếu chủ đề → dùng skill `video-chon-chu-de` trước.
3. Lập bảng tuần: ngày, chủ đề, recipe, định dạng (dài / Shorts / bản dịch), nền tảng, giờ đăng.
4. Kiểm tra đa dạng: không quá 2 video dài liên tiếp cùng recipe.
5. Đưa bảng cho người dùng. Khi họ đồng ý:
   - `save_standing_order` để ghi nhịp (chỉ ghi chữ, không tự chạy);
   - `set_profile_automation` (confirm) để đặt số video và giờ đăng;
   - hoặc từng dự án: `create_project` rồi `run_pipeline` (confirm).
6. Sau khi video dài render xong:
   - chạy skill `video-kiem-tra-truoc-khi-dang`;
   - `make_shorts` với `count` 3–5 (confirm), xem kết quả bằng `list_clips`;
   - `make_translation` cho video tốt nhất tuần (confirm).
7. Báo lại tuần: đã làm, đang chờ duyệt, bị chặn và lý do.

## Ngân sách

- Mặc định giữ chế độ ngân sách người dùng đã chọn. Đọc `usage_summary` và `get_llm_quota_status` trước khi tạo nhiều dự án.
- Quota thấp hơn số cảnh cần làm → không tạo thêm việc; báo người dùng.

## Khi pipeline bị kẹt

Nguyên tắc: thử lại có giới hạn, không lặp vô hạn, không tự mở chi phí. Mỗi lần kẹt đều ghi báo cáo `status: blocked` với mã lỗi, khâu, số cảnh và thời gian.

**`STAGE_TIMEOUT`** (một khâu chạy quá thời gian):
1. `get_pipeline`: khâu nào, chạy bao lâu, dự án có bao nhiêu cảnh.
2. App đã tự tính thời gian chờ theo số cảnh. Nếu lỗi do mạng hay provider chậm nhất thời → chạy lại một lần bằng `run_pipeline` (confirm).
3. Lặp lại lần hai ở cùng khâu → dừng vòng tự chạy. Đọc `get_stage_timeouts`, rồi đề xuất `update_stage_timeouts` (confirm) với số phút cho đúng khâu. Công cụ chỉ tạo thao tác chờ duyệt. VISUAL_SEARCH và RENDER với video trên 20 cảnh thường cần 20–30 phút. Người dùng duyệt thì app mới đổi.

**`LLM_QUOTA_WAIT`** (model hết lượt):
1. `get_llm_quota_status`: model nào hết, bao giờ có lại, model **miễn phí** nào còn lượt.
2. Còn route miễn phí khác hợp với khâu đó → đề xuất đổi route bằng `update_llm_settings` (confirm, thành thao tác chờ duyệt). Ghi rõ đổi từ gì sang gì, vì sao.
3. Không có route miễn phí → chờ đến giờ có lại; không tạo dự án mới trong lúc chờ.
4. Không chuyển sang model trả phí, không bật `paid_fallback`, không xoá thời gian chờ để "ép" chạy.

**Lỗi mạng của TTS** (ví dụ edge-tts báo `getaddrinfo failed`):
1. App tự thử lại lỗi mạng: 4 lần trong khoảng 90 giây, rồi chạy lại bước sau 5 phút, tối đa 3 vòng. Agent chờ hết các lần đó trước khi báo.
2. Vẫn lỗi sau các vòng trên → dừng, báo người dùng kiểm tra mạng hoặc chọn provider TTS khác cho hồ sơ. Không tự đổi sang TTS trả phí.

Việc thử lại tự động trong code (backoff) là việc của app, không phải agent. Nếu thấy cùng một lỗi lặp lại ở nhiều dự án, ghi đề xuất sửa app trong báo cáo.

## Không làm

- Không tăng số video mỗi ngày quá mức người dùng đặt.
- Không đăng lại một video y hệt lên cùng nền tảng.
- Không bật `paid_fallback`, không đổi key.
- Không duyệt cổng hay render trên dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Báo cáo

Làm theo skill `video-bao-cao-thu-nghiem`: đọc báo cáo cũ và nhận việc trước, lưu báo cáo sau, kể cả khi bị chặn.

- Ghi bảng tuần đã chốt. Giả thuyết: "nhịp này làm đủ số video với quota hiện có và không bị chặn".
- Chỉ số để kiểm: số video dự kiến so với đã đăng, số việc bị chặn và lý do, quota hoặc chi phí đã dùng.
- Ngày kiểm: cuối tuần của lịch (Chủ nhật).

## Nguồn

- Dài + Shorts: https://influenceflow.io/resources/youtube-shorts-and-long-form-video-strategy-the-complete-2026-creators-guide-1/
- Watermark nền tảng: https://www.usefastlane.ai/blog/youtube-shorts-algorithm-2026
- TikTok trên 1 phút: https://creatorsagency.co/blog/tiktok-creator-rewards-program-2026
