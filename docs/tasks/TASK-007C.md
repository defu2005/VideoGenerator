# TASK-007C — "Nhờ AI tìm ảnh" (LLM web search) + ảnh do AI tạo

> Trạng thái: **ghi chú / chưa giao**. Phụ thuộc TASK-007 (image store tải + kiểm tra ảnh), TASK-004F (routing, usage), TASK-004H (agy).

## GOAL
Khi kho ảnh không có ảnh phù hợp cho một scene, user (hoặc pipeline ở QUALITY/MAX) nhờ LLM **tự tìm trên web** và trả về link ảnh. App tải và kiểm tra từng ảnh rồi đưa vào lưới candidate như các nguồn khác.

Phần 2 (sau): **AI tạo ảnh** khi không tìm được ảnh thật.

## CONTEXT — kiểm chứng thật (architect, 2026-11-03)
- **claude-cli làm được:**
  - Lệnh: `claude -p "<prompt>" --allowedTools WebSearch WebFetch --model claude-sonnet-5-5 --output-format json`.
  - Kết quả với "AlphaGo vs Lee Sedol, Seoul 2016": 147 s, trả JSON `{imageUrl, sourcePage, author, license, width, height, why}`.
  - Nó tự loại ảnh của hãng tin (Getty/AP) vì có bản quyền, và nói rõ ảnh nào **không** phải ảnh trận đấu.
  - Ảnh tìm được lấy qua Commons API, nhưng **nó chưa tải thử** ⇒ app phải tự kiểm tra.
- **agy với `--mode plan` không làm được:** model cố chạy lệnh shell, bị chặn, `response` rỗng.
- **agy toàn quyền làm được** (thử thật 2026-11-03, theo yêu cầu của product owner):
  - Lệnh: `agy -p "<prompt>" --dangerously-skip-permissions --sandbox --output-format json --print-timeout 400s`, chạy trong thư mục tạm.
  - Query "BLACKPINK performing on stage during Born Pink world tour": 213 s, `status: SUCCESS`, ~186k token.
  - `response` là JSON đúng schema, 4 ảnh Commons đúng chủ đề (CC BY 2.0 / CC BY 4.0). 3 link tải được ngay, 1 link Wikimedia trả 429 (giới hạn tần suất), không phải link hỏng.
  - Nó tự viết và chạy `calc_urls.ps1` trong thư mục tạm để tính đường dẫn upload.wikimedia.org ⇒ thật sự chạy lệnh trên máy.
- **LLM chỉ trả link, không trả ảnh.** Claude không tạo ảnh. Ảnh thật luôn do app tải về từ URL.

## REQUIREMENTS

### 1. Capability + transport
- Thêm `webSearch: boolean` vào capability provider:
  - claude-cli: `true`, bật bằng `--allowedTools WebSearch WebFetch`. Chỉ bật cho task này; các task khác giữ không có tool.
  - anthropic API: `true` qua server tool `web_search`.
  - antigravity-cli: `true` **chỉ khi** user bật "Cho phép Antigravity toàn quyền khi tìm ảnh" (setting `visualWebSearch.allowAgyFullAccess`, mặc định **tắt**, env `AGY_WEB_SEARCH_FULL_ACCESS=true` cũng bật). Khi bật, chỉ cuộc gọi task `visualWebSearch` dùng `--dangerously-skip-permissions --sandbox`; mọi task khác vẫn `--mode plan`. UI ghi rõ: "Antigravity sẽ tự chạy lệnh trên máy trong thư mục tạm khi tìm ảnh."
  - Các provider khác: `false`.
- Task routing mới **`visualWebSearch`**. Mặc định: claude-cli / claude-sonnet-5-5, tier "nên dùng model mạnh", timeout 300 s.
- Cuộc gọi chạy trong một thư mục tạm mới cho mỗi lần gọi (xoá sau khi xong), không phải trong repo; không `--add-dir` thư mục nào khác; env tối giản (không truyền key/API token của app).

### 2. Luồng
1. Scene card có nút **"Nhờ AI tìm"**. Ở QUALITY/MAX, pipeline tự gọi khi scene có điểm candidate tốt nhất dưới ngưỡng hoặc không có candidate. Tối đa N scene mỗi video, có trong budget estimate.
2. Prompt gồm:
   - mô tả scene, `visualDescription`, ngôn ngữ, tỉ lệ khung hình, độ phân giải tối thiểu;
   - **luật license**: chỉ CC0/PD/CC BY/CC BY-SA hoặc nguồn stock miễn phí; loại ảnh hãng tin/Getty/stock trả phí; không lấy ảnh có watermark.
   - Ép đầu ra theo schema JSON `{ candidates: [{imageUrl, sourcePage, author, license, licenseUrl?, width?, height?, why}] }`, tối đa 6.
3. App xử lý từng link:
   - tải qua image store (chặn SSRF, kiểm tra magic bytes, đọc kích thước thật, giới hạn dung lượng); loại link hỏng;
   - **xác minh license** khi nguồn quen thuộc: `commons.wikimedia.org` → hỏi lại Wikimedia API; `flickr`, `unsplash`, `pexels`, `pixabay` → API tương ứng nếu có key; còn lại `licenseVerified: false`.
4. Candidate mới có provider `ai-web` và badge "AI tìm", hiện kèm `why`.
   - Ảnh `licenseVerified: false` **không bao giờ được tự duyệt**, kể cả ở AUTO; UI cảnh báo "Chưa xác minh license".
5. Ghi usage (task `visualWebSearch`), cache theo hash của (scene query + prompt version), và đưa vào báo cáo token (TASK-004I).

### 3. Phần 2 — AI tạo ảnh (task con TASK-007D, làm sau)
- Provider tạo ảnh qua API key: Gemini image model (Google AI Studio key), OpenAI `gpt-image`. Claude không tạo ảnh.
- Kiểm tra `agy` có tool tạo ảnh chạy headless được không. Chưa xác minh, architect sẽ thử.
- License `AI_GENERATED`, badge "Ảnh AI tạo", ghi chú công khai trong mô tả video. Không dùng để tả người thật hoặc sự kiện có thật như ảnh tư liệu.

## DO NOT
- Không tin URL/license LLM trả về khi chưa tải và kiểm tra.
- Không bật tool web cho các task LLM khác.
- Chỉ dùng `--dangerously-skip-permissions` (luôn kèm `--sandbox`) cho agy ở task `visualWebSearch`, khi setting toàn quyền đang bật. Có test chứng minh task khác và trạng thái tắt vẫn dùng `--mode plan`.
- Không thêm dependency. Test không gọi mạng hoặc CLI thật (dùng fixture từ lần chạy thật ở trên).

## ACCEPTANCE CRITERIA
1. Typecheck, build, test, drizzle-kit, audit 0.
2. Unit test:
   - parse JSON;
   - loại URL hỏng, sai magic bytes, IP nội bộ;
   - xác minh license Commons;
   - không tự duyệt ảnh `licenseVerified: false`;
   - budget estimate có tính lượt gọi.
3. Live (architect): scene "AlphaGo vs Lee Sedol" → ít nhất 1 candidate `ai-web` tải được, license đã xác minh qua Commons, và hiện đúng trong Visuals tab.
