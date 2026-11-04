# AI Video Agent — MVP Architecture

> Status: v0.1 (2026-11-02). Source of truth cho Copilot. Mọi thay đổi kiến trúc phải cập nhật file này trước.

## 1. Audit hiện trạng

| Hạng mục | Kết quả |
|---|---|
| Repository | Trống, chưa `git init` |
| Node.js | v24.19 + npm 11 |
| Python | 3.15 (quá mới, nhiều wheel media/ML chưa hỗ trợ → không chọn làm runtime chính) |
| FFmpeg | **Chưa cài** → dùng `FFMPEG_PATH` env, fallback package `ffmpeg-static` |
| Docker | Có, nhưng MVP không cần |
| Tái sử dụng | Không có code cũ. Xây mới toàn bộ |

## 2. Quyết định công nghệ

| Lớp | Lựa chọn | Lý do |
|---|---|---|
| Ngôn ngữ | TypeScript toàn bộ | Chia sẻ type/schema giữa UI và server, một toolchain |
| Monorepo | npm workspaces | Không cần cài thêm pnpm/turbo |
| Backend | Fastify 5 + zod | Nhẹ, validate bằng schema dùng chung |
| DB | SQLite (better-sqlite3) + Drizzle ORM | Không cần server DB, file đơn, dễ backup |
| File storage | Local FS `data/projects/<id>/` | Rẻ, đơn giản |
| Job runner | In-process worker, job lưu trong SQLite | Không Redis/broker. Resume sau restart |
| Progress | SSE + endpoint GET để fallback | Đơn giản hơn WebSocket, đủ cho 1 chiều server → UI |
| Frontend | React + Vite + React Router + TanStack Query + Tailwind | Phổ biến, Copilot làm tốt |
| Render | FFmpeg qua `child_process` | Không dùng AI video |
| Test | Vitest + `fastify.inject` | Nhanh, không cần chạy server thật |

Không dùng: microservices, message broker, Kubernetes, Redis, ORM thứ hai, state lib lớn (chỉ thêm Zustand nếu thật cần).

## 3. Repository layout

```
videoGenerator/
├── package.json                # workspaces
├── tsconfig.base.json
├── .env.example
├── docs/                       # ARCHITECTURE.md, tasks/TASK-xxx.md
├── packages/
│   └── shared/                 # zod schemas, enums, API types (dùng chung)
├── apps/
│   ├── server/
│   │   └── src/
│   │       ├── api/            # routes Fastify
│   │       ├── db/             # drizzle schema, migrations
│   │       ├── services/       # nghiệp vụ theo entity
│   │       ├── pipeline/       # state machine, invalidation, gates
│   │       ├── jobs/           # job queue + worker
│   │       ├── stages/         # research, script, scenes, visuals, voice,
│   │       │                   # subtitle, music, timeline, render
│   │       ├── providers/      # llm/, image/, tts/, music/ (interface + adapter)
│   │       ├── storage/        # path helpers cho data/
│   │       └── lib/            # config, logger, errors, hash, retry
│   └── web/
│       └── src/
│           ├── pages/ components/ hooks/ services/ stores/ utils/
│           └── features/       # projects, script, scenes, visuals, voice,
│                               # music, timeline, render
└── data/                       # gitignored: app.db, projects/<id>/...
```

## 4. Chế độ Hybrid (agent ↔ user) — chất lượng video trước, token sau

Mỗi project có `mode`, và mỗi stage có thể override `executor`.

| Mode | Hành vi |
|---|---|
| `AUTO` | Agent chạy hết. Ở review gate, tự chọn candidate có rank cao nhất (rule-based). Vẫn dừng ở `FINAL_APPROVAL` (1 click "Approve All") trừ khi bật `autoRender`. |
| `ASSISTED` (mặc định) | Agent generate, dừng ở `VISUAL_REVIEW`, `MUSIC_REVIEW`, `FINAL_APPROVAL`. |
| `MANUAL` | Agent chỉ chạy khi user bấm từng stage. |

