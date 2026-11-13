# Lộ trình phát triển (12 tháng)

> Viết ngày 2026-11-11. Đi cùng `docs/ARCHITECTURE-TARGET.md`. Ý tưởng lấy số từ `docs/IDEAS.md` (bản 2).
> Chúng ta xây công cụ, agent vận hành. Mỗi task dưới đây giao cho agent một tool, một nguồn dữ liệu, một cách đo hoặc một rào chắn.
> Mã TASK-08x trở đi là gợi ý. Thời lượng là ước lượng, chưa có số đo tốc độ thật của đội. Mục tiêu bằng số là đề xuất để người dùng chỉnh.
> Ký hiệu: 🔴 = chỉ có ý nghĩa khi kênh đã đăng thật và có analytics. 🗄 = sinh migration. Độ khó S/M/L.
> Người làm: **Cursor** (grok-4.7-medium, việc dễ dùng composer-2.5) cho phần test kiểm được. **Codex** cho chuỗi backend dài và research. **Fable** chỉ phần cần gu, phiên ngắn. **Claude** viết guide và review. **Người dùng** cho tài khoản, OAuth, chạy thật, commit.

## Tổng quan

| Giai đoạn | Tên | Khoảng thời gian | Kết quả chính |
|---|---|---|---|
| G1 | Đăng thật được | tháng 1–2 | Một kênh YouTube đăng thật qua app, số liệu thật chảy về |
| G2 | Mắt và núm chỉnh | tháng 2–4 | Agent thấy video mất người xem ở đâu và có núm để vặn |
| G3 | Phòng thí nghiệm và trí nhớ | tháng 4–6 | Agent tự đặt giả thuyết, thử, kết luận, ghi bài học |
| G4 | Công cụ sáng tạo | tháng 6–9 | Đóng gói trước, thumbnail, nhịp, series, bản sắc kênh |
| G5 | Tiền | tháng 9–12 | Thang thị trường, affiliate, Shorts làm phễu, chọn ngách |

Phụ thuộc cứng: G1 → (dữ liệu thật) → G2 phần đo → G3 → đo được G4 và G5. Param registry, pattern library, phần code của G4 không cần dữ liệu thật nên làm sớm và song song được.

## G1. Đăng thật được (tháng 1–2)

**Mục tiêu đo được:** một kênh YouTube thật đăng 10 video qua app. Từ 7/10 lượt AUTO đi tới cổng duyệt cuối mà không cần sửa tay. Analytics sync về cho cả 10 video. Không còn file chưa commit.

**Điều kiện xong:** các dòng TASK-025, 033 trong `CON-THIEU.md` đã đóng. Operator chạy 7 ngày liên tục trên kênh thật ở mức `supervised`. `ARCHITECTURE.md` được thay bản mới.

