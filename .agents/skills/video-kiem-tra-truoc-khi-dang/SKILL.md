---
name: video-kiem-tra-truoc-khi-dang
description: >-
  Kiểm tra một video đã render trong app Video Agent trước khi đăng: rập khuôn,
  nội dung tái sử dụng, nhãn AI, bản quyền ảnh, watermark, độ dài theo nền tảng.
  Dùng trước mỗi lần đăng, khi người dùng hỏi video có bị mất kiếm tiền không,
  hay khi kênh bị từ chối kiếm tiền.
operator: true
area: kenh
triggers:
  - kiểm tra trước khi đăng
  - kiem tra truoc khi dang
  - rập khuôn
  - reused
  - nhãn ai
  - mất kiếm tiền
  - bị từ chối kiếm tiền
antiTriggers:
  - xoá
  - xoa
tools:
  - get_project
  - search_profile_context
  - list_publications
  - request_user_action
  - publish_project
risk: confirm
---

# Kiểm tra trước khi đăng

Một video rập khuôn có thể làm **cả kênh** mất kiếm tiền. Chạy danh sách này trước mỗi lần đăng.

## Danh sách kiểm tra

1. **Không trùng video cũ.** `search_profile_context` với chủ đề và câu mở. Nếu ý chính, câu mở và bố cục gần giống một video đã đăng → dừng, báo người dùng.
2. **Không rập khuôn.** So với 5 video gần nhất (`list_publications`, `get_project`): nếu cùng recipe, cùng nhạc, cùng giọng, cùng bố cục cảnh, và kịch bản chỉ đổi vài chữ → báo nguy cơ "inauthentic content".
3. **Có giá trị riêng.** Có số liệu có nguồn, góc nhìn hoặc kết luận riêng.
4. **Không phải nội dung tái sử dụng.** Không có đoạn video hay clip của người khác mà không bình luận thật.
5. **Ảnh và B-roll.**
   - Ảnh có bản quyền (manga, anime, phim, game, ảnh báo chí): xem mục "Ảnh có bản quyền trong video bình luận" bên dưới.
   - Không ảnh có watermark hay logo của trang khác. Gặp ảnh như vậy thì **bỏ ảnh**, không xoá watermark.
   - Ảnh Pexels/Pixabay có người hoặc thương hiệu nhận ra được thì không dùng để gợi ý họ ủng hộ điều gì.
   - Không ảnh nào dùng cho hai cảnh; không ảnh đời thực lạc đề (xem `video-giu-chan-nguoi-xem`).
6. **Nhãn AI.** Có cảnh trông như người, nơi chốn hay sự kiện thật mà do AI tạo hoặc sửa → người dùng phải bật "Altered or synthetic content" trong YouTube Studio. Nếu chưa có cách bật trong app, tạo `request_user_action` nhắc người dùng. Giọng TTS, hoạt hình, đồ họa rõ ràng là không thật thì không bắt buộc.
7. **Không nhân vật AI giả chuyên gia** đưa lời khuyên y tế, tài chính, pháp lý, chính trị.
8. **Độ dài theo nền tảng.**
   - TikTok: dài hơn 1 phút thì mới được trả tiền.
   - Shorts: dưới 3 phút; không có watermark của nền tảng khác.
9. **Tiêu đề và thumbnail** khớp nội dung, không giật tít sai.
10. **Mô tả** ghi nguồn số liệu và nguồn ảnh khi giấy phép yêu cầu.

## Ảnh có bản quyền trong video bình luận

Kênh review manga, anime, phim, game cần hình của chính tác phẩm. Cách dùng có thể chấp nhận được là **bình luận thật**, không phải che dấu nguồn.

