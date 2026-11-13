---
name: video-giu-chan-nguoi-xem
description: >-
  Xem lại kịch bản, cảnh và tiêu đề của một dự án trong app Video Agent để giữ
  người xem: mở đầu 30 giây, nhắc lại móc câu, đổi hình đủ nhanh, tiêu đề và
  thumbnail khớp lời hứa. Dùng khi người dùng nhờ sửa kịch bản, hỏi vì sao video
  ít người xem hết, hay trước khi duyệt kịch bản.
operator: true
area: kenh
triggers:
  - giữ chân
  - giu chan
  - retention
  - mở đầu
  - hook
  - sửa kịch bản
  - sua kich ban
  - tiêu đề
  - ảnh lạc đề
  - anh lac de
  - ảnh trùng
antiTriggers:
  - đăng ngay
  - duyệt cổng
  - approve gate
tools:
  - get_project
  - get_pipeline
  - profile_insights
  - video_metrics
  - apply_review_proposal
risk: read
---

# Giữ chân người xem

Agent đọc và **đề xuất** sửa. Người dùng duyệt các cổng (gate). Agent không tự duyệt cổng.

## Quy tắc (từ nghiên cứu 2026, đa số là kinh nghiệm, không phải số chính thức)

- **30 giây đầu** là chỗ rơi nhiều người nhất. YouTube xếp video vào nhóm mở đầu tốt khi còn từ 50% người xem sau 30 giây.
- **Mở bằng kết quả**, không giới thiệu kênh, không "trong video hôm nay...". Trả phần đầu của lời hứa trong tiêu đề trước giây thứ 30.
- **Vòng mở**: đặt một câu hỏi ở đầu, trả lời ở cuối.
- **Nhắc lại móc câu** mỗi 60–90 giây trong video dài ("nhưng điều bất ngờ nhất là...").
- **Đổi hình mỗi 5–10 giây** với video không lộ mặt. Ảnh đứng yên 30 giây làm người xem bỏ đi, dù lời đọc hay.
- **Shorts**: câu đầu tiên là móc câu; độ dài 20–60 giây; cảnh cuối nối được về cảnh đầu để xem lại.
- **TikTok**: muốn được trả tiền thì bản đăng phải dài hơn 1 phút.
- **Tiêu đề và thumbnail** hứa đúng điều video trả. Hứa quá thì người xem bỏ sớm, retention tụt.

## Đúng ảnh trước, đổi ảnh sau

Đổi hình nhanh mà sai hình thì còn tệ hơn ảnh đứng yên: người xem thấy ngay video "ghép bừa". Mỗi ảnh phải cho thấy đúng thứ câu thoại đang nói.

- **Mỗi cảnh, hỏi một câu:** ảnh này có cho thấy đúng chủ thể của câu thoại không (nhân vật, nơi chốn, sự kiện, số liệu)? Chỉ trùng một từ ("Hawk", "band", "sword") thì không tính là đúng.
- **Chủ đề hư cấu** (manga, anime, game, phim, nhân vật tưởng tượng): kho ảnh mở như Wikimedia hay Openverse gần như chỉ có ảnh đời thực lạc đề (cosplay, hội chợ, tượng, diễu hành). Với các cảnh đó:
  - tìm lại bằng web search (Brave) qua `research_scene_visuals` khi app có tool này;
  - chỉ dùng artwork hay cảnh phim chính thức khi hồ sơ bật chế độ bình luận (xem `video-kiem-tra-truoc-khi-dang`, mục bản quyền);
  - nếu không, dùng ảnh minh hoạ không vi phạm: chữ lớn, sơ đồ, biểu tượng, ảnh do người dùng tải lên.
- **Loại ngay** ảnh đời thực khi cảnh nói về nhân vật hư cấu: cosplay, convention, festival, parade, marching band, statue, monument, costume, fan art chất lượng thấp. Chỉ giữ khi chính câu thoại nói về những thứ đó.
- **Không trùng ảnh:** một ảnh chỉ dùng cho một cảnh trong cùng video. Thiếu ảnh thì tìm thêm, tách cảnh ít hơn, hoặc để trống chờ người dùng chọn. Không lấy lại ảnh cảnh trước cho đủ số.
- **Thiếu ảnh đúng thì báo**, không chọn ảnh "gần gần" cho đủ nhịp 5–10 giây. Cảnh dài hơn có ảnh đúng và chuyển động nhẹ vẫn tốt hơn ba ảnh sai.

