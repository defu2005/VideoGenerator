# MX — Mexico

Kiểm tra **2026-11-10**.

- **Locale:** es-MX là lựa chọn biên tập dựa trên độ phủ dân số biết ngôn ngữ, chưa đo bằng lượt xem video. MXN, múi giờ mặc định `America/Mexico_City`. Với nhiều múi giờ, dùng vùng dân cư lớn làm mặc định biên tập và thay theo analytics của kênh. [CLDR ngôn ngữ](https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/territoryInfo.json) · [CLDR tiền tệ](https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/currencyData.json) · [CLDR đơn vị](https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/measurementData.json) · [Intl](https://tc39.es/ecma402/) · [IANA](https://data.iana.org/time-zones/tzdb/zone.tab) · [UN WUP](https://population.un.org/wup/)
- **Nền tảng:** YouTube, Facebook, Instagram hoạt động công khai. TikTok hoạt động công khai. Báo cáo Digital 2026 dùng độ phủ quảng cáo làm bằng chứng hoạt động. [Digital 2026](https://datareportal.com/reports/digital-2026-mexico)
- **Kiếm tiền:** YPP có trong danh sách. Creator Rewards có nguồn xác nhận. Facebook Content Monetization theo lời mời, chưa rõ quyền theo nước. Instagram còn null vì thay đổi theo tính năng và tài khoản. [YPP](https://support.google.com/youtube/answer/7101720) · [TikTok](https://newsroom.tiktok.com/programa-recompensas-creadores-tiktok-mexico?lang=es-419) · [Meta](https://about.fb.com/news/2026/03/creator-fast-track-grow-your-audience-earn-money-on-facebook/)
- **RPM USD/1.000 view (ước tính):** dài 0.26–0.55; Shorts 0.037–0.04. DubSync mô hình hóa từ CPM năm 2024, Dynamoi đo trên mẫu kênh kết nối. AIR và RevenueLab báo mức Shorts khác nhau, không coi khoảng là dự báo hay khoảng tin cậy. [DubSync](https://dubsync.me/youtube-rpm-by-country?target=en) · [Dynamoi](https://dynamoi.com/data/youtube-adsense-rpm) · [AIR dài](https://air.io/en/air-data-findings/how-much-does-youtube-really-pay-in-2026-real-rpm-data-from-300-channels) · [AIR Shorts](https://air.io/en/monetization/what-rpm-can-you-expect-from-shorts-in-2026) · [RevenueLab](https://www.revenuelab.fyi/youtube-shorts-revenue-by-country)
- **Giờ đăng:** null vì nguồn công khai chưa tách được đủ nước, format và nền tảng. YouTube null vì chưa có nguồn cùng thị trường đủ rõ. [Sprout Social](https://sproutsocial.com/insights/best-times-to-post-on-social-media/) · [Buffer](https://buffer.com/resources/state-of-social-media-engagement-2026/) · [Mẫu YouTube của Buffer](https://buffer.com/resources/best-time-to-post-on-youtube/)
- **Trend:** mã `MX` dùng ISO 3166-1 và thị trường có YouTube Music Charts. Chưa xác thực từng mã bằng Data API có credential. Wikimedia `es.wikipedia` đã trả top pages theo ngôn ngữ dự án, không phải theo quốc gia. [i18nRegions](https://developers.google.com/youtube/data/reference/rest/v3/i18nRegions/list) · [Music Charts theo thị trường](https://support.google.com/youtube/answer/9014376) · [Dữ liệu chart lịch sử](https://arxiv.org/abs/2510.23645) · [Thay đổi chart](https://developers.google.com/youtube/v3/revision_history) · [Mẫu Wikimedia](https://wikimedia.org/api/rest_v1/metrics/pageviews/top/es.wikipedia/all-access/2026/11/01)
- **TTS:** Edge trả các giọng `es-MX` khi truy vấn qua edge-tts. ElevenLabs/OpenAI hỗ trợ ngôn ngữ. Google null vì chưa xác nhận exact locale. Piper có model card ghi dataset Unlicense và base được kiểm CC0. [Edge TTS](https://github.com/rany2/edge-tts) · [Google](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types?hl=en) · [ElevenLabs](https://elevenlabs.io/docs/help-center/other/what-languages-do-you-support) · [OpenAI](https://developers.openai.com/api/docs/guides/text-to-speech) · [Piper](https://huggingface.co/rhasspy/piper-voices/blob/main/es/es_MX/ald/medium/MODEL_CARD)
- **Lịch:** 9 mốc biên tập 2026. Có thể gồm ngày nghỉ vùng, nghỉ bù hoặc ngày văn hóa. Tuần Thánh là mốc biên tập, không phải ngày nghỉ lao động toàn quốc. Không suy ra lượng xem hay tự sao chép ngày sang năm khác. [date.nager.at](https://date.nager.at/api/v3/PublicHolidays/2026/MX)

[Model card giọng base Piper](https://huggingface.co/rhasspy/piper-voices/blob/main/es/es_ES/davefx/medium/MODEL_CARD)

## Quy tắc địa phương

- **SHOULD** Hiển thị quan hệ quảng cáo bằng nhãn rõ bằng tiếng Tây Ban Nha theo hướng dẫn Profeco. Chỉ đưa claim kiểm chứng được. [Nguồn](https://www.gob.mx/profeco/prensa/260109)
- **MUST** Cung cấp aviso de privacidad và quản lý quyền dữ liệu khi thu lead thuộc luật bảo vệ dữ liệu do tư nhân nắm giữ. [Nguồn](https://www.dof.gob.mx/nota_detalle.php?codigo=5752569&fecha=20/03/2025)

## RSS

Đã kiểm GET 200, XML có item/entry.

- [www.jornada.com.mx](https://www.jornada.com.mx/rss/edicion.xml)
- [www.sdpnoticias.com](https://www.sdpnoticias.com/arc/outboundfeeds/rss/?outputType=xml)
- [www.elfinanciero.com.mx](https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/?outputType=xml)
- [www.publimetro.com.mx](https://www.publimetro.com.mx/arc/outboundfeeds/rss/?outputType=xml)

## BỔ SUNG DEEP RESEARCH — 2026-11-11

- Ma trận creator-country: Creator Partnerships **có trong danh sách**, Shopping affiliate **có**, Branded Mission **có**. Không xác nhận enrollment/payout của account; xem [ma trận và nguồn](README.md#ma-tran-chuong-trinh-2026-11-11).
- Creator Rewards có công bố launch Mexico 01/10/2025; không đồng nghĩa mọi account hiện được nhận. Profeco hiện fetch403. [Nguồn](https://newsroom.tiktok.com/programa-recompensas-creadores-tiktok-mexico?lang=es-419), kiểm 2026-11-11.
- Giả thuyết để thử: Thử how-to es-MX; nếu dùng giọng es-US cần người dùng nghe/duyệt. Hiệu quả chưa đo; không là forecast.
- Ranges RPM cũ chỉ dùng sensitivity, không là confidence interval hay giá của cả nước. Xem [audit benchmark](README.md#audit-benchmark-2026-11-11).