`stageExecutors` override theo stage, ví dụ `visuals: "USER"`: agent chỉ sinh query + link tìm kiếm (Google Images, Wikimedia…) — **0 token, 0 API call** — user dán URL/upload. Đây là đường rẻ nhất cho việc "nhìn ảnh".

### Cost tiers (luật: luôn dùng tier thấp nhất giải quyết được)

| Tier | Ví dụ | Chi phí |
|---|---|---|
| 0 — Code | **scene plan (tách scene, thời lượng)**, ranking ảnh, dedupe (perceptual hash), kích thước, aspect, watermark theo domain, tách câu subtitle, timeline, FFmpeg, ducking, xếp hạng nhạc theo mood/BPM/duration | Free |
| 1 — API rẻ | Image search API (Wikimedia, Openverse, Pexels…), music API, TTS | Thấp |
| 2 — LLM text | research, script, visual queries, music mood; ở chế độ cao hơn: review/sửa script, xếp hạng ảnh theo ngữ nghĩa (text metadata) | Theo **chế độ ngân sách** (bên dưới), cache theo input hash + provider/model |
| 3 — LLM vision | Hiểu nội dung ảnh | **Tắt mặc định.** Chỉ ở QUALITY/CUSTOM khi user bật, hoặc user bấm trên 1 candidate; luôn báo chi phí trước |

Mọi LLM call ghi `usage` (tokens/requests, cost ước tính) vào job để UI hiển thị.

### Chế độ ngân sách token (Budget mode) — user chọn theo project
| Chế độ | Ý tưởng | LLM calls ước tính / video (Generate All) |
|---|---|---|
| `ECO` | Rẻ nhất: research + script gộp 1 call; chuẩn hóa bằng code, không gọi sửa, không trợ giúp ảnh/nhạc | 1 (tối đa 1) |
| `BALANCED` (mặc định, ưu tiên chất lượng — TASK-004F) | Research sâu vừa + script tách riêng; review script 1 lượt; AI hỗ trợ từ khóa scene, xếp hạng ảnh, mood nhạc, metadata; repair 1 lần; headroom output 1.5× | ≈5 (tối đa ≈9) |
| `QUALITY` | Research sâu; review + polish script 2 lượt; mọi trợ giúp AI; repair 2 lần; headroom 2×; vision vẫn opt-in | ≈7 (ước tính bảo thủ 6–15, tùy trợ giúp ảnh và repair) |
| `MAX` (TASK-004G) | Không tiết kiệm token: mọi tính năng ở mức cao nhất + fact-check script, tìm ảnh rộng hơn, **AI vision kiểm tra top 5 ảnh mỗi scene** (tự tìm lại tối đa 2 vòng nếu < 7/10), kiểm tra đồng nhất giữa các scene, **kiểm tra video sau render** (ffprobe + vision trên frame giữa mỗi scene). Scene không đạt luôn bị gắn `NEEDS_ATTENTION`, không bao giờ bị bỏ qua âm thầm | ≈10 text + vision theo số scene (hiển thị trước khi chạy, không áp trần) |
| `CUSTOM` | Dùng cấu hình BALANCED rồi áp dụng các feature override; ước tính theo cấu hình | tùy cấu hình |

**Định tuyến model theo tác vụ (TASK-004F):** mỗi tác vụ LLM (`research`, `script`, `scriptReview`, `sceneQueries`, `visualAltQueries`, `visualRerank`, `visionCheck`, `musicAssist`, `metadata`) có route riêng `{provider, model, maxOutputTokens?, fallback?}`. Thứ tự ưu tiên: dự án theo tác vụ → dự án mặc định → app theo tác vụ → app mặc định → ENV. Usage ghi từng call (task/provider/model).

Ước tính hiện tại bao gồm route research/script/review/scene-query/visual-search; scene-query dùng một call batch cho mọi scene khi được bật, còn alternative query và rerank phụ thuộc kết quả tìm ảnh. Music assist và metadata đã có feature flag/task route nhưng thuộc các stage sau; vision luôn tắt trừ khi user chủ động bật trong CUSTOM.

