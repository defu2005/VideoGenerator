# Cursor guide: upcoming tasks

## Cách dùng (cho bạn)
1. Mở repo trong Cursor, bật Agent mode.
2. Làm **lần lượt từng task** theo bảng bên dưới. Mỗi lần dán vào Cursor đúng một dòng:
   > Read docs/cursor/README.md and docs/cursor/TASK-019.md, then implement that task.
3. Cursor làm xong khi có file `docs/tasks/TASK-XXX.report.md` và `docs/tasks/TASK-XXX.done`.
4. Đừng cho Cursor commit. Gọi Claude review rồi commit (hoặc tự kiểm tra theo "Done checklist" bên dưới).
5. Chỉ chuyển task kế tiếp khi task trước đã review và commit xong.

## Order

| # | Guide | What | Spec |
|---|---|---|---|
| ✅ | [TASK-017](TASK-017.md) | Content guideline packs (**done**, commit 3739833) | docs/tasks/TASK-017.md |
| 1 | [TASK-019](TASK-019.md) | Video metadata (title/description/tags) + music assist LLM | docs/tasks/TASK-019.md |
| 2 | [TASK-018](TASK-018.md) | Optional pre-render review chat with the LLM | docs/tasks/TASK-018.md |
| 3 | [TASK-013](TASK-013.md) | Render versions, history, export/download | docs/tasks/TASK-013.md |
| 4 | [TASK-004G](TASK-004G.md) | MAX mode: vision-checked images + vision check of rendered frames | docs/tasks/TASK-004G.md |
| 5 | [TASK-007C](TASK-007C.md) | Web image search: Brave API + Gemini grounding (free) + code crawl (guide replaces the LLM-agent spec) | docs/tasks/TASK-007C.md |
| 6 | [TASK-020](TASK-020.md) | AUTO never pauses (auto decisions + AUTO report) + realistic token estimate | (guide only) |
| 7 | [TASK-007B](TASK-007B.md) | More image/video sources | docs/tasks/TASK-007B.md |
| 8 | [TASK-021](TASK-021.md) | Fixes from the first live AUTO run (download fallback, blocked-source circuit breaker) | (guide only) |
| 8b | [TASK-021B](TASK-021B.md) | Fixes from live run 2: sturdier edge-tts retry, NASA image URLs from the listed sizes | (guide only) |
| 9 | [TASK-022](TASK-022.md) | Profiles (Hồ sơ) with their own direction + platform accounts | (guide only) |
| 10 | [TASK-023](TASK-023.md) | Render variants 16:9 / 9:16 from one project | (guide only) |
| 11 | [TASK-024](TASK-024.md) | Publishing framework: encrypted token vault, OAuth, publish jobs + schedule, mock publisher | (guide only) |
| 12 | [TASK-025](TASK-025.md) | YouTube publisher (long videos + Shorts) | (guide only) |
| 13 | [TASK-026](TASK-026.md) | OmniRoute as the LLM gateway (catalog, health, prefer/only mode) | (guide only) |
| 14 | [TASK-027](TASK-027.md) | LLM model advisor (picks a model per task) | (guide only) |
| 15 | [TASK-028](TASK-028.md) | Topic queue + automation scheduler per profile | (guide only) |
| 16 | [TASK-029](TASK-029.md) | TikTok publisher | (guide only) |
| 17 | [TASK-030](TASK-030.md) | Facebook Reels + Instagram Reels publishers | (guide only) |
| 18 | [TASK-031](TASK-031.md) | Notifications + Telegram bot (pairing, events, daily summary) | (guide only) |
| 19 | [TASK-032](TASK-032.md) | LLM assistant that controls the app (web chat + Telegram, confirm rules) | (guide only) |
| 20 | [TASK-033](TASK-033.md) | Platform analytics sync (YouTube Analytics, TikTok video stats, Meta insights) + analytics dashboard | (guide only) |
| 21 | [TASK-034](TASK-034.md) | Revenue + profit per video/channel (minus LLM/TTS cost), manual revenue entry, payout reminder, monthly report | (guide only) |
| 22 | [TASK-035](TASK-035.md) | Learn from results: LLM performance insights → direction, topics, best posting time | (guide only) |
| 23 | [TASK-036](TASK-036.md) | Auto thumbnails (frames + title text, AI pick, upload) | (guide only) |
| 24 | [TASK-037](TASK-037.md) | Long video → Shorts/Reels clips added to the schedule | (guide only) |
| 25 | [TASK-038](TASK-038.md) | Comment inbox across platforms, LLM reply suggestions, spam filter | (guide only) |
| 26 | [TASK-039](TASK-039.md) | Trending topics via official APIs + multi-language dubbing/subtitles | (guide only) |
| 27 | [TASK-040](TASK-040.md) | More TTS sources: Google Gemini/Cloud, ElevenLabs, OpenAI, FPT.AI/Viettel AI, local Piper/VieNeu; word timings | (guide only) |
| ∥ | [TASK-049](TASK-049.md) | Frontend polish (runs in parallel in worktree `../videoGenerator-fe`, branch `frontend-polish`; web only): design system, grouped sidebar + mobile drawer, Ctrl+K, states/toasts, dashboard "Cần bạn xử lý", lazy routes, a11y | (guide only) |
| 27b | [TASK-048](TASK-048.md) | User guide (Vietnamese, `docs/user-guide/`) + one feature map in code + in-app Hướng dẫn page with "?" links + coverage test; every later task must update it | (guide only) |
| 28 | [TASK-041](TASK-041.md) | Editing skills: real transitions (xfade), emphasis (punch-in, keyword callouts, SFX), animated styled subtitles (word highlight), LLM edit plan, per-profile edit presets, subtitle gap fix | (guide only) |
| 29 | [TASK-042](TASK-042.md) | Motion graphics layer: HyperFrames HTML/GSAP templates (titles, kinetic words, counters, lower thirds, lists, charts, end card) rendered to alpha clips and overlaid; LLM picks templates + fills text | (guide only) |
| 30 | [TASK-043](TASK-043.md) | Format recipes (explainer, listicle, story, news…), treatment card with cost estimate, chat editing with revision token + undo across web/Telegram/MCP | (guide only) |
| 31 | [TASK-044](TASK-044.md) | Free/quota-limited model manager: quota profiles, usage counters, cool-down on 429/quota, ordered free-first fallback chain, wait-or-paid policy with daily cap, Quota UI, Telegram alert, advisor awareness | (guide only) |
| 32 | [TASK-045](TASK-045.md) | Live provider quota from OmniRoute (connections + real used/total/reset), management token in vault, live data overrides estimates, backfill local counters, Quota tab live cards + routed models without quota | (guide only) |
| 33 | [TASK-047](TASK-047.md) | Cursor operator: one tool registry for assistant/MCP/operator with server-enforced confirm + hard blocks, long-lived Cursor CLI session (resume, MCP-only, no shell) driven from web/Telegram chat or the Cursor IDE, generated handbook, notes memory, standing orders, optional ticks | (guide only) |
| 34 | [TASK-046](TASK-046.md) | Provider intelligence: evidence-backed provider/offer/ToS/privacy/billing-risk database with history, Vietnam eligibility, OmniRoute connection audit, account benefits, page-change monitoring, routing profiles + backed-up OmniRoute combo updates on click; model abilities + public benchmarks + real-run stats + app eval suites into a per-task model scorecard; research done by the TASK-047 operator via quote-verified tools | (guide only) |
| 35 | [TASK-050](TASK-050.md) | Per-project stage timeouts: one fast LLM call sizes each stage's ceiling from duration and complexity; a code baseline is the fallback; the worker uses that plan instead of one global 10-minute limit | (guide only) |
| 36 | [TASK-051](TASK-051.md) | Vận hành đa provider: adapter theo năng lực, MCP và function calling dùng chung, chọn agent độc lập với model tác vụ | (guide only) |
| 37 | [TASK-052](TASK-052.md) | Workflow có checkpoint, RAG và memory theo hồ sơ, đánh giá định tuyến theo chất lượng và chi phí | (guide only) |
| 38 | [TASK-053](TASK-053.md) | Học từ kết quả, tự tạo bản nháp skill, phát hiện và đề xuất bổ sung công cụ MCP | (guide only) |
| 39 | [TASK-054](TASK-054.md) | Tự động hóa theo sự kiện, theo dõi từ tin nhắn đến job và nghiệm thu đa agent | (guide only) |
| 40 | [TASK-055](TASK-055.md) | Computer Use có giới hạn cho thao tác chỉ có qua giao diện | (guide only) |
| 41 | [TASK-056](TASK-056.md) | Cấu hình hết trong app: key AI và nguồn ảnh qua giao diện (đăng nhập lấy key, ô nhập key, kiểm tra, không cần khởi động lại), trang Tài khoản nền tảng cho nhiều kênh, trình thêm tài khoản, trang Kết nối và checklist thiết lập ban đầu. Không phụ thuộc 051–055 | (guide only) |
| 42 | [TASK-057](TASK-057.md) | RAG cho pipeline video: chỉ mục tri thức theo hồ sơ (SQLite FTS5 + embedding tuỳ chọn), research/script/metadata/review/chủ đề dùng ngữ cảnh kênh có trích dẫn, tab "Tri thức" và bảng "Ngữ cảnh đã dùng". Sau 052, 053, 056 | (guide only) |
| 43 | [TASK-058](TASK-058.md) | Đăng nhập tài khoản nền tảng thân thiện hơn: kiểm tra dạng Client ID/Secret, nút "Kiểm tra ứng dụng", trang kết quả OAuth tiếng Việt thay cho JSON, không để lại tài khoản rác, nút Kết nối/Kết nối lại/Xoá trên trang Tài khoản, sửa "Kiểm tra tất cả" báo sai, hướng dẫn Google Cloud đầy đủ và bảng lỗi. Sau 056, chạy sau 057 | (guide only) |
| 44 | [TASK-059](TASK-059.md) | Tự vận hành 24/7: mức tự chủ và quyền theo hồ sơ (giới hạn cứng giữ nguyên: key, đăng nhập, tiền, dự án bảo vệ, tự nâng quyền), ngân sách và circuit breaker, supervisor không tốn token tự sửa lỗi và khôi phục sau khởi động lại, mục tiêu từ người dùng, góp ý thành quy tắc lâu dài, agent tự chọn provider từng stage có canary và hoàn tác, quản lý OmniRoute qua API, yêu cầu "Cần bạn", bản tin hằng ngày, nhật ký và hoàn tác. Chạy sau 058 | (guide only) |
| 45 | [TASK-060](TASK-060.md) | Sửa lỗi từ báo cáo Hermes: khớp provider quota (null === null), ảnh cảnh lệch chủ đề (ngưỡng liên quan, thực thể, vision loại thì tìm web, ảnh có bản quyền mặc định tắt), đồng bộ catalog nền và tự nhận khả năng model, tự đổi model tương đương khi hết quota, đẩy sự kiện cho agent ngoài (webhook ký Standard Webhooks, SSE toàn cục, MCP get_events). Chạy sau 059 | (guide only) |
| 46 | [TASK-061](TASK-061.md) | Ảnh cảnh: không trùng ảnh giữa các cảnh (hash cảm quan dHash qua ffmpeg, gán toàn cục bằng thuật toán Hungarian, tìm thêm trước khi phải dùng lại, bỏ tự chép ảnh cảnh bên cạnh), lọc watermark thành loại hẳn (danh sách host stock, ảnh web phải qua vision), chế độ ảnh "Tốt nhất" chạy đầy đủ bất kể chế độ ngân sách, sửa trùng cho dự án cũ. Chạy sau 060 | (guide only) |
| 47 | [TASK-062](TASK-062.md) | Công cụ cắt ảnh, chỉ chạy khi người dùng bấm hoặc gọi tool, không nằm trong pipeline: cắt ảnh của cảnh đúng tỉ lệ video (16:9, 9:16, 1:1); ảnh đã đúng tỉ lệ thì cắt cùng tỉ lệ còn 9/10 mỗi chiều; tâm cắt lấy từ người dùng → vision đã lưu → smartcrop → giữa ảnh; giữ ảnh gốc, trình chỉnh khung cắt, render chỉ dùng ảnh cắt khi có. Chạy sau 061 | (guide only) |
| 48 | [TASK-063](TASK-063.md) | Nạp skill vận hành kênh từ `.agents/skills/` (chỉ file có `operator: true`) vào operator, handbook, find_skills, skillEval; parser đọc description dạng `>-`/`|`, sửa lỗi kiểm tra secret `sk-` báo nhầm; tool `read_skill` cho MCP; trang operator liệt kê skill repo và file bị loại; skill chỉ là hướng dẫn, không thêm quyền. Chạy sau 047, độc lập với 059–062 | (guide only) |
| 49 | [TASK-064](TASK-064.md) | Báo cáo mỗi lần chạy skill (giả thuyết, chỉ số, ngày kiểm) và kiểm chứng tự động bằng code; nhận việc (claim) để hai agent không làm trùng; ghi agent/môi trường cho mọi lệnh gọi tool (chỉ là nhãn, không phải quyền); xuất/nhập báo cáo giữa nhiều app, cảnh báo môi trường khác cùng vận hành hồ sơ; bài học vào chỉ mục tri thức; trang "Báo cáo thử nghiệm". Chạy sau 063 | (guide only) |
| 50 | [TASK-065](TASK-065.md) | Tự phục hồi lỗi pipeline có giới hạn: edge-tts thử lại lỗi mạng/DNS (4 lần cách 30 giây, rồi chạy lại sau 5 phút, giữ mã lỗi TTS_NETWORK), orchestrator tôn trọng retryAt; STAGE_TIMEOUT: mỗi lần thử lại tăng thời gian chờ 1,5 lần (có trần), gia hạn một lần khi bước còn tiến triển, VISUAL_SEARCH lưu checkpoint từng cảnh để không tìm lại từ đầu, thông báo tiếng Việt; tool update_stage_timeouts (confirm) cho agent đề xuất. Chạy sau 064 | (guide only) |
| 51 | [TASK-066](TASK-066.md) | Hoàn thiện TASK-059 sau review: cổng chất lượng kịch bản/render/đăng đọc số liệu từ server (bỏ tham số quality/autopilot do agent tự gửi), lưu điểm kịch bản, kiểm tra âm thanh im lặng và phụ đề; kích hoạt thật các grant trong policy (computer_act, bật tự động hoá, xoá dự án vẫn do người dùng); test thật cho lệnh ẩn trong bình luận/xu hướng; nối khoá 24 giờ khi người dùng sửa, chia quota luân phiên, giờ yên lặng, guideline thắng góp ý; bản tin có dữ liệu thật; tạm dừng hồ sơ khi bị claim/strike; bỏ DDL viết tay, mã nâng quyền dùng crypto, timeout test 30 giây. Chạy sau 065 | (guide only) |
| 52 | [TASK-067](TASK-067.md) | Kế hoạch tổng compose engine (mỗi cảnh thành nhiều kiểu cảnh quay, cắt theo từ và nhịp nhạc, CPU). Chia việc: 067a Cursor → 067b Fable → 068/070 Cursor | (plan) |
| 52a | [TASK-067a](TASK-067a.md) | Cursor: nền móng compose (schema, từ theo cảnh, dò beat, DP chia nhịp cắt, chỉ số, footage Pexels/Pixabay, renderer, ghép khớp khung, đạo diễn baseline sau interface, harness eval). Chạy song song 069 | done 2026-11-10, Claude reviewed |
| 52c | [TASK-067c](TASK-067c.md) | Cursor (grok-4.7-medium): helper thuần cho compose, tách khỏi 067b phần 1 để tiết kiệm Fable: language pack vi/en (+ fallback chỉ chữ số), bộ đọc số và nhóm số so sánh được (line/pie/bar), nhận thứ tự/từ đối lập, variety pass V1–V4 có kiểm và tự sửa. Chạy song song với Codex 073a (khác thư mục) | done (Claude sửa V4 để không hở từ) |
| 52b | [TASK-067b](TASK-067b.md) | **Fable 5.2**, 3 phiên riêng: (1) đạo diễn luật + số tiếng Việt + đa dạng + 1 lần gọi LLM, (2) template chuyên nghiệp, (3) chọn footage theo nghĩa + tinh chỉnh eval. Sau khi Claude review 067a | done (3 phần) |
| 53 | [TASK-068](TASK-068.md) | Cursor: tích hợp compose vào render (cài đặt legacy/compose, lỗi cảnh thì lùi về cũ, plan JSON + thống kê trong report, giấy phép footage vào credits, cổng render bắt đứng hình/đen, UI thống kê, tool MCP xem plan, kiểm tra trực tiếp). Sau 069 + 067a, song song 067b | done 2026-11-10, Claude reviewed (fix: download only chosen footage) |
| 54 | [TASK-069](TASK-069.md) | Sửa sau review 066: vòng sửa kịch bản thật (đưa lý do chưa đạt vào prompt, khoá cache theo vòng, người dùng sửa thì về 0), cổng đăng kiểm mọi tài khoản (tất cả hoặc không), lệnh MCP quyền "agent" cũng phải qua cổng chất lượng; chạy kiểm tra trực tiếp còn thiếu của 066. Chạy sau 066, song song với 067 được | done |
| 54q | [RESEARCH-072](RESEARCH-072.md) | Codex research (không viết code): mọi cách kiếm tiền từ video trên YouTube/TikTok/Facebook/Instagram và ngoài nền tảng (điều kiện, chia doanh thu, có ở VN không, kênh tự động có dùng được không), luật chặn kênh tự động kiếm tiền (nội dung lặp lại/tái sử dụng/AI), kỹ năng creator tạo ra doanh thu, đối chiếu với tính năng app và đề xuất (tính năng, operator skill, MCP tool) xếp theo hiệu quả. Chạy trước 071 | (guide only) |
| 54r | [RESEARCH-071](RESEARCH-071.md) | Codex research (không viết code): dữ liệu 17 thị trường (ngôn ngữ, múi giờ khán giả, nền tảng khả dụng, kiếm tiền, RPM ước tính, giờ đăng, nguồn xu hướng, giọng TTS, luật riêng từng nước, sự kiện mùa vụ) vào docs/research/markets/, kèm nguồn; đánh giá thư viện mã nguồn mở. Chạy ngay, song song 067b | (guide only) |
| 54s | [TASK-073](TASK-073.md) | Khung thích ứng với mọi thay đổi bên ngoài. **Danh mục thay đổi** (catalog, có test giữ đủ): chính sách nội dung, kiếm tiền, AI/tính nguyên bản, quảng cáo, bản quyền, quy định khán giả; định dạng và API nền tảng, tính năng, thuật toán, nền tảng mới/bị cấm; hành vi khán giả, trend, mùa vụ, RPM; luật từng nước; LLM/TTS/footage/nhạc, công cụ và thư viện; sức khoẻ tài khoản và video, mốc kênh, hiệu quả tụt không rõ lý do; chi phí; mục tiêu của bạn; độ đúng của chính tri thức. **073a:** mọi dữ kiện bên ngoài là knowledge entry có nguồn, ngày kiểm, hạn dùng, ngày hiệu lực; resolver và danh sách nơi dùng; rà soát chỗ viết cứng; đề xuất có diff, rủi ro, lịch sử, khôi phục; nhập knowledge.json; trang "Tri thức". **073b:** hộp thư thay đổi chung; chính sách phản ứng (ghi log → báo → đề xuất → tự chuyển phương án có sẵn → tạm dừng đúng phần bị ảnh hưởng → điều tra); phát hiện qua trang nguồn, lỗi runtime/API (Deprecation/Sunset, 401, quota, sai schema), dữ kiện quá hạn và npm, người báo; skill điều tra. **073c:** trạng thái tài khoản/video và phát hiện số liệu tụt (sau RESEARCH-073). **073d:** ngân sách thử nghiệm 15 % để bắt thay đổi không ai báo. 073a chạy trước 071; 073c cần RESEARCH-073 (API mỗi nền tảng cho biết gì về trạng thái tài khoản/video) | 073a, 073b, 073c done; 073d chưa có guide |
| 54t | [TASK-074](TASK-074.md) | Operator tự cải tiến. **074a:** tự research bằng research skill (web_search qua Gemini grounding, fetch_page có robots/SSRF guard, check_quote; quy trình cố định kế hoạch → tìm → đọc → trích có quote → đối chiếu → đề xuất knowledge → báo cáo), kích hoạt khi tri thức quá hạn, có change event, người dùng hỏi. **074b:** operator tự viết/sửa skill từ mẫu lặp lại, research, thay đổi tri thức, kết quả kém; qua routing eval + behaviour eval chạy khô + shadow; người dùng kích hoạt (skill chỉ đọc có thể tự bật nếu bật cài đặt); đo kết quả và quay lại bản cũ. **074c:** đề xuất cải tiến app có bằng chứng, gộp trùng tăng trọng số, tìm mã nguồn mở, chấp nhận → bản nháp guide trong docs/proposals/ cho Claude xem; sau khi làm xong tự kiểm chứng số liệu. Không bao giờ tự sửa code, git, giao Codex, tăng ngân sách. Sau 073a (074a) và 073b | (guide only) |
| 54m | [TASK-071](TASK-071.md) | Thị trường mục tiêu cho mỗi kênh: market pack trong shared, profile.market + xem trước/áp dụng mặc định (không ghi đè ngầm), luật nội dung theo nước, prompt kịch bản/ý tưởng theo nước và sự kiện, giọng theo locale, cảnh báo nền tảng không khả dụng, trợ lý dùng múi giờ của người dùng. Sau 073a và khi Claude đã review RESEARCH-071 và ghi snapshot market.json; trước 070 | done |
| 54r | [RESEARCH-075](RESEARCH-075.md) | **Codex, chỉ research, không code.** Đo thời gian render cảnh đồ hoạ (HyperFrames): khởi động browser, chụp frame, encode, grain; tuỳ chọn batch/song song/fps; ảnh tĩnh + chuyển động ffmpeg; cache; các cách render mã nguồn mở khác (kèm license). Đề xuất bảng mode cho ECO/BALANCED/QUALITY/MAX. Kết quả trong `docs/research/render-speed/` | done |
| 54u | [TASK-075](TASK-075.md) | **Cursor (grok-4.7-medium).** Mode đồ hoạ `composeGraphics` = off/static/animated trong budget preset (CUSTOM chỉnh được), sửa tốc độ theo research, truyền projectId/language vào ComposeRenderContext, ước tính thời gian render trên màn hình render. Sau RESEARCH-075 và khi Claude đã ghi phần "Decisions" | done 2026-11-11 (static chậm hơn dự đoán 2–3×: follow-up gom khung vào một browser) |
| 54v | [TASK-077](TASK-077.md) | **Cursor (grok-4.7-medium).** Cổng liên quan bắt buộc cho ảnh cảnh (từ lần chạy Berserk của Hermes): ảnh lạc đề hoặc bị vision loại không bao giờ "sẵn sàng render"; AUTO dừng lại hỏi bạn thay vì tự duyệt ảnh sai; ảnh agent chọn không bị khoá như ảnh bạn chọn; query luôn có tên tác phẩm + từ loại trừ; tác phẩm hư cấu tìm web trước; chặn nguồn rác; provider 404/410 bị bỏ cả lượt. Không làm xoá watermark/cắt né bản quyền. Sau 075 hoặc song song ở chat Cursor thứ hai | done 2026-11-11 |
| 55 | [TASK-070](TASK-070.md) | Cursor: (sau 071) thêm kiểu cảnh map/compare/quote_full/list_full, sửa cảnh quay (đổi kiểu, đổi footage, khoá), đưa thống kê cảnh quay vào vòng học. Sau 067b + 068, Claude kiểm lại guide trước | (guide only) |
| 54w | [BUGFIX-VISION-SCHEMA](BUGFIX-VISION-SCHEMA.md) | **Cursor (composer-2.5).** Sửa lỗi Hermes #10: một câu trả lời vision sai định dạng (`LLM_INVALID_OUTPUT`) làm hỏng cả VISUAL_SEARCH. Thêm bước normalize trước khi parse (giữ nguyên JSON schema gửi provider), bọc `runCheck`: batch lỗi thì thử từng ảnh, ảnh vẫn lỗi thì bỏ qua và để cổng `vision_missing` chặn; lỗi auth vẫn báo như cũ. Chạy song song 114/117 được | (guide only) |
| 54x | [TASK-121](TASK-121.md) | **Cursor (grok-4.7-xhigh).** Tự sửa chất lượng khi có quyền `retries`: kịch bản, ảnh cảnh và render không đạt cổng thì agent chọn cách sửa (code giữ chẩn đoán, danh sách hành động và ngân sách; không có model thì dùng thang mặc định), chạy qua tool registry, kiểm lại bằng cùng cổng; hết ngân sách thì gác dự án (SHELVED) thay vì chờ người dùng. Không nới cổng, không nới giới hạn cứng. Migration `quality_repairs` | (guide only) |
| 54y | [TASK-122](TASK-122.md) | **Cursor (grok-4.7-xhigh).** Hermes giám sát operator: chuỗi chỉ huy người dùng > Hermes trực > operator > code giám sát. Danh tính agent gắn với machine key (TASK-114); lease một-người-ghi cho mỗi đối tượng, Hermes chiếm quyền được, operator thì không; idempotency key; đúng một Hermes trực (duty lease); tool giám sát (snapshot có anomaly do code tính, pause/resume, giao việc, sửa standing order, override qua undo, đọc sự kiện); escalation operator → Hermes trước người dùng (trừ việc chỉ người dùng được duyệt); tự an toàn khi Hermes tắt; một giọng Telegram; tab Hermes; skill vg-supervise. Giới hạn cứng TASK-059 giữ nguyên. Sau 114. Migration | (guide only) |
| 54z | [TASK-123](TASK-123.md) | **Cursor (grok-4.7-xhigh).** Đội Hermes đồng bộ: app là hub. MCP qua Streamable HTTP (mọi máy cùng bộ tool), bundle khả năng (skill đang bật, handbook, bài học chung, cấu hình model/MCP, phiên bản Hermes, cron) không chứa bí mật; sidecar `vg-hermes-sync` (không tốn token) kéo về `vg-skills/`, gộp key được quản lý vào config.yaml, đẩy skill mới lên làm bản nháp qua eval; bảng `agent_lessons`; registry instance và phát hiện lệch; `compose.hermes.yml` dùng image chính thức pin version. Sau 122 và 117 | (guide only) |
| 55a | [TASK-115](TASK-115.md) | **Cursor (grok-4.7-xhigh) hoặc session Sonnet mới.** Không gian làm việc (organization của Better Auth), 6 vai trò, quyền theo kênh (chỉ hạ quyền, không nâng), một module `policy.ts` dùng chung cho route và tool registry; bản đồ quyền cho mọi route và mọi tool có test phủ; danh sách lọc theo workspace và kênh (404 thay vì lộ dữ liệu); agent nội bộ chạy với system actor của owner; pending action nhớ ai yêu cầu; bảng `audit_log` (API, tool, từ chối) giữ 180 ngày; `GET /api/me`, `GET /api/audit`. Sau 114 và sau khi 121 tạo migration. Migration | (guide only) |
| 55b | [TASK-116](TASK-116.md) | **Cursor (grok-4.7-medium) hoặc session Sonnet mới.** Giao diện nhóm: thành viên, mời qua link (không gửi email), đổi vai trò, chọn kênh, nhận lời mời (đường đăng ký duy nhất), Tài khoản của tôi (mật khẩu, 2FA bằng khóa nhập tay, phiên đăng nhập, API key hiện một lần), bắt buộc 2FA cho owner/admin (kiểm ở server), trang Nhật ký. Không thêm thư viện, không migration. Sau 115 | (guide only) |
| 55d | [TASK-124](TASK-124.md) | **Session Sonnet mới (hoặc Cursor composer-2.5).** Bộ skill vận hành app dùng chung cho mọi agent (operator trong app, Hermes qua `external_dirs`, Cursor, Codex, Claude): hub `video-van-hanh-app` + skill cho từng khu vực, test phủ (mọi khu vực và mọi tool đều có skill hoặc lý do), tool `propose_skill` để agent đề xuất bản nháp (chỉ người dùng kích hoạt), CLI `npm run export-skills` đưa skill đã duyệt về `.agents/skills`. Không migration. Chạy song song 116/118 với ranh giới file. | (guide only) |
| 55e | [TASK-119](TASK-119.md) | **Session Sonnet mới (hoặc Cursor grok-4.7-medium).** Trang Máy `/nodes`: danh sách, chi tiết, drain, đổi tên, thu hồi; hộp thoại "Thêm máy" sinh lệnh docker/npm; kiểm năng lực thật (render 1 giây qua HyperFrames) gửi theo heartbeat, máy kiểm hỏng không nhận render; phiên bản đích và tự thoát để cập nhật (`VG_EXIT_FOR_UPDATE`); tên máy trên danh sách job; tool `list_nodes` + `set_node_drain`; test E2E tuỳ chọn. Migration `nodes.probe`. Sau 118. | (guide only) |
| 55f | [TASK-125](TASK-125.md) | **Session Sonnet mới (hoặc Cursor grok-4.7-xhigh).** Ước lượng thời gian từng bước học từ các lần chạy thật (trung vị và p90 theo cảnh/giây, trộn với công thức khi ít mẫu); hết thời gian thì không dừng mà đánh dấu "quá dự kiến", code gom dấu hiệu (tiến độ, byte ghi, tiến trình con, log), Code chỉ ước lượng khi chắc (đủ mẫu, ít dao động); bước không chắc thì agent quyết thời hạn, có lý do. Hết thời gian thì **không dừng theo đồng hồ**: kiểm trong app chỉ được chờ hoặc chuyển lên; Hermes (hoặc bạn) chẩn đoán và chọn chờ thêm/dừng thử lại/dừng hẳn/hỏi bạn; quá 30 phút chưa ai quyết thì báo bạn, job vẫn chạy. Không có trần cứng. Supervisor `job_overdue`, bảng `stage_overdue_checks`, skill `video-kiem-tra-qua-gio`. Chạy song song 119 với ranh giới file. | (guide only) |
| 55c | [TASK-118](TASK-118.md) | **Cursor (grok-4.7-xhigh) hoặc session Sonnet mới.** Máy worker v1: tách render thành prepare/execute/finalize (một đường code), node tham gia bằng mã một lần, heartbeat, lease có fencing, artifact theo sha256, render từ xa (`remoteRender` off/prefer/only, mặc định off), tiến trình `VG_ROLE=worker` không DB. Sau 115. |
| 56a | [TASK-111](TASK-111.md) | Style 4: tạo/sửa style pack của kênh (từ preset, lựa chọn, màu thương hiệu, AI gợi ý), xem trước 3 khung, lịch sử phiên bản, tab "Phong cách", tool `set_style_pack` luôn chờ duyệt. Không migration | (guide only) |
| 56b | [TASK-112](TASK-112.md) | ✅ **Xong 2026-11-13.** Style 5: đạo diễn đọc genre pack thay vì so recipe id; thể loại mới chỉ là dữ liệu; QUALITY cho LLM chọn biến thể trong cùng một lần gọi. Snapshot tương đương, eval không giảm | (guide only) |
| 56c | [TASK-113](TASK-113.md) | Style 6: độ giống hình ảnh (trong kênh và giữa các kênh) vào báo cáo originality, chặn thì chuyển duyệt tay | (guide only) |
| 56d | [TASK-120](TASK-120.md) | Node chạy thêm TTS cục bộ và tải media; xếp việc theo năng lực máy; secret ngắn hạn theo lease, thu hồi khi xong, có nhật ký. Sau 119. Có thể migration | (guide only) |
| 57 | [TASK-080](TASK-080.md) | Claude chạy checklist, chia nhóm commit, viết `ARCHITECTURE.md` v1.0; **bạn commit và push** | (guide only) |
| 57a | [TASK-085](TASK-085.md) | Tách `db/schema.ts`, `assistant/tools.ts`, `visualService.ts` (không đổi hành vi). **Chạy một mình**, sau 080 | (guide only) |
| 57b | [TASK-082](TASK-082.md) | Runbook chạy thật YouTube: bạn tạo app + OAuth, Hermes chạy và ghi runlog, Claude viết guide sửa lỗi. Sau 080 | (guide only) |
| 57c | [TASK-083](TASK-083.md) | Kiểm tra trước khi đăng thành bước có code: dữ kiện (nhãn AI, tài trợ, claim, ad suitability), agent đánh giá, chặn đăng cho tới khi bạn xác nhận | (guide only) |
| 57d | [TASK-088](TASK-088.md) | Param registry: định nghĩa trong code, giá trị theo phạm vi, giới hạn của bạn, tool và trang "Tham số", hoàn tác. Sau 085. Migration | (guide only) |
| 57e | [TASK-090](TASK-090.md) | `review_render`: contact sheet, loudness, khung đen/đứng, mật độ chữ, lệch phụ đề; đánh giá theo mode; bảng `render_reviews`. Sau 085. Migration | (guide only) |
| 58a | [TASK-087](TASK-087.md) | Snapshot theo cửa sổ 48h/7d/28d, impressions/CTR qua Reporting API, `retention_curves`. Sau 082. Migration 🔴 | (guide only) |
| 58b | [TASK-089](TASK-089.md) | `video_genes` + bản đồ giữ chân. Sau 087. Migration 🔴 | (guide only) |
| 58c | [TASK-091](TASK-091.md) | Kinh tế theo thị trường/format + mức sẵn sàng kiếm tiền. Sau 082. Migration 🔴 | (guide only) |
| 59a | [TASK-092a](TASK-092a.md) | Lab lõi. **Cổng dữ liệu: 087/089 chạy thật ≥ 4 tuần, Claude kiểm và chỉnh số trước khi giao.** Migration | (guide only) |
| 59b | [TASK-092b](TASK-092b.md) | Lab: tool, trang "Thử nghiệm", Thompson sampling chỉ gợi ý | (guide only) |
| 59c | [TASK-093](TASK-093.md) | Channel playbook có bằng chứng, đưa vào prompt. Migration | (guide only) |
| 59d | [TASK-094](TASK-094.md) | Pattern library. Sau 088. Migration | (guide only) |
| 60a | [TASK-095](TASK-095.md) | Bước PACKAGING + cổng "trả đủ lời hứa". Sau 094. Migration | (guide only) |
| 60b | [TASK-096](TASK-096.md) | Thumbnail từ template, nhiều biến thể. Sau 095 | (guide only) |
| 60c | [TASK-097](TASK-097.md) | Nhịp ngắt + nhạc theo cung. Sau 088, 094 | (guide only) |
| 60d | [TASK-098a](TASK-098a.md) | Bộ nhận diện + người dẫn. Sau 094. Migration | (guide only) |
| 60e | [TASK-098b](TASK-098b.md) | Series nhiều tập. Sau 098a. Migration | (guide only) |
| 60f | [TASK-099](TASK-099.md) | Kiểu cảnh `diagram`, `timeline` | (guide only) |
| 61a | [TASK-100](TASK-100.md) | Câu hỏi khán giả → chủ đề. Sau 082 🔴 | (guide only) |
| 61b | [TASK-101](TASK-101.md) | Thang thị trường (chuyển thể). Sau 084, 091. Migration 🔴 | (guide only) |
| 61c | [TASK-102a](TASK-102a.md) | Sổ affiliate và tài trợ. Sau 091. Migration | (guide only) |
| 61d | [TASK-102b](TASK-102b.md) | Kịch bản biết bán hàng + media kit. Sau 102a 🔴 | (guide only) |
| 61e | [TASK-103](TASK-103.md) | Short viết riêng + phễu. Sau 087. Migration 🔴 | (guide only) |
| 61f | [TASK-104](TASK-104.md) | Độ dài + gợi ý điểm chèn quảng cáo. Sau 091 🔴 | (guide only) |
| 61g | [TASK-105](TASK-105.md) | Chấm ngách + radar cơ hội. Sau 074a, 091 | (guide only) |
| 61h | [TASK-126](TASK-126.md) | ✅ **Xong 2026-11-13. Từ Hermes #12, #13.** VISUAL_SEARCH không bỏ qua vision khi query không đổi mà ảnh chưa được kiểm; ảnh Brave tìm thêm được kiểm vision vòng 2; không nới cổng; lý do rõ cho từng cảnh. Chặn Berserk. Không migration | (guide only) |
| 61i | [TASK-127](TASK-127.md) | **Từ Hermes #14.** LLM tự chuyển sang model dự phòng khi hết quota / bị rate limit, có thời gian nghỉ cho provider, tôn trọng ngân sách và chế độ ECO, hiện trạng thái trên trang định tuyến. Không migration | (guide only) |
| 61j | [TASK-128](TASK-128.md) | **Agent nhận toàn quyền một stage.** Khi provider (Brave, Gemini…) hết usage, VISUAL_SEARCH được giao cho agent (Hermes…): agent tự tìm, tự duyệt (verdict của agent là vision check), chọn ảnh qua tool; giao theo phạm vi (1 agent / kênh, 1 agent / stage của 1 video), nhiều agent song song không đụng nhau nhờ claim + lease; skill theo vai trò dùng chung; cache verdict ảnh + kết quả tìm dùng chung. Hai phần 128a, 128b, mỗi phần 1 migration | (guide only) |
| 61k | [TASK-129](TASK-129.md) | **Mission control.** 129a: bus hai chiều (app đẩy sự kiện cho agent qua webhook/SSE/poller không tốn token; hộp thư agent ↔ agent, sub-agent báo orchestrator). 129b: bộ điều tiết tài nguyên (số luồng tự tăng/giảm theo CPU/RAM/GPU/đĩa, thay `WORKER_CONCURRENCY` cố định). 129c: mission — một lệnh của user chạy đến đăng bài rồi đo kết quả +2h/+24h/+72h/+7d; orchestrator trực 24/7 có watchdog; chỉ dừng ở cổng mà mức tự động hoá không cho phép | (guide only) |

