---
name: video-stage-giong-va-phu-de
description: >-
  Vận hành riêng bước VOICE và SUBTITLE: lỗi TTS, giọng đọc sai số hoặc từ
  viết tắt, phụ đề lệch tiếng, và thứ tự chạy lại an toàn.
operator: true
area: hinh-anh-va-giong-doc
triggers:
  - voice
  - giọng đọc
  - giong doc
  - tts
  - subtitle
  - phụ đề
  - phu de
  - voice_track_missing
antiTriggers:
  - kịch bản nhạt
  - thumbnail
tools:
  - get_project
  - get_pipeline
  - get_events
  - repair_render_stage
  - list_connections
  - search_lessons
  - record_lesson
risk: confirm
---

# Bước VOICE và SUBTITLE

## Khi nào dùng

- VOICE hoặc SUBTITLE lỗi.
- Giọng đọc sai số, năm hoặc từ viết tắt.
- Phụ đề lệch so với tiếng.

## Bước này nhận gì, ra gì

- **VOICE** nhận lời đọc của từng cảnh và giọng của kênh. Ra một tệp âm thanh cho mỗi cảnh, kèm thời lượng thật.
- **SUBTITLE** cần âm thanh từ VOICE và ra phụ đề khớp thời gian. Khi thiếu âm thanh, bước này báo `VOICE_TRACK_MISSING`.

## Các bước

1. Gọi `get_pipeline` và `get_events` để lấy mã lỗi.
2. Gọi `list_connections` để xem nhà cung cấp giọng có sẵn sàng không. Công cụ này không bao giờ trả về khóa.
3. Xử lý theo bảng lỗi bên dưới.
4. **Giọng đọc sai số hoặc từ viết tắt:** lỗi nằm ở lời đọc. Sửa trong kịch bản bằng skill `video-stage-kich-ban` (viết số đúng như cách đọc), rồi chạy lại VOICE.
5. **Thứ tự chạy lại:** VOICE, rồi SUBTITLE, rồi TIMELINE, đều qua `repair_render_stage`. Chạy lại VOICE làm phụ đề và timeline thành cũ.

## Kiểm tra kết quả

- Mọi cảnh đều có tệp âm thanh có độ dài lớn hơn 0.
- Phụ đề bắt đầu và kết thúc khớp với tiếng.

## Lỗi hay gặp

| Mã | Ý nghĩa | Cách xử lý |
|---|---|---|
| `TTS_NETWORK` | Lỗi mạng khi gọi TTS | Chờ, rồi `repair_render_stage` cho VOICE một lần |
| `TTS_BINARY_MISSING` | Máy thiếu công cụ TTS | Báo người dùng cài |
| `TTS_BINARY_OUTDATED` | Công cụ TTS đã cũ | Báo người dùng cập nhật |
| `TTS_FAILED` | Nhà cung cấp trả lỗi | Thử lại một lần; nếu lặp lại thì báo người dùng |
| `TTS_NO_AUDIO` | Nhà cung cấp trả tệp rỗng | Thử lại một lần; nếu lặp lại thì báo người dùng |
| `VOICE_TRACK_MISSING` | SUBTITLE chạy khi chưa có giọng | Chạy VOICE trước, rồi mới chạy SUBTITLE |

## Không được làm

- Không đọc hay gửi khóa TTS.
- Không tự bật nhà cung cấp trả phí. Đổi nhà cung cấp là việc của người dùng.
- Không chạy bước nào trên dự án được bảo vệ.
