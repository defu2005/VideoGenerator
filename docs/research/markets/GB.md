# GB — Vương quốc Anh

Kiểm tra **2026-11-10**.

- **Locale:** en-GB là lựa chọn biên tập dựa trên độ phủ dân số biết ngôn ngữ, chưa đo bằng lượt xem video. GBP, múi giờ mặc định `Europe/London`. Với nhiều múi giờ, dùng vùng dân cư lớn làm mặc định biên tập và thay theo analytics của kênh. [CLDR ngôn ngữ](https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/territoryInfo.json) · [CLDR tiền tệ](https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/currencyData.json) · [CLDR đơn vị](https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/measurementData.json) · [Intl](https://tc39.es/ecma402/) · [IANA](https://data.iana.org/time-zones/tzdb/zone.tab)
- **Nền tảng:** YouTube, Facebook, Instagram hoạt động công khai. TikTok hoạt động công khai. Báo cáo Digital 2026 dùng độ phủ quảng cáo làm bằng chứng hoạt động. [Digital 2026](https://datareportal.com/reports/digital-2026-united-kingdom)
- **Kiếm tiền:** YPP có trong danh sách. Creator Rewards có nguồn xác nhận. Facebook Content Monetization theo lời mời, chưa rõ quyền theo nước. Instagram còn null vì thay đổi theo tính năng và tài khoản. [YPP](https://support.google.com/youtube/answer/7101720) · [TikTok Help](https://support.tiktok.com/en/business-and-creator/creator-rewards-program/how-rewards-work) · [Công bố các thị trường](https://newsroom.tiktok.com/programa-recompensas-creadores-tiktok-mexico?lang=es-419) · [Meta](https://about.fb.com/news/2026/03/creator-fast-track-grow-your-audience-earn-money-on-facebook/)
- **RPM USD/1.000 view (ước tính):** dài 1.46–4.37; Shorts 0.166–0.25. DubSync mô hình hóa từ CPM năm 2024, Dynamoi đo trên mẫu kênh kết nối. AIR và RevenueLab báo mức Shorts khác nhau, không coi khoảng là dự báo hay khoảng tin cậy. [DubSync](https://dubsync.me/youtube-rpm-by-country?target=en) · [Dynamoi](https://dynamoi.com/data/youtube-adsense-rpm) · [AIR dài](https://air.io/en/air-data-findings/how-much-does-youtube-really-pay-in-2026-real-rpm-data-from-300-channels) · [AIR Shorts](https://air.io/en/monetization/what-rpm-can-you-expect-from-shorts-in-2026) · [RevenueLab](https://www.revenuelab.fyi/youtube-shorts-revenue-by-country)
- **Giờ đăng:** Mẫu Sprout dùng GMT. Facebook thứ Ba–Năm, Instagram thứ Hai–Năm, TikTok dùng đỉnh thứ Tư. YouTube null vì chưa có nguồn cùng thị trường đủ rõ. [Sprout Social](https://sproutsocial.com/insights/best-times-to-post-on-social-media-uk/) · [Buffer](https://buffer.com/resources/state-of-social-media-engagement-2026/) · [Mẫu YouTube của Buffer](https://buffer.com/resources/best-time-to-post-on-youtube/)
- **Trend:** mã `GB` dùng ISO 3166-1 và thị trường có YouTube Music Charts. Chưa xác thực từng mã bằng Data API có credential. Wikimedia `en.wikipedia` đã trả top pages theo ngôn ngữ dự án, không phải theo quốc gia. [i18nRegions](https://developers.google.com/youtube/data/reference/rest/v3/i18nRegions/list) · [Music Charts theo thị trường](https://support.google.com/youtube/answer/9014376) · [Dữ liệu chart lịch sử](https://arxiv.org/abs/2510.23645) · [Thay đổi chart](https://developers.google.com/youtube/v3/revision_history) · [Mẫu Wikimedia](https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/2026/11/01)
- **TTS:** Edge trả các giọng `en-GB` khi truy vấn qua edge-tts. ElevenLabs/OpenAI hỗ trợ ngôn ngữ. Google `en-GB-Standard-A`. Piper có model card ghi nguồn dữ liệu permissive, giữ attribution nếu có. [Edge TTS](https://github.com/rany2/edge-tts) · [Google](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types?hl=en) · [ElevenLabs](https://elevenlabs.io/docs/help-center/other/what-languages-do-you-support) · [OpenAI](https://developers.openai.com/api/docs/guides/text-to-speech) · [Piper](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/cori/medium/MODEL_CARD)
- **Lịch:** 14 mốc biên tập 2026. Có thể gồm ngày nghỉ vùng, nghỉ bù hoặc ngày văn hóa. Không suy ra lượng xem hay tự sao chép ngày sang năm khác. [www.gov.uk](https://www.gov.uk/bank-holidays.json)

## Quy tắc địa phương

- **MUST** Đánh dấu Ad nổi bật từ đầu đối với nội dung thuộc CAP Code, gồm affiliate trong phạm vi. Không chỉ giấu nhãn sau nút mở rộng. [Nguồn](https://www.asa.org.uk/advice-online/influencers-guide.html)
- **SHOULD** Khi vận hành dịch vụ online có khả năng trẻ em dùng, áp dụng Children’s Code của ICO, mặc định riêng tư cao và giảm tối đa dữ liệu. [Nguồn](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-code/)

## RSS

Đã kiểm GET 200, XML có item/entry.

- [feeds.bbci.co.uk](https://feeds.bbci.co.uk/news/rss.xml)
- [www.theguardian.com](https://www.theguardian.com/uk/rss)
- [feeds.skynews.com](https://feeds.skynews.com/feeds/rss/uk.xml)

## BỔ SUNG DEEP RESEARCH — 2026-11-11

- Ma trận creator-country: Creator Partnerships **có trong danh sách**, Shopping affiliate **có**, Branded Mission **có**. Không xác nhận enrollment/payout của account; xem [ma trận và nguồn](README.md#ma-tran-chuong-trinh-2026-11-11).
- ASA có edition influencer guide ngày 23/10/2026; cần đọc cả affiliate/fake reviews. [Nguồn](https://www.asa.org.uk/advice-online/influencers-guide.html), kiểm 2026-11-11.
- Giả thuyết để thử: Thử tutorial có search intent và offer phù hợp; không bắt đầu từ RPM ngành tài chính. Hiệu quả chưa đo; không là forecast.
- Ranges RPM cũ chỉ dùng sensitivity, không là confidence interval hay giá của cả nước. Xem [audit benchmark](README.md#audit-benchmark-2026-11-11).
