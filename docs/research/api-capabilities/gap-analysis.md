# Gap với ROADMAP

Đã đọc [docs/ROADMAP.md](../../ROADMAP.md) ngày **2026-11-12**. Không sửa roadmap.
Bảng này là đề xuất phạm vi nghiệm thu. Không xác nhận các task đã triển khai.
`—` là không có phụ thuộc trực tiếp trong bốn task.
Kết luận nền tảng dùng [YouTube](youtube.md), [TikTok/Meta](other-platforms.md) và [knowledge](knowledge.json).

| Khả năng | TASK-087: snapshot/retention | TASK-098b: series | TASK-104: độ dài/điểm chèn | TASK-092b: lab |
|---|---|---|---|---|
| Retention | Lưu 100 khoảng gốc và thời lượng. Giữ tỷ lệ + biên thời gian. Không hứa một mẫu gốc mỗi giây. Meta/TikTok để thiếu dữ liệu đến khi xác minh | Đo giữ chân từng tập, không suy ra ai xem tiếp | Dùng khoảng tụt và biên cảnh để gợi ý. Độ phân giải 6 giây không xác định chính xác giây tụt | Lưu cửa sổ đo và độ phân giải. Thiếu mẫu thì chưa kết luận |
| Impressions/CTR thumbnail | YouTube dùng Reporting reach từ 2026-01-15. Import CSV có backfill; trữ ngày để ghép cửa sổ. Không thay bằng ad impressions | CTR từng tập chỉ là hiệu quả đóng gói, không phải tỷ lệ xem tập kế | Có thể dùng để kiểm biến độ dài nhưng không thay RPM | Có baseline/window. CTR gộp cần trọng số impressions. Không suy kết quả native A/B |
| End screen: ghi và đo | Nhập hiệu quả bằng channel_end_screens_a2 khi được cấp | App đề xuất tập kế. Người dùng đặt trong Studio. Lưu trạng thái đã làm. Không hứa API chỉnh end screen | Chừa vùng cuối theo kế hoạch dựng; đó không là mid-roll | Đo hiệu quả API sau thao tác UI. Không coi mọi click là chuyển đổi tập kế |
| Cards: ghi và đo | Analytics/bulk đọc được chỉ số. Không có API tạo card đã xác minh | Người dùng gắn link tập/playlist trong Studio | — | Có thể thử CTA/card sau khi xác nhận thao tác tay. Giữ log thời điểm |
| Ghim bình luận | — | Soạn bình luận dẫn tập kế; người dùng ghim trên YouTube. TikTok Accounts chỉ xác nhận đọc pinned | — | Ghi nhận thủ công đã ghim. Không giả định comment insert tự ghim |
| Vị trí mid-roll | Chỉ số tiền/ads không cho biết danh sách slot VOD đã đặt | — | suggest_ad_breaks trả gợi ý timestamp + lý do. Người dùng đặt/kiểm trong Studio. Không tự ghi hay xác nhận slot | So RPM theo độ dài/cách đặt nhưng ghi treatment thực đã làm. Không suy số slot từ doanh thu |
| Tạo Test & Compare | Không tự thêm dimension variant vào report | — | — | Tạo kế hoạch và asset; người dùng khởi chạy native test. videos.update/thumbnails.set không tạo native A/B |
| Đọc kết quả Test & Compare | CTR video tổng không thay kết quả theo phương án | — | — | Nhập kết quả người dùng có provenance. Không hứa endpoint results. Không tự chọn thắng khi chưa có bằng chứng |
| Community Posts | Không suy traffic sau post là tác động nhân quả | Viết nháp thông báo tập mới. YouTube cần người dùng đăng | — | Nhập mốc đăng làm biến can thiệp. Meta/TikTok chưa xác minh tương đương/API |
| Playlist: tạo | — | YouTube playlists.insert, 50 units/lệnh. Lưu playlist ID. Chưa tự nhận đây là official series playlist | — | — |
| Playlist: thêm | Có thể lấy số liệu trong bối cảnh playlist; không gán toàn bộ view video cho playlist | YouTube playlistItems.insert, 50 units/item. Lưu item ID; tránh thêm trùng khi thử lại | — | Ghi exposure/assignment theo playlist nếu thực sự đo được |
| Playlist: thứ tự | — | YouTube playlistItems.update, 50 units/lệnh. Manual ordering là điều kiện. Nếu chưa có thì yêu cầu người dùng đổi setting | — | Thứ tự thay đổi là treatment. Lưu thời điểm và giá trị trước/sau |
| Multi-language audio | Không dùng subtitle-language làm audio-language | Cùng series có thể có bản lồng tiếng, nhưng upload track YouTube là thao tác Studio. Không tự coi nhiều video là nhiều track | — | Ghi rõ biến là audio hay phụ đề. Meta AI dubbing khác track tùy ý |
| Localized title/description | Giữ metadata snapshot tại thời điểm đo | YouTube videos.update localizations từ 2015-11-19. Giữ defaultLanguage và toàn bộ bản dịch cũ | — | Sửa locale theo thời gian là thử riêng; không giả native randomization. Meta/TikTok null |

