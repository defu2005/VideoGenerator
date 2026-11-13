# Độ phủ của app và đề xuất

Đối chiếu ngày **2026-11-10**. “Missing” nghĩa là chưa thấy tính năng trực tiếp trong danh mục đã đọc. Các ID liên kết với [nguồn thu](streams.md) hoặc [kỹ năng](skills.md). Căn cứ app là [feature map](../../../packages/shared/src/features/featureMap.ts), [user guide](../../user-guide/README.md) và tên/trigger trong [operator skills](../../../apps/server/src/operator/skills.ts). Không thấy `playbooks.ts` ở đường dẫn brief.

| ID / mục | Độ phủ | App hiện có | Còn thiếu |
|---|---|---|---|
| Y1 Watch Page Ads | partly | analytics, finance, publish-from-project | Thiếu eligibility YPP, ad suitability và nhập RPM theo video. |
| Y2 Shorts Feed Ads | partly | shorts, analytics, publish-from-project | Thiếu qualified views, Shorts Module và phân bổ doanh thu. |
| Y3 Channel Memberships | missing | comments, finance là tính năng liên quan | Thiếu hội viên, quyền lợi và dữ liệu thu định kỳ. |
| Y4 Super Thanks | missing | finance | Thiếu theo dõi Thanks và đối soát. |
| Y5 Super Chat và Super Stickers | missing | comments | Thiếu lịch LIVE/Premiere, kiểm duyệt và đối soát Supers. |
| Y6 Shopping — cửa hàng riêng | missing | metadata, publish-from-project | Thiếu catalog, product tags, fulfillment và đối soát. |
| Y7 Shopping — affiliate | partly | metadata | Thiếu tích hợp product tags, link affiliate và hoa hồng. |
| Y8 YouTube Premium | partly | analytics, finance | Thiếu tách Premium và module theo format. |
| Y9 Creator Partnerships (BrandConnect) | missing | analytics | Thiếu media kit, deal và quyền dùng nội dung. |
| T1 Creator Rewards | partly | shorts, analytics, publish-from-project | Thiếu readiness 60 giây, qualified views và kiểm vùng. |
| T2 Subscription | missing | comments | Thiếu entitlement và quyền lợi hội viên. |
| T3 LIVE Gifts | missing | comments | Thiếu LIVE, quản lý chat và Gifts. |
| T4 Shop Affiliate | partly | metadata, publish-from-project | Thiếu catalog, gắn sản phẩm, tracking và payout. |
| T5 TikTok One (Creator Marketplace) | missing | analytics | Thiếu marketplace, hợp đồng và phê duyệt claim. |
| T6 Series | missing | compose-plan | Thiếu tạo bộ trả phí và đối soát doanh thu. |
| T7 Effect Creator Rewards | missing | Không có mục Effect House trong feature map | Thiếu sản xuất hiệu ứng và đo usage. |
| T8 Video Gifts | missing | finance | Thiếu eligibility và số liệu Gifts. |
| F1 Content Monetization | partly | publish-from-project, analytics, finance | Thiếu invite status, qualified views và tính nguyên bản ở cấp kênh. |
| F2 Stars | missing | finance | Thiếu nguồn Stars và eligibility. |
| F3 Subscriptions | missing | comments | Thiếu quản lý hội viên và quyền lợi. |
| F4 Brand Collabs Manager / partnership ads | missing | metadata | Thiếu đối tác, quyền creative và partnership ads. |
| F5 Bonuses / Fast Track | missing | finance | Thiếu kiểm tra điều kiện, tiến độ và payout theo đợt. |
| I1 Gifts | missing | publish-from-project, finance | Thiếu eligibility và số liệu Gifts. |
| I2 Subscriptions | missing | comments | Thiếu membership và quyền lợi. |
| I3 Badges | missing | comments | Thiếu Live Badges và reconciliation. |
| I4 Bonuses | missing | finance | Thiếu program status và theo dõi điều kiện. |
| I5 Affiliate | partly | metadata, publish-from-project | Thiếu quản lý affiliate, disclosure và conversion. |
| I6 Creator Marketplace / brand collabs | missing | analytics | Thiếu media kit, deal và quyền creative. |
| S1 Monetization Program | missing | shorts có thể tạo asset | Thiếu publish Snapchat, chương trình và số liệu. |
| X1 Creator Revenue Sharing (cũ) | missing | Không thấy kết nối X trong publish-from-project | Chương trình cũ kết thúc, chỉ cần lưu trạng thái lịch sử nếu nghiên cứu X. |
| X2 Original Content Rewards | missing | Không thấy kết nối X trong publish-from-project | Thiếu publish, kiểm eligibility và payout X mới. |
| X3 Subscriptions | missing | comments, finance liên quan | Thiếu kết nối X và subscription lifecycle. |
| P1 Paid partnerships / affiliate Pins | missing | metadata, thumbnails liên quan | Thiếu publish Pinterest, paid label và conversion. |
| Z1 Lead qua nút liên hệ | missing | metadata, shorts liên quan | Thiếu publish Zalo và attribution lead. |
| C1 Điều kiện kênh nước ngoài tại Trung Quốc đại lục | missing | publish-from-project | Thiếu kết nối đại lục; chưa đủ căn cứ để làm trước. |
| O1 Amazon Associates | partly | metadata, finance | Thiếu storefront link, disclosure và attribution. |
| O2 Shopee Affiliate | partly | metadata, finance | Thiếu tracking, đối soát và lọc đơn hoàn. |
| O3 Lazada Affiliate | partly | metadata, finance | Thiếu tracking, đối soát và lọc đơn hoàn. |
| O4 Impact | partly | metadata, finance | Thiếu đối soát theo contract và conversion. |
| O5 Sponsorships | partly | analytics, finance | Thiếu media kit, hồ sơ quyền và deal pipeline. |
| O6 Sản phẩm số và khóa học | partly | metadata, finance | Thiếu storefront, funnel, fulfilment và refund. |
| O7 Licensing footage | missing | render và hồ sơ dự án là đầu vào | Thiếu asset rights/release ledger và workflow submit stock. |
| O8 Newsletter / lead capture | partly | metadata, finance | Thiếu consent, attribution lead và chuyển đổi trả phí. |
| O9 Multi-language Audio — cùng video | partly | translations, publish-from-project | Có bản dịch video; chưa thấy ghép nhiều audio track lên cùng video YT. |
| K1 Chọn ngách và đề tài | partly | trends, insights, finance | Thiếu nối nhu cầu với RPM, format và chi phí theo geo. |
| K2 Hook và dựng giữ chân | partly | compose-plan, vision-check | Thiếu map retention curve với timeline và hook. |
| K3 Tiêu đề, thumbnail và A/B | partly | metadata, thumbnails | Thiếu quản lý biến thể và đọc kết quả Studio. |
| K4 Độ dài và mid-roll | missing | compose-plan là đầu vào | Thiếu chèn marker theo eligibility và đo tác động. |
| K5 SEO và bản địa hóa | partly | metadata, translations | Thiếu xác nhận workflow chapters, captions và multi-audio trên kênh. |
| K6 Lịch, series, playlists và điều hướng | partly | automation, weekly-plan | Có lịch; thiếu liên kết playlist, card, end screen theo series. |
| K7 Shorts → video dài và tái định dạng | partly | shorts, publish-from-project | Thiếu map bản dài/Short và đo lượt chuyển. |
| K8 Cộng đồng | partly | comments, triage-comments | Thiếu pin, Community posts/poll và đánh giá phản hồi. |
| K9 Vòng đo 48h / 7d / 28d | partly | analytics, finance, skill-reports, autonomy-journal | Thiếu snapshot cửa sổ và ghi giả thuyết/thay đổi. |
| K10 Brand safety và phù hợp quảng cáo | partly | guidelines, vision-check | Thiếu policy-version theo platform, risk ad suitability và kiểm disclosure trước phát hành. |
| K11 Trend và mùa vụ | partly | trends, automation, weekly-plan | Thiếu lịch mùa vụ theo thị trường và scoring lead time. |
| K12 Media kit và tài trợ | partly | analytics, finance | Thiếu media kit, deal rights và UTM. |

