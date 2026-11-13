# Bản tổng hợp: mục tiêu, kiến trúc, spec, hiện trạng

> Viết ngày 2026-11-11 (Asia/Bangkok), sau TASK-075, TASK-077 và TASK-073c. Dùng làm đầu vào cho Fable lập kế hoạch dài hạn.
> Chi tiết kỹ thuật vẫn ở `docs/ARCHITECTURE.md` (v0.2, một số mục đã cũ, xem §8). Thứ tự task và luật agent ở `docs/cursor/README.md`. Hành vi người dùng ở `docs/user-guide/` và `packages/shared/src/features/featureMap.ts`.

## 1. Mục tiêu cuối cùng

**Một người, trên máy của họ, vận hành nhiều kênh video faceless ở nhiều thị trường. Agent làm gần hết việc 24/7. Người dùng chỉ góp ý, đặt mục tiêu và duyệt những điểm có rủi ro.**

Mỗi video phải:
1. **Giữ chân người xem.** Dựng có nhịp, đa dạng kiểu cảnh, ảnh và footage đúng chủ đề, phụ đề và đồ hoạ đẹp.
2. **Đủ nguyên bản để được kiếm tiền.** Không bị xếp vào "nội dung lặp lại, sản xuất hàng loạt". Có phân tích, bình luận, câu chuyện riêng. Có nguồn và giấy phép.
3. **An toàn với nền tảng và luật từng nước.** Guideline pack, kiểm trước khi đăng, nhãn AI và tài trợ.
4. **Có lãi.** Chi phí LLM, TTS, footage thấp hơn doanh thu. Đo được cho từng video, kênh và thị trường.

Vòng giá trị khép kín:

```
chọn thị trường + chủ đề → kịch bản → cảnh → ảnh/footage → giọng, phụ đề, nhạc → dựng (compose) → kiểm chất lượng
→ đăng theo lịch → đo số liệu → học (chủ đề, hook, kiểu cảnh, giờ đăng) → tiền (doanh thu, lợi nhuận)
→ thích ứng với thay đổi bên ngoài (chính sách, API, thuật toán, provider) → tự research, tự viết skill, đề xuất cải tiến app
```

Hướng phát triển là đi hết vòng này một cách tự động và đáng tin, không phải thêm tính năng rời.

### Chúng ta xây công cụ, agent vận hành

Đây là cách chia việc quan trọng nhất của dự án.

- **Phát triển** (người dùng, Claude, Cursor, Codex, Fable) chỉ làm ra tính năng, công cụ, dữ liệu, cách đo và rào chắn. Chúng ta không vận hành kênh, không chọn chủ đề, không quyết định thử gì.
- **Agent vận hành** (operator + trợ lý, chạy trong app) mới là người suy nghĩ khi chạy: chọn ngách và thị trường, chọn chủ đề và gói tiêu đề, quyết định thử gì, giữ gì, đổi gì. Nó dựa trên số liệu thật, knowledge và research của chính nó, rồi tự học: viết skill, ghi bài học vào sổ tay kênh, đề xuất cải tiến app (TASK-074). Nó không sửa code.
- **Người dùng** đặt mục tiêu, ngân sách và giới hạn, góp ý, duyệt điểm rủi ro. Họ không phải trả lời câu hỏi vận hành mà agent tự tìm được.

Hệ quả khi thiết kế một tính năng:
1. Tính năng là **công cụ cho agent**: tool trong registry (có mức rủi ro, grant, audit), dữ liệu đọc được, chỉ số đo được. Cũng phải có đường cho người tự làm.
2. Ngưỡng, khoảng cách, trọng số, công thức chấm là **tham số agent chỉnh được** trong giới hạn an toàn, có lịch sử và hoàn tác. Không viết cứng thành hằng số "đúng mãi".
3. Thuật toán tối ưu (bandit, chấm điểm, phát hiện tụt) **gợi ý và đo**. Agent đọc kết quả và quyết, trong phạm vi grant.
4. Mỗi tính năng phải trả lời: agent dùng nó lúc nào, ra quyết định gì, học được gì từ kết quả, và rào chắn nào ngăn nó làm hỏng kênh.

