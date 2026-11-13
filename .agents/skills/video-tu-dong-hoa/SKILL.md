---
name: video-tu-dong-hoa
description: >-
  Quản lý tự động hoá: hàng chờ chủ đề, duyệt hoặc từ chối chủ đề gợi ý,
  tạm dừng hoặc tiếp tục tự động, standing order và mức tự chủ. Dùng khi
  người dùng muốn app tự làm video theo lịch hoặc hỏi tại sao nó đang dừng.
operator: true
area: tu-dong-hoa
triggers:
  - tự động hoá
  - tu dong hoa
  - hàng chờ chủ đề
  - tạm dừng tự động
  - standing order
  - cron
  - lịch tự động
tools:
  - list_topics
  - add_topic
  - add_trend_topic
  - suggest_topics
  - approve_topics
  - reject_topics
  - delete_topic
  - trend_ideas
  - automation_status
  - pause_automation_all
  - resume_automation_all
  - get_autonomy_status
  - save_standing_order
risk: confirm
---

# Tự động hoá

## Khi nào dùng

Muốn app tự làm video theo hàng chờ chủ đề; muốn biết hoặc đổi trạng thái tự động; đặt lệnh dài hạn.

## Các bước

1. `automation_status` và `get_autonomy_status` để biết trạng thái và mức tự chủ (Tắt, Trợ giúp, Có giám sát, Toàn quyền). Đổi mức này là việc của người dùng.
2. Hàng chờ chủ đề: `list_topics`; thêm `add_topic` hoặc `add_trend_topic`; gợi ý `suggest_topics`, `trend_ideas`.
3. Duyệt hoặc từ chối gợi ý: `approve_topics`, `reject_topics` (đọc từng chủ đề trước, xem `video-chon-chu-de`).
4. Gặp sự cố hoặc cần ngừng: `pause_automation_all` (safe). Tiếp tục: `resume_automation_all` (confirm).
5. Việc dài hạn viết thành lệnh bằng `save_standing_order` (confirm); lệnh phải cụ thể, có giới hạn và cách dừng.
6. Hàng chờ operator và cron: kiểm tra trạng thái trong trang Vận hành; lịch lặp do app chạy, không tạo cron ngoài.

## Kiểm tra kết quả

- `automation_status` hiện đúng trạng thái; chủ đề đã duyệt chuyển sang hàng chờ.

## Lỗi hay gặp

- Chủ đề trùng: bỏ bằng `reject_topics`.
- `TOOL_BLOCKED` khi đổi mức tự chủ hoặc bật toàn quyền: cấm cứng.
- `LLM_QUOTA_WAIT`: tự động tạm chờ lượt; không ép chạy.

## Không được làm

- Không bật tự động hoặc nâng mức tự chủ; chỉ người dùng làm.
- Không xoá chủ đề của người dùng khi chưa được yêu cầu.
- Không tạo standing order mơ hồ hoặc không giới hạn.
