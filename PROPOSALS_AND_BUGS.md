# Báo Cáo Lỗi & Đề Xuất Tính Năng (PROPOSALS_AND_BUGS.md)

Tài liệu này ghi lại chi tiết các lỗi phát hiện được và đề xuất giải pháp kỹ thuật, tính năng mới cho dự án `videoGenerator`. (Theo chỉ thị: Không can thiệp sửa code trực tiếp, toàn bộ mô tả và giải pháp được lưu vào file này để xem xét xử lý sau).

---

## 1. [BUG & FEATURE] Đảm bảo ảnh giữa các Scene không bao giờ bị trùng lặp (Strict No-Duplicate Policy)

### Hiện trạng lỗi:
- Khi một từ khóa chỉ tìm thấy 1-2 ảnh (đặc biệt từ Wikimedia), các scene tiếp theo tự động tái sử dụng lại ảnh của scene trước (ví dụ: Scene 0 và Scene 1 trong video Berserk đều dùng chung ảnh `Berserk by uemura.jpg`).

### Nguyên nhân gốc rễ trong code:
- **Tệp:** `packages/shared/src/visuals/assign.ts` (hàm `assignDistinct`)
- **Đoạn code:**
  ```typescript
  const available = preferred.filter((item) => 
    !globallyUsed.has(dedupeKey(item)) && !reservedLocked.has(dedupeKey(item))
  );
  let candidate = lockedCandidate
    ?? available[0]
    ?? preferred.find((item) => dedupeKey(item) !== previousKey)
    ?? preferred[0] // <-- NGUYÊN NHÂN Ở ĐÂY
    ?? null;
  ```
- **Cơ chế:** Khi `available` rỗng (toàn bộ ứng viên của scene này đã bị các scene trước dùng hết), code tự động fallback về `preferred[0]` (ảnh đã dùng) và chỉ đánh dấu cờ `reusedAcrossScenes: true` mà vẫn cho phép render.

### Đề xuất giải pháp / Tính năng:
1. **Thiết lập Strict Mode (Tuyệt đối không trùng):**
   - Khi `available.length === 0`:
     - **Bước 1:** Tự động kích hoạt truy vấn bổ sung từ nguồn mở rộng (Brave Web Search hoặc Gemini Grounding) với bộ từ khóa phụ (`alternativeQueries`) để bổ sung các ứng viên hoàn toàn mới chưa có trong `globallyUsed`.
     - **Bước 2:** Nếu vẫn không tìm được ảnh mới, gán trạng thái `needsUser = true` hoặc để `PLACEHOLDER` để người dùng upload/chọn ảnh, tuyệt đối không tự ý gán lại ảnh cũ đã nằm trong `globallyUsed`.

---

## 2. [BUG] Cơ chế `lowRelevance` làm tê liệt tính năng Brave Web Search tự động

### Hiện trạng lỗi:
- Tài khoản Brave Search API còn nguyên gần 2.000 lượt gọi/tháng và đã cấu hình đầy đủ key trong app, nhưng pipeline tự động không bao giờ gọi Brave Search (`braveRequestsThisMonth: 0`), dẫn đến video Manga/Anime bị lấy nhầm ảnh đời thực không liên quan từ Wikimedia.

### Nguyên nhân gốc rễ trong code:
1. **Tệp:** `packages/shared/src/visuals/rank.ts` (dòng 113)
   ```typescript
   lowRelevance: keyword === 0
   ```
   Hàm xếp hạng chỉ coi một ảnh là "không liên quan" khi số từ khóa trùng khớp bằng 0. Chỉ cần tiêu đề ảnh trên Wikimedia vô tình chứa một từ (như "Berserk" trong ảnh người dạo phố, hay "Hawk" trong ban nhạc "Golden Hawks"), ảnh sẽ bị coi là hợp lệ (`lowRelevance: false`).
2. **Tệp:** `apps/server/src/services/visualService.ts` (dòng 1357)
   ```typescript
   const lowScenes = rankedScenes.filter((entry) => {
     const relevant = entry.ranked.filter((candidate) => candidate.scoreBreakdown.lowRelevance !== true);
     return relevant.length === 0 || (entry.ranked[0]?.scoreBreakdown.lowRelevance === true);
   });
   ```
   Pipeline chỉ kích hoạt Brave Search cho các scene bị đánh dấu `lowRelevance`. Do Wikimedia luôn trả về ảnh có dính 1 chữ keyword, danh sách `lowScenes` luôn rỗng -> Brave Web Search không bao giờ được kích hoạt.

### Đề xuất giải pháp / Tính năng:
1. **Nâng ngưỡng liên quan ngữ nghĩa:**
   - Thay vì kiểm tra `keyword === 0`, cần kiểm tra tỷ lệ từ khóa (ví dụ `keyword < 0.4`) hoặc sử dụng `semanticImageRerank` để loại bỏ ảnh lạc đề.
2. **Cấu hình ưu tiên nguồn Web Search theo chủ đề:**
   - Bổ sung tùy chọn `imageSearchPreference`: Đối với các chủ đề đặc thù không có trên kho ảnh công cộng (Manga, Anime, Game, Người nổi tiếng, Xu hướng mới), pipeline cần ưu tiên truy vấn thẳng **Brave Web Search** ngay từ đầu thay vì chỉ dùng làm phương án cứu cánh khi Wikimedia thất bại.

---

## 3. [FEATURE SPEC] Hậu kỳ Ảnh: Xóa Watermark & Cắt 1/10 tỉ lệ khi ảnh có Bản quyền

### Yêu cầu nghiệp vụ:
- **ĐIỀU KIỆN TIÊN QUYẾT: ĐỘ LIÊN QUAN NỘI DUNG LÀ BẮT BUỘC (Hard Relevance Prerequisite):**
  - **Bài học từ video Berserk:** Hệ thống cũ chọn ảnh lạc đề nghiêm trọng (ảnh diễu hành lễ hội, ảnh người dạo phố, chụp tượng ngẫu nhiên...) chỉ vì tiêu đề chứa 1 từ khóa ngẫu nhiên và có giấy phép mở CC-BY trên Wikimedia.
  - **Quy tắc tuyệt đối:** Ảnh chỉ được đưa vào danh sách xem xét nếu nó **thực sự đúng nhân vật, đúng tác phẩm và đúng bối cảnh của phân cảnh** (Semantic Relevance vượt ngưỡng tối thiểu, ví dụ `relevanceScore >= 0.65` hoặc `visionCheck.fit === "EXCELLENT" | "ACCEPTABLE"`). Tuyệt đối **không được vì "miễn phí bản quyền" mà chọn một bức ảnh lạc đề**.
- **Thứ tự ưu tiên khi chọn ảnh (Candidate Selection Hierarchy):**
  1. **Ưu tiên 1 (Ảnh liên quan + Không bản quyền):** Nếu trong các ảnh **thực sự đúng nội dung**, có ảnh đạt chất lượng tương đương nhau, **luôn ưu tiên ảnh KHÔNG có bản quyền** (Public Domain, CC0, CC-BY...) và giữ nguyên ảnh gốc, không cần crop.
  2. **Ưu tiên 2 (Ảnh liên quan + Có bản quyền $\rightarrow$ Kích hoạt Hậu kỳ):** Nếu kho ảnh mở không có ảnh nào đúng nội dung phân cảnh (như các tác phẩm Manga, Anime, Game có bản quyền), hệ thống **bắt buộc phải lấy ảnh đúng chủ đề từ Web Search (Brave Search / Gemini Grounding)**, sau đó áp dụng quy trình xử lý 2 bước dưới đây:
     - **Bước 1 (Xóa Watermark):** Nếu ảnh có watermark, thực hiện xóa watermark trước (nếu có thể).
     - **Bước 2 (Cắt ảnh theo tỉ lệ):** Sau khi đã xử lý watermark (hoặc không có watermark), tiến hành cắt 1/10 ảnh theo đúng tỉ lệ khung hình ban đầu.

### Thiết kế chi tiết cho khâu Dev:

#### 1. Bước 1: Phát hiện và Xóa Watermark (Watermark Removal)
- **Điều kiện phát hiện:**
  - Thuộc tính `candidate.watermark === "SUSPECTED"`
  - Hoặc cờ kiểm tra của AI Vision (`candidate.visionCheck?.issues` chứa `"watermark"`, `"logo_only"`, hoặc `"text_overlay"`).
- **Phương án kỹ thuật thực hiện xóa:**
  - **Cách 1 (Inpainting AI / OpenCV):** Sử dụng thư viện inpainting (như thuật toán Navier-Stokes / Fast Marching của OpenCV hoặc mô hình AI inpaint nhẹ) trên vùng mask chứa watermark.
  - **Cách 2 (FFmpeg Delogo):** Với watermark ở các góc quen thuộc (góc dưới phải, trên trái), sử dụng filter `delogo=x=...:y=...:w=...:h=...` của FFmpeg để làm mờ và tái tạo vùng nền tự nhiên.

#### 2. Bước 2: Cắt 1/10 ảnh theo tỉ lệ cũ (10% Ratio-Preserving Crop)
- **Điều kiện xác định ảnh có bản quyền:**
  - `candidate.license.kind` là `ALL_RIGHTS_RESERVED`, `UNKNOWN`, có chứa `NC` (Non-Commercial), hoặc ảnh được thu thập từ nguồn Web Search không thuộc miền công cộng (Public Domain / CC0).