### Quy tắc LLM (bắt buộc cho mọi task)
1. **Ở mọi chế độ, việc code làm tốt tương đương thì viết code**, không gọi LLM: tách câu/scene, tính thời lượng, lọc trùng, format, subtitle, timeline, render, validate, chuẩn hóa output.
2. **Chỗ nào LLM làm video tốt hơn thì được gọi** (viết, biên tập, hiểu ngữ nghĩa, kiểm tra chính sách/định hướng kênh, góp ý trước render — quyết định của user 2026-11-04). Mỗi tính năng LLM khai báo **bật ở chế độ nào** và **số call**; ECO vẫn là lựa chọn tiết kiệm. Tác vụ do user chủ động bấm (chat góp ý) được phép ở mọi chế độ và hiện chi phí từng tin nhắn.
3. Trước khi chạy, UI hiển thị **ước tính số call/token** theo chế độ đang chọn; không bao giờ vượt chế độ đã chọn một cách âm thầm.
4. LLM vision luôn opt-in, báo chi phí trước; việc cần "mắt" vẫn có đường giao cho user ở review gate.
5. Cache theo hash input; chạy lại không đổi input = 0 token. Pre-flight theo giới hạn provider.
6. Mỗi spec có mục "LLM calls" theo từng chế độ; reviewer từ chối thiết kế gọi LLM cho việc deterministic.
7. Luôn có đường 0 token cho stage text: user tự viết, hoặc Claude Desktop / Copilot Chat qua MCP.

## 5. Pipeline & state machine

```
TOPIC → RESEARCH → SCRIPT → SCENE_PLAN → VISUAL_SEARCH → [VISUAL_REVIEW]
      → VOICE → SUBTITLE → MUSIC_SEARCH → [MUSIC_REVIEW] → TIMELINE
      → [FINAL_APPROVAL] → RENDER → DONE
```
`[...]` = review gate. Ở gate, project `status = REVIEW` (waiting for user).

- `project.stage`: stage hiện tại (enum `PipelineStage`).
- `project.status`: `DRAFT | GENERATING | REVIEW | RENDERING | COMPLETED | FAILED` (dùng cho Dashboard). Archive là cờ riêng `archivedAt`.
- Mỗi stage chạy dưới dạng `Job` (QUEUED → RUNNING → SUCCEEDED/FAILED/CANCELLED), có `attempt`, `progress 0–100`, `error {code,message,retryable}`, timeout, retry với backoff cho lỗi retryable.
- Restart server: job `RUNNING` → đặt lại `QUEUED` (resume). Output stage được lưu sau mỗi bước nên chạy lại là idempotent.
- Fail không làm mất dữ liệu: chỉ job fail, project giữ nguyên các output đã có.

### Invalidation (sửa 1 chỗ không phải làm lại tất cả)

Mỗi output lưu `inputHash` = hash của các input nó phụ thuộc. Output bị `STALE` khi hash không khớp.

```
topic ─► script ─► scenes ─┬─► visualQueries ─► candidates ─► selection ─┐
                           ├─► narration ─► voice ─► subtitle ──────────┤
                           └─► musicMood ─► musicCandidates ─► music ───┴─► timeline ─► render
```
- Sửa narration scene 3 → voice(scene 3), subtitle, timeline, render STALE. Visual không đổi.
- Thay ảnh scene 12 → chỉ selection(scene 12), timeline, render STALE. Render cache clip theo scene nên chỉ render lại clip scene 12 + bước ghép.

## 6. Data model

`packages/shared` định nghĩa bằng zod; server lưu SQLite (JSON column cho object lồng nhau).

