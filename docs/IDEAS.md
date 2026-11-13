# Ý tưởng sản phẩm: công cụ để agent làm video sáng tạo hơn và kiếm nhiều tiền hơn

> Bản 2, viết ngày 2026-11-11. Đầu vào: `BLUEPRINT.md` §1–§3 (gồm mục "Chúng ta xây công cụ, agent vận hành"), `research/monetization/`, `compose/README.md`, bảng task, tổng quan TASK-074 và TASK-059 §1.
> **Vai:** chúng ta chỉ xây tool, dữ liệu, cách đo và rào chắn. Agent (operator + trợ lý) chọn, thử, giữ, đổi. Mỗi ý có dòng "Cho agent". Tên tool là gợi ý. Tool `read` chạy tự do, tool `confirm` đi qua grant hoặc chờ duyệt như hiện nay.
> Không lặp 6 đề xuất trong `gap-analysis.md` và không lặp TASK-074 (research, viết skill, đề xuất cải tiến). Các ý dưới đây xây tiếp lên chúng.
> Token ghi theo số call LLM thêm mỗi video ở BALANCED. Số tác động là lý lẽ, chưa có số đo thật. "Cần kiểm API" là điều chưa xác minh, phải thành knowledge entry trước khi làm.

## 1. Tầm nhìn

Sau một năm, mỗi kênh là một **chương trình có tên tuổi do agent tự vận hành và tự làm tốt lên**. Agent chọn ngách và thị trường bằng research và số liệu, lập series, chọn gói tiêu đề, dựng theo bộ nhận diện riêng của kênh. Sau mỗi video nó tự xem lại bản dựng, đối chiếu đường giữ chân, ghi bài học vào sổ tay kênh và đặt giả thuyết cho lần sau. Khoảng 15% video là thử nghiệm do chính nó thiết kế.

Tiền đến từ bốn lớp: quảng cáo (video dài trên 8 phút, Shorts làm phễu), affiliate gắn vào kịch bản, tài trợ nhờ media kit tự cập nhật, sản phẩm số theo series. Video thắng được agent chuyển thể sang thị trường RPM cao.

Người dùng đặt mục tiêu, ngân sách và giới hạn, làm việc chỉ họ làm được (tài khoản, hợp đồng, tiền), duyệt điểm rủi ro và đọc bản tin. Khi thiếu công cụ, agent gửi đề xuất cải tiến có bằng chứng. Nó không sửa code.

## 2. Danh sách ý tưởng

### A. Định dạng và bản sắc

**1. Series nhiều tập có mạch truyện** · L · +1 call mỗi series, +0–1 mỗi tập
- Làm gì: đối tượng "series" gồm dàn tập, mạch chung, câu mở sang tập sau. Kèm playlist, đánh số, link tập kế trong mô tả, thumbnail cùng khung.
- Vì sao: người xem có lý do xem tiếp, tăng thời gian xem theo phiên. Series là bằng chứng "câu chuyện riêng" trước luật nội dung lặp lại. Lấp K6.
- Cho agent: tool `plan_series`, `get_series_stats` (tỉ lệ xem tiếp giữa các tập). Agent quyết mở series nào, bao nhiêu tập, khi nào dừng sớm. Học: mạch nào giữ người xem. Rào chắn: grant `topics`, trần số series mở cùng lúc.
- Dựa trên: hàng chủ đề (028), format recipes (043), RAG (057), publisher YouTube (025).
- Rủi ro: một tập yếu kéo cả series. Màn hình kết thúc, ghim bình luận có thể không có API (cần kiểm API).

**2. Bộ nhận diện kênh (hình + tiếng)** · M · 0
- Làm gì: mỗi hồ sơ có một bộ dữ liệu: bảng màu, phông, chuyển cảnh, nền đồ hoạ, nhạc hiệu, đoạn mở 3 giây, kiểu phụ đề. Mọi template và thumbnail đọc bộ này.
- Vì sao: kênh nhận ra được thì người xem quay lại. Hai kênh cùng app trông khác nhau, giảm rủi ro "sản xuất hàng loạt".
- Cho agent: `propose_identity` (confirm) và `preview_identity` (dựng mẫu). Agent đề xuất bộ ban đầu từ research ngách, sau đó chỉ tinh chỉnh từng phần. Học: phần nào liên quan tới tỉ lệ quay lại. Rào chắn: đổi cả bộ luôn cần người duyệt, kiểm tương phản bằng code, có hoàn tác.
- Dựa trên: `common.js`, `graphicVars.ts`, edit preset theo hồ sơ (041), thumbnail (036).
- Rủi ro: thấp. Nhạc hiệu phải có giấy phép rõ.