- **Thuật toán cắt (Crop Transform):**
  - Giữ nguyên tỉ lệ khung hình của video (`16:9` hoặc `9:16`).
  - Lấy 90% vùng trung tâm bức ảnh, loại bỏ 5% mỗi bên mép (tổng cắt 1/10 kích thước cả chiều rộng và chiều cao).
  - Công thức tính toán:
    ```typescript
    const cropWidth = Math.round(originalWidth * 0.9);
    const cropHeight = Math.round(originalHeight * 0.9);
    const cropX = Math.round((originalWidth - cropWidth) / 2);
    const cropY = Math.round((originalHeight - cropHeight) / 2);
    ```
  - Thực thi qua **FFmpeg**:
    ```bash
    ffmpeg -i input.jpg -vf "crop=iw*0.9:ih*0.9:(iw-ow)/2:(ih-oh)/2" output_cropped.jpg
    ```
    hoặc qua thư viện **Sharp** (Node.js):
    ```typescript
    await sharp(inputBuffer)
      .extract({ left: cropX, top: cropY, width: cropWidth, height: cropHeight })
      .toFile(outputPath);
    ```
  - **Lợi ích:** Vừa loại bỏ các viền watermark / viền chữ đóng khung ở rìa ảnh, vừa biến đổi bố cục nhẹ để tránh thuật toán quét bản quyền tự động, đồng thời đảm bảo không bị méo tỉ lệ khung hình khi render.

#### 3. Các vị trí file cần tích hợp khi triển khai:
- `apps/server/src/services/visualService.ts`: Thêm hàm `postProcessCandidateVisual(candidate)` sau khi tải ảnh `downloadCandidate`.
- `apps/server/src/media/imageTransform.ts`: Tạo module helper xử lý `removeWatermark` và `cropCopyrightRatio`.
- `packages/shared/src/schemas/visual.ts`: Thêm metadata theo dõi `watermarkRemoved?: boolean`, `copyrightCropApplied?: boolean`.

---

## 4. [BUG-IMAGE-001] Met Image Provider trả HTTP 410 trong Visual Search

### Bằng chứng runtime:
- Backend ghi nhận `ImageProviderError: Image provider returned HTTP 410` từ provider `met`.
- Lỗi phát sinh tại `apps/server/src/providers/images/met.ts`, khi gọi:
  - `https://collectionapi.metmuseum.org/public/collection/v1/search`
  - sau đó là endpoint object của Met Museum.
- Stack trace cho thấy lỗi đi qua `fetchJsonWithRetry` và `VisualService.searchAcrossProviders` trong lúc tìm ảnh cho nhiều scene.

### Phân tích nguyên nhân:
- HTTP `410 Gone` nghĩa là endpoint hoặc tài nguyên đã bị gỡ/không còn khả dụng, không phải lỗi tạm thời của mạng.
- Provider hiện vẫn được đăng ký và bị gọi trong mỗi lượt tìm kiếm, dù lỗi 410 là lỗi xác định không thể tự hồi phục bằng retry.
- Nếu không có circuit breaker riêng cho lỗi vĩnh viễn, nhiều scene có thể lặp lại cùng lỗi và làm log nhiễu, kéo dài stage `VISUAL_SEARCH`.

### Ảnh hưởng:
- Provider Met không trả ứng viên ảnh.
- Có thể làm tăng thời gian tìm kiếm và số lỗi trong log.
- Nếu các provider khác vẫn trả kết quả, stage có thể tiếp tục nhưng thiếu nguồn Met.
- Nếu Met là nguồn cần thiết cuối cùng, scene có nguy cơ thiếu ảnh hoặc bị chuyển sang fallback không phù hợp.

### Đề xuất xử lý cho Dev (không sửa trực tiếp tại đây):
1. Xác nhận endpoint Met hiện tại còn được hỗ trợ; nếu API đã thay đổi, cập nhật URL theo tài liệu chính thức.
2. Phân loại HTTP `410` là non-retryable và không chạy thêm retry cho cùng request.
3. Bổ sung circuit breaker theo từng lượt chạy: sau lỗi 410 đầu tiên, bỏ qua Met cho phần còn lại của stage và chỉ ghi một cảnh báo tổng hợp.
4. Ghi trạng thái sức khỏe provider vào phần tổng kết Visual Search, ví dụ: `met: unavailable (HTTP 410)`.
5. Không để Met lỗi làm dừng toàn bộ Visual Search khi Brave/Gemini/Openverse/Wikimedia hoặc provider hợp lệ khác vẫn còn kết quả.
6. Nếu không còn nguồn ảnh phù hợp, phải báo `needsUser`/`Cần bạn`, không chọn ảnh lạc đề để lấp scene.
7. Thêm test mock không dùng mạng cho các trường hợp: 410 không retry, provider bị skip sau lỗi đầu tiên, provider khác vẫn được gọi, và toàn bộ provider thất bại thì scene được đánh dấu cần xử lý.

---

## 5. [BERSEK-RUN-001] Tổng hợp lỗi từ lần chạy lại dự án Berserk và đề xuất giải pháp

### Phạm vi kiểm tra
Dự án `1ef6de1f-cf84-4552-8aed-8958f290bc0e` đã được tìm lại ảnh nhiều lần, gồm tìm kiếm Brave theo từng scene, dedupe và chạy lại `VISUAL_SEARCH` ở chế độ `MAX` với model vision `omniroute/sopen/gemini-3.8-flash-high`.

### Lỗi 1 — Ảnh lạc đề do khớp từ khóa bề mặt
**Bằng chứng:** các scene chọn ảnh Pixabay/NASA/Wikimedia về sấm chớp, samurai, ban nhạc, diễu hành, nhật thực, phi hành gia, vệ tinh, `Gut on Chip`, cổng thành và stock photo, dù narration nói về Guts, Griffith, God Hand, Dragon Slayer hoặc Brand of Sacrifice.

**Nguyên nhân:** ranking vẫn để tag/tên ảnh chung như `gut`, `dragon`, `band`, `hawk`, `eclipse`, `god` tạo điểm liên quan; chưa có entity gate bắt buộc cho tác phẩm, nhân vật và bối cảnh.

**Đề xuất:** tạo entity bundle cho mỗi scene; yêu cầu ứng viên khớp `Berserk` + entity cụ thể + context; thêm negative keywords; loại candidate nếu chỉ trùng một từ hoặc là ảnh đời thực không đúng chủ thể.

### Lỗi 2 — `lowRelevance` không chặn render
**Bằng chứng runtime sau MAX:** `31/31` scene có `lowRelevance=true` nhưng vẫn có `status=READY_FOR_RENDER`, `needsUser=0`, `REVIEW_REQUIRED=0`.

**Nguyên nhân:** `READY_FOR_RENDER` đang có nghĩa là đã có ảnh được chọn, không phải ảnh đã vượt relevance gate. `lowRelevance` chỉ xuất hiện trong summary nhưng không phải hard block.

**Đề xuất:** nếu `lowRelevance=true`, vision reject hoặc score dưới ngưỡng thì bắt buộc chuyển `REVIEW_REQUIRED`/`needsUser=true`; không được render. Chỉ cho render khi `lowRelevance=0`, `REVIEW_REQUIRED=0`, `needsUser=0`.

### Lỗi 3 — Chế độ BALANCED không chạy vision, nhưng trạng thái không cảnh báo đủ
**Bằng chứng:** trước khi đổi MAX, project có `budget.mode=BALANCED`, `features={}`, candidate có `visionCheck=null`; summary có nhiều ảnh đã chọn dù chưa qua AI kiểm duyệt.

**Nguyên nhân:** BALANCED đặt `visionCheck=false`, nhưng UI/trạng thái vẫn cho phép hiểu `READY_FOR_RENDER` là đạt chất lượng.

**Đề xuất:** hiển thị rõ `AI vision chưa chạy`; với chủ đề hư cấu như Manga/Anime/Game, tự động yêu cầu MAX/visual quality best hoặc chặn render cho đến khi vision review hoàn tất.

### Lỗi 4 — MAX đã bật nhưng vision vẫn không tạo hard acceptance gate
**Bằng chứng:** sau khi đặt MAX và route vision, VISUAL_SEARCH hoàn tất với `31 scenes`, `744 candidates`, `LLM calls=1`, nhưng kết quả cuối vẫn là stock ảnh lạc đề và `lowRelevance=31`.

**Nguyên nhân khả dĩ:** vision được dùng để hỗ trợ ranking/retry nhưng chưa bắt buộc xác nhận candidate cuối; candidate cũ hoặc candidate không được vision kiểm vẫn lọt vào pool; selection đã `APPROVED` có thể được bảo vệ khỏi thay thế.

**Đề xuất:** ghi metadata `visionCheck` cho mọi candidate cuối; candidate thiếu vision result không được chọn trong MAX; candidate bị reject phải bị loại; cho phép re-evaluate selection cũ khi người dùng yêu cầu tìm lại, trừ selection khóa thủ công.

### Lỗi 5 — Tìm Brave thành công nhưng không thay selection cũ tốt hơn
**Bằng chứng:** Brave trả candidate Guts/Berserk có relevance cao hơn, nhưng selection vẫn giữ `Berserk by uemura.jpg` hoặc ảnh Wikimedia cũ.

**Nguyên nhân:** web search chủ yếu bổ sung candidate; không có bước global re-ranking/reassignment đủ mạnh sau tìm kiếm. Selection `APPROVED` của Agent được coi như khóa.

**Đề xuất:** phân biệt `user_locked` và `agent_selected`; cho phép thay agent selection khi candidate mới vượt điểm tối thiểu và qua vision; chạy lại global assignment + dedupe sau toàn bộ web search.

### Lỗi 6 — Nguồn ảnh chất lượng thấp hoặc không phù hợp
**Bằng chứng:** kết quả Brave có Reddit, Pinterest, wallpaper, Craiyon, PromptHero, Wallhaven, Stable Diffusion Web, blog tổng hợp và fan-art không rõ quyền.