| Entity | Trường chính |
|---|---|
| **VideoProject** | id, title, description, topic, language, targetDurationSec, aspectRatio, mode, stageExecutors, autoRender, status, stage, thumbnailPath, durationSec, version, createdAt, updatedAt, archivedAt |
| **Script** | id, projectId, title, hook, researchNotes, sources[], inputHash, version |
| **Scene** | id, projectId, order, label (Hook/Intro/…), narration, visualRequirement, estDurationSec, transitionNote, musicMood?, inputHash |
| **VisualQuery** | sceneId, primary, alternatives[], origin (`AGENT`/`USER`), createdAt |
| **VisualCandidate** | id, sceneId, origin (`SEARCH`/`CUSTOM_URL`/`UPLOAD`/`AI_GENERATED`), provider, query, previewUrl, imageUrl, sourceUrl, sourceSite, localPath?, width, height, aspectRatio, fileType, watermark (`NONE`/`SUSPECTED`/`UNKNOWN`), relevanceScore, license: LicenseMetadata, discardedAt? |
| **VisualSelection** | id, sceneId, slot (cho phép nhiều ảnh/scene), candidateId, status: VisualStatus, motion {type: kenburns/pan/zoom, from, to}, durationSec?, reviewedAt |
| **LicenseMetadata** | kind (`CC0`/`PUBLIC_DOMAIN`/`CC_BY`/`CC_BY_SA`/`CC_BY_NC`/`ROYALTY_FREE`/`ALL_RIGHTS_RESERVED`/`UNKNOWN`/`USER_PROVIDED`/`AI_GENERATED`), name, url, author, authorUrl, attributionRequired, attributionText, evidence (nguồn của thông tin: `api`/`page_meta`/`user`/`none`) |
| **VoiceTrack** | id, sceneId, provider, voice, speed, audioPath, durationSec, inputHash |
| **SubtitleTrack** | id, projectId, cues[{start,end,text,sceneId}], srtPath, assPath, inputHash |
| **MusicTrack** | id, projectId, origin, title, artist, source, url, license, durationSec, bpm?, mood, energy, audioPath, (selection:) status, startSec, endSec, volume, fadeIn, fadeOut, duckingDb |
| **Timeline** | id, projectId, items[{track: video/voice/music/subtitle, refId, start, end}], totalDurationSec, inputHash |
| **RenderJob** | (là Job với stage=RENDER) + outputPath, resolution, fps, sizeBytes |
| **Job** | id, projectId, stage, scope (vd: sceneId), status, progress, attempt, maxAttempts, error, usage {tokens, costUsd}, logs, startedAt, finishedAt |
| **ProjectVersion** (phase 9) | id, projectId, version, reason, snapshot JSON, createdAt |

**VisualCandidate vs VisualSelection**: search tạo nhiều candidate cho 1 scene; selection chỉ trỏ tới 1 candidate. Thay ảnh = đổi `candidateId` của selection, không search lại, không đụng stage khác.

**VisualStatus** (trên selection): `DISCOVERED` (agent vừa gán, chưa vào gate) → `REVIEW_REQUIRED` → `APPROVED` / `REJECTED`; `REPLACED` (user chọn candidate khác), `CUSTOM` (URL/upload của user), `AI_GENERATED`.

**Scene visual status** (suy ra, hiển thị trên Scene Board/Visual Review): `NO_VISUAL` → `SEARCHING` → `REVIEW_REQUIRED` → `APPROVED` → `READY_FOR_RENDER` (ảnh đã tải về local, kiểm tra đọc được, đúng kích thước).

**Nguyên tắc ảnh:** AI đề xuất (mô tả hình + query) → tool tìm nhiều candidate → code lọc/rank → user duyệt/chọn → render chỉ dùng ảnh đã chọn. Đổi ảnh chỉ cập nhật selection, không chạy lại script/voice/music/scene khác. LLM không bao giờ tự đoán URL ảnh. Chế độ `AUTO` vẫn chọn ảnh rank cao nhất nhưng dừng ở `FINAL_APPROVAL`.

### Quy tắc license (không hard-block ở MVP)
- Chỉ báo cáo dữ liệu tìm được, kèm `evidence`. Không bao giờ ghi "không có bản quyền" nếu không có dữ liệu.
- UI badge: `CC0`/`PUBLIC_DOMAIN` → xanh; `CC_BY*` → "Attribution required"; `UNKNOWN` → "⚠️ Unknown — user review"; `ALL_RIGHTS_RESERVED` → cảnh báo đỏ. Không tự loại ảnh.
- Render tạo `credits.txt` từ các selection có `attributionRequired`.

## 7. Providers (interface + adapter, cấu hình qua env)

