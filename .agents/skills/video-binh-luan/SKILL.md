---
name: video-binh-luan
description: >-
  Đọc, trả lời và ẩn bình luận trên video đã đăng. Dùng khi người dùng muốn
  xem bình luận mới, soạn trả lời hoặc ẩn bình luận spam.
operator: true
area: binh-luan
triggers:
  - bình luận
  - binh luan
  - trả lời comment
  - ẩn bình luận
  - comment
tools:
  - list_comments
  - reply_comment
  - hide_comment
risk: confirm
---

# Bình luận

## Khi nào dùng

Có bình luận mới cần đọc, trả lời hoặc ẩn.

## Các bước

1. `list_comments` để đọc hộp thư bình luận; gom theo video.
2. Soạn trả lời ngắn, đúng giọng kênh (xem hồ sơ kênh). Trả lời bằng `reply_comment` (confirm; người dùng duyệt).
3. Spam hoặc lừa đảo: `hide_comment` (confirm) kèm lý do ngắn.
4. Câu hỏi cần số liệu thật thì tra trước, không bịa.

## Kiểm tra kết quả

- Bình luận đã trả lời hoặc ẩn đổi trạng thái trong `list_comments`.

## Lỗi hay gặp

- Tài khoản nền tảng hết hạn: người dùng kết nối lại (`docs/user-guide/ket-noi.md`).
- Nền tảng chưa hỗ trợ lấy bình luận: chỉ báo, không thử đường vòng.

## Không được làm

- Không trả lời thay mặt người dùng khi chưa được duyệt.
- Không cam kết, hứa hẹn hay tiết lộ thông tin cá nhân trong câu trả lời.
- Không xoá bình luận thật của người xem; chỉ ẩn spam.