**Nguyên nhân:** chưa có source policy đủ chặt; license `UNKNOWN` vẫn được đưa vào pool và có thể thắng nhờ relevance bề mặt.

**Đề xuất:** denylist Pinterest/pinimg/wallpaper/scraper; đánh dấu fan-art/AI/aggregator là rủi ro cao; yêu cầu source URL và license evidence; ưu tiên key visual/chủ thể chính thức khi dùng nội dung bình luận.

### Lỗi 7 — Dedupe chạy nhưng không giải quyết relevance
**Bằng chứng:** dedupe có thay đổi selection nhưng sau đó vẫn còn ảnh khác nhau mà đều sai nội dung; một số ảnh gần giống vẫn xuất hiện ở nhiều scene trước khi chạy lại.

**Nguyên nhân:** dedupe chỉ so URL/id/hash, không đánh giá scene semantics và chưa phải bước cuối sau relevance gate.

**Đề xuất:** thứ tự bắt buộc là `relevance gate → vision gate → license/source filter → global assignment → perceptual dedupe → final gate`; cấm fallback ảnh cũ hoặc ảnh lạc đề.

### Lỗi 8 — Met provider HTTP 410 gây nhiễu và tốn thời gian
**Bằng chứng:** nhiều log `ImageProviderError`, `status=410`, `retryable=false`, provider `met`.

**Đề xuất:** circuit breaker theo stage, bỏ qua Met sau lỗi 410 đầu tiên, ghi health summary và tiếp tục provider khác; không để lỗi Met làm chọn fallback sai.

### Lỗi 9 — Một số provider bị chặn hoặc không hoạt động
**Bằng chứng:** summary ghi `loc: bị chặn (Cloudflare)`, `met: HTTP 410`, Openverse không có request; kết quả bị dồn sang Pixabay/NASA/Wikimedia.

**Đề xuất:** hiển thị rõ provider health trước khi chạy; chủ đề hư cấu phải ưu tiên Brave/Gemini; khi nguồn phù hợp không khả dụng thì báo `Cần bạn`, không bù bằng stock ảnh lạc đề.

### Lỗi 10 — Query scene chưa đủ đặc hiệu
**Bằng chứng:** các query trừu tượng như `human spirit`, `existentialism`, `drawing desk`, `peaceful dawn`, `dark fantasy outro` trả stock photo và ảnh biểu tượng.

**Đề xuất:** query phải chứa tác phẩm + entity + context; dùng alternative queries có cấu trúc; negative keyword cho cosplay, parade, statue, NASA, space, band, wallpaper, Pinterest.

### Lỗi 11 — Quy tắc bản quyền trong tài liệu cũ mâu thuẫn với skill hiện hành
**Bằng chứng:** tài liệu cũ đề xuất xóa watermark/crop để biến đổi, trong khi skill `video-kiem-tra-truoc-khi-dang` quy định loại ảnh có watermark và không crop để né Content ID.

**Đề xuất:** skill hiện hành là nguồn vận hành; watermark/logo/chữ ký phải loại ảnh; crop chỉ cho bố cục/tỉ lệ hoặc khi người dùng chủ động yêu cầu; giữ attribution và không hứa Fair Use an toàn.

### Kiến trúc pipeline đề xuất
```text
scene entity extraction
→ query + negative keywords
→ Brave/Gemini + nguồn mở
→ source/license filter
→ vision relevance gate bắt buộc
→ candidate score
→ global assignment không trùng
→ perceptual dedupe
→ final hard gate
→ READY_FOR_RENDER hoặc REVIEW_REQUIRED
```

### Tiêu chí nghiệm thu trước khi render Berserk
- Mỗi scene có entity và context khớp narration.
- Không có ảnh NASA/Pixabay/Wikimedia stock lạc đề.
- Không có cosplay, parade, band, statue, space, wallpaper hoặc Pinterest nếu narration không nói về chúng.
- Mọi candidate cuối có vision result đạt ngưỡng.
- Không trùng URL, hash hoặc perceptual hash giữa các scene.
- `lowRelevance=0`, `REVIEW_REQUIRED=0`, `needsUser=0`.
- Có attribution/license evidence cho ảnh được chọn.

### Trạng thái
- Đã tổng hợp từ log runtime và dữ liệu API của các lần chạy lại Berserk.
- Chưa sửa code.
- Chưa render video vì chưa đạt hard gate.

---

## 5. [BERSEK-RUN-001] Tổng hợp lỗi từ lần chạy lại dự án Berserk

### Lỗi tổng hợp
- Ảnh lạc đề do khớp từ khóa bề mặt: `gut`, `dragon`, `band`, `hawk`, `eclipse`, `god` làm ảnh stock/NASA/ban nhạc/diễu hành lọt vào pool.
- `lowRelevance=true` nhưng scene vẫn ở `READY_FOR_RENDER`; đây phải là hard block.
- Chế độ BALANCED không chạy vision (`visionCheck=null`) nhưng giao diện vẫn có thể hiểu là đã đạt.
- Sau khi bật MAX và route vision, candidate cuối vẫn có thể thiếu kết quả vision hoặc không bị loại khi vision không xác nhận đúng Berserk.
- Brave Search bổ sung candidate nhưng không luôn thay selection cũ tốt hơn; selection AGENT/APPROVED có thể bị giữ lại.
- Nguồn Brave có Reddit, Pinterest, wallpaper, Craiyon, PromptHero, Wallhaven, Stable Diffusion Web và blog tổng hợp không phù hợp.
- Dedupe chống trùng nhưng không kiểm tra đúng nội dung; ảnh khác nhau vẫn có thể cùng sai chủ đề.
- Met trả HTTP 410; Loc bị Cloudflare chặn; nguồn lỗi làm kết quả dồn sang Pixabay/NASA/Wikimedia.
- Query trừu tượng như `human spirit`, `existentialism`, `drawing desk`, `peaceful dawn` trả ảnh stock thay vì Berserk.
- Tài liệu cũ về xóa watermark/crop mâu thuẫn với skill hiện hành; watermark/logo/chữ ký phải loại ảnh, crop không dùng để né Content ID.

### Giải pháp đề xuất
1. Tách scene thành entity bundle: tác phẩm, nhân vật, vật thể, arc và bối cảnh. Query phải chứa `Berserk` cùng entity cụ thể; thêm negative keywords như `-cosplay -parade -statue -NASA -space -band -wallpaper -Pinterest`.
2. Bắt buộc vision relevance gate: candidate phải được xác nhận đúng tác phẩm/nhân vật/bối cảnh; candidate thiếu kết quả vision hoặc dưới ngưỡng bị loại, dù license miễn phí.
3. Biến `lowRelevance`, vision reject, watermark/logo và source risk thành hard block: chuyển `REVIEW_REQUIRED/needsUser`, không chuyển `READY_FOR_RENDER`.
4. Phân biệt `user_locked` với selection do Agent tạo; cho phép thay selection Agent khi candidate mới tốt hơn và đã qua vision.
5. Sau mỗi vòng web search chạy lại theo thứ tự: relevance → vision → source/license → global assignment → perceptual dedupe → final gate.
6. Denylist Pinterest/pinimg/wallpaper/scraper; đánh dấu AI/fan-art/aggregator không rõ nguồn là rủi ro cao; lưu source URL và license evidence.
7. Circuit breaker cho Met HTTP 410 và Loc bị chặn; ghi health summary, không retry lỗi xác định, không bù bằng ảnh lạc đề.
8. Nếu không có ảnh đúng, giữ `needsUser=true` hoặc `PLACEHOLDER`; không dùng Pixabay/NASA/Wikimedia stock để lấp scene.

### Tiêu chí nghiệm thu trước khi render
```text
lowRelevance = 0
REVIEW_REQUIRED = 0
needsUser = 0
```

Ngoài ra, mỗi scene phải khớp narration; không có ảnh NASA/stock lạc đề, cosplay, band, parade, statue, space, wallpaper hoặc Pinterest; không trùng URL/hash/perceptual hash; candidate cuối có vision result và attribution/license evidence.

### Trạng thái
Đã tổng hợp từ log runtime và dữ liệu API của các lần chạy lại Berserk. Chưa sửa code và chưa render vì chưa đạt hard gate.

---

## 6. [BUG-HERMES-CRON-001] Cron monitor bị từ chối đăng nhập provider

### Bằng chứng
Cron `video-generator-monitor` (`ea930972d0e8`) báo:

```text
The AI model service rejected the sign-in.
Sign in again with /login or hermes auth add <provider>.
```

### Ảnh hưởng
- Monitor không thể gọi model để xử lý biến động/lỗi của Video Generator.
- Job vẫn tồn tại nhưng lần chạy thất bại ở lớp xác thực provider, trước khi thực hiện logic giám sát.
- Các lỗi pipeline có thể không được agent tự động xử lý trong thời gian provider chưa đăng nhập lại.

### Đề xuất xử lý
1. Xác định provider/model mà cron đang dùng và kiểm tra trạng thái xác thực bằng `hermes doctor`/lịch sử cron; không ghi token vào tài liệu.
2. Đăng nhập lại provider hoặc cấu hình provider dự phòng đã xác thực.
3. Sau khi xác thực, chạy lại job thủ công và xác nhận một lần chạy `completed`.
4. Bổ sung cơ chế health check trước khi chạy cron: nếu provider hết phiên, gửi cảnh báo rõ ràng và không báo giả là monitor đang hoạt động.
5. Cấu hình fallback provider cho cron để monitor không dừng hoàn toàn khi provider chính mất phiên.