## Thứ tự chạy (cập nhật 2026-11-13)

Luật xếp lịch:
- **Mỗi lúc chỉ một task có migration (🗄).** drizzle-kit đánh số tuần tự, hai task cùng sinh migration sẽ đụng nhau.
- **TASK-085 chạy một mình**, vì nó chạm file mà mọi task khác đều sửa. Trước 085, không chạy song song hai task cùng thêm tool hoặc cùng thêm bảng.
- Task 🔴 cần dữ liệu thật (kênh đã kết nối và có video đăng). Code được viết bằng mock trước, nhưng phải kiểm lại trên kênh thật.
- Hai session chạy cùng lúc phải có ranh giới file rõ ràng trong guide.

| Đợt | Chạy | Song song được | Ghi chú |
|---|---|---|---|
| 1 (xong) | 125 | 119 | Migration 0071 (125), 0072 (119) |
| 2 (đang chạy) | 111 → 112 → 113 (chuỗi style) | 120 (sau 119); 126 (xong); 127 khi 111 xong | 111/112/113/126/127 không migration; 120 là task migration duy nhất của đợt. 126 sở hữu `visualService.ts`: 113 (độ giống hình) chờ 126 xong mới sửa file đó |
| 3 | 122 → 123 | 074a | 122 có migration; 074a chờ 122 generate xong |
| 2b | **129b** (ngay sau 120) | chuỗi style 111→112→113, 127 | Sửa `jobs/worker.ts` + file governor mới; không migration |
| 3b | 128a → 128b (sau 123 và 127) | không task migration nào khác | Mỗi phần một migration. 128a sửa `visualService.ts`: không chạy cùng task nào sửa file đó |
| 3c | 129a → 129c (sau 128b) | | Mỗi phần một migration |
| 4 | **080** | không | Claude chạy checklist; bạn commit và push |
| 5 | **085** | không | Một mình. Bạn commit sau khi xong |
| 6 | 082 (bạn + Hermes) | 083, 090 | 083 không migration; 090 có migration |
| 7 | 088 | 074b, 074c | 088 có migration |
| 8 | 087 → 091 (khi 082 có số liệu) | 094, 099 | 087/091/094 đều có migration: đi lần lượt |
| 9 | 089 | 100, 097 | Sau 089 bắt đầu đếm **4 tuần** cho cổng dữ liệu của 092a |
| 10 | 095 → 096 | 098a → 098b, 104 | Migration lần lượt: 095, 098a, 098b |
| 11 | 092a (khi qua cổng dữ liệu) → 092b → 093 | 102a → 102b | |
| 12 | 101, 103, 105 | | Theo thứ tự migration: 101, 103 |