| Loại | MVP | Sau |
|---|---|---|
| LLM | Đa provider: Anthropic, Gemini, OpenAI-compatible (OpenAI, Ollama, OpenRouter, DeepSeek, Groq, custom), CLI theo gói đăng ký (claude-cli, copilot-cli, antigravity-cli; gemini-cli đã bị Google ngừng cho tài khoản cá nhân); route provider/model theo từng task với thứ tự ưu tiên project → app → ENV và fallback; cache theo input hash + provider/model; user có thể tự viết script (0 token) | thêm provider khác |
| Image search | Wikimedia Commons, Openverse (license metadata tốt, free); Pexels (API key) | web image search (Brave/SerpAPI), AI image gen |
| TTS | 1 adapter giá rẻ, hỗ trợ tiếng Việt | local TTS |
| Music | Thư viện local (`data/music/` + metadata JSON), Jamendo API | thêm nguồn |

Ranking ảnh (Tier 0): điểm = khớp từ khóa trong title/description + độ phân giải ≥ target + aspect gần target + license đã biết + không nghi watermark (domain stock có watermark) − trùng lặp (pHash).

## 8. Render (FFmpeg)
1. Mỗi scene → clip MP4 (ảnh + `zoompan` Ken Burns, đúng duration theo voice). Cache theo hash(selection, motion, duration, resolution).
2. Concat clips (+ transition đơn giản).
3. Audio: voice nối theo timeline; music với volume/fade; ducking bằng `sidechaincompress` (voice làm sidechain).
4. Subtitle: burn ASS + xuất `.srt` riêng.
5. Output `data/projects/<id>/renders/v<version>.mp4` + `credits.txt`.

## 9. API (tổng quan, chi tiết theo từng task)
```
GET  /api/health
GET  /api/dashboard/stats
CRUD /api/projects (+ /duplicate /archive /unarchive)
POST /api/projects/:id/stages/:stage/run        # chạy 1 stage (hoặc "all")
POST /api/projects/:id/gates/:gate/approve      # approve gate (Approve All)
GET  /api/projects/:id/jobs                     # polling fallback
GET  /api/projects/:id/events                   # SSE progress
.../scenes, .../scenes/:sceneId/visuals (candidates, select, search, custom-url, upload)
.../voice, .../music, .../timeline, .../renders
```
Lỗi luôn có dạng: `{ "error": { "code": "PROJECT_NOT_FOUND", "message": "...", "details": {} } }`.

## 10. Task roadmap