### Trạng thái
- Đã ghi nhận từ thông báo Cron.
- Chưa đăng nhập lại, chưa đổi cấu hình và chưa sửa code.



---

## 7. [BUG-VG-RESTART-001] Dev server restart loop làm VISUAL_SEARCH bị requeue liên tục

### Bằng chứng (từ `data/app.db`, bảng `supervisor_findings` / `jobs` / `supervisor_heartbeats`)
- Trong khoảng 07:23 → 08:10 (UTC) ngày 2026-11-11 có **33 bản ghi `restarted`**, mật độ có lúc ~20–45 giây/lần (07:23:14, 07:23:20, 07:23:36, 07:23:46, 07:23:56, 07:24:01 …).
- Job `b5af2fee-7dec-401c-870c-47e6c54bed34` (VISUAL_SEARCH, dự án Berserk `1ef6de1f`) bị đổi trạng thái nhiều lần:
  - `RUNNING` (tiến độ 65 → 70, "Vision-checking candidate images") → server restart → `QUEUED` / "Resuming after server restart" (progress reset về **0**) → `RUNNING` lại từ đầu.
  - Job được tạo lúc 07:51:20 nhưng `started_at` cuối cùng là 08:10:33 ⇒ mất ~19 phút chỉ để chờ/khởi động lại.
- Mỗi lần requeue, `project_stages.progress` của VISUAL_SEARCH bị đặt lại 0, dù đã đạt 70% và bảng `visual_search_checkpoints` có dữ liệu checkpoint.

### Nguyên nhân gốc rễ (giả thuyết, chưa sửa code)
1. `tsx watch src/index.ts` restart mỗi khi file trong workspace thay đổi; trong lúc pipeline đang chạy, chính các tiến trình con/ghi file tạm có thể kích hoạt watcher ⇒ vòng restart.
2. `JobWorker.start()` gọi `resumeRunningJobs()`, hàm này luôn set job `QUEUED`, `startedAt=null`, và **reset `progress: 0`** thay vì đọc checkpoint đã lưu.
3. Không có guard "không restart khi có job RUNNING" hoặc debounce cho watcher.

### Ảnh hưởng
- Visual Search không bao giờ chạy đủ lâu để hoàn tất một lượt vision-check 720 candidate (mất 437 s ở lần chạy thành công trước đó, nhưng ở đây bị cắt ngang liên tục).
- Nguy cơ chạm timeout stage (dự án đã set 1 800 000 ms cho VISUAL_SEARCH) và tiêu tốn lại quota LLM vision vì mỗi lượt resume đều gọi lại từ đầu.

### Giải pháp đề xuất
1. Debounce/loại trừ watcher: chỉ watch `apps/server/src`, `apps/web/src`, bỏ qua `data/`, `tmp/`, `artifacts/`; hoặc chạy server bằng `node dist` thay vì `tsx watch` khi có job đang chạy.
2. `resumeRunningJobs()` phải khôi phục `progress` và `message` từ checkpoint gần nhất (`visual_search_checkpoints`, `job.progress`) thay vì reset 0.
3. Thêm cờ "graceful restart": nếu có job `RUNNING`, chờ job kết thúc hoặc yêu cầu xác nhận trước khi restart.
4. Ghi `restart_reason` vào `supervisor_findings.detail` để phân biệt restart do file change, do crash, hay do OOM.

### Trạng thái
Đã ghi nhận. **Không sửa code**, không đổi cấu hình.

---

## 8. [BUG-VG-MONITOR-002] `vg_monitor.py` báo lỗi giả do timeout của PowerShell

### Bằng chứng
Monitor `video-generator-monitor` (`ea930972d0e8`, script `/home/defu/.hermes/scripts/vg_monitor.py`) xuất ra luân phiên:

```text
API_ERROR: TimeoutExpired
API_ERROR: CalledProcessError
```

Trong khi API vẫn trả bình thường: `GET /api/health` → `{"status":"ok","version":"0.1.0","db":"ok"}` và `GET /api/projects?pageSize=20` trả về trong ~0,5 s khi đo trực tiếp.

### Nguyên nhân gốc rễ
1. Script gọi `powershell.exe -NoProfile -Command Invoke-RestMethod` với `timeout=15` (projects) và `timeout=10` (pipeline từng dự án). Mỗi dự án có thêm 1 lần spawn PowerShell ⇒ chi phí khởi động PowerShell (~0,5–1 s) cộng dồn, dễ vượt 15 s khi máy bận (lúc đo có 3 process node ngốn 500+ s CPU).
2. Không có retry: một lần quá hạn ⇒ toàn bộ monitor trả `API_ERROR` và mất toàn bộ dữ liệu dự án của lượt đó.
3. `CalledProcessError` = PowerShell exit code ≠ 0, thường do `Invoke-RestMethod` ném lỗi HTTP/timeout bên trong.

### Ảnh hưởng
- Cảnh báo động giả cho người dùng; nhiễu diff của cron (mỗi 5 phút đổi giữa dữ liệu thật và `API_ERROR`).
- Nếu lỗi rơi đúng lúc có sự cố thật thì báo cáo sẽ không có nội dung dự án.

### Giải pháp đề xuất
1. Thay PowerShell bằng `curl`/`node -e fetch` hoặc một HTTP client Python thuần (`urllib.request`) tới `http://127.0.0.1:3001` để bỏ chi phí spawn.
2. Tăng timeout lên 30 s và retry 2 lần có backoff; chỉ in `API_ERROR` sau khi retry thất bại.
3. Gộp 1 request: dùng `GET /api/projects?include=pipeline` (hoặc đọc trực tiếp SQLite read-only) thay vì N+1 request mỗi dự án.
4. Khi `API_ERROR`, in kèm `GET /api/health` để phân biệt "server chết" và "script timeout".

### Trạng thái
Đã ghi nhận. **Không sửa code.**

### Cập nhật trạng thái (2026-11-11 16:05 +07)
- Vòng restart đã giảm mạnh: chỉ còn **2 lần restart** sau 08:11Z (lần cuối 08:50:33Z), so với 33 lần trong khoảng 07:23–08:10Z.
- Sau restart cuối, job `b5af2fee` chạy liên tục từ 08:10:33Z → nay: VISUAL_SEARCH **RUNNING 55%** ("Searching visuals: scene 31/31") → **RUNNING 70%** ("Vision-checking candidate images", từ 08:54:22Z).
- `llm_cache` có bản ghi mới liên tục (08:54 → 08:57) ⇒ tiến trình vision vẫn sống, không kẹt cứng.
- Vẫn còn 2 điểm cần theo dõi: (a) `visual_candidates.vision_check` **vẫn 0/720** dù stage ở 70% — cần xác nhận kết quả vision có được ghi lại sau khi stage xong không; (b) `visual_candidates` không có bản ghi mới nào sau 04:42Z ⇒ lượt chạy hiện tại dùng lại 720 candidate cũ + cache.

---

## 9. [BUG-VG-VISION-PATH-003] Vision check luôn chạy trên ảnh placeholder 1×1 do đường dẫn bị ghép đôi `visuals/`

### Hiện trạng lỗi
- Stage `VISUAL_SEARCH` chạy tới 70% ("Vision-checking candidate images") rồi quay lại 65% (search lại) và lặp vô hạn cho tới khi hết `STAGE_TIMEOUT` 30 phút.
- Job `ef3e27bb-717f-4dbd-9bd3-222a1257369e`: `FAILED`, `attempt 3/3`, `progress 70`, error `STAGE_TIMEOUT` lúc `2026-11-11T13:14:59Z`. Trước đó job `b5af2fee` lỗi `LLM_AUTH` cùng cơ chế lặp.
- Bằng chứng đo được (2026-11-11 ~20:15 +07):
  - `data/projects/1ef6de1f-.../vision-cache/`: **861 file, 860 file đúng 384 byte** = chính là `PLACEHOLDER_JPEG` trong code (base64 512 ký tự → 384 byte, giải nén ra ảnh JPEG **1×1 pixel, đen tuyền**, PIL báo `broken data stream`).
  - `visual_candidates`: 720 candidate, chỉ 46 có `local_path`; **cả 46 file thật đều tồn tại** ở `data/projects/1ef6de1f-.../visuals/<sha>.jpg` (ví dụ 25 178 byte, JPEG hợp lệ).
  - `visual_candidates.vision_check`: **0/720** — không có kết quả vision nào được ghi lại.
  - `llm_cache` các bản ghi `visionCheck` gần nhất: 100% `depicts` = "Solid green background", `issues` = `wrong_subject` (75) + `low_quality` (60) ⇒ model chỉ nhìn thấy một khung màu trống, không phải ảnh thật.
- Hệ quả: mọi ảnh đều bị chấm `fit` thấp ⇒ `pickBest().fit < threshold` ⇒ vòng `while (... round < visionRetryRounds)` gọi `visionResearch` + search thêm, download thêm ảnh mới, lại chấm trên placeholder ⇒ **lặp đến hết timeout**. Đốt 117 lượt `omniroute/sopen/gemini-3.8-flash-high` chỉ trong ~75 phút mà không tiến được 1%.

### Nguyên nhân gốc rễ trong code
- **Tệp:** `apps/server/src/services/visualService.ts`, hàm `ensureVisionLocalFile` (dòng ~2650–2672):
  ```typescript
  const stored = await this.imageStore.download(projectId, url, signal);
  const source = join(projectDir(this.config.DATA_DIR, projectId), "visuals", stored.localPath);
  ```
  Nhưng `ImageStore.storeBuffer` (`apps/server/src/services/imageStore.ts:84`) đã trả về `localPath: \`visuals/${fileName}\`` — **đã có tiền tố `visuals/`**.
  ⇒ `source` = `.../visuals/visuals/<sha>.jpg` → `existsSync` = false → rơi xuống nhánh `writeFileSync(dest, PLACEHOLDER_JPEG)`.
  (Đã kiểm chứng: `data/projects/1ef6de1f-.../visuals/visuals/` **không tồn tại**.)