Chưa xếp (chờ quyết định hoặc đã bị thay):
- 073d nằm trong 092a;
- 106 phần lõi đã xong, phần còn lại do 108–110 thay;
- 081 chờ hướng mới (trang render riêng), làm sau khi các template ổn định.
- Đề xuất Hermes #15 (Wallhaven / nguồn ảnh cộng đồng): không viết nguồn riêng. TASK-128 cho agent tự tìm ở bất kỳ trang nào (kể cả Wallhaven) rồi nạp qua tool; ảnh mang `licenseVerified: false` và chế độ `copyrightMode` của project quyết định.
- Đề xuất Hermes #16 (Orchestrator + sub-agent): đã nằm trong 122 (lease, leo thang, giám sát), 123 (Hermes fleet) và 074 (tự nghiên cứu). Không mở task riêng.
- Đề xuất Hermes #3 (xóa watermark): **không làm**. Xóa watermark trên ảnh có bản quyền là gỡ thông tin quản lý bản quyền.

The spec in `docs/tasks/` is the requirement. The guide in `docs/cursor/` gives the current code state, the file map and the steps. When they disagree, the guide wins (it is newer). Each task depends on the ones above it; don't skip ahead.

Các hạng mục mở rộng agent được chia theo phạm vi. Chọn agent theo môi trường thuộc TASK-051. Checkpoint, định tuyến model theo chất lượng và chi phí, RAG và memory thuộc TASK-052. Skill tự học và đề xuất MCP thuộc TASK-053. Sự kiện, thông báo và theo dõi xuyên suốt thuộc TASK-054. Computer Use thuộc TASK-055. Chỉ mục tri thức và việc đưa ngữ cảnh kênh vào pipeline video thuộc TASK-057.

