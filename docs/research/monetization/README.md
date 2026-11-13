> **BỔ SUNG DEEP RESEARCH — 2026-11-11:** Đã mở rộng 44 → **50 cơ chế nguồn thu**; thêm Branded Mission, membership/tips, crowdfunding, VOD và dịch vụ video B2B.
> Knowledge: **142 entry** (50 monetization_program, 55 platform_limit cũ giữ nguyên, 4 platform_capability, 33 creator_tactic); 17 entry mới, 69 monthly/weekly.
> Bổ sung eligibility creator/viewer/payment, P&L/settlement, claim thương mại, quyền paid media và thí nghiệm; 12 đề xuất, top 5 cập nhật trong [gap-analysis](gap-analysis.md#top-5-sau-bổ-sung).
> Machine-readable dùng **94 URL evidence**; 12 URL có evidence kiểm mới 2026-11-11. Còn **35 trường null** trong knowledge.json, gồm payout/fee/country chưa xác nhận; không so con số này với “31 dòng có ô null” cũ.
> Bảng/báo cáo 2026-11-10 bên dưới được giữ làm lịch sử; chưa nhập vào snapshot/app. [Nguồn thu bổ sung](streams.md#bổ-sung-deep-research--2026-11-11).

# RESEARCH-072 REPORT

> **BỔ SUNG — 2026-11-10:** Mỗi dòng nguồn thu có volatility, lý do và nguồn theo dõi.
> Kỹ năng có chu kỳ rà soát. Đề xuất tách dữ liệu thay đổi khỏi code xử lý.
> [Tín hiệu thay đổi](change-signals.md) ghi lịch sử, robots.txt và cách thử half-life.
> [Knowledge entries](knowledge.json) giữ nguồn và ngày kiểm để tính hạn dùng.

- **Streams:** 44 dòng, 20 dùng được tại VN (gồm có điều kiện), 40 dùng được toàn phần hoặc một phần với kênh faceless tự động ở ít nhất một thị trường.
- **Rủi ro lớn nhất:** video lặp hoặc tái sử dụng ít đóng góp mới có thể làm mất quyền kiếm tiền của cả kênh YouTube. X Original Content Rewards loại nội dung tạo hoặc đăng bằng phương tiện tự động. [YouTube](https://support.google.com/youtube/answer/1311392) · [X](https://help.x.com/en/using-x/original-content-rewards)
- **Checklist originality** ([bằng chứng theo nền tảng](automation-risk.md)):
  1. Đối chiếu kịch bản với nguồn và chỉ rõ bình luận, phân tích hoặc câu chuyện riêng.
  2. Chỉ rõ phần biến đổi thực chất của clip bên thứ ba và lưu giấy phép.
  3. So mẫu video mới, nổi bật và nhiều watch time để phát hiện lặp cả kênh.
  4. Kiểm AI chân thực, tài trợ và tình trạng phù hợp quảng cáo theo nền tảng.
  5. Kiểm vòng lặp, slideshow/chữ đơn thuần và lưu dấu vết sản xuất trước duyệt.
- **Top 5** ([chi tiết](gap-analysis.md)):
  1. Cổng kiểm originality và hồ sơ nguồn — cao / M.
  2. Skill kiểm nhãn, claim và ad suitability trước đăng — cao / S.
  3. Thử nghiệm tiêu đề, thumbnail và hook theo retention — cao / M.
  4. Bảng RPM và lợi nhuận theo thị trường, định dạng — cao / M.
  5. Sổ chiến dịch affiliate/tài trợ, disclosure và chuyển đổi — vừa–cao / M.
- **OSS:** OpenCV cho so khung hình, Redash cho dashboard, LinkStack cho quản lý link, LosslessCut cho workflow cắt đoạn. [Phiên bản, giấy phép, sao](gap-analysis.md)
- **knowledge.json:** 125 mục gồm 44 monetization_program, 55 platform_limit và 26 creator_tactic. 59 mục có volatility cao (monthly/weekly).
- **Câu hỏi mở:**
  - Tài khoản Meta tại VN thấy chương trình nào trong Professional Dashboard?
  - Có dữ liệu thật về RPM, retention, lợi nhuận và chi phí theo video để chạy thử không?
  - Có thể lấy kết quả thử nghiệm Studio, related-video traffic và affiliate payout bằng export nào?
  - Tính năng công bố nào cần người duyệt bắt buộc theo từng thị trường?

## Phương pháp

Kiểm tra **2026-11-10**. Đọc điều khoản và Help Center trước, thông báo nhà cung cấp cho lịch sử, hai bài diễn đàn chỉ làm giai thoại. 87 URL web duy nhất, 31 dòng nguồn thu còn ít nhất một ô `null`. Các dòng chuyển đổi gián tiếp, chương trình lịch sử và doanh thu lồng nhau được giữ riêng để làm bản đồ, không cộng dồn. Counts VN gồm tính năng có điều kiện hoặc cơ chế bên ngoài được ghi rõ, không hàm ý mọi tài khoản được mở. Counts faceless xét khả năng theo chương trình, không xác nhận eligibility ở VN. Dữ liệu app là snapshot danh mục hiện hành.

- [Dòng thu và điều kiện](streams.md)
- [Chính sách và checklist](automation-risk.md)
- [Kỹ năng và KPI](skills.md)
- [Độ phủ và đề xuất](gap-analysis.md)

## Phương pháp bổ sung 2026-11-11

- Đọc lại brief 072 và TASK-073 §2; hoàn tất 072 trước khi bắt đầu phần dữ liệu 071. Chỉ sửa output research, không viết code/skill/tool, không sửa snapshot hoặc cấu hình người dùng.
- Giữ ID cũ và kind platform_limit cũ. Sửa có bằng chứng: youtube.creator_partnerships từ countries=null sang danh sách Help, bỏ yêu cầu ads-sharing không có trong Help hiện tại, scope market chỉ gồm các nước đã xác minh trong wave 1; thêm countriesListType để tránh coi verified_subset là danh sách toàn cầu.
- 17 entry mới: 6 program, 7 tactic (gồm 2 originality), 4 capability. 6 kỹ năng K13–K18 và trường hợp stock là phần mở rộng checklist, chưa là skill cài vào agent.
- Độ tự động hoá, xếp hạng tác động và công thức hoà vốn là inference, chưa có uplift hay dữ liệu kênh thật. Giá ví dụ 3 USD/2 USD là giả định, không là benchmark RPM.
- Mọi thay đổi có URL/ngày kiểm. Không quote nguyên văn nguồn mới. Date tài liệu/rollout/effective date được tách: trang Adobe cập nhật không chứng minh ngày launch, tài liệu Branded Mission 07/2025 được đánh dấu cũ.
- Kiểm public web; không đăng nhập, không gọi account API, không nguồn trả phí. Instagram Help trả 429 và TikTok Support không có thân bài đọc được: giữ null/nhãn chưa kiểm, không tìm cách vượt robots.
- Metadata OSS lấy từ GitHub API công khai đúng ngày kiểm, không cài Umami/OpenRefine. AGPL/GPL trong bảng cũ chỉ tham khảo, không đề xuất sao chép vào app.
- Node parse và kiểm tất cả ID duy nhất, evidence URL/date, scope, kind cũ/mới, các trường value và quote ≤25 từ: đạt. Giữ dữ kiện ngày 10/11 không được kiểm lại ở ngày cũ; không gắn ngày mới cho toàn bộ dữ liệu cũ.

### Câu hỏi chưa thể đóng bằng nguồn công khai

1. Tài khoản Meta cụ thể ở VN có invitation và payout nào? Cần người dùng xác nhận, không nhập secret vào research.
2. PayPal/Stripe/payout của từng creator cho Patreon/Ko-fi/VOD: chưa kiểm KYC nên không tuyên bố hỗ trợ VN.
3. Native A/B có endpoint/export chính thức nào phù hợp connector hiện tại? Không suy từ nút thử title trong app.
4. Kênh thật có cohort đủ để đo incremental profit, churn, returns và half-life format không? Chưa có thì hiệu quả số vẫn null.