| Mã | Tên | Nội dung | Phụ thuộc | Ai | Khó |
|---|---|---|---|---|---|
| TASK-080 | Dọn nền | Commit và push khoảng 620 file. Chạy lại đủ checklist README. Thay `ARCHITECTURE.md` v0.2. | không | Người dùng commit và push. Claude chạy checklist, chia nhóm commit, viết `ARCHITECTURE.md` mới | S |
| TASK-070 | Kiểu cảnh mới, sửa cảnh quay, nối đạo diễn 067b, **đặt compose làm mặc định** | Nối 4 kind và đặt mặc định `compose` (legacy vẫn chọn được) sau khi HyperFrames render được một khung 1280×720 của từng kind. **070b xong 2026-11-12**: đạo diễn luật/LLM, 4 kind trong luật và prompt, sửa cảnh quay (API + mục Cảnh quay), cột học compose; render thật 57,6 s ECO: compose 69 s vs legacy 55 s, không khung đen, giữ mặc định compose. Chưa render thật QUALITY có đồ hoạ. 🗄 | 080 | Cursor, Fable (4 template) | M |
| TASK-076 | Giới hạn render cùng lúc, giọng/phụ đề/nhạc chạy trong lúc chờ duyệt ảnh | Rút thời gian chờ của AUTO. Guide: `docs/cursor/TASK-076.md` (2026-11-12). **Xong 2026-11-12** (STAGE_DEPENDS, 2 làn, RENDER_CONCURRENCY; nhạc phụ thuộc thêm VOICE). | 080 | Cursor | M |
| TASK-081 | Một browser cho nhiều khung static | Gỡ chênh 2–3 lần so với ước tính ở 075. Guide: `docs/cursor/TASK-081.md`. 2026-11-12: spike thất bại có lý do (`common.js` gán đè `window.__timelines` và đọc `#root` trang gốc nên sub-composition không seek được; snapshot nhanh ~8 lần nhưng khung trống). Không đổi code. Hướng tiếp: trang render riêng giữ một browser, làm sau TASK-106 vì đụng hợp đồng template. | 075 | Cursor | S |
| TASK-082 | Chạy thật: OAuth, tải lên, analytics YouTube | Người dùng tạo app developer và kết nối. Hermes chạy, Codex sửa lỗi mà mock không bắt được. Sau đó TikTok, Meta theo thứ tự ưu tiên. | 080 | Người dùng, Hermes, Codex | M |
| TASK-083 | Skill `kiem-tra-truoc-khi-dang` | Gap #2: rà claim, nhãn AI, tài trợ, ad suitability trước khi đăng. Chỉ là skill + checklist. | 082 | Claude viết, Cursor nối | S |
| TASK-084 | Cổng originality + hồ sơ nguồn | Gap #1: `source_manifests`, so mẫu trong kênh, chuyển duyệt khi thiếu bằng chứng đóng góp riêng. 🗄 Xong 2026-11-12 (migration 0063); 2 điểm yếu sửa ở TASK-107. | 080 | Codex | M |
| TASK-085 | Tách file lớn | `visualService.ts` → `visuals/`, `assistant/tools.ts` → `registry/tools/`, `db/schema.ts` → `db/schema/`. Không đổi hành vi. | 070 xong | Cursor | M |
| TASK-074a | Operator tự research | Guide đã có. Không cần dữ liệu thật. 🗄 | 073b | Codex | M |
| RESEARCH-086 | API làm được gì | Kiểm các điểm "cần kiểm API": retention theo giây, impressions/CTR (Reporting), màn hình kết thúc, ghim bình luận, điểm chèn mid-roll, Test & Compare, bài cộng đồng, playlist, multi-audio. Ra knowledge entry. ✅ 2026-11-12: `docs/research/api-capabilities/` (60 entry: 9 API, 9 manual/không thể, 42 chưa xác minh). | không | Codex | S |

Ảnh cho tác phẩm hư cấu (rủi ro 3 trong BLUEPRINT) không nằm trong lộ trình tính năng. Kênh đầu tiên nên chọn ngách có ảnh mở để G1 không kẹt ở đó.

## G2. Mắt và núm chỉnh (tháng 2–4)

**Mục tiêu đo được:** với mọi video đủ ngưỡng lượt xem, `get_retention_map` trả điểm tụt gắn với cảnh quay. Từ 20 tham số sáng tạo đọc qua resolver, có lịch sử và hoàn tác. Bảng lợi nhuận theo format và thị trường có số thật.

**Điều kiện xong:** agent gọi `review_render` và `get_retention_map` trên 10 video thật, bản tin tuần trích được điểm tụt cụ thể. Một lần `set_param` được duyệt, áp dụng, rồi hoàn tác trên kênh thật.

| Mã | Tên | Nội dung | Phụ thuộc | Ai | Khó |
|---|---|---|---|---|---|
| TASK-087 | Snapshot theo cửa sổ + retention theo giây 🔴 | `publication_metrics_snapshots` thêm `window`, impressions, CTR. Bảng `retention_curves`. Lấp K9. Theo 086: YouTube chỉ có retention 100 khoảng (không phải mỗi giây), impressions/CTR qua Reporting reach từ 2026-01-15; TikTok/Meta để thiếu dữ liệu. 🗄 | 082, RESEARCH-086 | Codex | M |
| TASK-088 | Param registry (ý 22) | `params/defs.ts`, `param_values`, `param_user_bounds`, resolver, tool, trang web, hoàn tác. Chuyển ngưỡng của variety, pacing, relevance, chấm kịch bản sang đọc qua resolver. 🗄 | 085 | Cursor | M |
| TASK-089 | Gen video + bản đồ giữ chân (ý 10) 🔴 | `video_genes` sinh lúc render. `get_retention_map`, `compare_retention`. Mở rộng phần học của 070. 🗄 | 070, 087 | Cursor | M |
| TASK-090 | Agent tự xem lại video (ý 25) | `review_render`: bảng khung hình, lời có mốc, danh sách cắt, độ to, mật độ chữ. `render_reviews`. 🗄 | 085 | Cursor | M |
| TASK-091 | Unit economics theo thị trường và format 🔴 | Gap #4: RPM thật, chi phí, lợi nhuận theo nhóm. Không tự điền khi thiếu. Thêm độ sẵn sàng kiếm tiền theo từng tài khoản (gap #2 của 072). 🗄 | 082 | Codex | M |
| TASK-074b | Skill tự viết | Guide đã có. 🗄 | 074a | Codex | M |

