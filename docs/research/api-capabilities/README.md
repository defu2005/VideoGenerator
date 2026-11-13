# RESEARCH-086 REPORT — API làm được gì

- Ngày kiểm: **2026-11-12**, Asia/Bangkok.
- Phạm vi: YouTube trước; sau đó TikTok, Facebook, Instagram. Chỉ tài liệu chính thức.
- **YouTube:** có API cho retention theo 100 khoảng, bulk impressions/CTR, playlist và metadata theo locale.
- **Không có retention gốc mỗi giây** trong hợp đồng đã kiểm. Đổi trục sang giây không tạo thêm mẫu.
- Reach Reporting có từ **2026-01-15**. Không giữ giả định cũ rằng impressions/CTR chỉ có trong Studio.
- End screens/cards: đọc số liệu qua API. Chỉnh cấu hình qua Studio theo inventory đã kiểm.
- Pin, mid-roll VOD, native Test & Compare/results, Community Posts và upload multi-audio YouTube: **manual only**, có ghi rõ phần suy luận.
- **TikTok:** Display/Posting không đủ để kết luận Accounts API. Đã xác nhận Accounts đọc được trạng thái pinned; thao tác ghi còn chưa xác minh.
- **Meta:** nhiều trang trả 429. Có bằng chứng UI A/B/retention/dubbing, nhưng không đủ xác nhận hợp đồng API.
- `knowledge.json`: **60 api_contract entries**; **43 URL evidence**. 9 API, 8 manual_only, 1 not_possible, 42 `null` chưa xác minh.
- 18 entry monthly; 42 entry weekly. Đây là lịch rà soát đề xuất.
- [Gap table](gap-analysis.md) phủ mọi nhóm khả năng và TASK-087, 098b, 104, 092b. Không sửa ROADMAP.
- Chưa khép được: TikTok Accounts insights/pin-write, Playlist Help; hợp đồng Facebook/Instagram hiện hành; ngày ra mắt không công bố.
- Không viết code, cài npm, gọi tài khoản, đăng nhập, đọc secret, commit hoặc push.

## Tệp kết quả

- [YouTube: endpoint, scope, quota, giới hạn, mốc thời gian](youtube.md).
- [TikTok → Facebook → Instagram và các điểm chưa xác minh](other-platforms.md).
- [Gap với roadmap và phạm vi nghiệm thu đề xuất](gap-analysis.md).
- [Nhật ký nguồn, lỗi truy cập, volatility và lịch kiểm lại](sources.md).
- [Knowledge entries](knowledge.json).

## Cách đọc kết luận

`API`: tài liệu xác nhận thao tác bằng API; vẫn có điều kiện quyền và tài khoản.
`manual_only`: có đường giao diện; API công khai đã đối chiếu không có thao tác tương ứng.
`not_possible`: yêu cầu cụ thể không được hợp đồng đang xét cung cấp.
`null`: chưa đủ bằng chứng để chọn một trong ba nhãn. Không có nghĩa là không thể làm.
Ngày `apiSince` là ngày API được công bố có khả năng đó. `uiSince` là mốc UI có nguồn; không là ngày cấp quyền cho mọi tài khoản.

## Phương pháp và phạm vi bằng chứng

Đã đọc AGENTS.md, docs/cursor/README.md, RESEARCH-072.md và mẫu monetization.
Đã đọc TASK-073 §2 để giữ vỏ KnowledgeEntry và phân biệt ngày kiểm/ngày hiệu lực.
Đã đọc ROADMAP; bảng gap là đề xuất, không là cập nhật trạng thái triển khai.
Không áp yêu cầu nguồn thu/OSS của RESEARCH-072 sang task này.
Task này chỉ nghiên cứu hợp đồng nền tảng. Không chọn thư viện, không thiết kế thêm skill hay tool.

Mọi evidence có URL và checkedAt.
Phần suy luận có `type=inference`.
Không trích nguyên văn dài.
Nguồn cũ hơn 12 tháng được đánh dấu trong nhật ký, chỉ dùng đúng vai trò lịch sử/UI.
Ngày footer cập nhật không được dùng làm ngày ra mắt.
Có chỗ tài liệu truy cập trực tiếp lỗi nhưng chỉ mục nguồn chính thức đọc được; nhật ký tách rõ.
Không dùng bản sao proxy, diễn đàn hoặc tài liệu vendor để lấp ô trống.

Dùng kind `api_contract` vì cần giữ endpoint, scope, quota và kết luận chưa xác minh.
`value.api` là true/false/null; chỉ là kết luận nghiên cứu, không tự cấp quyền.
`apiSince`, `uiSince`, quotaCost, rateLimit và limits có thể null.
Vỏ entry theo TASK-073; đây chưa là snapshot đã duyệt hay một lần import vào app.
Không tự đổi trường null sang false để qua schema nhập.

Giới hạn: chưa kiểm app review, quyền thật, quota project hay rollout theo tài khoản/VN.
42 dòng chưa xác minh là kết quả có chủ đích của quy tắc giữ null.
Không coi URL trả lỗi là bằng chứng phủ định API.
Các dòng đó cần kiểm lại trước khi viết guide triển khai.

## Kiểm tra bàn giao

Chỉ tạo tệp trong thư mục này.
Kiểm JSON parse, ID duy nhất, đủ nhóm khả năng trên bốn nền tảng, evidence URL/ngày, volatility, nhãn, null và UTF-8.
Không chạy build/test ứng dụng vì không đổi code và brief chỉ yêu cầu output research.
Không chạy migration hoặc kiểm UI; không có thay đổi schema/giao diện.
Marker hoàn tất: `RESEARCH-086.done`.