## 2. Quyết định của người dùng (bất biến, chỉ người dùng đổi)

| Chủ đề | Quyết định |
|---|---|
| Chất lượng trước token | LLM được gọi ở mọi chỗ làm video tốt hơn. Mode ECO / BALANCED (mặc định) / QUALITY / MAX / CUSTOM vẫn chọn được. Việc cơ học (tách câu, thời lượng, xếp hạng, FFmpeg) là code. Không bao giờ vượt mode âm thầm. |
| Agent và người dùng | Mode dự án AUTO / ASSISTED / MANUAL. Mỗi stage có executor AGENT hoặc USER. Đường 0 token luôn có (người tự làm, hoặc MCP). |
| Ảnh không đúng chủ đề | **Mọi mode, kể cả AUTO, dừng lại hỏi.** Không tự duyệt ảnh lạc đề, không tự thay bằng đồ hoạ (TASK-077). |
| Bản quyền | Giấy phép là metadata, không chặn cứng. Ảnh watermark bị loại. **Không** xoá watermark, **không** cắt ảnh để né Content ID. |
| Đăng bài | Ưu tiên YouTube > TikTok > Facebook Reels > Instagram Reels. Mặc định công khai theo lịch. Có lỗi guideline MUST hoặc render hỏng thì đăng riêng tư và báo. |
| Tự vận hành | Mức tự chủ `off / assist / supervised / autonomous` theo hồ sơ, có grant. Giới hạn cứng dù ở "Toàn quyền": không đụng secret, đăng nhập, tiền, dự án được bảo vệ, xoá cứng, tự nâng quyền. `computer_act` tắt mặc định. Có nút dừng một bấm. |
| Tri thức bên ngoài | Không viết cứng dữ kiện bên ngoài vào code. Mỗi dữ kiện là knowledge entry có nguồn, ngày kiểm, độ biến động, hạn dùng. Phải chịu được mọi kiểu thay đổi, không chỉ ví dụ đã nêu. |
| Tự cải tiến | App tự research, tự viết skill, tự đề xuất cải tiến. Vòng: bằng chứng → đề xuất → thử → người duyệt → đo kết quả. **Operator không bao giờ sửa code, chạy git, giao việc cho Codex, tăng ngân sách hay tự duyệt đề xuất của mình.** |
| Mã nguồn mở trước | Mỗi tính năng tìm dự án OSS có sẵn trước. Chỉ chép mã MIT/Apache/BSD/ISC, giữ ghi công. Mỗi guide có mục "Mã nguồn mở có sẵn". |
| Một người dùng | App cá nhân, chạy trên máy người dùng (Windows 11). Không bán, không người dùng thứ hai. Điều kiện miễn phí của Remotion, n8n, FFmpeg GPL đúng với cách dùng này. |
| Dự án bảo vệ | Không bao giờ duyệt cổng hay render trên `56374fb2-54cf-48ff-9441-2e6c653295d4`. |

## 3. Kiến trúc hiện tại

### 3.1 Runtime

Monorepo TypeScript, Node 24, npm workspaces. Khoảng 128 nghìn dòng mã: server 73k, web 31k, shared 23k, MCP 1k. 63 migration.

| Lớp | Công nghệ |
|---|---|
| `packages/shared` | Zod schema + logic thuần (budget, compose, visuals, knowledge, operator, publishing, featureMap…) |
| `apps/server` | Fastify, better-sqlite3 + Drizzle, worker và hàng đợi job trong SQLite, SSE |
| `apps/web` | React + Vite + TanStack Query, chữ tiếng Việt |
| `apps/mcp` | MCP `video-agent` (stdio → REST), cho Claude Desktop, Cursor, Copilot Chat |
| Media | FFmpeg/ffprobe (`ffmpeg-static`), HyperFrames 0.9.14 (HTML/GSAP → video) |
| Dữ liệu | `data/` (gitignored): `app.db`, `projects/<id>/`, vault mã hoá token |

Không microservice, không Redis, không ORM thứ hai.

### 3.2 Pipeline video