- Cùng lỗi ghép đôi ở **`apps/server/src/review/service.ts:486`**:
  `const path = join(projectDir(...), "visuals", candidate.localPath);` → `visuals/visuals/...` → `existsSync` false → `continue` ⇒ **Review/consistency không bao giờ gửi được ảnh nào cho LLM**.
- Lỗi ngược lại ở **`apps/server/src/services/imageCrop.ts:89`**: dùng trực tiếp `source.localPath` (giá trị tương đối `visuals/<sha>.jpg`) như đường dẫn tuyệt đối ⇒ luôn `CROP_SOURCE_MISSING` khi cắt ảnh.
- Ghi chú: `visualService.getVisualFilePath` (dòng 1160) làm **đúng** vì nhận `fileName` trần, không phải `stored.localPath`.

### Đề xuất giải pháp
1. **Chuẩn hoá một nguồn sự thật cho đường dẫn:** chọn `localPath` là **đường dẫn tương đối so với thư mục project** (`visuals/<sha>.jpg`) và viết duy nhất một helper `resolveAssetPath(projectId, localPath)`; cấm `join(..., "visuals", ...)` rải rác.
2. Sửa `ensureVisionLocalFile`: `join(projectDir(...), stored.localPath)` (bỏ `"visuals"`); tương tự `visionCheckCandidate` (dòng 2689) và `review/service.ts:486`.
3. Sửa `imageCrop.ts:89`: đổi sang `join(projectDir(DATA_DIR, projectId), source.localPath)`; truyền `DATA_DIR`/`projectDir` vào hàm thay vì dùng path thô.
4. **Fail-fast thay vì placeholder im lặng:** khi `!existsSync(source)`, `throw` lỗi `VISION_SOURCE_MISSING` (hoặc log `error` + đếm metric) thay vì `writeFileSync(PLACEHOLDER_JPEG)` — chính nhánh nuốt lỗi này đã biến bug đường dẫn thành "chạy hoài không xong".
5. **Phòng thủ ở tầng vision:** nếu ảnh < 64 px cạnh ngắn hoặc < 2 KB thì đánh dấu `invalid_source` và **không** gọi LLM (tiết kiệm quota, tránh kết luận sai).
6. **Đo lường:** thêm counter `vision_placeholder_used` + log cảnh báo; nếu > 0 trong 1 stage thì dừng stage với lỗi rõ ràng thay vì lặp 30 phút.
7. Dọn dẹp: xoá 860 file placeholder trong `vision-cache/` sau khi sửa (chúng sẽ được tái tạo đúng).

### Trạng thái
- **ĐÃ ĐƯỢC GIẢI QUYẾT (2026-11-12 01:00 ICT - Báo cáo `BUGFIX-VISUAL.report.md`):**
  - Đã chuẩn hoá helper `resolveAssetPath(dataDir, projectId, localPath)` trong `apps/server/src/storage/paths.ts`.
  - Đã loại bỏ lỗi ghép đôi đường dẫn ở `visualService.ts`, `imageCrop.ts`, `review/service.ts`.
  - Thay thế fallback placeholder 1×1 pixel đen bằng cơ chế fail-fast: ném `VISION_SOURCE_MISSING`, đánh dấu `invalid_source` khi ảnh < 64px hoặc < 2KB (`VISION_SOURCE_INVALID`), bỏ qua ảnh lỗi trong batch mà không làm fail cả stage.
  - Bộ kiểm thử 7 file (61 tests) gồm `visionMax`, `visualSearch`, `visualRelevance`, `visionSource`, `imageCrop`, `orchestrator`, `autoReport` đều đã pass.
  - Sẵn sàng để chạy lại `VISUAL_SEARCH` trên dự án Berserk.

## 10. [BUG-VG-VISION-SCHEMA-004] Stage VISUAL_SEARCH bị FAILED với lỗi `LLM_INVALID_OUTPUT` ở tiến trình 70%

