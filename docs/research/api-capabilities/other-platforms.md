# TikTok, Facebook, Instagram

Ngày kiểm chung: **2026-11-12**.
Thứ tự bên dưới theo yêu cầu.
Các ô `null` không được đổi thành `not possible` hoặc `manual only`.
Một URL không đọc được chỉ là nơi cần kiểm lại, không là bằng chứng tính năng có/không.

## TikTok

| Khả năng | Kết luận tổng | Endpoint / scope / quota / mốc API | Bằng chứng và giới hạn |
|---|---|---|---|
| Đường giữ chân | **`null` — chưa xác minh** | Đều `null` | Display video.query không trả đường retention hoặc CTR thumbnail. Accounts API có insights riêng; hợp đồng chi tiết chưa xác minh. [Nguồn 1](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query), [Nguồn 2](https://business-api.tiktok.com/portal/docs/accounts-api-overview/v1.3) |
| Impressions và CTR thumbnail | **`null` — chưa xác minh** | Đều `null` | Display video.query không trả đường retention hoặc CTR thumbnail. Accounts API có insights riêng; hợp đồng chi tiết chưa xác minh. [Nguồn 1](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query), [Nguồn 2](https://business-api.tiktok.com/portal/docs/accounts-api-overview/v1.3) |
| Tạo/sửa end screen | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh tính năng tương đương và API ngoài Display/Content Posting. Không suy ra nền tảng không có tính năng. [Nguồn 1](https://developers.tiktok.com/docs/en/tiktok-api-scopes?enter_method=left_navigation), [Nguồn 2](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post?enter_method=left_navigation) |
| Tạo/sửa cards | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh tính năng tương đương và API ngoài Display/Content Posting. Không suy ra nền tảng không có tính năng. [Nguồn 1](https://developers.tiktok.com/docs/en/tiktok-api-scopes?enter_method=left_navigation), [Nguồn 2](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post?enter_method=left_navigation) |
| Ghim bình luận | **`null` — chưa xác minh** | Đều `null` | Accounts API đọc được pinned. Chưa xác minh được endpoint/scope để ghim; không kết luận manual only. [Nguồn 1](https://business-api.tiktok.com/portal/docs/get-comments-on-an-owned-video/v1.3), [Nguồn 2](https://business-api.tiktok.com/portal/docs/accounts-api-overview/v1.3) |
| Đọc/đặt vị trí mid-roll | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh tính năng tương đương và API ngoài Display/Content Posting. Không suy ra nền tảng không có tính năng. [Nguồn 1](https://developers.tiktok.com/docs/en/tiktok-api-scopes?enter_method=left_navigation), [Nguồn 2](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post?enter_method=left_navigation) |
| Tạo Test & Compare tiêu đề/thumbnail | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh tính năng tương đương và API ngoài Display/Content Posting. Không suy ra nền tảng không có tính năng. [Nguồn 1](https://developers.tiktok.com/docs/en/tiktok-api-scopes?enter_method=left_navigation), [Nguồn 2](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post?enter_method=left_navigation) |
| Đọc kết quả Test & Compare | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh tính năng tương đương và API ngoài Display/Content Posting. Không suy ra nền tảng không có tính năng. [Nguồn 1](https://developers.tiktok.com/docs/en/tiktok-api-scopes?enter_method=left_navigation), [Nguồn 2](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post?enter_method=left_navigation) |
| Bài cộng đồng / tính năng tương đương | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh tính năng tương đương và API ngoài Display/Content Posting. Không suy ra nền tảng không có tính năng. [Nguồn 1](https://developers.tiktok.com/docs/en/tiktok-api-scopes?enter_method=left_navigation), [Nguồn 2](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post?enter_method=left_navigation) |
| Tạo playlist | **`null` — chưa xác minh** | Đều `null` | Help liệt kê Creator Playlists. Thân trang hướng dẫn trả 503. Chưa xác minh đủ create/add/order và API Accounts. [Nguồn 1](https://developers.tiktok.com/docs/en/tiktok-api-scopes?enter_method=left_navigation), [Nguồn 2](https://support.tiktok.com/en/using-tiktok/creating-videos/creator-playlist) |
| Thêm video vào playlist | **`null` — chưa xác minh** | Đều `null` | Help liệt kê Creator Playlists. Thân trang hướng dẫn trả 503. Chưa xác minh đủ create/add/order và API Accounts. [Nguồn 1](https://developers.tiktok.com/docs/en/tiktok-api-scopes?enter_method=left_navigation), [Nguồn 2](https://support.tiktok.com/en/using-tiktok/creating-videos/creator-playlist) |
| Đổi thứ tự playlist | **`null` — chưa xác minh** | Đều `null` | Help liệt kê Creator Playlists. Thân trang hướng dẫn trả 503. Chưa xác minh đủ create/add/order và API Accounts. [Nguồn 1](https://developers.tiktok.com/docs/en/tiktok-api-scopes?enter_method=left_navigation), [Nguồn 2](https://support.tiktok.com/en/using-tiktok/creating-videos/creator-playlist) |
| Thêm track audio đa ngôn ngữ | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh tính năng tương đương và API ngoài Display/Content Posting. Không suy ra nền tảng không có tính năng. [Nguồn 1](https://developers.tiktok.com/docs/en/tiktok-api-scopes?enter_method=left_navigation), [Nguồn 2](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post?enter_method=left_navigation) |
| Tiêu đề/mô tả theo locale | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh tính năng tương đương và API ngoài Display/Content Posting. Không suy ra nền tảng không có tính năng. [Nguồn 1](https://developers.tiktok.com/docs/en/tiktok-api-scopes?enter_method=left_navigation), [Nguồn 2](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post?enter_method=left_navigation) |
| Đọc trạng thái ghim bình luận | API | GET https://business-api.tiktok.com/open_api/v1.3/business/comment/list/; scope `null`; quota `null`; từ `null` | Accounts API trả trạng thái pinned của bình luận thuộc video sở hữu. [Nguồn 1](https://business-api.tiktok.com/portal/docs/get-comments-on-an-owned-video/v1.3), [Nguồn 2](https://business-api.tiktok.com/portal/docs/accounts-api-overview/v1.3) |

### Những gì đã xác minh

Display API có `POST https://open.tiktokapis.com/v2/video/query/`, scope `video.list`.
Tối đa 20 video ID/lệnh. Các trường được công bố không có retention curve,
impressions thumbnail hoặc CTR thumbnail. Đây là kết luận trong Display API.
Không suy ra Accounts API cũng thiếu. [Schema](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query)

Content Posting có `POST /v2/post/publish/video/init/`, scope `video.publish`.
Giới hạn 6 lệnh/phút/token.
Trường `title` là caption, không phải bản đồ tiêu đề theo locale.
Chọn cover timestamp không phải A/B thumbnail.
Các schema đã kiểm không cho các thao tác yêu cầu ở bảng trên.
Tên scope `video.manage` hiện tồn tại; không tự suy ra hỗ trợ playlist/audio.
[Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post?enter_method=left_navigation), [scopes](https://developers.tiktok.com/docs/en/tiktok-api-scopes?enter_method=left_navigation)

Accounts API là sản phẩm riêng. Có insights, moderation và publishing.
Từ **2026-03-20 00:00 GMT+0**, ứng dụng mới/tăng quyền Accounts phải nộp form xét duyệt.
Đây là ngày đổi quy trình duyệt, không là ngày endpoint ra mắt.
Không gán scope Login Kit cho Accounts API. [Overview](https://business-api.tiktok.com/portal/docs/accounts-api-overview/v1.3)

Tài liệu Accounts xác nhận endpoint đọc comment có `pinned`.
Token lấy qua `/tt_user/oauth2/token/`.
Đọc được trạng thái không chứng minh ghim được.
Tên scope ghi, quota cost, rate limit và ngày mở thao tác ghim đều `null`.
[Get comments](https://business-api.tiktok.com/portal/docs/get-comments-on-an-owned-video/v1.3)

Help có liên kết Playlists. Đường đích `creator-playlist` trả 503.
Trang `/creating-videos/playlists` chỉ hiện khung điều hướng.
Chưa xác minh được điều kiện, thứ tự hay trần playlist hiện tại.
Không dùng snippet từ trang tìm kiếm có nội dung rác làm bằng chứng.
[Điểm vào Help](https://support.tiktok.com/en/using-tiktok/creating-videos/playlists)

### Ranh giới sản phẩm

Quyền OAuth thường không tự cấp quyền Business/Accounts.
Research API không thay thế API vận hành tài khoản thương mại.
Các báo cáo Ads có video views theo 25/50/75/100% không chứng minh đường retention gốc mỗi giây.
Impressions/CTR quảng cáo cũng không là CTR thumbnail organic.
Trong đợt này chưa xác minh hợp đồng Accounts insights đầy đủ.
Không điền tên field, endpoint, rate limit hoặc mốc ra mắt bằng trí nhớ.
[Accounts](https://business-api.tiktok.com/portal/docs/accounts-api-overview/v1.3), [Research FAQ](https://developers.tiktok.com/docs/en/research-api-faq?enter_method=left_navigation), [Ads metrics](https://business-api.tiktok.com/portal/docs/supported-metrics-in-creative-basic-reports/v1.3)

## Facebook

| Khả năng | Kết luận tổng | Endpoint / scope / quota / mốc API | Bằng chứng và giới hạn |
|---|---|---|---|
| Đường giữ chân | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/graph-api/reference/video/video_insights/), [Nguồn 2](https://about.fb.com/news/2023/11/helping-creators-test-content-and-earn-rewards/) |
| Impressions và CTR thumbnail | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/graph-api/reference/video/video_insights/), [Nguồn 2](https://about.fb.com/news/2023/11/helping-creators-test-content-and-earn-rewards/) |
| Tạo/sửa end screen | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/graph-api/reference/video/) |
| Tạo/sửa cards | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/graph-api/reference/video/) |
| Ghim bình luận | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/graph-api/reference/comment/) |
| Đọc/đặt vị trí mid-roll | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/graph-api/reference/video/) |
| Tạo Test & Compare tiêu đề/thumbnail | **`null` — chưa xác minh** | Đều `null` | Meta công bố A/B caption/thumbnail trên mobile và kết quả trong professional dashboard. API điều khiển/đọc kết quả chưa xác minh. [Nguồn 1](https://about.fb.com/news/2023/11/helping-creators-test-content-and-earn-rewards/), [Nguồn 2](https://developers.facebook.com/docs/graph-api/reference/video/) |
| Đọc kết quả Test & Compare | **`null` — chưa xác minh** | Đều `null` | Meta công bố A/B caption/thumbnail trên mobile và kết quả trong professional dashboard. API điều khiển/đọc kết quả chưa xác minh. [Nguồn 1](https://about.fb.com/news/2023/11/helping-creators-test-content-and-earn-rewards/), [Nguồn 2](https://developers.facebook.com/docs/graph-api/reference/video/) |
| Bài cộng đồng / tính năng tương đương | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/pages-api/posts/) |
| Tạo playlist | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/graph-api/reference/page/video_playlists/) |
| Thêm video vào playlist | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/graph-api/reference/page/video_playlists/) |
| Đổi thứ tự playlist | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/graph-api/reference/page/video_playlists/) |
| Thêm track audio đa ngôn ngữ | **`null` — chưa xác minh** | Đều `null` | Meta AI dubbing là tính năng giao diện. Không chứng minh app OAuth tải track audio riêng hoặc điều khiển dubbing được. [Nguồn 1](https://about.fb.com/news/2025/10/discover-reels-around-world-meta-ai-translation/), [Nguồn 2](https://developers.facebook.com/docs/graph-api/reference/video/) |
| Tiêu đề/mô tả theo locale | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/graph-api/reference/video/) |

Các trang Video, Video Insights, Comment và Pages Posts trả **429**.
Trang Page video_playlists không đọc được.
Do đó chưa xác nhận endpoint/scope, phiên bản Graph, quota hoặc quyền truy cập hiện hành.
Không dùng các tên field lịch sử làm hợp đồng hiện tại.
Cũng chưa xác minh khác biệt video thường, Reels, Page và professional profile.
[Video](https://developers.facebook.com/docs/graph-api/reference/video/), [Insights](https://developers.facebook.com/docs/graph-api/reference/video/video_insights/), [Playlist](https://developers.facebook.com/docs/graph-api/reference/page/video_playlists/), [Comment](https://developers.facebook.com/docs/graph-api/reference/comment/), [Posts](https://developers.facebook.com/docs/pages-api/posts/)

Có bằng chứng giao diện độc lập:
ngày **2023-11-02**, Meta công bố A/B caption/thumbnail Reels trên mobile,
tối đa 4 phương án. Kết quả nằm trong professional dashboard.
Cùng bài công bố có retention graph.
Đây là mốc công bố UI. Bài đã hơn 12 tháng.
Không chứng minh app OAuth tạo test hoặc đọc kết quả được vào hôm nay.
Vì tài liệu API không đọc được, kết luận API tổng vẫn `null`.
[Thông báo chính thức](https://about.fb.com/news/2023/11/helping-creators-test-content-and-earn-rewards/)

Meta AI dịch/lồng tiếng Reels là tính năng khác tải audio track tự có.
Bài công bố 2025-10-09, cập nhật 2026-07-14, mô tả rollout nhiều ngôn ngữ.
Nó không công bố hợp đồng upload track bằng OAuth.
Vì vậy cả API multi-audio và ngày API đều `null`.
Không dùng lịch rollout để xác nhận tài khoản cụ thể có quyền.
[Thông báo chính thức](https://about.fb.com/news/2025/10/discover-reels-around-world-meta-ai-translation/)

## Instagram

| Khả năng | Kết luận tổng | Endpoint / scope / quota / mốc API | Bằng chứng và giới hạn |
|---|---|---|---|
| Đường giữ chân | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/instagram-platform/insights/), [Nguồn 2](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api) |
| Impressions và CTR thumbnail | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/instagram-platform/insights/), [Nguồn 2](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api) |
| Tạo/sửa end screen | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api), [Nguồn 2](https://developers.facebook.com/docs/instagram-platform/content-publishing/) |
| Tạo/sửa cards | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api), [Nguồn 2](https://developers.facebook.com/docs/instagram-platform/content-publishing/) |
| Ghim bình luận | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/instagram-platform/content-publishing/), [Nguồn 2](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api) |
| Đọc/đặt vị trí mid-roll | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api), [Nguồn 2](https://developers.facebook.com/docs/instagram-platform/content-publishing/) |
| Tạo Test & Compare tiêu đề/thumbnail | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/instagram-platform/content-publishing/), [Nguồn 2](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api) |
| Đọc kết quả Test & Compare | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/instagram-platform/content-publishing/), [Nguồn 2](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api) |
| Bài cộng đồng / tính năng tương đương | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/instagram-platform/content-publishing/), [Nguồn 2](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api) |
| Tạo playlist | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/instagram-platform/content-publishing/), [Nguồn 2](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api) |
| Thêm video vào playlist | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/instagram-platform/content-publishing/), [Nguồn 2](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api) |
| Đổi thứ tự playlist | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://developers.facebook.com/docs/instagram-platform/content-publishing/), [Nguồn 2](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api) |
| Thêm track audio đa ngôn ngữ | **`null` — chưa xác minh** | Đều `null` | Meta AI dubbing là tính năng giao diện. Không chứng minh app OAuth tải track audio riêng hoặc điều khiển dubbing được. [Nguồn 1](https://about.fb.com/news/2025/10/discover-reels-around-world-meta-ai-translation/), [Nguồn 2](https://developers.facebook.com/docs/instagram-platform/content-publishing/) |
| Tiêu đề/mô tả theo locale | **`null` — chưa xác minh** | Đều `null` | Chưa xác minh hợp đồng hiện hành. Tài liệu developer trả 429; không kết luận API/manual/not possible. [Nguồn 1](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api), [Nguồn 2](https://developers.facebook.com/docs/instagram-platform/content-publishing/) |

Meta có workspace Postman chính thức.
Collection xác nhận Instagram Professional gồm Business và Creator.
Tài liệu Facebook Login yêu cầu Page liên kết; không hỗ trợ consumer account.
Có publishing/comment/insights nói chung.
Nội dung đó không xác nhận riêng các khả năng ở bảng.
[Meta team](https://www.postman.com/meta/), [collection](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api), [docs do Meta phát hành](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-b9dac9f7-5415-4659-bcfd-795298a07e91)

Các trang Insights và Content Publishing trả **429**.
Trang documentation Postman tải trực tiếp chỉ hiện vỏ; bản được công cụ tìm kiếm lập chỉ mục đọc được phần overview.
Không coi collection mẫu là inventory đầy đủ.
Vì vậy không dùng nó chứng minh một chức năng hoàn toàn không tồn tại.
Chưa điền `instagram_business_manage_insights` hay scope Facebook Login vào từng capability khi chưa kiểm đúng hợp đồng.
[Insights](https://developers.facebook.com/docs/instagram-platform/insights/), [publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/)

Meta AI dubbing có UI không chứng minh upload nhiều track tùy ý được.
Bài cộng đồng YouTube không đồng nghĩa với ảnh/Feed caption hay broadcast channel Instagram.
Trial Reels cũng không tự đồng nghĩa với A/B title/thumbnail.
Những phép tương đương này chưa có hợp đồng được xác minh trong đợt kiểm.
[Meta dubbing](https://about.fb.com/news/2025/10/discover-reels-around-world-meta-ai-translation/), [overview](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api)

## Danh sách còn cần kiểm

Đây là giới hạn bằng chứng, không phải danh sách việc cần đăng nhập trong task này.

1. TikTok Accounts: đọc đúng tài liệu insights và thao tác pin. Xác nhận scope theo sản phẩm, loại tài khoản, quota và mốc thay đổi.
2. TikTok Playlists: đọc thân Help và inventory Accounts trước khi chốt create/add/order.
3. Facebook: kiểm versioned reference Video Insights, Video/Comment/Page playlist. Xác minh khả năng áp dụng cho Reels.
4. Instagram: kiểm riêng Instagram Login và Facebook Login. Tách views/reach/watch-time tổng khỏi retention theo thời điểm và thumbnail CTR.
5. Meta: tìm endpoint native experiment và results, nếu có. UI announcement không đủ để kết luận API.
6. Cả bốn: ngày launch không được công bố rõ thì giữ `apiSince=null`. Ngày footer cập nhật không phải ngày launch.

Không gọi tài khoản, không kiểm app review và không xác minh rollout theo tài khoản/quốc gia.