## Ưu tiên theo tác động kỳ vọng trên công sức

Tác động là đánh giá định tính từ chính sách, điều kiện payout và KPI đã dẫn nguồn, chưa quy đổi thành doanh thu dự báo. Sao là snapshot GitHub ngày 2026-11-10. Các dự án AGPL/GPL dùng để tham khảo, không đề xuất sao chép mã.

| Hạng | Vấn đề | Dạng đề xuất | Tác động / công sức | Rủi ro và phụ thuộc | OSS | Data hay code |
|---|---|---|---|---|---|---|
| 1 | Video mẫu hàng loạt có thể mất thu cấp kênh | **Guideline rule** originality: đối chiếu kịch bản và khung hình với mẫu kênh, lưu nguồn/giấy phép và đóng góp sáng tạo, chuyển duyệt khi thiếu bằng chứng | Cao / M | Tránh bỏ sót biến thể gần nhau và nhầm stock có phép với đủ originality; cần timeline, metadata và manifest nguồn | [OpenCV 5.1.0](https://github.com/opencv/opencv/releases/tag/5.1.0), Apache-2.0, 06/11/2026, 91.522 sao. Dùng đối chiếu khung hình, chưa thay đánh giá chính sách. | Dữ liệu: tiêu chí originality và ngoại lệ theo nền tảng, nguồn và TTL. Code: thu dấu vết, so mẫu, đưa qua cổng duyệt. |
| 2 | Sai nhãn hoặc suitability làm giảm khả năng kiếm tiền | **Operator skill** `kiem-tra-truoc-khi-dang`: chạy khi bản render/metadata chờ duyệt; đọc dự án và guidelines, rà claim, nhãn AI và tài trợ theo platform, xuất thẻ cần xác nhận | Cao / S | Quy tắc thay đổi và false positive; cần guideline pack có nguồn và phiên bản | [OpenCV 5.1.0](https://github.com/opencv/opencv/releases/tag/5.1.0), Apache-2.0, 06/11/2026, 91.522 sao; có thể dò frame cần rà, chưa tự gắn nhãn. | Dữ liệu: loại nhãn, mức phù hợp quảng cáo và quy tắc claim theo thị trường/nền tảng. Code: điều phối skill, hiển thị checklist và ghi quyết định. |
| 3 | Có CTR và retention nhưng khó đo nguyên nhân | **Feature** ghi thí nghiệm tiêu đề/thumbnail và đánh dấu hook theo timeline; lưu kết quả 48h/7d/28d | Cao / M | Mẫu ít và sai attribution; cần analytics và nguồn kết quả Studio, hỗ trợ nhập tay nếu API thiếu | [Redash v26.9.0](https://github.com/getredash/redash/releases/tag/v26.9.0), BSD-2-Clause, 24/09/2026, 28.877 sao; tham khảo truy vấn và dashboard, chưa vận hành YouTube Test & Compare. | Dữ liệu: KPI, số biến thể, ngưỡng và mốc đọc báo cáo. Code: quản lý phiên bản, snapshot và tính chênh lệch. |
| 4 | Doanh thu và chi phí chưa gắn geo/format | **Feature** bảng unit economics theo nhóm video, format và thị trường; lưu RPM thật, không tự điền khi thiếu | Cao / M | Sai tiền tệ, trùng doanh thu và dữ liệu ít; cần finance, analytics và RESEARCH-071 | [Redash v26.9.0](https://github.com/getredash/redash/releases/tag/v26.9.0), BSD-2-Clause, 24/09/2026, 28.877 sao. | Dữ liệu: định nghĩa RPM, thị trường, định dạng, ngoại lệ và benchmark có hạn. Code: chuẩn hóa đơn vị, quy đổi, tổng hợp và đối soát. |
| 5 | Hoa hồng và tài trợ thiếu attribution, dễ bỏ disclosure | **Feature** quản lý link và chiến dịch, hợp đồng/rights, quy tắc disclosure và doanh thu sau hoàn | Vừa–cao / M | Tracking, quyền riêng tư, claim sản phẩm; cần metadata, finance, kiểm theo thị trường | [LinkStack v4.8.8](https://github.com/LinkStackOrg/LinkStack/releases/tag/v4.8.8), AGPL-3.0, 22/10/2026, 3.946 sao; tham khảo quản lý link, chưa đối soát hoa hồng. | Dữ liệu: quy tắc disclosure, payout, điều kiện campaign theo mạng và thị trường. Code: link/UTM, ghi giao dịch, trừ hoàn và quản lý quyền. |
| 6 | Chưa biết Shorts có kéo lượt xem sang video dài | **Feature** ghép ID hai phiên bản, gợi ý related video và đo traffic thực tế | Vừa / M | Khả năng truy xuất số liệu theo tài khoản; cần shorts, publish và analytics | [LosslessCut v3.70.2](https://github.com/mifi/lossless-cut/releases/tag/v3.70.2), GPL-2.0, 28/10/2026, 45.894 sao; tham khảo cắt đoạn, chưa đo funnel. | Dữ liệu: điều kiện related video, chỉ số nguồn traffic và tactic theo phiên bản. Code: ánh xạ ID hai bản, liên kết và tính chuyển đổi. |

Top 5 ưu tiên vì hai mục đầu bảo vệ quyền kiếm tiền, hai mục tiếp theo đo được chất lượng và kinh tế video, mục 5 mở nguồn thu theo giao dịch kể cả khi kênh chưa đủ điều kiện quảng cáo. [Chính sách và kiểm tra](automation-risk.md) · [K1, K2, K3, K9](skills.md) · [O1–O5](streams.md)


## BỔ SUNG DEEP RESEARCH — 2026-11-11

Đối chiếu tài liệu hiện tại, không xác nhận live implementation: [featureMap](../../../packages/shared/src/features/featureMap.ts), [tài chính](../../user-guide/phan-tich-va-tai-chinh.md), [thị trường](../../user-guide/ho-so.md#thi-truong-muc-tieu), [D3/D4](../../user-guide/tri-thuc-va-thay-doi.md#tai-khoan-video). Các bảng 2026-11-10 phía trên là snapshot lịch sử.

| Mục mới / thay đổi | Độ phủ tài liệu | Phần cần phát triển thêm |
|---|---|---|
| Market/knowledge, nguồn và TTL | covered phần lưu/đọc/duyệt | Phải tách audience market khỏi creator residence/payment country; chọn market không là bằng chứng eligibility |
| Kiểm trạng thái/metric drift | partly, có checklist/API theo coverage và nhập số liệu | Chưa coi read health hoặc mốc số liệu là xác nhận bật kiếm tiền |
| T9 Branded Mission | missing cho campaign lifecycle | Hồ sơ brief, quyền chạy ads, thời hạn và settlement; không tự đăng ký/hợp đồng |
| O10 Patreon; O11 Ko-fi; O13 VOD | partly sản xuất video/nhập doanh thu chung | Chưa thấy connector hội viên, fulfillment, churn và phí từng giao dịch |
| O12 Crowdfunding; O14 dịch vụ B2B | partly xuất video, thu/chi chung | Chưa thấy quản lý pledge/milestone, nghiệm thu, sửa bài và quyền thương mại |
| K13 P&L; K18 cohort | partly finance và CSV | Thiếu đối soát đa nguồn và tránh đếm RPM/memberships hai lần |
| K14 eligibility | partly knowledge + weekly check | Thiếu ma trận creator/viewer/payment và bằng chứng enrollment từng account |
| K15 thí nghiệm | partly tiêu đề/thumbnail/analytics | Native Studio test khác luân phiên title; không xác nhận API native từ danh mục tính năng |
| K16 claim; K17 quyền quảng cáo | partly guidelines/credits | Chưa thấy ledger trải nghiệm thực, paid-media usage rights và hết hạn |

### Đề xuất thêm 7–12 (tổng danh mục: 12, chưa viết task/code)

| # | Loại / đề xuất | Đo tác động và công sức | Dữ liệu hay code, phụ thuộc / rủi ro | OSS trước khi xây |
|---|---|---|---|---|
| 7 | **Feature** ma trận đủ quyền kiếm tiền theo account | Cao / M; giảm kế hoạch dựa sai chương trình, chưa có uplift đo | Data: cư trú, vùng chương trình, loại account, evidence/TTL. Code: trạng thái eligible/ineligible/unknown và luồng xác nhận. Phụ thuộc 071, knowledge, D3; không tự kết nối/payout | Tái dùng resolver/checklist trong app, không thêm dependency |
| 8 | **Feature** ledger doanh thu approved/finalized/received | Cao / M; đo chênh forecast–cash, hoàn tiền và lãi đóng góp | Data: phí, commission, currency và refund window. Code: ID giao dịch, đối soát, chống trùng. Phụ thuộc finance/CSV; dữ liệu tài chính cần owner duyệt | OpenRefine để tham khảo reconcile/import; không nhúng mặc định |
| 9 | **Operator skill** `kiem-chung-claim-thuong-mai` | Cao / S; claim không có căn cứ và khiếu nại, không hứa tăng sales | Trigger: affiliate/sponsor draft. Đọc evidence, phân loại claim, kiểm disclosure, báo người dùng. Data: luật/quyền. Code: registry/approval giữ nguyên | Tái dùng guideline/RAG/skill report có sẵn |
| 10 | **MCP read** `get_revenue_readiness(accountId, programId)` | Vừa–cao / S; thời gian kiểm và số unknown | Output đề xuất: evidence, ngưỡng số, enrollment/payment status, ngày cần kiểm; risk read. Không suy từ market hoặc yêu cầu model đọc key | Dùng knowledge + get_account_health hiện có; đây là đề xuất, chưa tạo tool |
| 11 | **Feature** đăng ký native experiment và chứng cứ kết quả | Vừa–cao / M; watch time và conversion có đối chứng | Data: định nghĩa KPI/eligibility Studio. Code: version, import result, tránh agent sửa title khi test đang chạy; cần người thao tác Studio khi chưa có API | Umami chỉ dùng outbound/landing analytics, không thay native YouTube A/B |
| 12 | **Feature** rights/fulfillment ledger cho B2B, membership, VOD | Vừa / L; doanh thu gia hạn, refund, nghĩa vụ chưa giao | Data: lãnh thổ/thời hạn/quyền paid ads. Code: entitlement, contract milestones và nhắc hạn. Cần hợp đồng do người chấp nhận; rủi ro support/thuế | OpenRefine hỗ trợ đối soát nguồn, không thay hệ thống hợp đồng |

### Top 5 sau bổ sung

1. **Giữ #1 originality/provenance gate:** điều kiện bảo vệ nguồn thu; kiểm nội dung cả kênh, không chỉ license từng asset.
2. **#7 readiness theo account:** biết nguồn thu thực sự mở trước khi mở rộng sản xuất.
3. **#8 đối soát và P&L:** phân biệt tiền ước tính với tiền có thể thu, rồi mới chọn format/ngách theo lãi.
4. **#9 kiểm claim + disclosure:** ưu tiên khi chuyển sang affiliate/tài trợ; nối #2 checklist nhãn, không viết skill mới ngay.
5. **#11 thí nghiệm có chứng cứ:** nối #3 thử tiêu đề/hook; dùng watch time/retention và sales, không chỉ CTR.

Đây là xếp hạng suy luận theo rủi ro/phụ thuộc, không phải dự báo ROI có số liệu. Căn cứ ngoài app: [YPP](https://support.google.com/youtube/answer/1311392?hl=en), [payments](https://support.google.com/adsense/answer/7164703?hl=en), [FTC claims](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers), [native experiment](https://support.google.com/youtube/answer/16391400?hl=en), kiểm 2026-11-11.

### OSS được kiểm thêm, không cài đặt

| Dự án | Licence / release / sao ngày 2026-11-11 | Hợp dùng và giới hạn |
|---|---|---|
| Umami | MIT; v3.4.1, 23/10/2026; 40.065 sao. [API metadata](https://api.github.com/repos/umami-software/umami) · [Release](https://github.com/umami-software/umami/releases/tag/v3.4.1) · [License](https://github.com/umami-software/umami/blob/master/LICENSE) | Tham khảo landing/outbound analytics; click không là đơn approved, không thay API analytics nền tảng |
| OpenRefine | BSD-3-Clause; 3.10.1, 04/03/2026; 12.097 sao. [API](https://api.github.com/repos/OpenRefine/OpenRefine) · [Release](https://github.com/OpenRefine/OpenRefine/releases/tag/3.10.1) · [License](https://github.com/OpenRefine/OpenRefine/blob/master/LICENSE.txt) | Chuẩn hoá export, tìm trùng và reconcile; không thay attribution hay nhận tiền |