```
RESEARCH → SCRIPT → SCENE_PLAN → VISUAL_SEARCH → [VISUAL_REVIEW]
        → VOICE → SUBTITLE → MUSIC_SEARCH → [MUSIC_REVIEW] → TIMELINE → [FINAL_APPROVAL] → RENDER
side job: PUBLISH, CLIP
```

- Mỗi output lưu `inputHash`. Đổi dữ liệu phía trên thì các stage sau thành `STALE`. Cache clip theo cảnh.
- Timeout theo stage do một call LLM nhỏ tính, có baseline code. Lỗi mạng TTS và timeout tự thử lại có giới hạn, VISUAL_SEARCH có checkpoint từng cảnh.
- Cổng chất lượng (kịch bản, render, đăng) đọc số liệu từ server, agent không tự khai được.

### 3.3 Hình ảnh (VISUAL_SEARCH)

- 11 provider ảnh mở + web (Brave, Gemini grounding, crawl). Footage Pexels/Pixabay.
- Thứ tự lọc: liên quan (keyword, thực thể, từ fan) → vision (khi bật) → nguồn/giấy phép, denylist → gán toàn cục (Hungarian) → dedupe dHash → **cổng cuối**.
- Cổng cuối (TASK-077) tính lúc đọc trong `deriveSceneVisualStatus`. Ảnh agent chọn mà lệch chủ đề, bị vision loại, nguồn rủi ro cao hoặc không có ứng viên thì là `NEEDS_ATTENTION`. Ảnh người dùng chọn, `CUSTOM`, `AI_GENERATED` luôn sẵn sàng.
- Query luôn có tên tác phẩm và từ loại trừ. Tác phẩm hư cấu tìm web ngay vòng đầu. Provider trả 404/410 bị khoá cả lượt.

### 3.4 Dựng (compose engine, TASK-067/068/075)

- Mỗi cảnh thành nhiều cảnh quay: `still`, `footage`, `kinetic_text`, `chart`. TASK-070 sẽ thêm `map`, `compare`, `quote_full`, `list_full`.
- Cắt ở khoảng lặng giữa từ và theo nhịp nhạc (quy hoạch động). Có luật đa dạng V1–V4 và chỉ số entropy.
- Đạo diễn: `baselineDirector`, `ruleDirector` (luật R1–R6, đọc số tiếng Việt), `createLlmDirector` (1 call LLM, lỗi thì lùi về luật). **`pickDirector` vẫn chọn baseline. Nối đạo diễn 067b vào render là việc của TASK-070.**
- Đồ hoạ theo mode: ECO `off`, BALANCED `static` (1 khung + chuyển động ffmpeg), QUALITY `animated`, MAX `animated` + grain. Ước tính render ±40% hiện trên tab Render, API, MCP.
- Render cũ (legacy: Ken Burns, xfade, phụ đề ASS) vẫn là đường lùi khi một cảnh compose lỗi. Cổng render bắt khung đứng hoặc đen.

### 3.5 LLM và provider

- 15 provider LLM: API, CLI (claude, copilot, antigravity), Ollama local/remote, OmniRoute gateway. Định tuyến theo task (34 task LLM), có fallback, cache theo hash prompt, usage từng call.
- Quota miễn phí: đếm local + số live từ OmniRoute, cool-down 429, chuỗi fallback miễn phí trước. Trả phí chỉ khi bật và trong trần USD/ngày.
- Cố vấn model và provider intelligence (bằng chứng, ToS, scorecard) chỉ đề xuất. Chỉ áp dụng khi người bấm hoặc khi có grant `providers`.
- TTS: edge-tts mặc định + 8 provider, có word timing.

### 3.6 Mặt điều khiển

- **Một registry tool** dùng chung cho trợ lý (web + Telegram), MCP và operator. Việc `confirm` thành thao tác chờ người duyệt, trừ khi grant cho phép. Có audit, hard block, lý do bắt buộc.
- **Operator** chạy Cursor CLI (hoặc runtime model khác qua adapter), không shell. Có handbook, skill (`.agents/skills/` với `operator: true`), lệnh thường trực, cron, hook sự kiện, supervisor không tốn token.
- **Tự vận hành (TASK-059/066/069):** mục tiêu theo hồ sơ, góp ý thành quy tắc lâu dài, ngân sách và circuit breaker, "Cần bạn" tự đóng khi đủ điều kiện, bản tin hằng ngày, hoàn tác.

