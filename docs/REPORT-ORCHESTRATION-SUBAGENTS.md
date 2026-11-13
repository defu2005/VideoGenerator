# KẾ HOẠCH CHI TIẾT: KIẾN TRÚC ORCHESTRATOR & CÁC SUB-AGENTS CHUYÊN BIỆT ĐIỀU PHỐI QUA WORK QUEUE

> **Tài liệu tham chiếu:** `docs/ARCHITECTURE-TARGET.md`, `docs/cursor/TASK-122.md`, `PROPOSALS_AND_BUGS.md` §16.  
> **Người lập:** Hermes Agent (Orchestrator).  
> **Mục tiêu:** Thiết lập hệ thống đa tác nhân (Multi-Agent Architecture) vận hành tự động, có khả năng thích ứng linh hoạt với mọi thể loại/ngách video (Manga, Khoa học, Lịch sử, Đời sống, Tin tức), giải quyết triệt để nút thắt cổ chai về tài nguyên tìm kiếm hình ảnh, kiểm duyệt nội dung và sản xuất video song song liên tục.

---

## 1. TỔNG QUAN HỆ THỐNG & SƠ ĐỒ CHỈ HUY

Hệ thống hoạt động theo mô hình **Kim Tự Tháp Quyền Lực & Trách Nhiệm**:
```text
                  ┌───────────────────────────────┐
                  │          NGƯỜI DÙNG           │  (Đưa mục tiêu, duyệt dự án, cấp ngân sách)
                  └───────────────┬───────────────┘
                                  │
                  ┌───────────────▼───────────────┐
                  │    ORCHESTRATOR AGENT (Hermes)│  (Điều phối trưởng 24/7, phân rã công việc)
                  └───────────────┬───────────────┘
                                  │
     ┌────────────────────────────┼────────────────────────────┐
     │ Đẩy task / Lease           │ Giám sát tiến độ           │ Quản lý tài nguyên
     ▼                            ▼                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      WORK QUEUE (SQLite: agent_tasks)                       │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ Claims task song song
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   SUB-AGENT 1    │    │   SUB-AGENT 2    │    │   SUB-AGENT 3    │
│ Visual Research  │    │ Channel Operator │    │  Video Producer  │
│  (Săn ảnh Web)   │    │ (Quản lý Kênh)   │    │ (Sản xuất Video) │
└──────────────────┘    └──────────────────┘    └──────────────────┘
```

---

## 2. NHIỆM VỤ CỤ THỂ CỦA TỪNG AGENT

### A. ORCHESTRATOR AGENT (Điều phối trưởng)
* **Vị trí:** Tầng điều hành trung tâm (Root Agent), giao tiếp trực tiếp với Người dùng qua giao diện Chat/Telegram và MCP Server.
* **Quyền hạn & Trách nhiệm:**
  1. **Tiếp nhận & Phân tích mục tiêu (Intent Parsing):** Khi người dùng yêu cầu làm video về một chủ đề bất kỳ (ví dụ: *Berserk, Thuyết tương đối của Einstein, Sự sụp đổ của La Mã, Tin AI tuần qua*), Orchestrator tự động nhận diện **Thể loại (Category / Niche)** và các yêu cầu kỹ thuật tương ứng.
  2. **Khởi tạo & Phân rã công việc (Task Decomposition):**
     - Sinh ra các Task con trong Work Queue (`agent_tasks`):
       - `TASK_TOPIC_RESEARCH`: Thu thập tài liệu & góc nhìn kịch bản.
       - `TASK_VISUAL_DISCOVERY`: Tìm kiếm danh mục hình ảnh tương thích với thể loại.
       - `TASK_MEDIA_SYNTHESIS`: Lồng tiếng, tạo phụ đề, chọn nhạc nền.
       - `TASK_COMPOSE_RENDER`: Dựng video bằng Compose Engine và thẩm định sau render.
  3. **Quản lý Hàng đợi & Tránh xung đột (Lease & Lock Manager):**
     - Áp dụng nguyên tắc `one-writer-per-object` (TASK-122). Mỗi scene hoặc project chỉ được 1 sub-agent nắm quyền chỉnh sửa tại một thời điểm.
     - Cấp phát `lease` (TTL 10 phút) cho Sub-Agent; thu hồi hoặc hủy bỏ khi sub-agent bị treo (`overdue`).
  4. **Giám sát Sức khỏe & Điều phối Tài nguyên (Resource & Quota Arbiter):**
     - Quản lý hạn mức gọi LLM (OmniRoute, Gemini, Grok, Claude).
     - Khi một API bị chạm hạn ngạch (HTTP 429/402), Orchestrator chủ động chuyển hướng route cho Sub-Agent thay vì để công việc bị chết đứng.
  5. **Tổng hợp Báo cáo (Synthesis & Delivery):**
     - Báo cáo kết quả cuối cùng cho Người dùng, cảnh báo các vấn đề bản quyền hoặc rủi ro nội dung.