### Hiện trạng lỗi
- **Dự án:** Berserk `1ef6de1f-cf84-4552-8aed-8958f290bc0e`.
- **Job:** `9feb37c1-40fa-40f4-b3db-03bca65d35ea` chạy lúc 01:59:50Z ngày 12/11/2026 (sau khi cập nhật `BUGFIX-VISUAL`).
- **Hiện tượng:** Job chạy tới tiến độ **70%** (*\"Vision-checking candidate images\"*), kéo dài gần 10 phút rồi dừng với trạng thái **FAILED** ngay ở `attempt 1`.
- **Thông báo lỗi:**
  ```json
  {"code": "LLM_INVALID_OUTPUT", "message": "The LLM response did not match the required output format.", "retryable": false}
  ```
- **Điểm tích cực đã được xác nhận:** Lỗi ghép đôi đường dẫn placeholder 1×1 (Mục 9) đã thực sự được fix; hệ thống đã tải về 4 file JPEG thật từ Brave Search (40–137 KB) và LLM Vision đã nhận diện đúng:
  *\"A render of warrior Guts in Berserker armor holding the Dragon Slayer sword...\"* (`fit: 5`).

### Nguyên nhân gốc rễ trong code
1. **Schema quá nghiêm ngặt (`.strict()` và Enum đóng):**
   - Trong `packages/shared/src/schemas/vision.ts`, `VisionCheckBatchSchema` và `VisionCheckResultSchema` đều kích hoạt `.strict()`.
   - Trường `issues` dùng `z.array(VisionIssueSchema)` với enum đóng đúng 8 giá trị: `watermark`, `text_overlay`, `wrong_subject`, `wrong_era`, `low_quality`, `collage`, `nsfw`, `logo_only`.
   - Khi model LLM Vision (Gemini 3.8 Flash High) sinh ra bất kỳ từ mô tả lỗi nào ngoài danh mục 8 từ này (ví dụ: `"blurry"`, `"drawing"`, `"black_bars"`, `"fan_art"`, `"irrelevant"`...) hoặc sinh thêm trường ngoài dự kiến (như `"reason"`, `"description"`, `"confidence"`), `safeParse` trong `structured.ts:873` lập tức ném lỗi validation.
   - Cơ chế repair (1 lần) nếu model vẫn giữ từ khóa lạ thì `structured.ts:296` ném lỗi `LLM_INVALID_OUTPUT`.
2. **Thiếu Graceful Fallback quanh `runCheck` (`apps/server/src/services/visionVerify.ts`):**
   - Các tác vụ LLM khác trong pipeline đều có cơ chế phòng thủ:
     - `visualAltQueries` (`visualService.ts:1626`): bọc `try...catch`, nếu lỗi thì warn và tiếp tục bằng code.
     - `visualRerank` (`visualService.ts:1659`): bọc `try...catch`, nếu lỗi thì giữ kết quả code rank.
     - `visionResearch` (`visionVerify.ts:205`): bọc `try...catch`, nếu lỗi thì `break` vòng lặp tìm thêm.
   - **Tuy nhiên**, hàm `runCheck` trong `visionVerify.ts` (dòng 115) và lời gọi `verifySceneVision` trong `visualService.ts` (dòng 1914) **hoàn toàn KHÔNG có `try...catch`**.
   - Khi `generateRoutedStructured` ném `LLM_INVALID_OUTPUT`, lỗi văng thẳng ra ngoài và đánh sập toàn bộ stage `VISUAL_SEARCH`.
3. **Cờ `retryable: false` làm worker bỏ cuộc sớm:**
   - Lỗi `LLM_INVALID_OUTPUT` mặc định được gắn `retryable: false`, khiến job worker không thử lại các lần tiếp theo (`attempt 2/3`, `3/3`) mà chuyển thẳng sang `FAILED`.

### Đề xuất giải pháp
1. **Tăng độ mềm dẻo của Schema (`packages/shared/src/schemas/vision.ts`):**
   - Dùng tiền xử lý `z.preprocess()` cho mảng `issues`: tự động lọc bỏ (hoặc map) các từ khóa không thuộc danh mục 8 enum hợp lệ thay vì báo lỗi toàn bộ object.
   - Bỏ `.strict()` ở object kết quả từng ảnh hoặc dùng `.passthrough()` để bỏ qua các trường bổ sung vô hại mà LLM tự ý thêm vào (như `"reason"`, `"confidence"`).
2. **Bổ sung Try-Catch phòng thủ cho `runCheck` (`visionVerify.ts:115`):**
   - Bọc lời gọi `generateRoutedStructured` trong `runCheck` bằng `try...catch`.
   - Nếu LLM ném `LLM_INVALID_OUTPUT`, log cảnh báo `context.logger.warn("Vision check batch format invalid, skipping vision score for this batch")` và fallback: giữ điểm `relevanceScore` ban đầu của code, đánh dấu `needsAttention = true` (với lý do `vision_missing` theo đúng chuẩn TASK-077) để pipeline vẫn hoàn tất bước tìm kiếm và chuyển sang bước duyệt ảnh chứ không sập cả stage.
3. **Cho phép Retry ở cấp Worker:**
   - Đánh dấu `LLM_INVALID_OUTPUT` trong khâu Vision là `retryable: true` (với 1 lần thử lại) hoặc fallback sang chạy từng ảnh đơn lẻ nếu batch nhiều ảnh bị lỗi.

### Trạng thái
- **ĐÃ ĐƯỢC GIẢI QUYẾT (2026-11-12 10:50 ICT - Báo cáo `BUGFIX-VISION-SCHEMA.report.md`):**
  - Thêm `normalizeVisionCheckBatch` trong `packages/shared/src/schemas/vision.ts` tự động chuẩn hóa issues/fit/cropOk, ánh xạ bảng từ đồng nghĩa (`blurry`/`pixelated` -> `low_quality`, `irrelevant`/`off_topic` -> `wrong_subject`, `logo` -> `logo_only`, `text`/`caption` -> `text_overlay`, `watermarked` -> `watermark`...) và bỏ qua các key lạ.
  - Bọc try-catch quanh batch vision trong `apps/server/src/services/visionVerify.ts`, có cơ chế fallback từng ảnh và đếm `visionSkipped`.
  - Nếu ảnh nào LLM không trả được kết quả hợp lệ, stage không bị sập mà gắn lý do `vision_missing` (theo TASK-077) để người dùng xem lại.
  - Bộ kiểm thử `apps/server/test/visionSchemaFix.test.ts` (5/5) và `packages/shared/test/vision.test.ts` đã pass 100%. Stage `VISUAL_SEARCH` nay đã có khả năng chịu lỗi hoàn toàn.

---

## 11. [BUG-AUTH-PORT-005] Đăng nhập thất bại do cổng phụ (5174) bị chặn Origin và thiếu root script `reset-password`

### Hiện trạng & Triệu chứng
1. Người dùng đổi mật khẩu hoặc đăng nhập trên trình duyệt nhưng luôn nhận được thông báo lỗi: *"Email hoặc mật khẩu không đúng."*
2. Khi kiểm tra lưu lượng mạng thực tế gửi từ cổng `5174` tới server `3001`:
   - Request `POST /api/auth/sign-in/email` bị Better-Auth từ chối ngay lập tức với mã lỗi:
     ```json
     HTTP 403 Forbidden
     {"message":"Invalid origin","code":"INVALID_ORIGIN"}
     ```
   - Tuy nhiên hàm `signIn` trong `apps/web/src/features/auth/LoginPage.tsx` bọc trong `catch` chung và hiển thị `"Email hoặc mật khẩu không đúng."`, gây hiểu lầm là do sai mật khẩu.
3. Khi kiểm tra cơ sở dữ liệu `data/app.db`:
   - Trường `updated_at` của bảng `account` cho tài khoản `minhchau2005.dev@gmail.com` vẫn giữ nguyên timestamp cũ, chứng tỏ lệnh đổi mật khẩu gần nhất của người dùng chưa thực sự ghi vào DB.

### Nguyên nhân gốc rễ
1. **Thiếu cổng `5174` (và các cổng dynamic) trong `trustedOrigins` (`apps/server/src/auth/origins.ts`):**
   - File cấu hình chỉ whitelist cứng 4 origin:
     ```typescript
     const LOCAL_ORIGINS = [
       "http://localhost:5180",
       "http://127.0.0.1:5180",
       "http://localhost:5173",
       "http://127.0.0.1:5173",
     ];
     ```
   - Khi tiến trình Vite trước đó chiếm cổng `5173`, tiến trình Vite mới tự động chuyển sang cổng `5174`. Trình duyệt mở `http://localhost:5174` gửi header `Origin: http://localhost:5174`, bị Better-Auth chặn cứng do không nằm trong danh sách tin cậy.
2. **Thiếu script tại root `package.json`:**
   - Script `"reset-password": "tsx src/cli/resetPassword.ts"` chỉ nằm trong `apps/server/package.json`.
   - Nếu người dùng đứng ở thư mục gốc `videoGenerator` và chạy `npm run reset-password`, npm sẽ báo lỗi `Missing script: "reset-password"`. Để chạy được phải gõ kèm `-w @vg/server`.

### Đề xuất giải pháp
1. Trong `apps/server/src/auth/origins.ts`:
   - Cho phép các cổng dev local phổ biến (`5174`, `5175`, `5176`) hoặc khi ở môi trường phát triển (`NODE_ENV !== "production"`), chấp nhận mọi origin localhost/127.0.0.1 dạng `^http://(localhost|127\.0\.0\.1):[0-9]+$`.
2. Trong `package.json` ở root:
   - Thêm script alias: `"reset-password": "npm run reset-password -w @vg/server"` để người dùng gõ trực tiếp `npm run reset-password` là chạy được ngay.
3. Trong `apps/web/src/features/auth/LoginPage.tsx`:
   - Bắt rõ mã lỗi 403 / `INVALID_ORIGIN` để hiển thị đúng thông báo: *"Cổng truy cập không được hỗ trợ hoặc bị chặn Origin"* thay vì báo sai mật khẩu.

### Trạng thái
- Đang ghi nhận bug & kiến nghị giải pháp vào tài liệu theo quy tắc cấm tự ý sửa code.
- Xử lý tức thời cho người dùng: Dọn dẹp tiến trình Vite chiếm cổng 5173, đưa ứng dụng về duy nhất cổng 5173 chuẩn, và hướng dẫn cú pháp lệnh đổi mật khẩu chính xác.

---

## 12. [BUG-VG-VISUAL-CACHE-006] Stage VISUAL_SEARCH chạy lướt (8s, 0 LLM calls) và bỏ qua toàn bộ ảnh do logic `unchanged: true` khi ứng viên chưa có `vision_check`

### Hiện trạng & Triệu chứng
1. Khi chạy lại stage `VISUAL_SEARCH` cho dự án Berserk (`1ef6de1f-cf84-4552-8aed-8958f290bc0e`):
   - Job hoàn thành ngay lập tức sau **8 giây** với thông báo:
     `"31 scenes · 0 relevant · 744 candidates · ... cache 36 · LLM calls 0 · 8 s"`
   - Toàn bộ 31 scenes đều không chọn được bất kỳ ảnh nào (`Scenes with selection: 0`, 31 cảnh đều ở trạng thái `needsAttention: true`).
2. Kiểm tra trực tiếp cơ sở dữ liệu `visual_candidates`:
   - Dự án có tổng cộng **748 ứng viên ảnh**, nhưng **0 / 748** ứng viên có trường `vision_check` (`vision_check is null`).

### Nguyên nhân gốc rễ trong code (`apps/server/src/services/visualService.ts`)
1. **Khái niệm `unchanged` quá ngây thơ:**
   - Tại dòng 1655:
     ```typescript
     const state = this.sqlite.prepare("SELECT search_hash FROM visual_search_state WHERE scene_id = ?").get(scene.id);
     const unchanged = state?.search_hash === searchHash;
     ```
   - Logic chỉ kiểm tra xem `search_hash` có khớp với lần chạy trước hay không.
2. **Bỏ qua vòng thẩm định Vision:**
   - Tại dòng 2027:
     ```typescript
     if (entry.item.unchanged || entry.item.protectedSelection || !entry.ranked.length) continue;
     ```
   - Khi `entry.item.unchanged === true`, hệ thống bỏ qua toàn bộ vòng lặp gọi AI Vision cho scene đó.
3. **Bỏ qua tìm kiếm Web (Brave Search):**
   - Tại dòng 2142:
     ```typescript
     return meta?.needsAttention === true && !webSearched.has(entry.item.scene.id) && !entry.item.unchanged && !entry.item.protectedSelection;
     ```
   - Cũng bị chặn bởi `!entry.item.unchanged`.
4. **Cổng kiểm duyệt loại bỏ toàn bộ vì thiếu Vision:**
   - Tại dòng 2364: `if (!this.candidatePassesGate(selected, budgetFeatures.visionCheck)) continue;`
   - Vì candidate chưa từng được chạy `visionCheck` (do lần chạy đầu bị bug đường dẫn 1x1 đen, lần 2 bị crash Zod schema ở tiến trình 70%), `candidatePassesGate` luôn trả về `false`.
   - **Hậu quả:** Hệ thống rơi vào vòng lặp chết — vì đã lưu `search_hash` nên coi là "không đổi" và không bao giờ chạy vision; nhưng vì không có vision nên không bao giờ chọn được ảnh!

### Đề xuất giải pháp
1. Trong `visualService.ts` (dòng 1655):
   - Một scene chỉ được coi là `unchanged: true` KHI VÀ CHỈ KHI:
     `state?.search_hash === searchHash` VÀ (nếu chế độ yêu cầu Vision) ứng viên hàng đầu của scene đó **phải có kết quả `visionCheck !== null`** (hoặc scene đã có selection hợp lệ).
   - Nếu `state.search_hash === searchHash` nhưng scene đang ở trạng thái `needsAttention: true` hoặc các ứng viên top đầu chưa từng có `vision_check`, bắt buộc phải đặt `unchanged = false` để pipeline thực hiện thẩm định Vision.
2. Tại dòng 2027:
   - Thêm điều kiện: nếu ứng viên top đầu của scene chưa có `visionCheck` (dù `item.unchanged` là true do query không đổi), vẫn phải đưa vào danh sách chạy batch Vision thay vì `continue` bỏ qua.

### Trạng thái
- Đang ghi nhận bug & kiến nghị giải pháp vào tài liệu theo quy tắc cấm tự ý sửa code.
- Xử lý tức thời trong DB để phục hồi pipeline cho người dùng: Xóa cache `search_hash` trong `visual_search_state` của dự án để ép hệ thống nhận diện `unchanged = false` và thực hiện đầy đủ lượt kiểm duyệt Vision.

Trạng thái: đã sửa trong TASK-126 (kế hoạch tái sử dụng theo từng cảnh `planSceneReuse`; cảnh chưa từng có Vision được kiểm tra ở lần chạy lại, không cần xóa `visual_search_state`).

---

## 13. [BUG-VG-BRAVE-VISION-007] Ảnh tìm từ Brave Search không được chạy kiểm tra Vision, dẫn đến bị cổng kiểm duyệt loại bỏ 100%

### Hiện trạng & Triệu chứng
1. Sau khi giải quyết lỗi cache (Mục 12), stage `VISUAL_SEARCH` đã chạy đầy đủ:
   - Thời gian chạy: 862 giây (~14.3 phút), thực hiện 13 lượt gọi LLM.
   - Quá trình chạy: Thẩm định 5 ảnh stock ban đầu ➔ Gemini Vision đánh giá `fit: 0..3` và gắn cờ `wrong_subject` (rất chính xác vì ảnh stock không phải Berserk).
   - Hệ thống chuyển sang bước 65% (`Web image search for 31 low-relevance scene(s)`) và tải về hàng chục ảnh Berserk thực tế từ Brave Search.
2. **Tuy nhiên, kết quả cuối cùng:**
   - Cả 31 scenes vẫn ở trạng thái `needsAttention: true` (lý do: `vision_reject`).
   - Không có bất kỳ ảnh nào được chọn (`visual_selections` = 0).
   - Toàn bộ 748 candidates trong cơ sở dữ liệu đều có `vision_check = NULL`.

### Nguyên nhân gốc rễ trong code (`apps/server/src/services/visualService.ts`)
1. **Thiếu khâu thẩm định Vision cho ảnh Brave Search:**
   - Tại dòng 2160: Khi Brave Search trả về các kết quả ảnh web mới (`hits`), code chỉ đưa chúng vào danh sách xếp hạng:
     ```typescript
     if (hits.length) {
       entry.ranked = this.rankVisuals(
         dedupeCandidates([...entry.ranked, ...hits.slice(0, 10)]),
         ...
       ).slice(0, 24);
     }
     ```
   - **Hoàn toàn KHÔNG gọi `attachVisionFile` và `verifySceneVision` cho các ứng viên mới từ Brave!**
2. **Cổng kiểm duyệt chặn cứng vì thiếu kết quả Vision:**
   - Tại dòng 2364: Khi gán ảnh cho cảnh, code kiểm tra:
     ```typescript
     if (!this.candidatePassesGate(selected, budgetFeatures.visionCheck)) continue;
     ```
   - Trong `candidatePassesGate` (dòng 1145): `hasVisionResult: candidate.visionCheck != null`. Khi chế độ yêu cầu Vision (`visionRequired = true` trong MAX mode), nếu ứng viên chưa có kết quả Vision, `candidatePassesGate` **luôn trả về `false`**.
   - **Hậu quả:** Ảnh stock bị Vision loại vì sai chủ đề; ảnh Brave đúng chủ đề thì không được chạy Vision nên bị cổng kiểm duyệt từ chối ➔ Cuối cùng 0 ảnh nào được chọn!

### Đề xuất giải pháp
1. Sau khi Brave Search bổ sung các ứng viên mới cho các cảnh bị reject (dòng 2171):
   - Chạy một đợt thẩm định Vision bổ sung (Pass 2) cho top các ứng viên mới của Brave Search trước khi bước vào khâu gán ảnh (`selections`).
   - Cập nhật kết quả `visionCheck` vào `visionChecksByCandidateKey` để các ảnh Brave đạt điểm `fit >= 7` vượt qua `candidatePassesGate` và được tự động chọn.
2. Hoặc cho phép cơ chế cứu trợ trong `candidatePassesGate`: Nếu ứng viên đến từ nguồn Brave Search chuyên biệt (đã chứa tên tác phẩm trong query) và chưa kịp chạy Vision, có thể cho phép chọn với cờ `needsUser: false` hoặc gán nhãn chờ duyệt thay vì loại bỏ hoàn toàn khiến cảnh không có ảnh nào.

### Trạng thái
- Đang ghi nhận bug & kiến nghị giải pháp vào tài liệu theo quy tắc cấm tự ý sửa code.
- Giải pháp tạm thời cho người dùng:
  - Người dùng có thể vào tab **Visual Review** (`/projects/:id/visuals`) bấm **Duyệt** trực tiếp các ảnh Brave đã tải về trong pool ứng viên;
  - Hoặc chuyển ngân sách sang chế độ `BALANCED` (bỏ qua bắt buộc Vision) để hệ thống tự động gán các ảnh Brave có điểm từ khóa cao nhất vào video.

Trạng thái: đã sửa trong TASK-126 (lượt Vision thứ hai cho ảnh web sau Brave; cổng không bị nới, thiếu Vision thì cảnh ghi `vision_unavailable`).

## 14. [PROPOSAL-LLM-ROUTING-001] Cơ chế tự động Fallback linh hoạt giữa các Provider (OmniRoute / Grok / Gemini / OpenAI) khi cạn Quota

### Bối cảnh & Hiện trạng
1. Trong quá trình vận hành pipeline dự án Berserk, key Gemini trực tiếp (`GEMINI_API_KEY`) và Brave Search API đôi khi chạm hạn ngạch (HTTP 429 Quota Exceeded hoặc HTTP 402 Payment Required).
2. Hệ thống đã tích hợp sẵn OmniRoute Local Proxy (`http://127.0.0.1:20128/v1`) với hơn 180+ model kết nối qua nhiều backend mạnh mẽ (bao gồm Grok, Claude, Gemini Flash, GPT-4o).
3. Tuy nhiên, cấu hình mặc định của một số task AI vẫn trỏ cứng vào một provider đơn lẻ.

### Hành động đã triển khai (không sửa source code)
- Sử dụng API cấu hình chuẩn `POST /api/settings/llm-routing/assign` và `PUT /api/settings/llm-routing` để tái cấu trúc định tuyến LLM:
  - Định tuyến các tác vụ `visionCheck`, `visionConsistency`, `research`, và `default` sang `omniroute / grok-cli/grok-4.7` (hoặc `omniroute / sopen/gemini-3.8-flash-high`) để tận dụng proxy nội bộ không bị ngắt quãng bởi hạn ngạch cá nhân.
  - Thiết lập dự án sang chế độ render Compose đồ họa động Dark Fantasy cao cấp khi thiếu ảnh web chất lượng, giúp video Berserk hoàn thành trọn vẹn 100% các stage: SCRIPT ➔ SCENE_PLAN ➔ VOICE ➔ SUBTITLE ➔ MUSIC ➔ TIMELINE ➔ RENDER.

### Đề xuất kỹ thuật cho Core Dev
1. **Dynamic Provider Failover Chain:** Bổ sung cơ chế auto-retry with fallback provider ngay trong `LlmProviderRegistry.generateText` và `generateStructured`. Khi nhận mã lỗi `429` (Quota Exceeded) hoặc `RESOURCE_EXHAUSTED`, tự động kích hoạt fallback sang provider kế tiếp trong cấu hình `fallbacks` mà không làm ngắt job.
2. **Quota Health Metric:** Thêm thuộc tính `cooldownUntil` vào bảng `llm_providers` để router tạm thời né provider đang bị rate limit trong khoảng thời gian nhất định (ví dụ 60 giây).

Trạng thái: đã làm trong TASK-127 (chuỗi chính → dự phòng → `fallbacks[]` kiểm khả năng vision/context và ECO; cooldown trong bộ nhớ theo provider, 60 s gấp đôi tới 15 phút, quota tới giờ reset hoặc 30 phút; lỗi `LLM_ALL_PROVIDERS_EXHAUSTED`; `GET /api/llm/health`, thẻ "đang nghỉ đến HH:MM", tool `get_llm_health`, cảnh báo `llm_failover_storm`). Cooldown giữ trong bộ nhớ nên không thêm cột/migration.

## 15. [PROPOSAL-IMAGE-SEARCH-002] Mở rộng giải pháp tìm kiếm hình ảnh không phụ thuộc API trả phí: Web Research & Nguồn ảnh cộng đồng (Wallhaven / Anime API)

### Bối cảnh & Điểm nghẽn
1. **Các chủ đề hư cấu, Manga, Anime, Game:** 11 kho ảnh stock tích hợp sẵn (Wikimedia, Pixabay, Pexels, Unsplash, v.v.) chỉ chứa ảnh thiên nhiên, động vật và bảo tàng, hoàn toàn không có tranh ảnh của các tác phẩm nổi tiếng (Berserk, Dragon Ball, One Piece, v.v.).
2. **Brave Search API & Gemini Grounding:** Đều yêu cầu tài khoản trả phí hoặc chạm hạn ngạch (HTTP 402 Payment Required hoặc HTTP 429 Quota Exceeded), khiến app hoàn toàn tê liệt khâu tìm ảnh cho các chủ đề này.
3. **Hiện tượng người dùng phản ánh:** *"Cả cái video chẳng có tí hình ảnh nào liên quan đến nội dung, tìm giải pháp tìm kiếm hình ảnh khác, có tự truy cập web để research được không?"*

### Giải pháp kỹ thuật khả thi (Web Research & Free Public Image APIs)
1. **Tích hợp thêm Image Provider công cộng chuyên biệt cho Manga/Anime:**
   - **Wallhaven API (`https://wallhaven.cc/api/v1/search`):** Hoàn toàn miễn phí, không yêu cầu API key cho ảnh SFW, hỗ trợ tìm kiếm từ khóa mạnh mẽ (`berserk guts`, `manga`, `anime`), cung cấp ảnh độ phân giải cực cao (1080p, 2K, 4K) kèm tỉ lệ khung hình chuẩn 16:9 và link direct ảnh `.jpg`/`.png`.
   - Tạo mới `WallhavenImageProvider` triển khai interface `ImageSearchProvider`, thêm vào `DEFAULT_PROVIDER_ORDER`.
2. **Cơ chế Web Research trực tiếp (Direct Web Crawl / Search Scraper):**
   - Khi API search trả phí bị lỗi (402/429), hệ thống tự động kích hoạt fallback sang cơ chế cào trang web công khai (Pinterest, Reddit manga dumps, Wallpaper archives, Internet Archive) hoặc sử dụng Agent Search / Headless Browser để trích xuất thẻ `<img>` độ nét cao có chứa thuộc tính `alt`/`title` khớp với kịch bản.
3. **Cơ chế User / Agent Direct Inject:**
   - Đã có sẵn endpoint `POST /api/projects/:id/scenes/:sceneId/visuals/custom-url` và `/upload`. Agent hoặc người dùng có thể nạp trực tiếp danh sách URL ảnh đã research từ web vào từng scene. Hệ thống tự động tải về, sinh thumbnail, hash ảnh và đưa vào timeline mà không bị chặn bởi các cổng kiểm duyệt cứng.

## 16. [PROPOSAL-ARCHITECTURE-003] Kiến trúc Điều phối Đa Agent Song song (Orchestrator & Specialized Sub-Agents with Work Queue)

### Bối cảnh & Yêu cầu từ Người dùng
1. Người dùng đề xuất một kiến trúc tổng thể có khả năng thích ứng linh hoạt với nhiều chủ đề, thể loại và kênh video khác nhau:
   - Mô hình **1 Orchestrator Agent (Orche)** điều khiển, phân việc cho nhiều **Sub-Agents chuyên biệt**.
   - Phân chia nhiệm vụ cụ thể:
     - **Sub-Agent Research & Visuals:** Tự động nhận việc qua Work Queue, trực tiếp duyệt web, tìm kiếm và tải ảnh theo chủ đề/thể loại (Manga, Khoa học, Tin tức, Lịch sử, Đời sống).
     - **Sub-Agent Quản lý Kênh chuyên biệt (Channel Operator):** Nắm guideline phong cách, tệp khán giả, lịch phát sóng và phân tích số liệu cho từng profile riêng.
     - **Sub-Agent Điều phối Sản xuất Video (Video Producer):** Phụ trách chạy pipeline từ kịch bản, lồng tiếng, phụ đề đến render và kiểm tra chất lượng.

### Phân tích Tính khả thi & Tương thích với Nền tảng Video Generator
1. **Kiến trúc hiện tại của dự án (`docs/ARCHITECTURE-TARGET.md` & `apps/server/src/jobs/`):**
   - Ứng dụng đã có sẵn hệ thống **Job Queue trong SQLite** (`jobs`, `project_stages`) với cơ chế lease, lock và heartbeat (TASK-118, TASK-125).
   - Đã có sẵn giao thức **SSE Event Stream (`/api/agent-events`)** và Webhook giúp Agent bên ngoài nhận tín hiệu thời gian thực khi một stage bắt đầu/kết thúc.
   - Hermes Agent hỗ trợ cơ chế công cụ `delegate_task` cho phép Orchestrator spawn tối đa 10 sub-agents chạy song song độc lập.

### Thiết kế Chi tiết Mô hình Đề xuất

```mermaid
flowchart TD
  User([Người dùng]) --> Orchestrator[Orchestrator Agent / Hermes Parent]
  
  subgraph Orchestration [Tầng Điều phối]
    Orchestrator --> WQ[(Work Queue / SQLite Job Table)]
    Orchestrator --> Policy[Policy & Budget Guardrails]
  end

  subgraph SubAgents [Tầng Sub-Agents Chuyên biệt (Chạy song song)]
    SA_Visual[Visual Research Sub-Agent<br/>- Web Crawler / Image Scraper<br/>- Wallhaven / Pinterest / Public Archives<br/>- Kiểm duyệt Vision & Nạp Custom URL]
    SA_Channel[Channel Specialist Sub-Agent<br/>- Phân tích ngách & khán giả<br/>- Quản lý Playbook & Gene của kênh<br/>- Lên lịch xuất bản & Tương tác]
    SA_Pipeline[Video Pipeline Sub-Agent<br/>- Điều khiển kịch bản, Voice, Sub<br/>- Render Compose & Sửa lỗi timeline<br/>- Duyệt Gate chất lượng tự động]
  end

  WQ --> SA_Visual
  WQ --> SA_Channel
  WQ --> SA_Pipeline

  SA_Visual -->|POST /scenes/:id/visuals/custom-url| ServerAPI[Fastify Server API]
  SA_Channel -->|PATCH /profiles/:id & Analytics| ServerAPI
  SA_Pipeline -->|POST /pipeline/run & approve| ServerAPI

  ServerAPI --> DB[(SQLite Database: app.db)]
```

### Các Thành phần Cốt lõi cần Triển khai:
1. **Work Queue chuyên biệt cho Sub-Agents (`agent_tasks`):**
   - Tạo bảng hoặc mở rộng bảng `jobs` hỗ trợ các loại task con: `VISUAL_RESEARCH_BATCH`, `CHANNEL_AUDIT`, `SCENE_POLISH`.
   - Các Sub-Agent có thể claim task (nhận việc), cập nhật tiến độ (progress reporting), và trả về kết quả cấu trúc (JSON schema).
2. **Visual Research Sub-Agent Toolset:**
   - Cung cấp cho Sub-Agent bộ công cụ: Web Search (DuckDuckGo, Brave, Wallhaven, Archive.org), Web Extract/Scrape, và API gán ảnh trực tiếp `addCustomUrl`.
   - Khi phát hiện một chủ đề đặc thù (như Berserk, One Piece, hoặc Lịch sử cổ đại), Sub-Agent tự động tra cứu nguồn dữ liệu thích hợp nhất mà không bị bó hẹp vào một API trả phí duy nhất.
3. **Cơ chế Bền vững & An toàn:**
   - Giữ nguyên nguyên tắc rào chắn: Sub-Agent chỉ hoạt động trong khuôn khổ các API có sẵn của server và Tool Registry; không tự ý chỉnh sửa mã nguồn hệ thống; ghi log hành động và audit log đầy đủ.

## 17. [BUG-SCRIPT-HOOK-DUP-008] Lời dẫn của Hook bị lặp lại 2 lần liên tiếp ở đầu video do `planScenes` tách câu trùng lặp

### Hiện trạng & Triệu chứng
1. Người dùng phát hiện lỗi: *"video berserk còn bị lỗi lặp thoại ở phần đầu kìa"*.
2. Khi kiểm tra cấu trúc kịch bản và danh sách scenes của dự án Berserk (`1ef6de1f-cf84-4552-8aed-8958f290bc0e`):
   - **Scene 0 (Order 0, Kind: `hook`):**
     * Lời thoại: *"Liệu một phàm nhân bằng xương bằng thịt có thể vung kiếm chém đứt xiềng xích của định mệnh đã an bài?"*
   - **Scene 1 (Order 1, Kind: `section`, Section: `Tiếng Gọi Của Ý Chí`):**
     * Lời thoại: *"Liệu một phàm nhân bằng xương bằng thịt có thể vung kiếm chém đứt xiềng xích của định mệnh đã an bài?"*
   - **Scene 2 (Order 2, Kind: `section`):**
     * Lời thoại: *"Berserk chính là câu trả lời nghiệt ngã nhưng bi tráng nhất."*
3. **Hậu quả:** Khi render video, giọng đọc (TTS) đọc câu hỏi này 2 lần liên tiếp ngay 10 giây đầu tiên, gây cảm giác video bị lỗi vấp đĩa / giật lặp.

### Nguyên nhân gốc rễ trong code
1. **Khâu sinh kịch bản (`SCRIPT`):** Mô hình LLM tạo trường `hook` độc lập, nhưng đồng thời lại dùng chính câu hook đó làm câu mở đầu cho phần dẫn của `sections[0].narration`.
2. **Khâu lập kế hoạch cảnh (`planScenes.ts` dòng 233-249):**
   ```typescript
   const units: Unit[] = [
     ...(script.hook.trim() ? [{
       kind: "hook" as const,
       sectionId: null,
       label: "Hook",
       narration: script.hook,
       ...
     }] : []),
     ...script.sections.map((section): Unit => ({
       kind: "section",
       sectionId: section.id,
       label: section.heading,
       narration: section.narration,
       ...
     })),
   ];
   ```
   - Hàm `planScenes` tạo 1 unit riêng cho `script.hook`, sau đó tách toàn bộ câu trong `script.sections` thành các unit tiếp theo mà **không kiểm tra xem câu đầu tiên của `section[0]` có trùng khớp với `script.hook` hay không**.

### Đề xuất giải pháp cho Core Dev
1. Trong `packages/shared/src/scenes/planScenes.ts`:
   - Trước khi map `script.sections`, kiểm tra nếu câu đầu tiên của `sections[0].narration` trùng (hoặc bắt đầu bằng) `script.hook.trim()`, tự động cắt bỏ phần trùng lặp ở `sections[0]` để tránh sinh cảnh lặp thoại.
2. Trong prompt sinh kịch bản (`apps/server/src/stages/script/prompt.ts`):
   - Bổ sung chỉ dẫn rõ ràng: *"Do NOT repeat the hook sentence in the body of section 1. Section 1 must continue immediately after the hook."*

### Xử lý ngay cho dự án hiện tại
- Gọi API `DELETE /api/projects/:id/scenes/:sceneId` để xóa Scene 1 (`6713e315-4836-4fba-8af4-34cd5908fbdc`) bị lặp.
- Tự động chạy lại Voice/Timeline/Render để video mở đầu liền mạch, không còn lặp thoại.







