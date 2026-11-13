---
name: video-chon-chu-de
description: >-
  Tìm, lọc và xếp hàng chủ đề video cho một hồ sơ trong app Video Agent sao cho
  mỗi video có giá trị riêng và không trùng video cũ. Dùng khi người dùng muốn
  ý tưởng video, đầy hàng đợi chủ đề, hay hỏi nên làm video gì tiếp.
operator: true
area: kenh
triggers:
  - chủ đề
  - chu de
  - ý tưởng video
  - y tuong
  - hàng đợi chủ đề
  - nên làm video gì
antiTriggers:
  - xoá hết
  - xoa het
  - đăng ngay
tools:
  - get_profile
  - list_topics
  - trend_ideas
  - profile_insights
  - analytics_overview
  - suggest_topics
  - search_profile_context
  - add_topic
  - approve_topics
  - reject_topics
risk: safe
---

# Chọn chủ đề

Mục tiêu: hàng đợi chủ đề vừa ăn khách vừa **khác nhau thật**. YouTube phạt cả kênh khi video na ná nhau, nên khâu này quan trọng không kém khâu sản xuất.

## Các bước

1. Đọc hướng kênh: `get_profile`. Đọc chủ đề đang chờ: `list_topics`.
2. Lấy nguồn ý tưởng:
   - `trend_ideas`: xu hướng đã ghép với hồ sơ;
   - `profile_insights`: chủ đề nào giữ chân tốt trước đây;
   - `analytics_overview`: top video, để làm phần tiếp theo;
   - Shorts nào nhiều view nhất thì đáng làm thành video dài.
3. Sinh thêm khi thiếu: `suggest_topics` (thêm thẳng vào hàng đợi).
4. **Lọc từng chủ đề** trước khi duyệt:
   - Trùng: gọi `search_profile_context` với chủ đề. Nếu đã có video cùng ý chính, bỏ hoặc đổi góc ("phần 2", số liệu năm mới, so sánh khác).
   - Giá trị riêng: ghi được một câu "video này cho người xem điều gì mà video khác chưa có" (số liệu có nguồn, góc nhìn, kết luận). Không ghi được thì bỏ.
   - Lời hứa của tiêu đề phải trả được trong 30 giây đầu.
   - Nếu chủ đề cần ảnh có bản quyền (manga, anime, phim, game): chỉ nhận khi hồ sơ đã bật chế độ bình luận và video thật sự phân tích, bình luận (xem `video-kiem-tra-truoc-khi-dang`). Hồ sơ chưa bật thì chọn góc làm được bằng ảnh tự do, sơ đồ, chữ, hoặc bỏ chủ đề.
   - Không phải tư vấn y tế, tài chính, pháp lý cá nhân bằng giọng chuyên gia giả.
   - Chọn recipe hợp: `explainer`, `listicle`, `story`, `news_recap`, `myth_vs_fact`, `how_to`, `short_hook`.
5. Cân đối hàng đợi một tuần: không quá 2 video liên tiếp cùng recipe; trộn video "luôn đúng" (evergreen) với video theo xu hướng.
6. Thêm chủ đề còn thiếu bằng `add_topic`, duyệt chủ đề đạt bằng `approve_topics`, từ chối chủ đề không đạt bằng `reject_topics` kèm lý do.
7. Báo lại: số chủ đề đã xem, đã duyệt, đã bỏ và lý do chính.

## Mẫu ghi cho mỗi chủ đề

```
Chủ đề: ...
Recipe: ...
Giá trị riêng: ...
Lời hứa 30 giây đầu: ...
Nguồn số liệu: ...
```

## Không làm

- Không duyệt chủ đề trùng ý với video đã có.
- Không xoá chủ đề người dùng tự thêm (`delete_topic`) trừ khi họ yêu cầu.
- Không tạo dự án hoặc chạy pipeline trong skill này. Việc đó thuộc `video-lich-san-xuat`.

## Báo cáo

Làm theo skill `video-bao-cao-thu-nghiem`: đọc báo cáo cũ và nhận việc trước, lưu báo cáo sau, kể cả khi bị chặn.

- Giả thuyết cho lô chủ đề đã duyệt (ví dụ "chủ đề phần 2 của video top đạt lượt xem 7 ngày trên trung vị kênh").
- Chỉ số để kiểm: lượt xem 7 ngày của từng video làm từ lô chủ đề so với trung vị kênh; số chủ đề bị bỏ vì trùng.
- Ngày kiểm: 7 ngày sau khi video cuối của lô được đăng.