088 và 090 không cần dữ liệu thật, bắt đầu được ngay khi 085 xong, kể cả lúc G1 còn dang dở.

## G3. Phòng thí nghiệm và trí nhớ (tháng 4–6)

**Mục tiêu đo được:** mỗi kênh có từ 2 thử nghiệm kết luận được mỗi tháng. Từ 60 % kết luận "giữ" còn đúng khi đo lại sau 28 ngày. Thời gian xem trung bình mỗi lượt hiển thị của video thường tăng so với quý trước.

**Điều kiện xong:** agent tự đi hết một vòng trên kênh thật: tạo thử nghiệm → code gán video → đọc kết quả → kết luận → đề xuất đổi tham số và mục playbook → người duyệt → video sau dùng giá trị mới. Mỗi bước có audit.

| Mã | Tên | Nội dung | Phụ thuộc | Ai | Khó |
|---|---|---|---|---|---|
| TASK-092a | Lab: lõi (ý 23 + 073d) 🔴 | `experiments`, `experiment_assignments`, `experiment_results`. Gán nhóm, snapshot, thống kê có khoảng tin cậy, trần 15 %, breaker theo nhánh. Kind `format_signal` và half-life của 073d nằm ở đây. 🗄 | 087, 088, 089 | Codex | L |
| TASK-092b | Lab: tool, UI, bandit gợi ý | `create_experiment`, `conclude_experiment`, trang "Thử nghiệm", Thompson sampling chỉ gợi ý. Gộp `title_experiments` và sổ thí nghiệm của gap #3. Theo 086: Test & Compare chỉ khởi chạy và đọc kết quả trong Studio; kết quả nhập tay có nguồn. | 092a | Cursor | M |
| TASK-093 | Channel playbook (ý 24) | `channel_playbook_entries`, index vào RAG, đưa vào prompt kịch bản/đóng gói/đạo diễn, hạn dùng, kiểm bằng chứng. Đổi tên `operator/playbooks.ts`. 🗄 | 092a | Cursor | M |
| TASK-094 | Pattern library (ý 26) | `creative_patterns` với schema theo kind. Chuyển format recipes và edit preset hiện có thành mẫu dựng sẵn. 🗄 | 088 | Cursor, Fable (bộ mẫu hook và tiêu đề khởi đầu) | M |
| TASK-074c | Đề xuất cải tiến app | Guide đã có. Từ đây agent xin được kiểu cảnh, tool, chỉ số mới. 🗄 | 074b | Codex | M |

Vì sao gộp 073d vào 092: cả hai cùng là "dành một phần video để thử phương án khác và đo". 073d lo tín hiệu phai dần và thay đổi không ai báo, lab lo giả thuyết do agent đặt. Chung bảng gán nhóm, chung trần, chung thống kê. Tách ra sẽ có hai cơ chế tranh nhau cùng 15 % video.

## G4. Công cụ sáng tạo (tháng 6–9)

**Mục tiêu đo được:** CTR hiển thị 48 giờ tăng tương đối từ 15 % mà tỉ lệ còn xem ở giây 30 không giảm (nhóm có gói so với 20 video trước của kênh). Tỉ lệ xem tiếp giữa hai tập liền nhau của series đo được và báo trong bản tin. Mỗi task xong khi agent đã chạy ít nhất một thử nghiệm trên công cụ đó.

**Điều kiện xong:** các công cụ dưới đây đều có tham số trong registry, mẫu trong pattern library và gen trong `video_genes`. Không công cụ nào có ngưỡng viết cứng.