### 3.7 Tri thức và thay đổi bên ngoài (TASK-057, 071, 073)

- RAG theo hồ sơ (SQLite FTS5 + embedding tuỳ chọn), có trích dẫn, ngữ cảnh đặt trong khối untrusted.
- Market pack 17 nước (ngôn ngữ, múi giờ, nền tảng, luật, sự kiện mùa vụ).
- Knowledge entry có resolver, hạn dùng, đề xuất có diff và khôi phục. Snapshot gồm market, account_policy (48), api_contract (26) và các loại khác.
- **Hộp thay đổi chung** với chính sách phản ứng theo bậc: ghi log → báo → đề xuất → tự chuyển phương án có sẵn → tạm dừng đúng phần bị ảnh hưởng → điều tra.
- Detector đang chạy: D1 trang nguồn (theo lịch), D2 lỗi runtime/API, D3 trạng thái tài khoản/video (poll + webhook TikTok), D4 số liệu tụt (CUSUM), D6 dữ kiện quá hạn + npm, D7 người báo.

### 3.8 Sau khi đăng

Analytics (YouTube, TikTok, Meta), doanh thu và lợi nhuận (nhập tay + CSV), học từ kết quả, thumbnail, clip ngắn từ video dài, hộp bình luận có gợi ý trả lời, xu hướng, lồng tiếng đa ngôn ngữ.

## 4. Hiện trạng theo khu vực

"Có trong code" khác "đã chạy thật". Nhiều phần mới chỉ qua test giả lập.

| Khu vực | Có trong code | Đã chạy thật | Thiếu chính |
|---|---|---|---|
| Pipeline lõi tới render | ✅ | ✅ nhiều dự án | Static render chậm hơn dự đoán 2–3 lần (mỗi shot mở browser) |
| Ảnh đúng chủ đề | ✅ cổng cứng | ⚠️ Berserk: 0/31 cảnh có ảnh đúng, lượt chạy lại chết vì `LLM_AUTH` | Tìm được ảnh đúng cho tác phẩm hư cấu; nguồn ảnh fan/official có giấy phép |
| Compose đa cảnh quay | ✅ | ⚠️ eval + vài dự án | Đạo diễn 067b chưa nối vào render; 4 kiểu cảnh mới; sửa cảnh quay tay |
| Giọng, phụ đề, nhạc | ✅ | ✅ edge-tts | Nhạc chỉ Openverse + local |
| Đăng 4 nền tảng | ✅ | ❌ chưa OAuth/tải lên thật | Người dùng phải tạo app developer |
| Analytics, doanh thu | ✅ | ❌ chưa sync thật | Retention theo giây, CTR/impressions (Reporting CSV) |
| Học từ kết quả | ✅ | ❌ chưa có dữ liệu thật | Nối kiểu cảnh, hook, thumbnail với retention |
| Tự vận hành 24/7 | ✅ | ⚠️ chưa chạy dài | Chạy thử nhiều ngày trên kênh thật |
| Thích ứng thay đổi | ✅ 073a–c | ⚠️ một phần | 073d: ngân sách thử nghiệm 15 %, tín hiệu phai dần |
| Tự cải tiến | ⚠️ nền móng (skill versions, eval, propose tool) | ❌ | 074a research, 074b skill tự viết, 074c đề xuất cải tiến |
| Kiếm tiền | ⚠️ finance, metadata | ❌ | Top 5 từ RESEARCH-072 (§6) |

## 5. Cách chúng ta làm việc

| Ai | Vai |
|---|---|
| Người dùng | Quyết định sản phẩm, tạo tài khoản và key, duyệt điểm rủi ro, giao việc cho agent |
| Claude (Opus) | Viết guide, research brief, review báo cáo, ghi quyết định, giữ tài liệu |
| Cursor (grok-4.7-medium, composer-2.5 cho việc dễ) | Code các phần test kiểm được |
| Codex | Research có nguồn + code chuỗi việc backend dài |
| Fable | Chỉ việc cần thiết kế và gu: đạo diễn, template, xếp hạng theo nghĩa, tinh chỉnh, và lập kế hoạch dài hạn. Phiên ngắn, ngân sách nhỏ |
| Hermes | Chạy dự án thật, ghi lỗi vào `PROPOSALS_AND_BUGS.md` |

