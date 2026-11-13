---
name: video-ho-so-kenh
description: >-
  Đọc và chỉnh hồ sơ kênh: hướng đi, guideline nền tảng, style pack, ngữ cảnh
  kênh và mức tự động của từng hồ sơ. Dùng khi người dùng hỏi kênh được cấu
  hình thế nào hoặc muốn đổi hướng, giọng, quy tắc của kênh.
operator: true
area: ho-so
triggers:
  - hồ sơ kênh
  - ho so kenh
  - guideline
  - style pack
  - hướng đi kênh
  - đổi giọng kênh
tools:
  - list_profiles
  - get_profile
  - update_profile_direction
  - set_profile_automation
  - search_profile_context
  - get_market_pack
  - get_style_pack
  - propose_style_pack
  - set_style_pack
risk: confirm
---

# Hồ sơ kênh

## Khi nào dùng

Cần biết hoặc đổi cách một kênh được cấu hình: đối tượng, giọng, quy tắc, guideline nền tảng, style.

## Các bước

1. `list_profiles` rồi `get_profile` để đọc cấu hình hiện tại.
2. Tra ngữ cảnh kênh đã lưu: `search_profile_context`; gói thị trường: `get_market_pack`.
3. Đổi hướng đi: `update_profile_direction` (confirm). Giải thích thay đổi bằng một câu và dẫn số liệu nếu có (xem `video-chien-luoc-kenh`).
4. Mức tự động của hồ sơ: `set_profile_automation` (confirm). Chỉ đề xuất, không tự bật toàn quyền.
5. Phong cách (màu, phông, nhịp): `get_style_pack` xem bản hiện tại và các bản cũ; `propose_style_pack` xin AI gợi ý một bản nháp (không lưu; ECO không gọi AI, chọn mẫu chưa kênh nào dùng); `set_style_pack` (confirm) lưu mẫu `presetId` hoặc sửa token `pack`. Bản mới chỉ áp dụng cho video render sau, không render lại video cũ; nếu có cảnh báo "giống kênh khác" thì nói với người dùng.
6. Guideline nền tảng (YouTube, TikTok, Facebook, Instagram) tự có sẵn gói; chỉnh theo từng kênh trong trang Hồ sơ.

## Kiểm tra kết quả

- `get_profile` hiện giá trị mới; dự án sau đó dùng hướng mới.

## Lỗi hay gặp

- Hồ sơ không tồn tại: `list_profiles` lấy đúng id.
- `TOOL_BLOCKED` khi đổi mức tự động hoặc quyền: việc bị cấm cứng, báo người dùng.

## Không được làm

- Không đổi quyền, vai trò hay ngân sách của hồ sơ.
- Không viết khóa hoặc token vào hồ sơ.
- Không đổi hướng kênh chỉ dựa vào một video kém.