## Chuyển động và âm thanh

App đã có các thứ này; agent kiểm tra là đã bật, không cần làm thêm:

- **Ảnh tĩnh có chuyển động** (zoom chậm hoặc lia nhẹ, kiểu Ken Burns). Không cảnh ảnh tĩnh nào đứng yên hoàn toàn.
- **Nhạc nền tự giảm khi có giọng** (ducking) và về lại ở khoảng nghỉ.
- **SFX** (whoosh, pop) chỉ ở các chuyển đoạn quan trọng, không ở mọi cảnh.
- **Phụ đề có màu nhấn** theo cụm từ, không phải khối chữ tĩnh dài.

Những thứ này giúp giữ chân người xem. Chúng **không** tự làm video hết "rập khuôn": chính sách inauthentic của YouTube nhắm vào video sản xuất hàng loạt, na ná nhau, không có giá trị riêng. Muốn an toàn phải có nội dung và góc nhìn khác nhau giữa các video (xem `video-kiem-tra-truoc-khi-dang`).

## Các bước

1. Đọc dự án: `get_project`, `get_pipeline` (đang ở cổng nào).
2. Nếu hồ sơ có số liệu cũ: `profile_insights` và `video_metrics` của video tương tự để biết người xem hay bỏ ở đâu.
3. Chấm kịch bản theo bảng:

| Mục | Đạt khi |
|---|---|
| Câu mở | Nêu kết quả hoặc câu hỏi mạnh trong 1–2 câu |
| 30 giây đầu | Đã trả một phần lời hứa của tiêu đề |
| Nhắc móc câu | Có ít nhất một lần mỗi 60–90 giây |
| Đổi hình | Không cảnh nào dài hơn 10 giây chỉ với một ảnh tĩnh |
| Đúng ảnh | Mọi ảnh cho thấy đúng chủ thể câu thoại; không ảnh đời thực lạc đề cho chủ đề hư cấu |
| Không trùng | Không ảnh nào dùng cho hai cảnh |
| Chuyển động | Ảnh tĩnh có zoom hoặc lia; nhạc giảm khi có giọng; phụ đề có màu nhấn |
| Giá trị riêng | Có số liệu có nguồn hoặc góc nhìn riêng |
| Kết | Trả vòng mở; mời xem video liên quan, không chỉ "nhớ đăng ký" |

4. Viết đề xuất sửa cụ thể: câu cũ → câu mới, cảnh nào tách đôi, cảnh nào cần thêm hình.
5. Đưa đề xuất cho người dùng. Nếu app có đề xuất review (`apply_review_proposal`), chỉ dùng khi người dùng bảo áp dụng.
6. Với cảnh dài: đề xuất tách cảnh hoặc thêm hình; không tự đổi ảnh khi người dùng chưa đồng ý.
7. Với ảnh sai hoặc trùng: liệt kê cảnh, ảnh hiện tại và lý do (sai chủ thể, ảnh đời thực lạc đề, trùng cảnh nào). Đề xuất tìm lại bằng `research_scene_visuals` nếu app có, hoặc nhờ người dùng chọn ảnh.

## Không làm

- Không gọi `approve_gate`. Cổng là việc của người dùng.
- Không viết tiêu đề giật tít sai sự thật.
- Không đụng dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Báo cáo

Làm theo skill `video-bao-cao-thu-nghiem`: đọc báo cáo cũ và nhận việc trước, lưu báo cáo sau, kể cả khi bị chặn.

- Giả thuyết cho từng sửa đổi kịch bản (ví dụ "câu mở mới giữ được trên 50% người xem sau 30 giây").
- Chỉ số để kiểm: còn xem sau 30 giây, thời lượng xem trung bình, với Shorts thêm tỉ lệ xem thay vì lướt.
- Ngày kiểm: 48 giờ và 7 ngày sau khi đăng.

## Nguồn

- https://prepublish.ai/guides/first-30-seconds
- https://socialrails.com/blog/youtube-audience-retention-complete-guide
- https://outlierkit.com/resources/youtube-hooks-and-retention/
- https://vidiq.com/blog/post/youtube-shorts-algorithm/