**3. Người dẫn có tính cách và trí nhớ** · M · +0
- Làm gì: "hồ sơ người dẫn" là dữ liệu: lập trường, câu cửa miệng, điều hay hoài nghi. Kịch bản phải có luận điểm riêng và có thể nhắc lại điều đã nói ở tập trước lấy từ RAG.
- Vì sao: bình luận và quan điểm riêng là thứ chính sách kiếm tiền đòi. Giọng nhất quán tạo fan.
- Cho agent: `get_persona`, `propose_persona_change` (confirm), `search_past_statements`. Agent quyết luận điểm từng tập và khi nào nhắc lại tập cũ. Học: kiểu lập luận nào kéo bình luận và thời gian xem. Rào chắn: guideline pack thắng tính cách, đổi tính cách cần người duyệt.
- Dựa trên: hướng đi hồ sơ (022), RAG kịch bản (057), cổng kịch bản (066/069).
- Rủi ro: quan điểm mạnh ở chủ đề nhạy cảm.

**4. Định dạng tranh luận hai giọng** · M · +1 call
- Làm gì: format recipe mới: hai giọng TTS giữ hai phía, giọng thứ ba chốt, hình chia đôi, bảng điểm lý lẽ.
- Vì sao: xung đột giữ chân hơn độc thoại, trình bày hai phía là phân tích thực chất, người xem chọn phe nên bình luận tăng.
- Cho agent: recipe `debate` trong danh sách format cùng số liệu của nó. Agent quyết chủ đề nào hợp tranh luận. Học: so retention với format khác trong cùng ngách. Rào chắn: danh sách chủ đề cấm là tham số người dùng đặt, agent không nới được.
- Dựa trên: TTS có word timing (040), cảnh `compare` (070), format recipes (043).
- Rủi ro: dựng phe đối lập sai lệch.

**5. Cảnh quay sơ đồ và dòng thời gian** · M · +0
- Làm gì: kiểu cảnh `diagram` và `timeline`, vẽ dần theo lời đọc. LLM trả nút và cạnh, code xếp bố cục.
- Vì sao: hình tự làm, nguyên bản, không dính bản quyền. Giảm số lần dừng hỏi vì thiếu ảnh đúng chủ đề.
- Cho agent: hai kiểu cảnh mới trong bảng lựa chọn của đạo diễn, kèm thống kê theo kiểu cảnh (070). Agent quyết tỉ lệ dùng qua tham số (ý 22). Học: retention của cảnh sơ đồ so với ảnh. Rào chắn: code kiểm đồ thị hợp lệ, cảnh lỗi lùi về ảnh tĩnh. Đây không phải cách né cổng ảnh lạc đề: cảnh thiếu ảnh vẫn dừng hỏi.
- Dựa trên: HyperFrames + `VGInit`, đạo diễn (067b), word timing.
- Rủi ro: sơ đồ sai logic. Render 16–38 giây mỗi cảnh.

**6. Số liệu riêng từ dữ liệu mở** · L · +1–2 call
- Làm gì: connector tới nguồn dữ liệu mở (World Bank, Our World in Data, Wikidata) và bộ tính bằng code (xếp hạng, tăng trưởng, so sánh). Kết quả thành biểu đồ có ghi nguồn.
- Vì sao: "đóng góp mới" mạnh nhất kênh faceless làm được. Biểu đồ riêng hay được trích lại.
- Cho agent: `search_datasets`, `query_dataset`, `compute_comparison` (đều `read`). Agent quyết câu hỏi nào đáng tính và đưa số nào vào kịch bản. Học: video có số liệu riêng có được chia sẻ hơn không. Rào chắn: phép tính do code làm, agent không tự gõ số. Mỗi số có nguồn và giấy phép.
- Dựa trên: cảnh `chart`, `parseNumbers`, knowledge entry, research skill (074a).
- Rủi ro: so sánh khập khiễng, dữ liệu cũ.

**7. Khán giả hỏi, kênh trả lời** · S–M · +1 call
- Làm gì: gom câu hỏi lặp lại trong bình luận thành cụm, có số lần hỏi. Video mở bằng chính bình luận đó trên màn hình.
- Vì sao: nhu cầu thật, không kênh nào chép được, người được nhắc chia sẻ lại. Lấp K8.
- Cho agent: `get_comment_questions` (cụm + tần suất) và `add_topic_from_comment`. Agent quyết cụm nào thành video. Học: video trả lời có CTR từ người đăng ký cao hơn không. Rào chắn: bình luận là dữ liệu untrusted, hiện tên theo cài đặt người dùng (mục 5).
- Dựa trên: hộp bình luận (038), cảnh `quote_full` (070), hàng chủ đề (028).
- Rủi ro: quyền riêng tư của người bình luận.

