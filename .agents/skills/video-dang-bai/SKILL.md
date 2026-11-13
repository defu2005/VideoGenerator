---
name: video-dang-bai
description: >-
  Chuẩn bị metadata, đăng hoặc hẹn giờ đăng video lên YouTube, TikTok,
  Facebook, Instagram, huỷ lịch đăng và đọc lịch. Dùng khi người dùng muốn
  đăng video, hẹn giờ, hoặc hỏi video nào sắp đăng.
operator: true
area: dang-bai
triggers:
  - đăng bài
  - dang bai
  - hẹn giờ
  - lịch đăng
  - publish
  - huỷ đăng
  - metadata
tools:
  - list_publications
  - publish_calendar
  - publish_project
  - cancel_publication
  - get_originality_report
  - list_platform_accounts
  - get_account_health
risk: confirm
---

# Đăng bài

## Khi nào dùng

Video đã render xong và sẵn sàng đăng; cần hẹn giờ; cần huỷ hoặc xem lịch.

## Các bước

1. Kiểm tra tài khoản nền tảng: `list_platform_accounts`, `get_account_health`. Kết nối OAuth là việc của người dùng (`docs/user-guide/ket-noi.md`).
2. Đọc `get_originality_report`; cổng độc đáo có thể ép chế độ công khai về riêng tư khi phát hiện rủi ro.
3. Chuẩn bị tiêu đề, mô tả, thẻ theo guideline của kênh (xem `video-ho-so-kenh`); kiểm tra trước khi đăng theo `video-kiem-tra-truoc-khi-dang`.
4. Đăng hoặc hẹn giờ bằng `publish_project`. Đăng công khai thành việc chờ duyệt; người dùng bấm duyệt.
5. Xem lịch: `publish_calendar`, `list_publications`. Huỷ bằng `cancel_publication` (confirm).

## Thứ tự nền tảng

YouTube trước, rồi TikTok, Facebook, Instagram, trừ khi hồ sơ kênh quy định khác.

## Kiểm tra kết quả

- Bài xuất hiện trong `list_publications` với trạng thái đúng (đã hẹn hoặc đã đăng).
- Nếu bị ép về riêng tư, báo người dùng lý do từ báo cáo độc đáo.

## Lỗi hay gặp

- Tài khoản hết hạn kết nối: `get_account_health` báo; người dùng kết nối lại.
- `STAGE_TIMEOUT` ở bước đăng: tối đa 2 giờ; kiểm tra nền tảng trước khi thử lại để không đăng trùng.
- `PROJECT_PROTECTED`: dự án được bảo vệ, dừng.

## Không được làm

- Không tự đăng công khai khi chưa có duyệt.
- Không đăng lại khi chưa xác nhận bài đầu thật sự thất bại.
- Không đụng token OAuth.
- Không đăng dự án được bảo vệ (id trong `AGENTS.md`).