**Điều kiện để dùng** (tất cả đều phải đúng):
- Hồ sơ đã bật `allowCopyrightedStills: commentary`. Chỉ người dùng bật được; agent không đổi cài đặt này.
- Giọng đọc phân tích, bình luận, so sánh suốt video, không kể lại nguyên cốt truyện. Mỗi ảnh có bản quyền đi cùng câu đang nói về đúng ảnh đó.
- Mỗi lần hiện ảnh có bản quyền tối đa khoảng 4 giây (app giới hạn sẵn ở chế độ này). Không dùng chuỗi trang manga liên tiếp hay đoạn phim dài.
- Ưu tiên ảnh quảng bá chính thức (key visual, ảnh báo chí của studio hay nhà xuất bản) hơn ảnh cắt từ bản scan lậu.
- Mô tả video ghi nguồn: tên tác phẩm, tác giả, studio.

**Không làm:**
- Không xoá watermark, logo hay chữ ký trên ảnh của người khác (inpaint, delogo). Đó là gỡ thông tin quản lý bản quyền, bị cấm riêng ở nhiều nước, và còn làm lỗi nặng hơn khi bị khiếu nại. Ảnh có watermark thì bỏ.
- Không cắt, lật, đổi màu ảnh **để né** hệ thống nhận diện như Content ID. Việc đó không biến cách dùng thành hợp lệ. Cắt ảnh cho vừa khung hình (công cụ cắt của app) thì được, vì đó là bố cục, không phải che nguồn.
- Không hứa với người dùng là "fair use thì an toàn". Fair use là lập luận pháp lý của Mỹ, xét từng trường hợp; nước khác có luật khác. Kênh vẫn có thể bị khiếu nại, mất tiền của video, hoặc bị gậy.

**Khi kiểm tra:**
- Đếm số ảnh có bản quyền và tổng số giây trên màn hình. Ghi vào báo cáo.
- Nếu đoạn nào ảnh có bản quyền hiện mà giọng đọc không bình luận về nó → "Cần sửa".
- Nhắc người dùng: nếu bị khiếu nại, chỉ người dùng quyết định có phản đối khiếu nại hay không. Agent không gửi phản đối.

## Các bước

1. `get_project` để có kịch bản, cảnh, ảnh đã chọn, bản render.
2. Chạy danh sách trên. Ghi mỗi mục: Đạt / Cần sửa / Chặn, kèm lý do ngắn.
3. Có mục "Chặn" → không gọi `publish_project`; báo người dùng việc cần sửa.
4. Tất cả đạt → gọi `publish_project` (thành thao tác chờ duyệt nếu là public). Không nói là đã đăng khi thao tác còn chờ.

## Khi kênh bị từ chối kiếm tiền

- Đọc 20 video gần nhất, tìm điểm chung rập khuôn (cùng template, cùng câu mở, cùng nhạc).
- Đề xuất: dừng đăng loại đó, thêm phân tích riêng vào video mới, đa dạng recipe và bố cục, ẩn hoặc gỡ video quá giống nhau (người dùng tự làm).
- Nhắc: YouTube cho nộp lại sau một thời gian chờ. Kiểm lại thời gian trên trang chính thức.

## Không làm

- Không tự bật hay tắt nhãn AI thay người dùng trên nền tảng.
- Không đăng khi còn mục "Chặn".
- Không đụng dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Báo cáo

Làm theo skill `video-bao-cao-thu-nghiem`: đọc báo cáo cũ và nhận việc trước, lưu báo cáo sau, kể cả khi bị chặn.

- Ghi kết quả từng mục (Đạt / Cần sửa / Chặn). Giả thuyết: "video qua danh sách không bị cảnh báo chính sách hay mất kiếm tiền".
- Chỉ số để kiểm: cảnh báo chính sách, khiếu nại bản quyền, trạng thái kiếm tiền của kênh, nhãn AI đã bật hay chưa.
- Ngày kiểm: 28 ngày sau khi đăng.

## Nguồn

- Reused content: https://vidiq.com/blog/post/youtube-reused-content-policy-guide/
- Shorts ưu tiên nội dung gốc: https://outlierkit.com/resources/youtube-shorts-original-content-update/
- Nhãn AI: https://air.io/en/youtube-hacks/youtube-ai-disclosure-in-2026-label-it-yourself-or-youtube-will , https://www.techwyse.com/news/platform-updates/youtube-automatic-ai-labels-disclosure-may-2026
- Inauthentic: https://nofacetube.com/guides/youtube-inauthentic-content-policy/