---

### B. SUB-AGENT 1: VISUAL RESEARCH AGENT (Chuyên viên Tìm kiếm & Đồ họa)
* **Mục tiêu:** Đảm bảo 100% các cảnh trong video đều có hình ảnh chuẩn xác, đúng chủ đề, đạt độ phân giải cao (1080p/4K), tỷ lệ 16:9, không bao giờ lấy ảnh lạc đề.
* **Quy trình hoạt động theo Work Queue:**
  1. **Lắng nghe Queue:** Nhận task `VISUAL_RESEARCH_BATCH` gồm danh sách các cảnh kèm theo `visualDescription`, `visualQueries` và `topic`.
  2. **Thích ứng Nguồn tìm kiếm theo Thể loại (Adaptive Multi-Source Strategy):**
     - **Nếu Thể loại = Manga / Anime / Game:**
       - Tự động bỏ qua các kho ảnh stock bảo tàng thiên nhiên (Pixabay, Unsplash, Wikimedia vì không có dữ liệu).
       - Kích hoạt tìm kiếm tại các nguồn mở chuyên biệt: **Wallhaven API** (`https://wallhaven.cc/api/v1/search`), **Pinterest HD Boards**, **Reddit Manga Archives**, **Internet Archive Artbooks**.
     - **Nếu Thể loại = Khoa học / Thiên văn / Công nghệ:**
       - Ưu tiên cào ảnh từ **NASA Images API**, **ESA**, **Wikimedia Commons**.
     - **Nếu Thể loại = Lịch sử / Khảo cổ / Nghệ thuật cổ điển:**
       - Truy vấn kho dữ liệu của **The Met Museum API**, **Smithsonian Open Access**, **Library of Congress (LOC)**, **Europeana**.
     - **Nếu Thể loại = Đời sống / Kinh doanh / Giáo dục phổ thông:**
       - Tận dụng kho ảnh bản quyền miễn phí chất lượng cao: **Pexels**, **Pixabay**, **Unsplash**.
  3. **Tải về, Thẩm định Kỹ thuật & Vision Check:**
     - Tải ảnh trực tiếp vào bộ nhớ đệm, kiểm tra: độ phân giải tối thiểu `1280×720` (ưu tiên `1920×1080`), tỉ lệ khung hình (cắt crop nếu cần), không chứa watermark chìm rác.
     - Chạy kiểm tra Vision (qua model Vision nhẹ hoặc Grok/Gemini): đảm bảo ảnh mô tả đúng nhân vật/sự kiện trong cảnh.
  4. **Nạp ảnh vào Hệ thống (System Injection):**
     - Gọi trực tiếp endpoint nội bộ: `POST /api/projects/:id/scenes/:sceneId/visuals/custom-url` hoặc `/upload`.
     - Chuyển cờ cảnh sang `no_visual = 0`, ghi nhận metadata bản quyền và tác giả rõ ràng.
  5. **Hoàn tất Task:** Trả về kết quả cho Queue: `status: "COMPLETED"`, số lượng ảnh đã gán thành công.

---