**8. Nhạc theo cung cảm xúc** · M · +0
- Làm gì: 2–4 đoạn nhạc theo cung của kịch bản, có tiếng chuyển, hạ nhạc khi đọc số quan trọng, im lặng ngắn trước ý chính.
- Vì sao: âm thanh đều đều là điểm yếu của video tự động. Đổi âm thanh là kiểu ngắt nhịp rẻ nhất.
- Cho agent: "cung nhạc" là mẫu dữ liệu trong thư viện (ý 26), mức hạ nhạc và độ dài im lặng là tham số (ý 22). Agent chọn cung cho từng format. Học: điểm tụt retention quanh chỗ đổi nhạc. Rào chắn: chỉ nhạc có giấy phép lưu được, trần số bản mỗi video.
- Dựa trên: MUSIC_SEARCH, `detectBeats`, SFX (041), trợ lý nhạc (019).
- Rủi ro: Content ID nhận nhầm, phải giữ bằng chứng nguồn.

### B. Giữ chân và CTR

**9. Đóng gói trước, viết sau** · M · +1 call mỗi chủ đề
- Làm gì: trước kịch bản, sinh nhiều gói "tiêu đề + ý tưởng thumbnail + câu mở + lời hứa". Gói được chọn thành ràng buộc cho kịch bản, cổng kịch bản kiểm "trả đủ lời hứa".
- Vì sao: CTR và 30 giây đầu nhân lên mọi nguồn thu. Hiện thumbnail làm sau render, lúc đó không sửa được nội dung.
- Cho agent: `generate_packages`, `score_package` (code + LLM), `choose_package`. Agent quyết gói nào, và bỏ chủ đề nào vì không có gói tốt. Học: kiểu gói nào thắng ở kênh này, ghi vào sổ tay. Rào chắn: guideline chặn giật tít, cổng lời hứa đọc số từ server, trọng số chấm nằm trong giới hạn.
- Dựa trên: metadata (019), thumbnail (036), cổng kịch bản (066), sổ thí nghiệm (gap #3).
- Rủi ro: CTR tăng mà retention tụt. Phải đo cả hai.

**10. Bản đồ giữ chân gắn vào timeline** · M · 0
- Làm gì: đặt đường retention lên timeline đã dựng, đánh dấu điểm tụt và điểm tua lại, gắn với kiểu cảnh, độ dài cảnh, câu thoại.
- Vì sao: biết đúng cảnh nào đuổi người xem. Lấp K2. Đây là "mắt" cho hầu hết ý khác.
- Cho agent: `get_retention_map(videoId)` và `compare_retention` (theo kiểu cảnh, format, gói). Agent dùng sau mốc 48 giờ và 7 ngày để chỉnh tham số, ghi sổ tay, đặt giả thuyết. Rào chắn: dưới ngưỡng lượt xem thì tool trả "chưa đủ dữ liệu" thay vì số.
- Dựa trên: analytics (033), plan JSON + thống kê compose (068), vòng học (035, 070).
- Rủi ro: đường cong nhiễu ở video ít lượt xem.

**11. Nhịp ngắt do agent chỉnh** · S · 0
- Làm gì: đạo diễn nhận tham số "khoảng cách tối đa giữa hai thay đổi rõ" (đổi kiểu cảnh, câu hỏi mở, số bất ngờ, đổi nhạc). Giá trị khởi đầu 25–40 giây, không phải hằng số.
- Vì sao: giữ chân giữa video quyết định số mid-roll được xem. Luật V1–V4 mới lo đa dạng hình.
- Cho agent: tham số theo hồ sơ và theo format trong bảng tham số (ý 22). Agent chỉnh sau khi đọc bản đồ giữ chân. Học: khoảng nào hợp ngách nào. Rào chắn: giới hạn cứng 10–90 giây, mỗi lần đổi một bước, tự hoàn tác nếu retention tụt.
- Dựa trên: `variety.ts`, `pacing.ts`, luật R1–R6.
- Rủi ro: lạm dụng thành rối.

**12. Thumbnail dựng bằng template** · M · +0–1 call
- Làm gì: thumbnail là bố cục HyperFrames: chủ thể cắt nền, 2–4 chữ, một con số, theo bộ nhận diện. Xuất nhiều biến thể.
- Vì sao: khung hình lấy từ video hiếm khi là thumbnail tốt. Lấp K3.
- Cho agent: `render_thumbnail(layout, text, image)` và `list_thumbnail_layouts` kèm CTR theo bố cục. Agent quyết bố cục và chữ. Học: bố cục nào thắng. Rào chắn: ảnh phải qua cổng giấy phép, chữ qua guideline.
- Dựa trên: thumbnail (036), HyperFrames `static`, cắt ảnh (062), ý 2.
- Rủi ro: nạp biến thể vào Test & Compare có thể phải làm tay (cần kiểm API).

### C. Kiếm tiền

**13. Thang thị trường** · M · chỉ tốn ở video được chọn
- Làm gì: công cụ "chuyển thể" một video sang kênh ở thị trường khác: viết lại ví dụ, đơn vị, sự kiện theo market pack, giọng bản địa, tìm lại ảnh.
- Vì sao: RPM chênh nhiều lần giữa các nước (ước tính trong market pack). Chỉ chuyển cái đã thắng thì rẻ và dễ trúng.
- Cho agent: `list_transcreation_candidates` (video vượt ngưỡng + RPM đích + chi phí ước tính) và `transcreate_project` (confirm). Agent quyết video nào, sang nước nào. Học: tỉ lệ thắng theo cặp thị trường. Rào chắn: chỉ sang kênh người dùng đã tạo, trong ngân sách, cổng originality kiểm phần nội dung địa phương.
- Dựa trên: lồng tiếng (039), market pack (071), vòng học (035), finance (034).
- Rủi ro: dịch thẳng dễ bị coi là nội dung tái sử dụng.

**14. Độ dài và điểm chèn quảng cáo** · S–M · 0
- Làm gì: độ dài mục tiêu là tham số theo format. Code đề xuất vị trí mid-roll ở ranh giới cảnh tự nhiên và đo RPM, retention quanh đó.
- Vì sao: trên 8 phút mới đặt được mid-roll, là cách tăng RPM rẻ nhất khi đã có YPP. Lấp K4.
- Cho agent: `suggest_ad_breaks(projectId)`, `get_length_stats`. Agent quyết chủ đề nào đủ sâu để kéo dài. Học: RPM theo độ dài. Rào chắn: cổng kịch bản chặn kéo dài loãng. Nếu đặt điểm chèn chỉ có trong Studio thì thành yêu cầu "Cần bạn".
- Dựa trên: SCENE_PLAN, `cutCandidates`, finance.
- Rủi ro: kéo dài làm tụt retention (cần kiểm API cho việc đặt điểm chèn).

**15. Kịch bản biết bán hàng** · M · +1 call
- Làm gì: danh mục sản phẩm affiliate theo hồ sơ (người dùng nhập), điểm "độ khớp sản phẩm" cho chủ đề, chỗ gắn tự nhiên trong kịch bản, link có UTM và dòng công bố.
- Vì sao: có tiền cả khi chưa đủ điều kiện quảng cáo. Sổ affiliate (gap #5) chỉ ghi nhận, ý này làm nội dung sinh đơn.
- Cho agent: `list_products`, `score_product_fit`, `get_conversion_stats`. Agent quyết video nào gắn sản phẩm nào, hoặc không gắn. Học: tỉ lệ chuyển đổi theo kiểu gắn. Rào chắn: agent không đăng ký chương trình, không đụng payout. Công bố bắt buộc do code chèn. Trần tỉ lệ video có sản phẩm.
- Dựa trên: hàng chủ đề (028), metadata (019), guideline (017), finance (034).
- Rủi ro: tuyên bố sai về sản phẩm.

**16. Media kit tự cập nhật và khe tài trợ** · S · +1 call mỗi tháng
- Làm gì: xuất media kit từng kênh (khán giả, số liệu, series, giá gợi ý). Format recipe có khe tài trợ 20–30 giây kèm nhãn đúng nền tảng.
- Vì sao: một hợp đồng tài trợ thường lớn hơn nhiều tháng quảng cáo ở kênh nhỏ. Lấp K12, O5.
- Cho agent: `build_media_kit`, và khe tài trợ là một lựa chọn khi lập kịch bản nếu có deal người dùng đã nhập. Agent quyết khi nào kênh đủ số để báo người dùng đi tìm tài trợ. Rào chắn: agent không liên hệ nhãn hàng, không ký, không báo giá ra ngoài.
- Dựa trên: analytics (033), báo cáo tháng (034), nhãn tài trợ trong guideline.
- Rủi ro: thấp.

**17. Sản phẩm số và bản mở rộng cho hội viên** · M–L · +2–3 call mỗi series
- Làm gì: từ nghiên cứu của series, soạn sổ tay PDF, bảng tính, bộ thẻ ghi nhớ. Từ cùng nghiên cứu, dựng bản dài hơn cho hội viên.
- Vì sao: biên lợi nhuận cao, doanh thu định kỳ, không phụ thuộc thuật toán. Lấp O6, O8, Y3.
- Cho agent: `draft_companion_product` (ra bản nháp chờ duyệt), `plan_extended_cut`. Agent quyết series nào đáng có sản phẩm, dựa trên bình luận và lượt lưu. Học: tỉ lệ nhấp link. Rào chắn: phát hành, bán, thu tiền, bật Memberships là việc của người dùng.
- Dựa trên: output RESEARCH/SCRIPT, RAG, cache theo `inputHash`, ý 1.
- Rủi ro: chất lượng sản phẩm, hoàn tiền, thuế.

**18. Một nghiên cứu, sáu sản phẩm** · M · +1–2 call
- Làm gì: từ một video dài sinh Short viết riêng (hook riêng, kết dẫn sang bản dài), bài viết, bài cộng đồng kèm thăm dò, bản âm thanh.
- Vì sao: clip cắt (037) thiếu mở và kết kiểu Shorts. Short viết riêng làm phễu tốt hơn. Lấp K7.
- Cho agent: `derive_asset(projectId, kind)` và `get_funnel_stats` (lượt chuyển Short → dài). Agent quyết video nào đáng tách và tách thành gì. Học: kiểu Short nào kéo người xem sang bản dài. Rào chắn: trần số bản phái sinh, cổng originality so trùng trong kênh.
- Dựa trên: clip ngắn (037), render 9:16 (023), ghép ID Short ↔ dài (gap #6).
- Rủi ro: bài cộng đồng có thể không có API (cần kiểm API).

### D. Tìm cơ hội

**19. Radar cơ hội: video ngoại lệ và mùa vụ** · M · +1 call mỗi tuần
- Làm gì: tìm video kênh khác có lượt xem cao bất thường so với số đăng ký và chỉ lưu **mẫu** (góc, cấu trúc tiêu đề, format, độ dài). Tính ngày nên đăng cho từng sự kiện trong market pack.
- Vì sao: ngoại lệ cho thấy nhu cầu chưa được đáp ứng. Nhu cầu mùa vụ đoán trước được. Lấp K11.
- Cho agent: `find_outliers(niche, market)`, `get_seasonal_windows`. Agent quyết mẫu nào thành giả thuyết (ý 23) và chủ đề nào vào hàng. Học: mẫu mượn có thắng ở kênh mình không. Rào chắn: không lưu kịch bản hay hình của kênh khác, cổng originality so trùng.
- Dựa trên: xu hướng (039), hàng chủ đề (028), research skill (074a), market pack (071).
- Rủi ro: trượt từ học mẫu sang chép nội dung.

**20. Bộ chấm ngách × thị trường** · M · +1 call mỗi lần chấm
- Làm gì: bảng điểm cho ngách ứng viên: nhu cầu, RPM ước tính, độ đông, chi phí sản xuất, độ sẵn ảnh có phép, khả năng có góc riêng, độ khớp affiliate.
- Vì sao: ngách quyết định trần doanh thu. Lấp K1. Người dùng không phải tự trả lời "làm ngách nào".
- Cho agent: `score_niche`, `compare_niches`, trọng số là tham số agent chỉnh. Agent tự research rồi quyết hướng kênh trong grant `strategy`. Mở kênh mới chỉ là đề xuất, vì tạo tài khoản là việc của người dùng. Học: so dự đoán với kết quả thật sau 90 ngày. Rào chắn: RPM ước tính có hạn dùng, đổi hướng tối đa một lần mỗi quý.
- Dựa trên: market pack (071), xu hướng (039), finance (034), unit economics (gap #4).
- Rủi ro: dữ kiện RPM biến động cao.

**21. Video sống: làm mới video cũ còn traffic** · S–M · +1 call mỗi video được chọn
- Làm gì: tìm video cũ còn lượt tìm nhưng gói yếu hoặc dữ kiện hết hạn. Đổi gói hoặc làm bản cập nhật.
- Vì sao: sửa gói cho video đã có traffic rẻ hơn nhiều so với làm video mới.
- Cho agent: `list_refresh_candidates`, `update_packaging` (confirm). Agent quyết sửa gói hay làm lại. Học: mức tăng sau khi đổi. Rào chắn: mỗi video một thay đổi trong một cửa sổ đo, tự hoàn tác nếu tụt, trần số video đổi mỗi tuần.
- Dựa trên: knowledge có hạn dùng (073a), analytics (033), sổ thí nghiệm (gap #3).
- Rủi ro: làm tụt video đang ổn.

### E. Công cụ để agent tự học và sáng tạo

**22. Bảng tham số agent chỉnh được** · M · 0
- Làm gì: một registry cho mọi ngưỡng, khoảng cách, trọng số của tính năng sáng tạo: mặc định, giới hạn dưới và trên, bước đổi tối đa, phạm vi (app, hồ sơ, format), lịch sử, lý do, hoàn tác.
- Vì sao: biến mọi tính năng thành thứ agent cải thiện được mà không cần ai viết code. Đây là hệ quả 2 trong BLUEPRINT.
- Cho agent: `list_params`, `set_param` (confirm, cần lý do và bằng chứng), `revert_param`. Dùng sau khi đọc kết quả thử nghiệm. Học: lịch sử đổi cùng tác động. Rào chắn: giới hạn do code và người dùng đặt, agent không đổi được giới hạn. Tham số về tiền, quyền, cổng an toàn không có trong bảng. Tự hoàn tác khi CUSUM báo tụt.
- Dựa trên: budget preset, `app_settings`, nhật ký và hoàn tác (059), CUSUM (073c).
- Rủi ro: nhiều tham số đổi cùng lúc thì không biết cái nào gây ra kết quả. Cần khoá một thay đổi mỗi cửa sổ đo.

**23. Phòng thí nghiệm sáng tạo** · M · 0 (code), +1 call mỗi tuần
- Làm gì: agent khai giả thuyết (biến, chỉ số, cỡ mẫu, điều kiện dừng). Code gắn "gen" cho mỗi video, chia nhóm, chụp số ở 48 giờ, 7 ngày, 28 ngày, tính chênh lệch và độ chắc. Bandit gợi ý phân bổ. Chi tiết ở mục 3.
- Vì sao: thiếu nó mọi ý khác là phỏng đoán. Có nó kênh tốt lên cộng dồn. Đây là phần thân cho 073d.
- Cho agent: `create_experiment`, `get_experiment_result`, `conclude_experiment`. Agent tự đặt giả thuyết từ sổ tay, radar, research, và quyết giữ hay bỏ. Rào chắn: trần 15% video, cỡ mẫu tối thiểu do code ép, guideline vẫn áp cho mọi nhánh.
- Dựa trên: vòng học (035), báo cáo thử nghiệm (064), thống kê cảnh quay (070), CUSUM (073c).
- Rủi ro: ít dữ liệu thì kết luận sai. Chỉ số chính là thời gian xem, không phải lượt xem.

**24. Sổ tay kênh agent tự ghi** · S–M · +0
- Làm gì: kho bài học nội bộ của từng kênh, mỗi mục có phát biểu, bằng chứng (video, thử nghiệm), độ tin, hạn dùng, phạm vi. Mục đang hiệu lực được đưa vào prompt kịch bản, đóng gói, đạo diễn.
- Vì sao: skill dạy cách vận hành, knowledge giữ dữ kiện bên ngoài. Còn thiếu chỗ cho "điều kênh này đã học về khán giả của nó".
- Cho agent: `add_playbook_entry`, `search_playbook`, `retire_playbook_entry`. Ghi sau mỗi thử nghiệm và mỗi lần tự xem lại. Học: mục nào còn đúng theo thời gian. Rào chắn: mục phải trỏ tới bằng chứng có thật trong app, mục mâu thuẫn guideline bị từ chối, hết hạn thì ngừng vào prompt. Mức tự áp dụng theo câu 7 mục 5.
- Dựa trên: bài học vào chỉ mục tri thức (064), RAG (057), góp ý thành quy tắc (059).
- Rủi ro: bài học sai được lặp lại. Cần hạn dùng và kiểm lại định kỳ.

**25. Agent tự xem lại video của mình** · M · +1 call vision mỗi lần xem
- Làm gì: tool trả về bảng khung hình theo thời gian, lời đọc có mốc, danh sách cắt, kiểu cảnh, độ to âm thanh, mật độ chữ, entropy, đặt cạnh bản đồ giữ chân nếu đã có.
- Vì sao: agent hiện chỉ thấy số, không thấy sản phẩm. Muốn phê bình sáng tạo thì phải nhìn được bản dựng.
- Cho agent: `review_render(projectId)` (`read`). Dùng trước khi đăng để tự phê bình, và sau 7 ngày để giải thích điểm tụt. Agent quyết sửa cảnh nào, ghi gì vào sổ tay, đặt giả thuyết nào. Rào chắn: lời phê là ý kiến, không vượt cổng chất lượng của server. Số lần xem tính vào ngân sách tự cải tiến.
- Dựa trên: vision check khung render (004G), cổng render (068), plan JSON compose.
- Rủi ro: chi phí vision. ECO chỉ trả phần số do code tính.

**26. Thư viện mẫu sáng tạo agent tự mở rộng** · M · 0
- Làm gì: mẫu hook, cấu trúc tiêu đề, format recipe, cung nhạc, bố cục thumbnail là **dữ liệu có schema**, không nằm trong code. Mỗi mẫu có nguồn gốc, ví dụ, số liệu khi dùng.
- Vì sao: nhiều ý (4, 8, 9, 12, 19) cùng cần một nơi để thêm kiểu mới mà không cần phát hành app.
- Cho agent: `list_patterns`, `propose_pattern` (từ radar, research hoặc tự nghĩ), `get_pattern_stats`. Mẫu mới chạy thử trong phòng thí nghiệm trước khi thành mặc định. Rào chắn: schema kiểm bằng code, mẫu cần template hoặc kiểu cảnh mới thì thành đề xuất cải tiến (074c), không tự thêm code. Mẫu thua bị cho nghỉ.
- Dựa trên: format recipes (043), edit preset (041), `skillVersions` (cách quản phiên bản), 074c.
- Rủi ro: thư viện phình to. Cần giới hạn số mẫu đang hoạt động.

## 3. Top 5 nên làm trước

Xếp theo: công cụ nào giúp agent tự làm ra nhiều doanh thu nhất trên mỗi công sức phát triển.

| Hạng | Ý | Lý do |
|---|---|---|
| 1 | 23. Phòng thí nghiệm sáng tạo | Biến mọi công cụ khác thành thứ agent tự tối ưu được |
| 2 | 22. Bảng tham số | Rẻ, mở khoá cho agent chỉnh tính năng đã có mà không cần code |
| 3 | 10. Bản đồ giữ chân (kèm 25) | Cho agent "mắt": không thấy nguyên nhân thì không học được |
| 4 | 9. Đóng gói trước, viết sau | Đòn bẩy doanh thu trực tiếp lớn nhất, agent có ngay thứ để thử |
| 5 | 13. Thang thị trường | Nhân doanh thu từ video đã thắng, phần lớn hạ tầng đã có |

Ý 24 (sổ tay kênh) nhỏ, nên làm cùng ý 23 để kết quả thử nghiệm có chỗ lưu.

### Phác thảo ý số 1: Phòng thí nghiệm sáng tạo

**Người dùng thấy gì**
- Trang "Thử nghiệm" theo hồ sơ: danh sách giả thuyết agent đang chạy, mỗi dòng có biến đang thử, số video mỗi nhánh, kết quả tạm, ngày dự kiến kết luận.
- Thanh "ngân sách thử nghiệm": đang dùng bao nhiêu phần trăm video so với trần người dùng đặt.
- Mỗi kết luận hiện thành một dòng trong bản tin: thử gì, kết quả, agent đã giữ hay bỏ, nút hoàn tác.
- Người dùng tự tạo được thử nghiệm bằng tay (đường 0 token) và dừng bất kỳ thử nghiệm nào.

**Phần là code (chúng ta xây)**
1. Schema thử nghiệm: giả thuyết, biến (một gen hoặc một tham số), nhánh, chỉ số chính, cỡ mẫu tối thiểu, điều kiện dừng.
2. Gắn gen cho mỗi video lúc tạo: kiểu hook, format, dải nhịp, mức đồ hoạ, cung nhạc, độ dài, bố cục thumbnail.
3. Chia video vào nhánh, không để hai thử nghiệm cùng đổi một biến trên một kênh.
4. Chụp số liệu ở 48 giờ, 7 ngày, 28 ngày. Tính chênh lệch và khoảng tin cậy. Thiếu mẫu thì trả "chưa đủ".
5. Thompson sampling **gợi ý** tỉ lệ phân bổ. Nó không tự áp dụng.
6. Rào chắn: trần phần trăm video, guideline và cổng chất lượng áp cho mọi nhánh, tự dừng nhánh khi CUSUM báo tụt mạnh, audit mọi lần gọi.

**Phần agent quyết**
- Thử gì: giả thuyết lấy từ sổ tay kênh, bản đồ giữ chân, radar, research của chính nó.
- Chủ đề nào vào nhánh nào, trong danh sách code cho phép.
- Kết luận: giữ nhánh thắng (đổi tham số qua ý 22, ghi sổ tay qua ý 24), bỏ, hoặc chạy thêm.
- Khi công cụ không đủ để thử một ý, nó gửi đề xuất cải tiến (074c).
- Agent không được: nâng trần thử nghiệm, sửa cỡ mẫu tối thiểu, đổi chỉ số chính sau khi đã bắt đầu, tự duyệt thay đổi nằm ngoài grant.

**Đo thành công**
- Chỉ số chính: **thời gian xem trung bình mỗi lượt hiển thị** (CTR × thời gian xem) của video thường, so quý trước và quý sau khi bật.
- Số thử nghiệm kết luận được mỗi tháng trên mỗi kênh (mục tiêu đề xuất: từ 2).
- Tỉ lệ kết luận "giữ" còn đúng khi đo lại sau 28 ngày (mục tiêu đề xuất: từ 60%).
- Điều kiện dừng: sau 3 tháng chỉ số chính không đổi thì xem lại cách agent đặt giả thuyết trước khi xây thêm.

## 4. Ý táo bạo

**B1. Linh vật kênh.** Một nhân vật 2D riêng, tạo một lần bộ tư thế và khẩu hình, dựng thành con rối trong HyperFrames, mấp máy theo word timing. Agent chọn tư thế theo cảm xúc cảnh và học tư thế nào giữ người xem. Token mỗi video bằng 0 sau khi tạo. Khó ở việc giữ nhân vật nhất quán và không giống nhân vật có bản quyền.

**B2. Chỉ số riêng của kênh.** Agent duy trì và công bố định kỳ một bộ số liệu chưa ai có, tính bằng công cụ ở ý 6. Mỗi kỳ là một video, một bài viết, một bảng dữ liệu. Nếu được trích lại, kênh thành nguồn gốc. Khó ở độ tin cậy của phương pháp và việc duy trì nhiều năm.

**B3. Series do khán giả lái.** Cuối tập có thăm dò chọn hướng tập sau. Agent đọc kết quả, viết tập kế theo nhánh thắng và làm một Short cho nhánh thua. Khó ở nhịp sản xuất phải kịp kỳ bỏ phiếu và API thăm dò (cần kiểm API).

## 5. Câu hỏi cho người dùng

Chỉ gồm việc agent không tự trả lời được. Chọn ngách, thị trường, format, độ dài, giờ đăng là việc của agent (ý 20, 23).

1. **Mục tiêu:** tối đa doanh thu, lợi nhuận, hay tăng người đăng ký trước? Trong bao lâu? Câu trả lời đổi chỉ số chính của phòng thí nghiệm.
2. **Ngân sách:** trần USD mỗi tháng cho LLM, TTS, vision và tạo ảnh AI. Phần trăm video được dùng để thử (đề xuất 15%).
3. **Số kênh và thị trường bạn chịu quản:** tạo tài khoản, đăng nhập, xác minh là việc chỉ bạn làm được. Con số này là trần cho ý 13 và 20.
4. **Vùng cấm nội dung:** chủ đề, kiểu quan điểm, kiểu tranh luận agent không được đụng, ngoài guideline pack.
5. **Nguồn thu cần bạn ra tay:** bạn có chịu đăng ký affiliate, mở cửa hàng sản phẩm số, bật Memberships, ký tài trợ không? Nếu không, ý 15, 16, 17 lùi xuống.
6. **Hiện tên người bình luận trong video** (ý 7): được, chỉ hiện nội dung, hay hỏi từng lần?
7. **Mức tự áp dụng:** agent được tự đổi tham số (ý 22) và tự đưa mục sổ tay vào prompt (ý 24) trong phần thử nghiệm, hay luôn chờ bạn bấm? Cho tự áp dụng nghĩa là thêm grant mới, tức đổi một quyết định ở §2. Mặc định đề xuất: chờ duyệt.
8. **Việc chỉ có trong Studio** (điểm chèn mid-roll, màn hình kết thúc, ghim bình luận): bạn làm theo danh sách "Cần bạn", hay xét bật `computer_act` cho riêng các việc này? Đây cũng là đổi quyết định ở §2, hiện mặc định tắt.
