# YouTube: app OAuth làm được gì?

Kiểm ngày **2026-11-12**. Phạm vi: API công khai cho chủ kênh.
Không giả định có quyền CMS/Content ID. `null` là chưa xác minh.
Scope và quota của việc không có endpoint để `null`, không ghi 0.

## Ma trận

| Khả năng | Kết luận | Endpoint / scope | Quota mỗi lần | Giới hạn | Có từ khi nào | Nguồn |
|---|---|---|---|---|---|---|
| Đường retention | **API** | `GET youtubeanalytics.googleapis.com/v2/reports`; A + R | `null` | 100 khoảng theo tỷ lệ. Một video/truy vấn | API 2014-07-16; thêm ba metric phân đoạn 2024-05-06 | [Dimension](https://developers.google.com/youtube/analytics/dimensions), [report](https://developers.google.com/youtube/analytics/channel_reports?authuser=2), [lịch sử](https://developers.google.com/youtube/analytics/revision_history) |
| Retention gốc mỗi giây | **not possible** với hợp đồng trên | Không có chế độ lấy mẫu 1 giây | `null` | Đổi trục sang giây không tăng độ phân giải | `null` | [100 điểm](https://developers.google.com/youtube/analytics/dimensions) |
| Impressions và CTR thumbnail | **API** | Reporting `reportTypes.list → jobs.create → jobs.reports.list → downloadUrl`; A | `null` | `channel_reach_basic_a1`, `channel_reach_combined_a1`; dữ liệu ngày | API 2026-01-15 | [Changelog](https://developers.google.com/youtube/analytics/revision_history), [reach](https://developers.google.com/youtube/reporting/v1/reports/channel_reports), [metric](https://developers.google.com/youtube/reporting/v1/reports/metrics) |
| Tạo/sửa end screen | **manual only**¹ | Studio Editor; endpoint/scope `null` | `null` | Video ≥25 giây. Trong 5–20 giây cuối. Tối đa 4 phần tử ở 16:9. Không Made for Kids | API/UI: `null` | [Help](https://support.google.com/youtube/answer/6388789), [inventory](https://developers.google.com/youtube/data/reference/rest) |
| Đọc hiệu quả end screen | **API** | Reporting job `channel_end_screens_a2`; A | `null` | impressions, clicks, click rate theo phần tử. Không trả hợp đồng chỉnh cấu hình link/vị trí | API: `null` | [Report](https://developers.google.com/youtube/reporting/v1/reports/channel_reports), [job](https://developers.google.com/youtube/reporting/v1/reference/rest/v1/jobs/create) |
| Tạo/sửa cards | **manual only**¹ | Studio Editor; endpoint/scope `null` | `null` | Tối đa 5 cards. Không Made for Kids | API/UI: `null` | [Help](https://support.google.com/youtube/answer/6140493), [inventory](https://developers.google.com/youtube/data/reference/rest) |
| Đọc hiệu quả cards | **API** | Analytics `reports.query`, A + R; hoặc bulk `channel_cards_a1`, A | `null` | `cardImpressions`, `cardClicks`, `cardClickRate`; bulk có `card_id` | API: `null` | [Analytics](https://developers.google.com/youtube/analytics/channel_reports?authuser=2), [bulk](https://developers.google.com/youtube/reporting/v1/reports/channel_reports) |
| Ghim bình luận | **manual only**¹ | Giao diện YouTube; endpoint/scope `null` | `null` | Advanced features. Sửa nội dung và moderation không phải ghim | API/UI: `null` | [Schema/methods](https://developers.google.com/youtube/data/reference/rest/v3/comments), [Help](https://support.google.com/youtube/answer/6000964) |
| Đọc/đặt vị trí mid-roll VOD | **manual only**¹ | Studio Monetization → Manage ad slots; endpoint/scope `null` | `null` | Bật kiếm tiền, từ 8 phút. Slot không bảo đảm được phát quảng cáo | API/UI: `null` | [Help](https://support.google.com/youtube/answer/6175006), [video update](https://developers.google.com/youtube/data/reference/rest/v3/videos/update) |
| Tạo Test & Compare title/thumbnail | **manual only**¹ | Studio desktop; endpoint/scope `null` | `null` | Tối đa 3 phương án. Advanced features. Không Shorts, private, Made for Kids, giới hạn tuổi | API: `null`; công bố title UI 2025-09-16 | [Help](https://support.google.com/youtube/answer/16391400?hl=en), [công bố](https://blog.youtube/news-and-events/youtube-studio-made-on-youtube-2025/), [inventory](https://developers.google.com/youtube/data/reference/rest) |
| Đọc kết quả Test & Compare | **manual only**¹ | Studio; endpoint/scope `null` | `null` | Không có experiment/variant breakdown trong report đã kiểm | API/UI kết quả: `null` | [Help](https://support.google.com/youtube/answer/16391400?hl=en), [report inventory](https://developers.google.com/youtube/reporting/v1/reports/channel_reports) |
| Tạo/đọc Community Posts | **manual only**¹ | YouTube Create post; endpoint/scope `null` | `null` | Có giới hạn đăng/24 giờ; con số `null` | API/UI: `null` | [Help](https://support.google.com/youtube/answer/7124474), [inventory](https://developers.google.com/youtube/data/reference/rest) |
| Tạo playlist | **API** | `POST www.googleapis.com/youtube/v3/playlists`; W | 50 units | Bắt buộc title. Trần playlist `null` | API: `null` | [insert](https://developers.google.com/youtube/data/reference/rest/v3/playlists/insert) |
| Thêm video vào playlist | **API** | `POST www.googleapis.com/youtube/v3/playlistItems`; W | 50 units | Một item/lệnh. Không chèn vào uploads playlist. Trần item `null` | API: `null` | [insert](https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/insert) |
| Đổi thứ tự playlist | **API**, có điều kiện | `PUT www.googleapis.com/youtube/v3/playlistItems`, `snippet.position`; W | 50 units | Playlist dùng Manual ordering. Cần playlistItem ID và snippet hợp lệ | API: `null` | [update](https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/update), [manualSortRequired](https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/insert) |
| Thêm multi-language audio | **manual only**¹ | Studio Languages → Dub; endpoint/scope `null` | `null` | Advanced features. Audio gần bằng thời lượng video. Xóa auto dub cùng ngôn ngữ trước | API: `null`; mở rộng UI 2023-02-23 | [Help](https://support.google.com/youtube/answer/13338784?hl=en), [công bố](https://blog.youtube/news-and-events/multi-language-audio-mrbeast-interview/), [inventory](https://developers.google.com/youtube/data/reference/rest) |
| Tiêu đề/mô tả theo locale | **API** | `PUT /youtube/v3/videos?part=snippet,localizations`; W. Đọc `videos.list` | Ghi 50; đọc 1 unit | `defaultLanguage` + `localizations.<lang>`. Giữ bản dịch cũ | API 2015-11-19 | [update](https://developers.google.com/youtube/data/reference/rest/v3/videos/update), [lịch sử](https://developers.google.com/youtube/data/revision_history), [quota](https://developers.google.com/youtube/data/determine_quota_cost) |

¹ Suy luận từ Help có thao tác giao diện và inventory API không có thao tác tương ứng.
Đó là kết luận cho API công khai đã kiểm.
Không tuyên bố về API nội bộ hoặc hợp đồng đối tác.
Knowledge có evidence `inference` cho các kết luận này.

## Scope và quota

- A: `https://www.googleapis.com/auth/yt-analytics.readonly`.
- R: `https://www.googleapis.com/auth/youtube.readonly`.
- W: `https://www.googleapis.com/auth/youtube.force-ssl`. Các lệnh ghi trên cũng chấp nhận `https://www.googleapis.com/auth/youtube`.
- Monetary: `https://www.googleapis.com/auth/yt-analytics-monetary.readonly`. Chỉ cần khi lấy số liệu tiền phù hợp; không cần cho reach.

Trang `reports.query` hiện có thông báo yêu cầu R, ngoài bảng scope Analytics.
Báo cáo ghi cả A và R. Chưa kiểm token thật.
OAuth chỉ cho dữ liệu của chủ kênh đã cấp quyền. [Query](https://developers.google.com/youtube/analytics/reference/reports/query), [Reporting authorization](https://developers.google.com/youtube/reporting/v1/reference/rest/v1/jobs/create)

Bảng quota hiện ghi 10.000 units/ngày cho nhóm endpoint Data API còn lại.
Playlist và metadata dùng nhóm này. Reset nửa đêm Pacific Time.
Không lấy units Data API áp cho Analytics/Reporting.
Chi phí số của mỗi query Analytics và mỗi bước Reporting chưa xác minh: `null`.
Quota project cụ thể cũng `null`. [Quota](https://developers.google.com/youtube/data/determine_quota_cost), [khác biệt hai API](https://developers.google.com/youtube/reporting/)

## Retention: giữ dữ liệu gốc

Dùng `ids=channel==MINE`, `startDate`, `endDate`, `filters=video==VIDEO_ID`,
`dimensions=elapsedVideoTimeRatio`.
Metric: `audienceWatchRatio`, `relativeRetentionPerformance`.
Có thêm `startedWatching`, `stoppedWatching`, `totalSegmentImpressions`.
Report không cho danh sách nhiều video. Không tự thêm dimension `day`.
Muốn so cửa sổ thì truy vấn từng cửa sổ. [Hợp đồng report](https://developers.google.com/youtube/analytics/channel_reports?authuser=2)

Đổi tọa độ bằng tỷ lệ × thời lượng.
Ví dụ suy ra: video 600 giây có khoảng 6 giây.
Nội suy chỉ để hiển thị và phải gắn nhãn.
`audienceWatchRatio` có thể >1 do xem lại.
`relativeRetentionPerformance` là mức so sánh trong [0,1], không phải tỷ lệ người còn xem. [Dimensions](https://developers.google.com/youtube/analytics/dimensions), [metrics](https://developers.google.com/youtube/analytics/metrics)

Ngưỡng tối thiểu cụ thể: `null`.
Thiếu dữ liệu không có nghĩa là retention bằng 0.
Chưa gọi tài khoản nên không bảo đảm mọi video có đủ mẫu.
Ngày cuối có thể bị cắt theo tiến độ xử lý dữ liệu. [Query](https://developers.google.com/youtube/analytics/reference/reports/query), [data model](https://developers.google.com/youtube/analytics/data_model)

## Reach và bulk

Base URL: `https://youtubereporting.googleapis.com/v1`.
Liệt kê report types trước. Tạo job cho loại được cấp.
Sau đó lấy `jobs/{jobId}/reports` và tải CSV bằng `downloadUrl`.
Các report reach trả `video_thumbnail_impressions` và `video_thumbnail_impressions_ctr`.
Đây là thumbnail exposure, không phải `adImpressions`.
Cũng không phải card impressions hay `totalSegmentImpressions`. [Report](https://developers.google.com/youtube/reporting/v1/reports/channel_reports), [metrics](https://developers.google.com/youtube/reporting/v1/reports/metrics)

Job đầu có report trong 24 giờ theo tài liệu.
File thường tồn tại 60 ngày; file historical 30 ngày.
Có ngày chỉ có header. Không coi là số liệu realtime.
Lưu report ID và `createTime`; backfill mới thay bản cũ cùng khoảng.
[Quy trình](https://developers.google.com/youtube/reporting/v1/reports/), [job](https://developers.google.com/youtube/reporting/v1/reference/rest/v1/jobs/create)

Khi gộp cửa sổ, cần trọng số impressions cho CTR.
Không lấy trung bình đơn giản và không lấy views/impressions để thay metric gốc.
Đây là suy luận thống kê từ định nghĩa CTR.
Giữ đơn vị gốc, tránh nhân 100 lần thứ hai. [Định nghĩa](https://developers.google.com/youtube/reporting/v1/reports/metrics)

## Các nhầm lẫn cần tránh

Đổi title bằng `videos.update` không tạo native A/B.
Luân phiên title/thumbnail theo thời gian không tái tạo randomization của Studio.
Không suy kết quả từng biến thể từ CTR tổng.
Sửa title/thumbnail đang thử có thể dừng native test. [A/B](https://support.google.com/youtube/answer/16391400?hl=en)

`captions.insert` tải phụ đề, không tải track audio.
`defaultAudioLanguage` chỉ mô tả ngôn ngữ.
Một bản lồng tiếng đăng thành video mới khác nhiều track trên cùng video.
[Audio](https://support.google.com/youtube/answer/13338784?hl=en), [inventory](https://developers.google.com/youtube/data/reference/rest)

`activities.list` không là API Community Posts.
Cuepoint của livestream không chứng minh quyền đặt mid-roll trên VOD.
Quyền đọc chỉ số cards/end screens không cấp quyền chỉnh chúng.
[Inventory](https://developers.google.com/youtube/data/reference/rest), [video fields](https://developers.google.com/youtube/data/reference/rest/v3/videos/update), [bulk](https://developers.google.com/youtube/reporting/v1/reports/channel_reports)