### C. SUB-AGENT 2: CHANNEL SPECIALIST AGENT (Quản lý Kênh chuyên biệt)
* **Mục tiêu:** Vận hành từng kênh YouTube/TikTok/Reels theo đúng "DNA" và định hướng thương hiệu của kênh đó.
* **Nhiệm vụ cụ thể:**
  1. **Duy trì Playbook của Kênh (Channel Playbook & Style System):**
     - Nắm vững hồ sơ kênh (`profiles`): Định hướng ngách (Manga Review, Lịch sử hào hùng, Bản tin công nghệ).
     - Giữ vững quy chuẩn thương hiệu:
       * **Font chữ & Màu sắc:** Bộ token giao diện Dark Fantasy, Minimalist hay Vibrant Neon.
       * **Tông giọng lồng tiếng (Voice Profile):** Giọng đọc nam trầm ấm (Edge TTS HoaiMy/NamMinh), tốc độ đọc chuẩn cho từng thể loại (`+0%` đến `+5%`).
       * **Nhạc nền chủ đạo (Music Guidelines):** Thể loại nhạc (Cinematic Orchestral, Lofi Chill, Ambient Dark).
  2. **Quản lý Hàng đợi Chủ đề (Topic Pipeline & Radar):**
     - Tự động quét xu hướng (Trends), các chủ đề nóng trong ngách của kênh.
     - Đề xuất kịch bản và chuẩn bị sẵn các draft dự án trong database.
  3. **Tối ưu SEO & Đăng bài (Publishing & Metadata Optimization):**
     - Tạo 3 phương án tiêu đề A/B testing (`titles`).
     - Tối ưu hóa mô tả video, trích dẫn bản quyền đầy đủ (`creditsText`), gắn hashtag và thẻ tags tăng tỷ lệ click (CTR).
  4. **Phân tích Hiệu quả Giữ chân (Retention Analysis):**
     - Đọc dữ liệu sau xuất bản (48h, 7 ngày) từ YouTube Analytics.
     - Xác định đoạn nào người xem thoát nhiều nhất để điều chỉnh độ dài cảnh ở các video tiếp theo.

---

### D. SUB-AGENT 3: VIDEO PRODUCER AGENT (Điều phối Sản xuất & Render)
* **Mục tiêu:** Chịu trách nhiệm thực thi đường ống (Pipeline Execution) và bảo đảm chất lượng thành phẩm video.
* **Nhiệm vụ cụ thể:**
  1. **Điều khiển Pipeline Tuyến tính & 2 Làn (Dual-Lane Runner):**
     - Giám sát 2 làn chạy song song độc lập (Làn Visual và Làn Audio).
     - Khi Làn Audio hoàn thành: Kích hoạt tạo phụ đề đồng bộ (`SUBTITLE`) và khớp nhịp nhạc (`MUSIC_SEARCH`).
  2. **Dựng Timeline & Xử lý Cắt ghép (Compose Bridge):**
     - Tính toán thời lượng chính xác từng giây giữa lời thoại (voice track) và hiển thị hình ảnh.
     - Áp dụng các hiệu ứng chuyển động máy quay (Ken Burns, Pan, Push-in, Zoom-out) phù hợp với nhịp cảm xúc kịch bản.
  3. **Kiểm soát Cổng Chất lượng (Quality Gates & Auto-Repair - TASK-121):**
     - Khi khâu hình ảnh hoặc render gặp cảnh báo: Tự động chạy thang sửa lỗi (Quality Repair Ladder).
     - Nếu phát hiện khung hình bị đen hoặc bị đứng (`probeFreezeBlack` > 2 giây): Tự động điều chỉnh timeline hoặc thay đổi hiệu ứng chuyển cảnh `xfade`.
  4. **Render Cuối cùng (Final Export):**
     - Chạy FFmpeg + HyperFrames dựng video Full HD / 4K.
     - Tự động trích xuất các khung hình đẹp nhất để tạo Thumbnail hấp dẫn.

---

## 3. CƠ CHẾ GIAO TIẾP & ĐIỀU PHỐI (ORCHESTRATION PROTOCOL)

Hệ thống giao tiếp thông qua **3 trụ cột kỹ thuật chuẩn mực**:

