---
name: video-chien-luoc-kenh
description: >-
  Chọn ngách, thể loại và đường kiếm tiền cho một hồ sơ (kênh) trong app Video Agent,
  không dùng GPU. Dùng khi người dùng hỏi nên làm kênh gì, ngách nào nhiều tiền,
  điều kiện bật kiếm tiền YouTube/TikTok/Facebook, hay muốn đổi hướng kênh.
operator: true
area: kenh
triggers:
  - ngách
  - ngach
  - kênh gì
  - kiếm tiền
  - kiem tien
  - điều kiện kiếm tiền
  - rpm
  - đổi hướng kênh
antiTriggers:
  - xoá
  - xoa
  - mua view
tools:
  - list_profiles
  - get_profile
  - get_goal_progress
  - analytics_overview
  - finance_summary
  - profile_insights
  - update_profile_direction
  - save_standing_order
risk: confirm
---

# Chiến lược kênh

Skill này giúp agent tư vấn và thiết lập hướng đi cho một hồ sơ. Agent chỉ đề xuất; đổi hướng kênh và bật tự động hoá luôn cần người dùng duyệt.

## Sự thật cần nhớ (nghiên cứu 11/2026, đa số từ blog bên thứ ba, kiểm lại trang chính thức trước khi hứa với người dùng)

- **YouTube không cấm kênh AI hay kênh không lộ mặt.** Chính sách "inauthentic content" (đổi tên từ "repetitious content" tháng 7/2025) chặn video sản xuất hàng loạt, rập khuôn, lặp lại. YouTube xét **cả kênh**, không xét từng video.
- **Nhân vật AI đóng vai chuyên gia** (bác sĩ, tư vấn tài chính, luật, chính trị) thì không được bật kiếm tiền.
- **Reused content** là luật riêng: compilation, reaction, clip người khác mà không có bình luận thật thì không ra tiền, kể cả khi có giấy phép.
- **Điều kiện kiếm tiền** (kiểm lại trước khi trích):
  - YouTube YPP: 1.000 sub cộng 4.000 giờ xem trong 12 tháng, hoặc 10 triệu view Shorts trong 90 ngày.
  - TikTok Creator Rewards: 10K follower, 100K view trong 30 ngày, 18+, **chỉ video dài hơn 1 phút** được trả.
  - Facebook Content Monetization: Page 10K follower.
- **RPM** (ước tính, khán giả Mỹ): tài chính và đầu tư khoảng $8–25, bảo hiểm và pháp lý cao nhất, công nghệ/AI/SaaS cao, kể chuyện tăng nhanh nhất. TikTok khoảng $0.4–1.5. Facebook Reels khoảng $1–10.
- **Khán giả Việt Nam** có CPM thấp hơn Mỹ nhiều. Nếu mục tiêu là tiền, đề xuất thêm một hồ sơ tiếng Anh và dùng `make_translation` cho video tốt nhất.
- **Video dài ra tiền, Shorts kéo người xem.** Affiliate, tài trợ và sản phẩm số thường đem lại nhiều hơn quảng cáo ở ngách tài chính và công nghệ.

## Thể loại hợp với app (không cần GPU)

| Ngách | Recipe của app | Vì sao |
|---|---|---|
| Tài chính, kinh tế có số liệu | `explainer`, `myth_vs_fact` | RPM cao; số liệu thật làm video khác nhau |
| Lịch sử, địa lý, "tại sao..." | `explainer`, `story` | Xem lâu; nhiều ảnh tư liệu công cộng |
| Công nghệ/AI, hướng dẫn | `how_to`, `explainer` | RPM cao, dễ có affiliate |
| Kể chuyện (truyện công cộng, chuyện có thật) | `story` | Nhóm tăng nhanh nhất |
| Top list, so sánh | `listicle` | Dễ làm đều; phải đổi bố cục |
| Tin tức tổng hợp | `news_recap` | Cần nguồn và góc nhìn riêng, tránh chép bài |

Tránh: reaction, compilation clip người khác, nhân vật AI giả người thật, avatar cần GPU.

Ngách review manga, anime, phim, game làm được nhưng rủi ro bản quyền cao nhất: mọi hình đều thuộc studio, nên dễ bị khiếu nại hoặc mất tiền của video. Chỉ chọn khi người dùng chấp nhận rủi ro, hồ sơ bật chế độ bình luận, và mỗi video là phân tích thật (xem `video-kiem-tra-truoc-khi-dang`). Nói rõ rủi ro này khi đề xuất ngách.

## Các bước

1. Đọc hiện trạng: `list_profiles`, `get_profile`, `get_goal_progress`, `analytics_overview` (90 ngày), `finance_summary`.
2. Nếu hồ sơ đã có video: `profile_insights` để biết video nào giữ chân tốt.
3. Đề xuất 1–2 ngách theo bảng trên. Mỗi ngách nêu: khán giả, recipe dùng, "giá trị riêng" của kênh (số liệu, góc nhìn, chuỗi bài), đường kiếm tiền (quảng cáo, affiliate, tài trợ).
4. Nêu khoảng cách tới điều kiện kiếm tiền của từng nền tảng, lấy số từ `analytics_overview`. Không bịa số.
5. Khi người dùng đồng ý:
   - `update_profile_direction` (confirm, thành thao tác chờ duyệt);
   - `save_standing_order` để ghi nhịp sản xuất (xem skill `video-lich-san-xuat`).
6. Ghi quyết định vào `notes/journal.md` nếu đang chạy trong workspace operator.

## Không làm

- Không hứa thu nhập. RPM là ước tính.
- Không đề xuất mua view, sub, hay trao đổi sub.
- Không bật tự động hoá hoặc đổi hướng kênh mà không có thao tác chờ duyệt.
- Không đụng dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Báo cáo

Làm theo skill `video-bao-cao-thu-nghiem`: đọc báo cáo cũ và nhận việc trước, lưu báo cáo sau, kể cả khi bị chặn.

- Giả thuyết về ngách hoặc hướng kênh (ví dụ "ngách X với recipe Y đạt RPM cao hơn hiện tại").
- Chỉ số để kiểm: lượt xem 28 ngày, người đăng ký mới, giờ xem, RPM (nếu có), tiến độ điều kiện kiếm tiền.
- Ngày kiểm: sau 28 ngày hoặc sau 6 video theo hướng mới, mốc nào đến sau.

## Nguồn

- Chính sách inauthentic: https://www.markstudios.com/blog/faceless-youtube-channels-2026-what-works-what-gets-demonetized , https://quasa.io/media/inauthentic-is-a-channel-level-risk-not-a-ban-on-every-ai-video
- AI persona: https://www.layer3labs.io/guides/youtube-ai-content-policy
- TikTok: https://benly.ai/learn/tiktok-ads/creator-rewards-program-2026
- Facebook: https://www.shortsync.app/resources/facebook-content-monetization-program-2026
- RPM: https://outlierkit.com/resources/faceless-youtube-channels/