---

## For the agent: project facts

- **Monorepo** (npm workspaces):
  - `packages/shared`: zod schemas and pure logic. Exported from `src/index.ts` with `.js` import suffixes. Built to `dist/` before the apps use it.
  - `apps/server`: Fastify, better-sqlite3, Drizzle. Routes in `src/api/*.ts`, registered in `src/app.ts`. Stage executors in `src/stages/<stage>/`. Services in `src/services/`. Tests in `apps/server/test/`.
  - `apps/web`: React + Vite + react-query. Features in `src/features/<area>/`. UI text is **Vietnamese**.
  - `apps/mcp`: MCP server for Claude Desktop / Copilot Chat (`src/tools.ts`, `src/apiClient.ts`).
- **Source of truth:** `docs/ARCHITECTURE.md`. Read §4 (budget modes, LLM rules, routing) before touching LLM code.
- **Pipeline:** stages with states, gates (`WAITING_USER`), modes AUTO/ASSISTED/MANUAL. `src/pipeline/orchestrator.ts`. Changing upstream data marks later stages stale (`markStaleFrom`).
- **LLM layer:** `apps/server/src/providers/llm/`. Use `generateRoutedStructured` (per-task route, fallback, cache by prompt hash, usage per call). Every new LLM task needs:
  - an `LlmTaskId` plus an `LLM_TASKS` entry in `packages/shared/src/schemas/llm.ts`;
  - a budget feature in `packages/shared/src/budget/modes.ts` (presets ECO/BALANCED/QUALITY, the CUSTOM toggle in `apps/web/src/features/projects/BriefFields.tsx`, the estimate);
  - an answer in the mock provider for tests.