| Task | Nội dung | Phụ thuộc | Phase |
|---|---|---|---|
| TASK-001 | Monorepo scaffold, shared enums/schemas, SQLite, Project CRUD API + dashboard stats, tests | — | 1 |
| TASK-002 | Web shell: Dashboard, Project list (search/filter/sort), create/rename/duplicate/archive/delete | 001 | 1 |
| TASK-003 | Job queue + worker + SSE + pipeline state machine + gates + modes (dùng stage giả để test) | 001 | 2 |
| TASK-004 | LLM đa provider + Research/Script (gộp 1 call) + Script editor UI | 003 | 2 |
| TASK-004B | MCP server cho Claude Desktop + provider claude-cli (dùng subscription) | 004 | 2 |
| TASK-004D | ~~GitHub Models~~ (đã bị GitHub khai tử 30/7/2026) + GitHub Copilot (copilot-cli, MCP với Copilot Chat) + giới hạn token theo provider (pre-flight) + đếm số call/tháng (không áp trần) | 004B | 2 |
| TASK-004C | Tham số video (topic bắt buộc, còn lại tùy chọn) + khuyến nghị tự động bằng luật, 0 LLM call; quick create | 004 | 2 |
| TASK-004E | Chế độ ngân sách token ECO/BALANCED/QUALITY/CUSTOM + ước tính số call trước khi chạy + review & sửa script (QUALITY) | 004C | 2 |
| TASK-004F | Định tuyến model LLM theo từng tác vụ (app + dự án, fallback) + nâng mức dùng LLM của BALANCED/QUALITY + usage theo từng call | 006 | 2 |
| TASK-005 | Scene plan bằng code (tách câu, gom theo thời lượng scene, chia query/mood) + Scene Board (sửa/tách/gộp/sắp xếp); QUALITY +1 call gợi ý query theo scene | 004E | 3 |
| TASK-006 | Image provider interface + Wikimedia/Openverse/Pexels + candidate store + ranking + dedupe | 005 | 4 |
| TASK-007 | Visual Review UI: lưới candidate (top 8, xem thêm), panel metadata đầy đủ (nguồn, URL, tác giả, license, attribution, kích thước, tỉ lệ, file, watermark, điểm), approve/reject/replace/remove, sửa query + search again, custom URL, upload, Approve All; tải preview + ảnh được chọn về local (kiểm tra tải được/không hỏng/kích thước thật); scene visual status | 006 | 4 |
| TASK-004H | Provider `antigravity-cli` (Antigravity CLI `agy`, tài khoản Google: Gemini 3.8, Claude Sonnet/Opus 4.6, GPT-OSS) — text + vision, `--mode plan`, `--json-schema`; thay cho gemini-cli đã bị Google ngừng | 004F | 2 |
| TASK-004I | Xem token tiêu thụ theo video và theo quá trình (stage / tác vụ / model / từng lần chạy) + tổng toàn app; tổng hợp từ `jobs.usage.calls`, 0 LLM call | 004F | 2 |
| TASK-004G | Chế độ MAX: vision cho provider (copilot-cli `--attachment`, claude-cli Read, API multimodal), kiểm tra ảnh bằng vision + vòng tìm lại, `NEEDS_ATTENTION`, hợp đồng kiểm tra render | 004F, 007 | 4 |
| TASK-007B | Thêm nguồn ảnh/video: Pixabay, Unsplash, NASA, The Met, Library of Congress, Smithsonian, Europeana, Flickr (CC), Pexels/Pixabay Videos; chọn nguồn theo chủ đề bằng luật; phát hiện watermark nâng cao | 007 | 4 |
| TASK-007C | "Nhờ AI tìm ảnh": LLM có web search (claude-cli `WebSearch/WebFetch`, anthropic `web_search`) trả link → app tải, kiểm tra, xác minh license; ảnh chưa xác minh license không bao giờ tự duyệt. Phần sau (007D): AI tạo ảnh (Gemini/OpenAI image API) | 007, 004F | 4 |
| TASK-008 | TTS provider + Voice stage + Voice UI | 005 | 5 |
| TASK-009 | Subtitle generation (từ voice duration, chia câu) | 008 | 5 |
| TASK-010 | Music provider + search + ranking + Music Review UI | 005 | 6 |
| TASK-011 | Timeline builder + Timeline view cơ bản | 007, 009, 010 | 7 |
| TASK-012 | FFmpeg render (Ken Burns, concat, ducking, subtitle, credits) + progress UI + kiểm tra render (ffprobe, frame đen/đứng, sync phụ đề; MAX: vision trên frame mỗi scene, theo hợp đồng TASK-004G §6) | 011 | 8 |
| TASK-013 | Versioning + history, export/download | 012 | 9 |
| TASK-017 | Bộ nguyên tắc nội dung: chính sách nền tảng (YouTube/TikTok/Facebook) + định hướng kênh (drama, storytelling…) + luật riêng; REMIND (chèn vào prompt) / FILTER (kiểm tra bằng code + LLM `guidelineCheck`, finding MUST → NEEDS_ATTENTION, không chặn cứng) | 004F | 9 |
| TASK-018 | Chat góp ý với LLM trước render (tùy chọn): context do code dựng, LLM trả lời + đề xuất sửa có cấu trúc, user bấm áp dụng → stage liên quan STALE; không chặn render; có đường MCP 0 token | 011, 017 | 9 |

```
001 ─┬─► 002
     └─► 003 ─► 004 ─► 005 ─┬─► 006 ─► 007 ─┐
                            ├─► 008 ─► 009 ─┼─► 011 ─► 012 ─► 013
                            └─► 010 ────────┘
```
002 và 003 có thể làm song song. 006/008/010 có thể song song sau 005.
