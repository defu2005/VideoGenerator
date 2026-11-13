> **BỔ SUNG DEEP RESEARCH — 2026-11-11:** Hoàn tất 17/17 hồ sơ; thêm **51 ô** Creator Partnerships/Shopping affiliate/Branded Mission theo nước creator, có evidence theo path.
> Giữ nguyên dải RPM cũ để đối chiếu, thêm audit mô hình/mẫu số và xung đột nguồn; không dùng như dự báo lợi nhuận. Lịch 2026 có 151/178 mốc đã qua.
> Null core vẫn **122**, thêm **1 null** cho ngày kết thúc grace KR chưa xác nhận: tổng **123**. Hai fallback Google cần người dùng duyệt; không biến chúng thành voice exact-locale.
> `sources` có **192 URL** duy nhất toàn bộ dataset, không phải 192 trang đều được kiểm lại hôm nay. Các trường mới giữ ngày 11/11 trong researchSupplement; ngày cũ không bị đẩy lên.
> Các phần 2026-11-10 dưới đây là lịch sử. Chỉ cập nhật research; snapshot và app không đổi. [Ma trận](#ma-tran-chuong-trinh-2026-11-11) · [Audit benchmark](#audit-benchmark-2026-11-11).

# RESEARCH-071 REPORT

> **BỔ SUNG — 2026-11-10:** Cả 17 hồ sơ có volatility theo 15 nhóm trường và 4–5 watch mỗi nước.
> [Lịch sử và nguồn theo dõi](change-signals.md) tách lệnh chặn, giới hạn tài khoản, nhãn AI và disclosure quảng cáo.
> Volatility là chu kỳ rà soát đề xuất. Sự kiện chưa xác minh giữ null trong ghi chú.
> Giữ nguyên dữ liệu và ngày kiểm của các trường đã hoàn thành trước đó.

- **Countries:** 17/17, không thiếu hồ sơ.
- **Nulls:** 122 ô. Ba nhóm chính là thiếu benchmark giờ đăng theo nước/nền tảng (62), thiếu xác nhận chương trình kiếm tiền theo nước hoặc tài khoản (42), và thiếu xác nhận giọng/giấy phép đúng locale (14). Bốn ô còn lại là Shorts RPM.
- **Libraries:**
  - Intl — tiêu chuẩn ECMA-402, có sẵn trong Node/ICU. Có, dùng cho tên và format.
  - countries-and-timezones — MIT. Có điều kiện nếu cần tra quốc gia → IANA offline.
  - i18n-iso-countries — MIT. Không cần khi runtime có Intl.DisplayNames.
  - country-data — MIT. Không, bản phát hành cũ và trùng dữ liệu.
  - date-holidays — ISC cho mã, CC BY-SA 4.0 cho dữ liệu. Có điều kiện, kiểm nghĩa vụ tái phân phối và lịch nguồn.
  - Unicode CLDR — Unicode-3.0. Có, lấy snapshot phần tối thiểu hoặc dùng ICU sẵn có.
  - YouTube i18nRegions/i18nLanguages — API theo điều khoản Google. Có, xác thực khi có cấu hình API hợp lệ.
  - Natural Earth — public domain. Có cho bản đồ, không thay dữ liệu market pack.
- **Surprises:**
  - Ấn Độ chặn TikTok, nhưng YouTube, Facebook và Instagram có số liệu sử dụng. [Lệnh Chính phủ](https://www.pib.gov.in/newsite/PrintRelease.aspx?lang=2&reg=48&relid=209803) · [Digital 2026](https://datareportal.com/reports/digital-2026-india)
  - Creator Rewards và TikTok Shop là hai eligibility khác nhau. [Công bố vùng Creator Rewards](https://newsroom.tiktok.com/programa-recompensas-creadores-tiktok-mexico?lang=es-419) · [Shop VN](https://seller-vn.tiktok.com/university/essay?knowledge_id=104015979497218&lang=en)
  - YouTube `mostPopular` từ 21/07/2025 lấy từ các chart Music, Movies và Gaming. Wikimedia top pages theo ngôn ngữ dự án, dễ trùng giữa nhiều nước. [YouTube revision history](https://developers.google.com/youtube/v3/revision_history) · [Wikimedia](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html)
  - Có giới hạn tài khoản dưới 16 tuổi theo phạm vi nền tảng tại AU, ID và MY. Cần tách trạng thái hoạt động công khai khỏi khả năng dùng của từng nhóm người xem. [Australia eSafety](https://www.esafety.gov.au/about-us/industry-regulation/social-media-age-restrictions) · [Indonesia Komdigi](https://portal.komdigi.go.id/kanal-publik/berita-kini/10066) · [Malaysia MCMC](https://www.mcmc.gov.my/skmmgovmy/media/General/PressRelease/MS_NEW-REGULATORY-FRAMEWORK-FOR-A-SAFER-INTERNET-FOR-CHILDREN-AND-FAMILIES.pdf)
  - AI Act Điều 50 ở EU và quy tắc ảnh chỉnh sửa/tổng hợp của influencer ở Pháp cần phân loại phạm vi riêng. [EU](https://eur-lex.europa.eu/eli/reg/2024/1689/2026-07-27/eng) · [Pháp](https://www.legifrance.gouv.fr/codes/section_lc/JORFTEXT000047663185/JORFSCTA000047663196/)

## Phương pháp

Kiểm tra **2026-11-10**. [markets.json](markets.json) là mảng 17 hồ sơ, theo đúng thứ tự brief. Có 181 URL duy nhất trong `sources` của JSON, 47 feed RSS đã kiểm GET 200 có XML và item/entry, 178 mốc mùa vụ và 44 quy tắc địa phương. Các ghi chú mã nước ánh xạ nhóm trường sang nguồn. Giấy phép, tài liệu phương pháp và dữ liệu khảo sát thêm của README nằm ngoài số 181. Hồ sơ quốc gia là dữ liệu nghiên cứu để rà trước khi dùng làm mặc định.

- **Locale:** lấy format trên Node 24.19.0, ICU 78.3, CLDR 48.0, Gregorian. Nguồn CLDR JSON dùng cho dân số ngôn ngữ, tiền tệ và hệ đo. CLDR không đo ngôn ngữ người xem video. `primary` là mặc định biên tập, `co-primary` là lựa chọn trọng yếu thứ hai. Múi giờ từ IANA 2026f. Với nước nhiều múi giờ, `defaultTimezone` là điểm bắt đầu theo vùng đông dân, có thể khác tệp xem thật. Các định dạng là mẫu hiển thị, ngăn nhóm chữ số của India vẫn nên để Intl thực hiện. [ECMA-402](https://tc39.es/ecma402/) · [CLDR](https://github.com/unicode-org/cldr-json/releases/tag/49.0.0) · [IANA](https://data.iana.org/time-zones/tzdb/zone.tab) · [UN WUP](https://population.un.org/wup/)
- **Eligibility:** tách public availability, chương trình mở theo nước và duyệt từng tài khoản. Digital 2026 là bằng chứng hoạt động công khai, không phải văn bản pháp lý. TikTok India dùng lệnh chặn và xác nhận không gỡ của chính phủ tháng 08/2025. Các nước chưa được xác nhận Creator Rewards để null. [Akashvani](https://newsonair.gov.in/no-order-issued-to-lift-ban-on-tiktok-in-india-govt/) · [TikTok Rewards](https://support.tiktok.com/en/business-and-creator/creator-rewards-program/how-rewards-work) · [Meta invite-only](https://about.fb.com/news/2026/03/creator-fast-track-grow-your-audience-earn-money-on-facebook/)
- **RPM:** theo địa lý người xem, USD/1.000 view. Dài dùng khoảng mô hình CPM × 55% × 35–60% của DubSync làm kịch bản và nới theo snapshot Dynamoi khi có số lệch. Ví dụ Mỹ 2,30–3,95 ở DubSync và 5,04 ở Dynamoi, Australia 1,71–2,95 so với 6,87. AIR dài là phép đối chiếu biến động theo ngách, không gán median đó cho mọi nước. Shorts dùng bao hai giá trị benchmark theo nước từ AIR và RevenueLab. Ví dụ Ấn Độ 0,008 so với 0,027. Hai nguồn khác mẫu và RevenueLab có mô hình ước tính, nên khoảng chỉ dùng để thử độ nhạy, không làm cam kết payout. Chưa có hai nguồn Shorts đủ dùng cho VN, TH, MY, ES. [DubSync](https://dubsync.me/youtube-rpm-by-country?target=en) · [Dynamoi](https://dynamoi.com/data/youtube-adsense-rpm) · [AIR dài](https://air.io/en/air-data-findings/how-much-does-youtube-really-pay-in-2026-real-rpm-data-from-300-channels) · [AIR Shorts](https://air.io/en/monetization/what-rpm-can-you-expect-from-shorts-in-2026) · [RevenueLab](https://www.revenuelab.fyi/youtube-shorts-revenue-by-country)
- **Giờ đăng:** chỉ điền cửa sổ có báo cáo phân đoạn thị trường cho GB/AU. Sprout đo engagement, Buffer phân biệt Shorts và video dài trong mẫu YouTube, Dash Social có mẫu và cách tổng hợp khác. Các bài tổng hợp không cho đối chiếu cùng nước, format, múi giờ và ngày trong tuần, nên để null thay vì biến một benchmark toàn cầu thành giờ địa phương. Dải hai đầu là cửa sổ thử, không phải hai slot mặc định. [Sprout GB](https://sproutsocial.com/insights/best-times-to-post-on-social-media-uk/) · [Sprout AU](https://sproutsocial.com/insights/best-times-to-post-on-social-media-australia/) · [Buffer](https://buffer.com/resources/best-time-to-post-on-youtube/) · [Dash Social](https://www.dashsocial.com/blog/best-time-to-post-on-youtube)
- **Trends và TTS:** 17 thị trường đều có tên trong danh sách Music Charts. Dùng alpha-2 theo tài liệu Data API nhưng chưa gọi `i18nRegions.list` bằng API key. Kiểm Wikimedia bằng một ngày mẫu có bài và RSS qua XML công khai. Edge lấy danh sách live bằng bản `edge-tts` có sẵn, không synthesize. Các nhà cung cấp khác đối chiếu danh mục chính thức. Piper kiểm từng model card và base khi model card nêu rõ. [YouTube Charts](https://support.google.com/youtube/answer/9014376) · [API Videos](https://developers.google.com/youtube/data/reference/rest/v3/videos/list) · [edge-tts](https://github.com/rany2/edge-tts) · [Piper voices](https://huggingface.co/rhasspy/piper-voices)
- **Lịch và quy tắc:** ưu tiên lịch chính phủ, đối chiếu Nager.Date hoặc timeanddate nơi phù hợp. Ngày quan sát, nghỉ bù, vùng và lịch riêng cơ quan được mô tả trong hồ sơ. Đây là các mốc có ngày kiểm được, chưa có dữ liệu view để xếp hạng. Các rule pháp lý là phần bổ sung cho guideline toàn cầu, mức áp dụng theo nội dung, đối tượng và vai trò của app. [Nager.Date](https://date.nager.at/Api) · [Global guideline hiện có](../../../packages/shared/src/guidelines/packs.ts)

## Kiểm tra nguồn mở

| Tên | Giấy phép | Bản kiểm, ngày, kích thước | Có thể thay trường |
|---|---|---|---|
| Intl | ECMA-402 là đặc tả, không thêm dependency. ICU dùng Unicode license. | Runtime kiểm Node 24.19.0 và ICU 78.3. 0 B dependency mới. Ngày phát hành riêng của Intl không áp dụng. | name, formats. Có thể định dạng currency từ mã đã chọn và hiển thị timezone, chưa thay được ánh xạ quốc gia → timezone/tiền tệ. [ECMA-402](https://tc39.es/ecma402/) · [ICU license](https://github.com/unicode-org/icu/blob/main/LICENSE) |
| countries-and-timezones | MIT | 3.11.0, 2026-10-16, 516.962 B unpacked | timezones, có thể dùng IANA trực tiếp để tránh dependency. [Registry](https://registry.npmjs.org/countries-and-timezones) |
| i18n-iso-countries | MIT | 7.14.0, 2025-02-17, 623.688 B unpacked | name/code nếu cần fallback Intl. [Registry](https://registry.npmjs.org/i18n-iso-countries) |
| country-data | MIT | 0.0.31, 2016-10-25, 46.688 B tarball. Unpacked size null vì registry không công bố. | name/code/currency và dữ liệu ngôn ngữ tham khảo, thiếu lý do dùng cùng CLDR/Intl. [Registry](https://registry.npmjs.org/country-data) |
| date-holidays | ISC cho mã/parser. CC BY-SA 4.0 cho holiday data. | 3.39.1, 2026-11-08, 12.167.188 B unpacked. Parser 3.7.0, 2026-11-08, 255.278 B unpacked. | Phần holiday trong seasonalEvents, vẫn cần thêm shopping, school và các mốc địa phương. [Registry](https://registry.npmjs.org/date-holidays) · [Parser](https://registry.npmjs.org/date-holidays-parser) · [Mã và dữ liệu](https://github.com/commenthol/date-holidays) |
| Unicode CLDR | Unicode-3.0 | cldr-core 49.0.0, 2026-10-22, 3.528.834 B unpacked | territoryInfo → ngôn ngữ dân số, likelySubtags → locale mặc định, currencyData → tiền tệ, measurementData → hệ đo. [Release](https://github.com/unicode-org/cldr-json/releases/tag/49.0.0) · [Registry](https://registry.npmjs.org/cldr-core) |
| YouTube i18nRegions / i18nLanguages | API theo điều khoản Google, không có license OSS cho dữ liệu trả về | v3 là API dịch vụ, không có tarball hay bản phát hành dữ liệu riêng. Ngày phát hành và kích thước snapshot null vì chưa gọi API xác thực. | youtubeRegionCode và locale hiển thị được YouTube hỗ trợ, không đo độ phủ ngôn ngữ creator. [Regions](https://developers.google.com/youtube/data/reference/rest/v3/i18nRegions/list) · [Languages](https://developers.google.com/youtube/data/reference/rest/v3/i18nLanguages/list) · [Điều khoản](https://developers.google.com/youtube/terms/api-services-terms-of-service) |
| Natural Earth | Public domain | Vector release v5.1.2, 2022-05-13. Layer 110m Admin 0 Countries công bố riêng 5.1.1, ZIP 210,08 KB. | Hình học và nhãn phục vụ map shot. Không thay quy tắc, locale, platform hoặc lịch. Biên giới mặc định là de facto. [Release](https://github.com/nvkelso/natural-earth-vector/releases/tag/v5.1.2) · [Layer](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/) · [Điều khoản](https://www.naturalearthdata.com/about/terms-of-use/) |

## Câu hỏi mở

- Dùng export nào để xác minh RPM theo địa lý, format và eligible views từ kênh thật?
- Chọn múi giờ theo địa lý khán giả hay để người dùng chọn riêng khi profile có tệp đa quốc gia?
- Lấy kết quả API i18nRegions bằng cấu hình sẵn có ở TASK-071 trước khi bật nguồn trend theo market.
- Phần lịch mùa mua sắm và trường học cần thêm nguồn cấp vùng. Quyết định có cần lịch động hay chỉ lưu các mốc biên tập đã rà.
- Với payout Meta/TikTok chưa rõ, có thể xác nhận qua màn hình eligibility do người dùng cung cấp cho từng tài khoản.
- Xác minh thêm giấy phép model/base Piper nếu muốn điền các locale còn thiếu.

## BỔ SUNG DEEP RESEARCH — 2026-11-11

<a id="ma-tran-chuong-trinh-2026-11-11"></a>
### Ma trận chương trình

Đây là **nước của creator** trong danh sách chương trình, không là thị trường người xem, lời mời hay quyền payout của tài khoản. “Chưa liệt kê” không là cấm nhận tài trợ trực tiếp. Mọi ô kiểm ngày 2026-11-11 từ [Creator Partnerships](https://support.google.com/youtube/answer/9385307?hl=en), [Shopping affiliate](https://support.google.com/youtube/answer/13376398?hl=en) và [Branded Mission](https://ads.tiktok.com/resources/help/article/about-branded-mission?lang=en); Branded Mission là tài liệu cập nhật 07/2025, >12 tháng, cần xác nhận campaign. Quốc gia nằm trong danh sách chưa đủ để khẳng định người dùng đủ điều kiện.

| Nước | Creator Partnerships | Shopping affiliate | Branded Mission |
|---|---|---|---|
| VN | Chưa liệt kê | Có | Có |
| US | Có | Có | Có |
| GB | Có | Có | Có |
| CA | Có | Chưa liệt kê | Có |
| AU | Có | Chưa liệt kê | Có |
| IN | Có | Có | Chưa liệt kê |
| PH | Có | Có | Có |
| ID | Có | Có | Có |
| TH | Chưa liệt kê | Có | Có |
| MY | Chưa liệt kê | Có | Có |
| JP | Có | Có | Có |
| KR | Có | Có | Có |
| DE | Có | Có | Có |
| FR | Có | Chưa liệt kê | Có |
| ES | Có | Chưa liệt kê | Có |
| MX | Có | Có | Có |
| BR | Có | Có | Có |

51 ô mới được lưu trong monetization của 17 hồ sơ; evidence theo path trong researchSupplement. Giữ nguyên các null Creator Rewards/Meta chưa đủ chứng cứ. Không lấy “nước chọn trong profile” làm nơi cư trú hay đổi vùng account.

<a id="audit-benchmark-2026-11-11"></a>
### Audit benchmark

| Nguồn kiểm 2026-11-11 | Chứng cứ / hạn chế | Cách dùng trong nghiên cứu |
|---|---|---|
| [DubSync](https://dubsync.me/youtube-rpm-by-country?target=en) | Trang cập nhật 05/10/2026 nhưng underlying CPM là video đăng 2024. RPM suy từ CPM × 55% × giả định tỷ lệ ad-served 35–60%; không phải RPM đo của kênh | Giữ dải cũ làm scenario, không đổi nhãn thành dữ liệu payout 2026 |
| [Dynamoi](https://dynamoi.com/data/youtube-adsense-rpm) | Mẫu các kênh kết nối của họ, theo viewer country; cửa sổ 09/11/2025–08/11/2026, không đại diện toàn bộ kênh/quốc gia. Snapshot live đã khác vài giá trị trong ghi chú cũ | Lưu ngày/window; không tạo national forecast hoặc lấy min/max hai mẫu thành confidence interval |
| [AIR Shorts](https://air.io/en/monetization/what-rpm-can-you-expect-from-shorts-in-2026) | Trang cập nhật 11/11/2026; có dữ liệu network nhưng không có raw cohort theo từng kênh để tự kiểm; không tìm thấy VN trong bảng đọc được | Industry estimate; không nội suy bốn nước còn thiếu chỉ để giảm null |
| [RevenueLab](https://www.revenuelab.fyi/youtube-shorts-revenue-by-country) | Headline US 0,10–0,22 khác bảng US 0,300; chính trang mô tả bảng là modeled | Hạ độ tin cậy, giữ bất đồng; không coi là phép xác nhận độc lập AIR |
| [Buffer](https://buffer.com/resources/best-time-to-post-on-youtube/) / [Sprout GB](https://sproutsocial.com/insights/best-times-to-post-on-social-media-uk/) | Báo cáo mẫu và format khác nhau; không phải slot đã thử cho từng kênh ở 17 nước | Các ô giờ chưa có nguồn phân đoạn vẫn null; đo từ audience analytics của kênh |

Không tự đổi các dải cũ đã được review/import vào snapshot. Bổ sung benchmarkUse trong researchSupplement để người review thấy chúng chỉ dùng thử độ nhạy. Nhãn estimate không chứng minh khoảng là confidence interval. Không nhân thêm revenue share lần nữa khi số đầu vào đã là RPM sau chia sẻ.

**Thiết kế thử đề xuất (inference):** trước khi chọn nước, chốt ngôn ngữ/tệp, quyền chương trình và chi phí localization; thử một nhóm nội dung cùng chất lượng, so retention, RPM đúng mẫu số và lãi đóng góp. Nếu thử trước/sau không có đối chứng thì ghi observational. Không đưa mức uplift, cỡ mẫu tối ưu hoặc số ngày thắng thua khi chưa có dữ liệu.

### Pháp lý và giới hạn vùng: điểm mới cần review

- **EU DE/FR/ES:** đọc theo vai trò provider/deployer và loại output, có ngoại lệ; không gán chung một rule “mọi AI phải cùng nhãn”. [Điều 50 từ EC Service Desk](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50) và [guidelines cập nhật 06/08/2026](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-transparency-obligations) nêu mốc áp dụng 02/08/2026. EUR-Lex trực tiếp trả anti-bot; không ghi là đã đọc được bản đó hôm nay.
- **KR:** [MSIT](https://www.msit.go.kr/eng/bbs/view.do?bbsSeqNo=42&nttSeqNo=1215) nêu grace ít nhất một năm cho điều tra/phạt minh bạch, dù luật đã hiệu lực. Ngày kết thúc chính xác chưa rõ, giữ null; không tự tạo validUntil=22/01/2027.
- **MY:** nguồn licensing 2024 cũ không chứng minh ngưỡng tuổi 2026. Đổi source của my_age sang [Hansard 24/06/2026](https://hansard.parlimen.gov.my/hansard/dewan-rakyat/2026-06-24), đánh dấu draft record, đối chiếu [thông báo MCMC qua Bernama 01/06/2026](https://bernama.com/bm/am/news.php?id=2563587). Chưa tải được bản quy phạm CPC cuối cùng; không suy cấm người lớn hay yêu cầu app tự giữ giấy tờ.
- **GB/CA/PH:** phân biệt law với hướng dẫn cơ quan/code tự điều chỉnh. [ASA](https://www.asa.org.uk/advice-online/influencers-guide.html) có edition 23/10/2026; [Ad Standards Canada](https://adstandards.ca/resources/influencer-marketing/) là self-regulatory; [ASC PH](https://asc.com.ph/wp-content/uploads/2023/03/ASC_Guidebook.pdf) ghi hiệu lực 29/04/2024. Không nâng mọi lời khuyên thành MUST pháp luật.
- **FR:** ngoài minh bạch nội dung, [DGCCRF](https://www.economie.gouv.fr/influenceurs-quels-sont-mes-devoirs) nêu quy định quảng bá đào tạo dùng tài trợ công từ 02/04/2026. Phải xét đúng loại offer; không áp cho mọi video giáo dục.
- **IN:** [Akashvani](https://newsonair.gov.in/no-order-issued-to-lift-ban-on-tiktok-in-india-govt/) là xác nhận ngày 23/08/2025 chưa gỡ ban. Footer 2026 không làm thông báo thành sự kiện 2026. Chưa thấy văn bản gỡ ban mới; không suy website truy cập được là app đã hợp pháp trở lại.

Các điểm còn lại và giả thuyết biên tập có trong từng CC.md, đều ≤60 dòng. Đây không phải audit đầy đủ mọi lĩnh vực quảng cáo y tế/tài chính/bầu cử của 17 nước; các dữ kiện cũ không được kiểm lại vẫn giữ ngày kiểm cũ.

### Voice, licence và lịch

- Google voice catalogue không có match en-CA/es-MX trong bản đọc. Giữ hai ô exact-locale null; đề xuất fallback en-US-Standard-C / es-US-Standard-A chỉ khi người dùng nghe và chấp nhận. [Catalogue](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types), kiểm 2026-11-11; không synthesize và không khẳng định dialect tương đương.
- Piper VN model card nêu dataset CC-BY-4.0 và fine-tune từ lessac. Nhãn MIT của cả repo không đủ kết luận mọi weight/base đã được cấp quyền phù hợp. Giữ piper=null chờ review. [Model card](https://huggingface.co/rhasspy/piper-voices/blob/main/vi/vi_VN/vais1000/medium/MODEL_CARD), kiểm 2026-11-11.
- [rhasspy/piper](https://github.com/rhasspy/piper) đã archive 06/10/2025; [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) là nhánh GPL-3.0. Tách licence engine, dataset và weight; không cài/chuyển engine hay chép GPL vào app trong research.
- Kiểm dataset ngày 11/11/2026: **151/178 mốc seasonalEvents đã qua**, 27 mốc chưa qua/ngay hôm nay. Không dùng toàn bộ lịch 2026 làm lịch tương lai và không tự tăng năm của lịch âm/ngày địa phương. Nguồn đếm: [markets.json](markets.json), không là benchmark khả năng tạo view. Lịch 2027 đầy đủ hiện chưa nghiên cứu, không tự điền.

### Kiểm chứng bổ sung và phạm vi

Node JSON.parse + assertion: 17 mã quốc gia duy nhất/đủ wave 1; 51 ô mới boolean, mỗi ô có URL/ngày; core watch và supplementary watch đều 1–5; volatility hợp lệ; 17 hồ sơ CC.md không quá 60 dòng; không NUL/UTF-8 hỏng; đạt. Không chạy test app vì không sửa code.

Dữ kiện cũ được giữ: toàn bộ giá trị RPM/giờ đăng/tts và ngày kiểm core, kể cả null. Thay có chủ đích: nguồn và phạm vi câu my_age, kèm supersededSources giữ URL trước đó. Trường mở rộng researchSupplement là dữ liệu nghiên cứu để Claude review; chưa có bảo đảm importer/app đang đọc toàn bộ metadata đó. Không sửa code để thêm khả năng đọc nó trong task research.

Giấy phép OSS nêu ở phần thêm không thay quyết định TASK-071: không thêm thư viện. Không commit/push/đổi branch, không npm install, không đụng .env/.claude/data/scripts, không đăng nhập/nguồn trả phí, không gọi LLM/TTS thật hoặc thử account credentials.

Các phần **chưa xác minh**: enrollment/payout từng account; forecast lợi nhuận theo niche ở 17 nước; giờ đăng riêng từng kênh; half-life format đo nhân quả; quyền weight/base Piper ở các locale còn null; lịch 2027 đầy đủ. Không biến các khoảng trống này thành số 0 hoặc default.

**Mẫu số cần xác nhận:** Help YouTube hiện có câu RPM theo engaged views nhưng bảng trên cùng trang còn phân biệt Videos/Shorts. Cần lưu đúng metric definition từ export/API, không âm thầm đổi giữa public, engaged và qualified views. [Help](https://support.google.com/youtube/answer/9314357?hl=en), kiểm 2026-11-11.