- **Quality-first rule:** an LLM call is allowed wherever it makes the video better. Budget modes stay selectable. Mechanical work (splitting, timing, ranking math, FFmpeg) stays in code.
- **Licenses** are metadata for the user. Never a hard block.

## Rules (must follow)

1. Never run real `claude`, `copilot`, `agy`, `edge-tts` or any real LLM in tests. Tests must not use the network. Use the mock provider and HTTP fixtures.
2. No new npm dependencies unless the guide says so. FFmpeg/ffprobe binaries are already available (`ffmpeg-static`, `ffprobe-static`).
3. **Migrations:** change `apps/server/src/db/schema.ts`, then run `npx drizzle-kit generate` inside `apps/server`. Never hand-write or edit migration SQL or snapshots.
4. Do not touch `.env`, `.claude/`, `data/`, `scripts/`. Do not commit or push.
5. Do not change existing behaviour beyond the task. Keep all existing tests passing. Update an old test only when the task intentionally changes what it checks, and say so in the report.
6. The app never handles Google credentials. Never read `~/.gemini/oauth_creds.json`.
7. Don't put the user's email or other personal data into user agents, URLs or any external service.
8. **Live checks:** never approve gates or press Render on project `56374fb2-54cf-48ff-9441-2e6c653295d4` (the user's real project). Create a throwaway project for live tests.
9. Windows + PowerShell 5.1: `&&` does not work in PowerShell. Use `;` or Git Bash.
10. **User guide.** Every task that changes what the user sees or does must update `docs/user-guide/` (Vietnamese), the `featureMap` in `packages/shared/src/features/featureMap.ts`, and `docs/user-guide/nhat-ky-thay-doi.md`. This applies from TASK-048 on.
11. **Open source first.** Applies from TASK-059 on. Before building a feature or a non-trivial module from scratch, look for a maintained open-source project that already does it. The guide's "Mã nguồn mở có sẵn" section lists what Claude found and what to build on.
    - **Using what the guide picked:**
      - Follow the guide's choice. Each choice is one of: add as a dependency, copy (vendor) code, or only borrow the design.
      - A dependency the guide names counts as allowed under rule 2.
    - **Copying code:**
      - Only from permissive licences: MIT, Apache-2.0, BSD or ISC.
      - Keep the licence header and add the source URL and commit in a comment at the top of the file.
      - List the copied code in the report.
      - Never copy GPL, AGPL or unlicensed code.
    - **Something better that the guide did not list:** do not add it on your own. Describe it in the report (name, link, licence, last release, why it is better) so Claude can update the guide.

## Commands

```bash
npm run typecheck
npm run build
npm test --workspaces
cd apps/server && npx drizzle-kit generate
```

- Run `drizzle-kit generate` a second time. It must print "No schema changes".
- Dev servers: `npm run dev` (API on 3001, web on 5180).

Test counts after TASK-017: shared 156, mcp 11, server 295, web 70. The counts must not go down.

## Done checklist (every task)

- [ ] `npm run typecheck`, `npm run build`, `npm test --workspaces` all pass.
- [ ] Each new table has a generated migration plus snapshot, and a second `drizzle-kit generate` says "No schema changes".
- [ ] No `package.json` / `package-lock.json` change unless the guide allows it.
- [ ] No NUL bytes or broken encodings in changed files (Vietnamese text stays UTF-8).
- [ ] The web UI works in a browser on a throwaway project: the new panel renders and its main action works.
- [ ] `docs/tasks/TASK-XXX.report.md` covers:
  - what changed, as a file list;
  - test counts per workspace;
  - deviations from the spec;
  - what is not done.
- [ ] The user guide is updated for every user-visible change: the `featureMap` entry, the guide section in `docs/user-guide/`, and a `nhat-ky-thay-doi.md` entry for this task. The guide coverage test passes. This applies from TASK-048 on.
- [ ] An empty file `docs/tasks/TASK-XXX.done`.
