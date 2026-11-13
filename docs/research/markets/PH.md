# PH — Philippines

Kiểm tra **2026-11-10**.

- **Locale:** fil-PH, en-PH, ceb-PH là lựa chọn biên tập dựa trên độ phủ dân số biết ngôn ngữ, chưa đo bằng lượt xem video. Filipino là mặc định biên tập, tiếng Anh cùng có độ phủ lớn. PHP, múi giờ mặc định `Asia/Manila`. Với nhiều múi giờ, dùng vùng dân cư lớn làm mặc định biên tập và thay theo analytics của kênh. [CLDR ngôn ngữ](https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/territoryInfo.json) · [CLDR tiền tệ](https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/currencyData.json) · [CLDR đơn vị](https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/measurementData.json) · [Intl](https://tc39.es/ecma402/) · [IANA](https://data.iana.org/time-zones/tzdb/zone.tab)
- **Nền tảng:** YouTube, Facebook, Instagram hoạt động công khai. TikTok hoạt động công khai. Báo cáo Digital 2026 dùng độ phủ quảng cáo làm bằng chứng hoạt động. [Digital 2026](https://datareportal.com/reports/digital-2026-philippines)
- **Kiếm tiền:** YPP có trong danh sách. Creator Rewards null vì tài liệu công khai đã rà chưa xác nhận thị trường. Facebook Content Monetization theo lời mời, chưa rõ quyền theo nước. Instagram còn null vì thay đổi theo tính năng và tài khoản. [YPP](https://support.google.com/youtube/answer/7101720) · [TikTok Help](https://support.tiktok.com/en/business-and-creator/creator-rewards-program/how-rewards-work) · [Công bố các thị trường](https://newsroom.tiktok.com/programa-recompensas-creadores-tiktok-mexico?lang=es-419) · [Meta](https://about.fb.com/news/2026/03/creator-fast-track-grow-your-audience-earn-money-on-facebook/)
- **RPM USD/1.000 view (ước tính):** dài 0.23–0.65; Shorts 0.023–0.03. DubSync mô hình hóa từ CPM năm 2024, Dynamoi đo trên mẫu kênh kết nối. AIR và RevenueLab báo mức Shorts khác nhau, không coi khoảng là dự báo hay khoảng tin cậy. [DubSync](https://dubsync.me/youtube-rpm-by-country?target=en) · [Dynamoi](https://dynamoi.com/data/youtube-adsense-rpm) · [AIR dài](https://air.io/en/air-data-findings/how-much-does-youtube-really-pay-in-2026-real-rpm-data-from-300-channels) · [AIR Shorts](https://air.io/en/monetization/what-rpm-can-you-expect-from-shorts-in-2026) · [RevenueLab](https://www.revenuelab.fyi/youtube-shorts-revenue-by-country)
- **Giờ đăng:** null vì nguồn công khai chưa tách được đủ nước, format và nền tảng. YouTube null vì chưa có nguồn cùng thị trường đủ rõ. [Sprout Social](https://sproutsocial.com/insights/best-times-to-post-on-social-media/) · [Buffer](https://buffer.com/resources/state-of-social-media-engagement-2026/) · [Mẫu YouTube của Buffer](https://buffer.com/resources/best-time-to-post-on-youtube/)
- **Trend:** mã `PH` dùng ISO 3166-1 và thị trường có YouTube Music Charts. Chưa xác thực từng mã bằng Data API có credential. Wikimedia `tl.wikipedia` đã trả top pages theo ngôn ngữ dự án, không phải theo quốc gia. [i18nRegions](https://developers.google.com/youtube/data/reference/rest/v3/i18nRegions/list) · [Music Charts theo thị trường](https://support.google.com/youtube/answer/9014376) · [Dữ liệu chart lịch sử](https://arxiv.org/abs/2510.23645) · [Thay đổi chart](https://developers.google.com/youtube/v3/revision_history) · [Mẫu Wikimedia](https://wikimedia.org/api/rest_v1/metrics/pageviews/top/tl.wikipedia/all-access/2026/11/01)
- **TTS:** Edge trả các giọng `fil-PH` khi truy vấn qua edge-tts. ElevenLabs/OpenAI hỗ trợ ngôn ngữ (OpenAI ghi Tagalog). Google `fil-PH-Standard-A`. Piper null vì chưa xác nhận đúng locale với giấy phép permissive. [Edge TTS](https://github.com/rany2/edge-tts) · [Google](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types?hl=en) · [ElevenLabs](https://elevenlabs.io/docs/help-center/other/what-languages-do-you-support) · [OpenAI](https://developers.openai.com/api/docs/guides/text-to-speech) · [Piper](https://huggingface.co/rhasspy/piper-voices)
- **Lịch:** 13 mốc biên tập 2026. Có thể gồm ngày nghỉ vùng, nghỉ bù hoặc ngày văn hóa. Không suy ra lượng xem hay tự sao chép ngày sang năm khác. [pco.gov.ph](https://pco.gov.ph/news_releases/pbbm-issues-proclamation-declaring-regular-holidays-special-non-working-days-for-2026/)

## Quy tắc địa phương

- **SHOULD** Đối chiếu ASC Code cho testimonial, thông tin quảng cáo và hồ sơ chứng minh claim trước khi phát hành. [Nguồn](https://asc.com.ph/wp-content/uploads/2023/03/ASC_Guidebook.pdf)
- **MUST** Với dữ liệu lead và bình luận có thể nhận dạng, áp dụng nguyên tắc minh bạch, mục đích hợp pháp, tương xứng và căn cứ xử lý theo DPA. [Nguồn](https://privacy.gov.ph/implementing-rules%20regulations-data-privacy-act-2012/)

## RSS

Đã kiểm GET 200, XML có item/entry.

- [www.philstar.com](https://www.philstar.com/rss/headlines)
- [www.rappler.com](https://www.rappler.com/feed/)

## BỔ SUNG DEEP RESEARCH — 2026-11-11

- Ma trận creator-country: Creator Partnerships **có trong danh sách**, Shopping affiliate **có**, Branded Mission **có**. Không xác nhận enrollment/payout của account; xem [ma trận và nguồn](README.md#ma-tran-chuong-trinh-2026-11-11).
- ASC guide là bộ quy tắc ngành có ngày hiệu lực 29/04/2024, không tự biến mọi dòng thành đạo luật. [Nguồn](https://asc.com.ph/wp-content/uploads/2023/03/ASC_Guidebook.pdf), kiểm 2026-11-11.
- Giả thuyết để thử: Thử hướng dẫn có demo, tách English/Filipino theo nhu cầu; đối soát thương mại riêng. Hiệu quả chưa đo; không là forecast.
- Ranges RPM cũ chỉ dùng sensitivity, không là confidence interval hay giá của cả nước. Xem [audit benchmark](README.md#audit-benchmark-2026-11-11).