| Mã | Tên | Nội dung | Phụ thuộc | Ai | Khó |
|---|---|---|---|---|---|
| TASK-095 | Đóng gói trước, viết sau (ý 9) | Bước `PACKAGING`, `topic_packages`, ràng buộc cho SCRIPT, cổng "trả đủ lời hứa". 🗄 | 094 | Cursor; Fable (prompt chấm và thang điểm) | M |
| TASK-096 | Thumbnail bằng template (ý 12) | Bố cục HyperFrames theo bộ nhận diện, nhiều biến thể. | 095 | Fable (bố cục), Cursor (nối) | M |
| TASK-097 | Nhịp ngắt + nhạc theo cung (ý 11, 8) | Tham số khoảng cách ngắt, mẫu `music_arc`, luật đạo diễn mới. | 088, 094 | Cursor; Fable (luật đạo diễn) | M |
| TASK-098a | Bộ nhận diện + người dẫn (ý 2, 3) | `profiles.identity`, `profiles.persona`, template đọc bộ nhận diện, trí nhớ lời đã nói. 🗄 | 094 | Cursor; Fable (2–3 bộ mẫu) | M |
| TASK-098b | Series nhiều tập (ý 1) | `series`, `plan_series`, playlist, link tập kế, `get_series_stats`. Theo 086: playlist tạo/thêm/xếp bằng API (50 units/lệnh); end screen, card, ghim bình luận là yêu cầu "Cần bạn" làm trong Studio. 🗄 | 098a, RESEARCH-086 | Codex | L |
| TASK-099 | Cảnh `diagram` và `timeline` (ý 5) | Template + renderer + luật đạo diễn. | 070 | Fable (template), Cursor | M |
| TASK-100 | Khán giả hỏi, kênh trả lời (ý 7) 🔴 | Gom cụm câu hỏi từ bình luận, đưa vào hàng chủ đề. | 082 | Cursor | S |

Phần code của 095–099 làm được trước khi G3 xong. Phần **đo** thì cần lab, nên các task này chỉ được coi là xong sau G3.

## G5. Tiền (tháng 9–12)

**Mục tiêu đo được:** lợi nhuận mỗi video (doanh thu trừ LLM, TTS, footage) dương ở ít nhất một kênh. Có ít nhất một nguồn thu ngoài quảng cáo ghi nhận trong finance. Một kênh thứ hai ở thị trường RPM cao hơn chạy bằng video chuyển thể.

**Điều kiện xong:** bảng unit economics cho thấy kênh và format nào có lãi. Agent tự đề xuất hướng kênh dựa trên bảng đó và bộ chấm ngách.