1. **Work Queue trong SQLite (`agent_tasks`):**
   ```sql
   CREATE TABLE agent_tasks (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL,
     task_type TEXT NOT NULL,          -- VISUAL_SEARCH, SCRIPT_GEN, RENDER_VERIFY...
     assigned_agent TEXT,              -- ID của sub-agent đang nhận task
     status TEXT NOT NULL,             -- QUEUED, IN_PROGRESS, COMPLETED, FAILED
     payload_json TEXT NOT NULL,       -- Dữ liệu đầu vào chi tiết
     result_json TEXT,                 -- Kết quả đầu ra có cấu trúc
     lease_expires_at TEXT,            -- Khóa chống tranh chấp
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   ```

2. **Server-Sent Events (SSE) & Webhook Stream (`/api/agent-events`):**
   - Orchestrator và các Sub-Agent kết nối tới luồng SSE của Fastify Server.
   - Khi có sự kiện `STAGE_COMPLETED`, `VISUAL_UPDATED`, hoặc `NEEDS_ATTENTION`, hệ thống phát tín hiệu tức thì mà không cần polling liên tục gây nghẽn database.

3. **Lease Protocol & Heartbeat (Chống tắc nghẽn):**
   - Mỗi sub-agent khi nhận việc phải gửi heartbeat định kỳ (mỗi 30-60 giây).
   - Nếu một sub-agent bị treo quá thời gian (ví dụ script cào ảnh bị crash), Orchestrator phát hiện lease hết hạn sẽ tự động thu hồi task và gán cho sub-agent khác hoặc chuyển sang phương án dự phòng.

---

## 4. BẢNG SO SÁNH: TRƯỚC VÀ SAU KHI ÁP DỤNG KIẾN TRÚC MỚI

| Tiêu chí | Hệ thống Cũ (Đơn tuyến / Đơn Provider) | Hệ thống Mới (Orchestrator & Sub-Agents) |
|---|---|---|
| **Khả năng thích ứng chủ đề** | Kém. Chỉ tốt cho phong cảnh, thiên nhiên. Tê liệt với Manga, Anime, Game, Phim ảnh. | **Cực cao.** Tự động chuyển đổi giữa 15+ nguồn dữ liệu chuyên biệt theo từng thể loại. |
| **Độ phụ thuộc API** | Phụ thuộc 100% vào Brave Search và Gemini. Hết quota là dừng cả hệ thống. | **Độc lập & Bền vững.** Tự động dùng nguồn mở miễn phí (Wallhaven, Archives, Web Scraper) khi API trả phí hết ngạch. |
| **Xử lý song song** | TUYỆT ĐỐI TUẦN TỰ. 1 việc lỗi làm dừng cả tiến trình. | **SONG SONG.** Sub-Agent tìm ảnh chạy độc lập với Sub-Agent làm giọng và kịch bản. |
| **Độ tin cậy & Tự phục hồi** | Gặp lỗi phải dừng lại chờ người dùng can thiệp thủ công. | Tự sửa lỗi qua Work Queue, tự đổi nguồn dữ liệu, tự động tái kích hoạt stage. |
| **Chất lượng Video** | Dễ bị video toàn chữ hoặc dính ảnh stock lạc đề (chim ưng, xe múc). | **100% ảnh đúng nội dung, sắc nét**, đồng bộ chuẩn từng mili-giây với kịch bản. |

---

## 5. KẾ HOẠCH HÀNH ĐỘNG TRIỂN KHAI THỰC TẾ

1. **Bước 1 (Ghi nhận & Chuẩn hóa):** Đã ghi nhận toàn bộ thiết kế kiến trúc vào `PROPOSALS_AND_BUGS.md` (Mục 16) để team core phát triển.
2. **Bước 2 (Thực nghiệm Ngay trên Dự án Berserk):**
   - Đóng vai trò Orchestrator trực tiếp: Spawn tác vụ tìm kiếm hình ảnh cho 31 cảnh của Berserk.
   - Quét nguồn ảnh Manga Berserk chất lượng cao từ Wallhaven API.
   - Gán ảnh tự động qua API `POST /api/projects/:id/scenes/:sceneId/visuals/custom-url`.
   - Kích hoạt Producer Agent dựng lại toàn bộ video có 100% tranh manga chuẩn xác.