## Điều kiện để giao guide

### TASK-087

Ưu tiên adapter YouTube. Phân biệt nguồn Analytics và Reporting.
Lưu ngày dữ liệu và ngày lấy, window, đơn vị, metric name và report version.
Giữ raw ratio 100 khoảng; phần nội suy là dữ liệu suy ra.
Nếu dữ liệu trễ hoặc rỗng, trả thiếu dữ liệu.
Quyền scope chưa đủ không có nghĩa video không có retention.
[Bằng chứng](https://developers.google.com/youtube/analytics/dimensions), [reach](https://developers.google.com/youtube/reporting/v1/reports/channel_reports), [quy trình](https://developers.google.com/youtube/reporting/v1/reports/)

### TASK-098b

Có thể tự động hóa playlist thường.
Tạo playlist, thêm item và đổi thứ tự là ba thao tác khác nhau.
Đặt chế độ Manual hoặc official series playlist chưa có hợp đồng API được xác minh.
End screen, card và pin YouTube cần yêu cầu thao tác Studio.
Bulk click rate theo phần tử không bảo đảm đo được người xem đi tập nào sau đó.
Đừng đặt KPI “tỷ lệ xem tiếp” khi thiếu attribution.
[Playlist API](https://developers.google.com/youtube/data/reference/rest/v3/playlists/insert), [ordering](https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/insert), [end screen](https://support.google.com/youtube/answer/6388789)

### TASK-104

Đầu ra khả thi là danh sách gợi ý ad-break.
Thêm trường xác nhận người dùng đã đặt khi cần đo hiệu quả.
YPP/độ dài đủ điều kiện không bảo đảm từng slot chạy quảng cáo.
Không dùng API cuepoint livestream thay cho VOD.
Giữ null cho vị trí thực chưa xác nhận.
[Mid-roll](https://support.google.com/youtube/answer/6175006), [video update](https://developers.google.com/youtube/data/reference/rest/v3/videos/update)

### TASK-092b

Tách ba loại bằng chứng: native test trong Studio, thử giữa video, và đổi metadata theo thời gian.
Hai loại sau không được gắn nhãn native Test & Compare.
Native result nhập tay phải có thời gian và nguồn người dùng cung cấp.
Không khẳng định có CSV export chuẩn vì chưa xác minh.
Đổi title/thumbnail khi native test đang chạy có thể dừng test.
[Hợp đồng UI](https://support.google.com/youtube/answer/16391400?hl=en)

## Dữ liệu và logic

Dữ liệu thay đổi: endpoint, scope, quota, report type, eligibility, giới hạn UI, ngày hiệu lực.
Chúng thuộc knowledge có nguồn và ngày kiểm.
Logic đề xuất: lưu provenance, bảo toàn null, gom cửa sổ, thay backfill và theo dõi thao tác tay.
Đây là đề xuất thiết kế, không là thay đổi code trong task nghiên cứu.

Tạm chưa mở rộng cam kết bốn task sang TikTok/Meta từ các dòng chưa xác minh.
`null` là lý do để kiểm lại trước khi triển khai, không phải kết luận loại bỏ nền tảng.