| Mã | Tên | Nội dung | Phụ thuộc | Ai | Khó |
|---|---|---|---|---|---|
| TASK-101 | Thang thị trường (ý 13) 🔴 | `list_transcreation_candidates`, `transcreate_project`, `sourceProjectId`. Cổng originality kiểm phần địa phương. 🗄 | 084, 091; người dùng tạo kênh đích | Codex | M |
| TASK-102a | Sổ affiliate và tài trợ | Gap #5: `affiliate_products`, `campaigns`, link + UTM, disclosure, doanh thu sau hoàn. 🗄 | 091 | Codex | M |
| TASK-102b | Kịch bản biết bán hàng + media kit (ý 15, 16) 🔴 | `score_product_fit`, chỗ gắn trong kịch bản, khe tài trợ, `build_media_kit`. | 102a | Cursor; Fable (prompt gắn sản phẩm) | M |
| TASK-103 | Shorts viết riêng + phễu (ý 18, gap #6) 🔴 | `derive_asset`, ghép ID Short ↔ dài, `get_funnel_stats`. 🗄 | 087 | Cursor | M |
| TASK-104 | Độ dài và điểm chèn (ý 14) 🔴 | Tham số độ dài, `suggest_ad_breaks`, đo RPM theo độ dài. Cần kênh có YPP. Theo 086: không có API đặt mid-roll VOD, chỉ gợi ý + người dùng xác nhận đã đặt. | 091, RESEARCH-086 | Cursor | S |
| TASK-105 | Bộ chấm ngách + radar cơ hội (ý 19, 20) | `score_niche`, `find_outliers`, `get_seasonal_windows`. | 074a, 091 | Codex | M |
| TASK-106 | Kiến trúc phong cách theo kênh, gói thể loại, bộ sinh biến thể, đo độ giống nhau | Video giữa các kênh và trong một kênh không trông như sản xuất hàng loạt; thêm thể loại bằng dữ liệu. Guide: `docs/cursor/TASK-106.md`. 2026-11-12: Fable hết usage giữa chừng; lõi `packages/shared/src/style/` xong (56 test), `common.js` + `list_full` đã chuyển sang token. Thiếu tài liệu, mẫu, báo cáo; server chưa truyền `variables.style` → phần còn lại chia thành 108–113 cho Cursor. | 070b, 084 | Fable (kiến trúc + lõi), Cursor (phần còn lại) | L |
| TASK-107 | Originality không chặn bước | Recheck lỗi chỉ log cảnh báo, retention vẫn chạy; API thủ công và đăng bài vẫn báo lỗi. Xong 2026-11-12. Điểm 2 (đồ hoạ fullscreen) không cần sửa: lớp đó trong suốt nên ảnh dưới vẫn hiện. Guide: `docs/cursor/TASK-107.md`. | 084 | Cursor | XS |
| TASK-108 | Phong cách 1: nối vào render, tài liệu, mẫu | Truyền `variables.style` + biến thể cho mọi template (sửa `list_full` đang lỗi), khoá cache theo style, viết `docs/architecture/style-system.md`, render mẫu 2 preset. Guide: `docs/cursor/TASK-108.md`. Xong 2026-11-12 (mẫu ở `docs/compose/samples/style/`). | 106 | Cursor (grok-4.7-xhigh) | M |
| TASK-109 | Phong cách 2: lưu style pack + lịch sử look 🗄 | Bảng `style_packs` có phiên bản, gắn kênh → pack, lưu look mỗi render để xoay vòng biến thể; kênh mới tự nhận preset khác nhau. Guide: `docs/cursor/TASK-109.md`. Xong 2026-11-12 (migration 0064). | 108 | Cursor (grok-4.7-medium) | M |
| TASK-110 | Phong cách 3: chuyển các template còn lại sang token | map, compare, quote_full, chart, kinetic… theo hợp đồng tokens-v1, mỗi template khai trục biến thể. Guide: `docs/cursor/TASK-110.md`. | 108 | Cursor (grok-4.7-medium) | L |
| TASK-111 | Phong cách 4: API + trang cài đặt + LLM đề xuất pack | Tạo pack từ preset/lựa chọn/màu thương hiệu/LLM theo ngách kênh; xem trước. Chưa có guide. | 109 | Cursor | M |
| TASK-112 | Phong cách 5: director đọc gói thể loại | Director dùng `genreDirectives` thay vì so id recipe; QUALITY cho LLM chọn trong `variantOptions`. Chưa có guide. | 108 | Cursor (grok-4.7-xhigh) | M |
| TASK-113 | Phong cách 6: độ giống nhau vào originality | Lấy khung render + look → `visualSameness`, thêm tín hiệu vào báo cáo 084, trong kênh và giữa các kênh. Chưa có guide. | 109 | Cursor | S |

**Nhiều người dùng, nhiều máy, đóng gói** (thiết kế: `docs/architecture/multi-user-multi-node.md`):

| Task | Tên | Việc | Phụ thuộc | Ai | Cỡ |
|---|---|---|---|---|---|
| TASK-114 | Đăng nhập + bảo vệ mọi route 🔐 | Better Auth, chủ sở hữu tạo lần đầu, đăng nhập web, API key cho MCP/Telegram/operator. Guide: `docs/cursor/TASK-114.md`. | 110 xong | Cursor (grok-4.7-xhigh) | L |
| TASK-115 | Workspace, vai trò, quyền theo kênh | Policy chung cho route và tool, `workspace_id`, nhật ký audit. Guide: `docs/cursor/TASK-115.md`. | 114 | Cursor (grok-4.7-xhigh) | L |
| TASK-116 | Giao diện nhóm | Mời người, vai trò, quyền kênh, 2FA, phiên, API key, xem audit. Guide: `docs/cursor/TASK-116.md`. | 115 | Cursor (grok-4.7-medium) | M |
| TASK-117 | Đóng gói Docker 📦 | Một image, compose control/worker, Caddy HTTPS, script cài, Litestream. Guide: `docs/cursor/TASK-117.md`. | — | Cursor (grok-4.7-medium) | M |
| TASK-118 | Máy worker v1 | Đăng ký node, heartbeat, lease job, artifact theo hash, render từ xa. Guide: `docs/cursor/TASK-118.md`. | 114, 117 | Cursor (grok-4.7-xhigh) | L |
| TASK-119 | Trang Nodes | Lệnh thêm máy, sức khoẻ, cấu hình từ xa, drain, ghim phiên bản, tự cập nhật. Chưa có guide. | 118 | Cursor (grok-4.7-medium) | M |
| TASK-120 | Thêm bước chạy từ xa | TTS cục bộ, tải media, secret ngắn hạn cho node. Chưa có guide. | 119 | Cursor (grok-4.7-xhigh) | M |

**Sau 12 tháng, chưa xếp:** ý 6 (số liệu riêng), 17 (sản phẩm số, bản hội viên), 21 (video sống), 4 (tranh luận hai giọng), ba ý táo bạo. Agent có thể tự đề nghị kéo lên sớm qua 074c khi có bằng chứng.

## Điểm cần dữ liệu thật

| Mốc | Cần gì | Mở khoá |
|---|---|---|
| M1: lần đăng thật đầu tiên (TASK-082) | Người dùng tạo app developer, OAuth YouTube | 083, 087, 091, 100 |
| M2: 10 video có số 7 ngày | Kênh đăng đều | Kiểm chứng 087, 089. Ngưỡng `insufficient_data` đầu tiên |
| M3: 30 video, đường retention ổn định | Khoảng 6–8 tuần đăng | 092a có đủ mẫu. Kết luận thử nghiệm đầu tiên |
| M4: kênh đủ điều kiện YPP | Phụ thuộc nền tảng, không điều khiển được | 104, RPM thật cho 091, quảng cáo trong G5 |
| M5: kênh thứ hai | Người dùng tạo tài khoản | 101 |

Trước M1, mọi task 🔴 chỉ viết được code và test với fixture. Không đánh dấu "xong" cho task 🔴 khi chưa có lần chạy thật. Nếu M4 chậm, G5 đi trước bằng 102 và 103, là hai nguồn không cần YPP.

## Song song hoá

Luật: vùng file tách nhau, và mỗi lúc chỉ **một** task 🗄 được sinh migration. Task 🗄 thứ hai chờ task trước review và commit xong.

| Lúc | Làn 1 (giữ quyền migration) | Làn 2 (không migration) | Làn 3 (người dùng / research) |
|---|---|---|---|
| G1 đầu | 070 | 076, 081 | 080, rồi 082; RESEARCH-086 |
| G1 giữa | 084, rồi 074a | 083 | 082 tiếp tục |
| G1 cuối | (trống) | 085, chạy một mình vì chạm nhiều file | chạy thật 7 ngày |
| G2 | 088 → 087 → 089 → 090 → 091 → 074b | phần web của từng task sau khi API ổn | đăng đều để tới M2, M3 |
| G3 | 092a → 093 → 094 → 074c | 092b; Fable soạn bộ mẫu | người dùng duyệt thử nghiệm đầu |
| G4 | 095 → 098a → 098b | 096, 097, 099 (đều trong `compose/` và `assets/`, chia theo thư mục template) | 100 |
| G5 | 102a → 101 → 103 | 102b, 104, 105 | tạo kênh thứ hai, đăng ký affiliate |

Sau TASK-085, hai task chạm tool khác nhóm không còn đụng cùng file. Trước 085, không chạy song song hai task cùng thêm tool hoặc cùng thêm bảng.

## Rủi ro của lộ trình

| Rủi ro | Hệ quả | Cách giảm |
|---|---|---|
| Đăng thật chậm (OAuth, duyệt app, lỗi provider thật) | G2–G5 không đo được | 082 đi đầu G1. Chỉ cần YouTube trước. 088, 090, 094 và code G4 làm trong lúc chờ |
| Kênh ít lượt xem, mẫu nhỏ | Lab không kết luận được, hoặc kết luận sai | Code ép cỡ mẫu tối thiểu, trả `insufficient_data`. Thử biến có tác động lớn trước (gói, hook). Chỉ số chính là thời gian xem |
| Xây lab trước khi biết dữ liệu trông thế nào | Schema sai, phải làm lại | 087 và 089 chạy thật ít nhất 4 tuần trước khi viết guide 092a |
| Kênh mất quyền kiếm tiền vì "sản xuất hàng loạt" | Mất cả kênh | 084 và 083 nằm trong G1, trước khi tăng số video. Bản sắc kênh (098a) không để quá muộn |
| Nền tảng đổi API hoặc chính sách giữa chừng | Task đang làm lệch | RESEARCH-086 ra knowledge entry có hạn dùng. Detector 073 đã chạy. Guide kiểm lại knowledge trước khi giao |
| Ngân sách Fable nhỏ | Template và prompt chấm chậm | Cursor dựng khung và test trước. Fable chỉ nhận phiên ngắn có sẵn harness eval. Mỗi giai đoạn tối đa 2–3 phiên |
| Refactor 085 gây lỗi ngầm | Hỏng đường ảnh đang chạy được | Không đổi hành vi, giữ nguyên test, chạy một mình, review bằng một lượt chạy thật trên dự án thử |
| Agent chỉnh quá tay | Kênh tụt | Giới hạn và bước tối đa trong code, một thay đổi mỗi cửa sổ đo, tự hoàn tác theo CUSUM, mặc định chờ duyệt |
| Việc chưa commit phình thêm | Mất máy là mất việc | 080 là task đầu tiên. Sau đó commit sau mỗi task đã review |
| Quá nhiều công cụ, agent không dùng | Công sức bỏ phí | Mỗi task xong khi agent đã gọi tool trong một lượt chạy thật. Routing eval có ca cho tool mới |

## Câu hỏi còn mở và giả định đang dùng

Tám câu ở mục 5 của `IDEAS.md` chưa có trả lời. Lộ trình trên dùng các giả định sau.

| Câu | Giả định đang dùng | Câu trả lời nào đổi lộ trình |
|---|---|---|
| 1. Mục tiêu | Lợi nhuận trong 12 tháng, chỉ số chính của lab là thời gian xem mỗi lượt hiển thị | "Tăng người đăng ký trước": 103 và 100 lên G4, 104 lùi |
| 2. Ngân sách | Giữ trần hiện tại, 15 % video cho thử nghiệm, không tạo ảnh AI trả phí | Ngân sách vision thấp: 090 chỉ trả phần số. Có tiền tạo ảnh: xét ý B1 |
| 3. Số kênh | Một kênh YouTube tiếng Việt tới hết G4, thêm một kênh thị trường RPM cao ở G5 | Nhiều kênh sớm: 101 và 098a lên G3, 105 lên G2 |
| 4. Vùng cấm | Chỉ guideline pack, người dẫn không có quan điểm về chính trị, y tế, tài chính cá nhân | Cho tranh luận: ý 4 vào G4 |
| 5. Nguồn thu cần bạn ra tay | Chịu làm affiliate, chưa làm sản phẩm số và hội viên | Không làm affiliate: bỏ 102, G5 dồn vào 101 và 103 |
| 6. Tên người bình luận | Chỉ hiện nội dung, không hiện tên | Không đổi lộ trình, chỉ đổi mặc định của 100 |
| 7. Mức tự áp dụng | `set_param` cấp hồ sơ và kích hoạt mục playbook luôn chờ duyệt. Nhánh thử nghiệm chạy theo grant `strategy` trong trần | Cho tự áp dụng: thêm một task nhỏ về grant mới sau 093. Đây là đổi quyết định §2 |
| 8. Việc chỉ có trong Studio | `computer_act` tắt, thành yêu cầu "Cần bạn" | Bật cho riêng các việc này: thêm task sau RESEARCH-086, 098b và 104 tự động hơn. Cũng là đổi §2 |

Hai câu mới, cần trả lời trước G1:
- **Kênh đầu tiên làm ngách gì?** Agent tự chọn được khi có 105, nhưng 105 nằm ở G5. Để có M1 sớm, cần bạn chọn tạm một ngách có ảnh mở. Nếu muốn agent chọn ngay từ đầu, kéo 105 lên G1 và chấp nhận M1 chậm vài tuần.
- **Ai commit và khi nào?** Lộ trình giả định commit sau mỗi task đã review. Nếu vẫn dồn như hiện nay, luật "một migration một lúc" không giữ được.