Luật kỹ thuật cho mọi agent: không commit/push (người dùng commit), không thêm npm trừ khi guide cho, migration chỉ qua `drizzle-kit generate`, test không mạng và không LLM thật, không đụng `.env`, `.claude/`, `data/`, `scripts/`, cập nhật user guide và featureMap. Chạy song song chỉ khi vùng file tách nhau và chỉ một agent sinh migration một lúc.

## 6. Hàng việc đã biết

| Việc | Trạng thái | Ghi chú |
|---|---|---|
| TASK-070: 4 kiểu cảnh mới, sửa cảnh quay, nối đạo diễn 067b vào render | guide có, Claude cần xem lại sau 075 | Cursor + Fable (template) |
| TASK-076: giới hạn số render cùng lúc; giọng/phụ đề/nhạc chạy trong lúc chờ duyệt ảnh | chưa có guide | Rút ngắn thời gian chờ của AUTO |
| TASK-073d: ngân sách khám phá 15 %, tín hiệu phai dần | chưa có guide | |
| TASK-074a → b → c: tự research, skill tự viết, đề xuất cải tiến app | guide có | Codex, nối tiếp 073c |
| Static graphics: một browser cho nhiều khung | mới phát hiện ở 075 | Gỡ chênh 2–3 lần so với dự đoán |
| RESEARCH-072 top 5: cổng originality + hồ sơ nguồn; kiểm nhãn/claim/ad suitability trước đăng; A/B tiêu đề, thumbnail, hook theo retention; RPM và lợi nhuận theo thị trường/định dạng; sổ affiliate/tài trợ | chưa thành task | Mạnh nhất cho mục tiêu "kiếm tiền" |
| Retention theo giây từ YouTube Analytics → học kiểu cảnh nào giữ người xem | ý tưởng | Ứng viên việc của Fable |
| Kiểm tra trực tiếp còn mở (OAuth thật, Telegram, OmniRoute token, operator chạy dài…) | `docs/tasks/CON-THIEU.md` | Cần người dùng |

## 7. Rủi ro và nợ kỹ thuật

1. **Chưa commit và chưa push.** Khoảng 620 file đang sửa chưa commit, 42 commit chưa lên GitHub. Mất máy là mất việc. Agent cloud chỉ thấy bản cũ.
2. **Chưa chạy thật phần sau render.** Đăng, analytics, doanh thu, học, tự vận hành dài chưa chạy với tài khoản thật. Mỗi lần có provider thật mới, lỗi mà mock không bắt được lại hiện ra.
3. **Ảnh cho chủ đề hư cấu (anime, game, phim) vẫn yếu.** Nguồn mở không có. Web cho ảnh fan và ảnh không rõ giấy phép. Đây là chỗ nghẽn chất lượng lớn nhất cho ngách review/giải thích tác phẩm.
4. **File khổng lồ.** `visualService.ts` dài vài nghìn dòng, agent phải grep, dễ sửa lệch. Nên tách theo bước lọc.
5. **Suite test chậm và nhạy tải.** Server khoảng 930 test, khoảng 3,5 phút. Vài file timeout khi máy bận, chạy riêng thì qua.
6. **`ARCHITECTURE.md` v0.2 đã cũ:** thiếu compose, knowledge/change inbox, autonomy, cổng ảnh, mode đồ hoạ.
7. **Phụ thuộc CLI/tài khoản cá nhân.** Gemini CLI không dùng được với tài khoản Google cá nhân từ 2026-06-18. `LLM_AUTH` trong lượt Berserk cho thấy route mặc định có thể hỏng âm thầm.

## 8. Đề bài cho Fable

Fable nghĩ và đề xuất tính năng sáng tạo và kiếm tiền (không phải sửa lỗi). Lời giao ở cuối `docs/cursor/DISPATCH-2026-11-11.md`, kết quả ở `docs/IDEAS.md`.
