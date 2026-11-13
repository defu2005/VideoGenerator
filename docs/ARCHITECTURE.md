# AI Video Agent — Architecture

> Status: **v0.2** (2026-11-06, Asia/Bangkok). Source of truth cho kiến trúc hệ thống.
> Hành vi người dùng: `docs/user-guide/` và `packages/shared/src/features/featureMap.ts`.
> Thứ tự task và quy tắc agent: `docs/cursor/README.md`. Khi guide của một task mâu thuẫn với đoạn cũ trong file này, guide thắng cho phạm vi task đó.
> Mọi thay đổi kiến trúc phải cập nhật file này.

## 1. Runtime

| Hạng mục | Quyết định |
|---|---|
| Ngôn ngữ | TypeScript, monorepo npm workspaces |
| Node | 24.x (OmniRoute bên ngoài yêu cầu Node 22.22+ hoặc 24+, không dùng Node 23) |
| DB | SQLite (`better-sqlite3`) + Drizzle. Migration chỉ sinh bằng `npx drizzle-kit generate` trong `apps/server` |
| File | `data/` (gitignored): `app.db`, `projects/<id>/`, secrets vault |
| Job | Worker trong process, hàng đợi trong SQLite. Không Redis, không broker |
| Progress | SSE + GET polling |
| UI | React + Vite + React Router + TanStack Query. Chữ UI tiếng Việt |
| Media | FFmpeg/ffprobe qua `ffmpeg-static` / `ffprobe-static` (hoặc `FFMPEG_PATH`) |
| Test | Vitest + `fastify.inject`. Không mạng, không LLM/TTS thật |
| MCP | `apps/mcp` nói HTTP với API local. Không mở SQLite |

Không dùng: microservices, Kubernetes, ORM thứ hai. Zustand chỉ thêm khi thật cần.

## 2. Repository layout

```
videoGenerator/
├── package.json                  # workspaces: packages/*, apps/*
├── docs/
│   ├── ARCHITECTURE.md           # file này
│   ├── cursor/                   # guide từng task (thứ tự trong README)
│   ├── tasks/                    # spec + report
│   └── user-guide/               # hướng dẫn tiếng Việt
├── packages/shared/src/          # zod + logic thuần, export từ index.ts (suffix .js)
│   ├── schemas/  budget/  pipeline/  features/
│   ├── edit/  formats/  motion/  render/  review/
│   ├── providerIntel/  llmQuota/  publishing/  operator/
│   └── scenes/ timeline/ subtitles/ thumbnails/ …
├── apps/server/src/
│   ├── api/                      # route Fastify, đăng ký trong app.ts
│   ├── db/                       # schema + migrate
│   ├── jobs/                     # queue, worker, SSE
│   ├── pipeline/                 # orchestrator, stale, stage timeout plan
│   ├── stages/                   # research, script, scenes, visuals, voice,
│   │                             # subtitle, music, timeline, render, clip
│   ├── services/                 # project, script, scene, visual, render, …
│   ├── providers/                # llm/, images/, tts/, music/
│   ├── review/  guidelines/  publishing/  operator/  assistant/
│   ├── providerIntel/  learning/  finance/  analytics/
│   ├── notifications/  comments/  trends/  translations/
│   ├── edit/  formats/  media/  timeline/  registry/  storage/
│   └── lib/                      # config, errors
├── apps/web/src/features/        # dashboard, projects, pipeline, script, scenes,
│                                 # visuals, voice, subtitles, music, timeline,
│                                 # render, review, profiles, publish, settings,
│                                 # operator, providers, finance, usage, help
├── apps/mcp/                     # MCP video-agent (stdio → REST)
├── provider-intelligence/        # hồ sơ nghiên cứu nhà cung cấp (file, không phải DB app)
└── data/                         # gitignored
```

Operator Cursor (TASK-047) dùng thư mục **ngoài** git root (`<data>/operator` hoặc `../.video-agent-operator`), không dùng `.cursor/` của repo này làm workspace operator.

## 3. Hybrid: agent và người dùng

Mỗi project có `mode`. Từng stage có thể override `executor` (`AGENT` | `USER`).

| Mode | Hành vi |
|---|---|
| `AUTO` | Chạy tiếp các gate khi còn được phép. `VISUAL_REVIEW` và `MUSIC_REVIEW` tự duyệt nếu không có lý do chặn (`autoBlock`: thiếu ảnh, `NEEDS_ATTENTION`, v.v.). `FINAL_APPROVAL` vẫn dừng trừ khi `autoRender`. Dừng bất ngờ thì báo attention, không coi là “chờ bạn duyệt” bình thường. |
| `ASSISTED` (mặc định) | Agent sinh, dừng ở `VISUAL_REVIEW`, `MUSIC_REVIEW`, `FINAL_APPROVAL`. |
| `MANUAL` | Chỉ chạy stage khi người dùng bấm. |

`stageExecutors.visuals = USER`: agent chỉ gợi ý query, người dùng dán URL hoặc upload. 0 token tìm ảnh.

### Cost tiers

| Tier | Ví dụ | Chi phí |
|---|---|---|
| 0 — Code | Tách scene, rank/dedupe ảnh, timeline, FFmpeg, timeout baseline, validate | Free |
| 1 — API rẻ | Image search, music search, TTS | Thấp |
| 2 — LLM text | Research, script, query, rerank text, metadata, review chat, advisor, assistant | Theo budget mode + cache |
| 3 — LLM vision | Kiểm tra ảnh, đồng nhất scene, frame sau render, chọn thumbnail | Tắt mặc định. Bật ở MAX hoặc CUSTOM |

Mỗi call ghi `usage` (task, provider, model, token, cost ước tính).

### Budget mode (theo project)

| Mode | Ý tưởng |
|---|---|
| `ECO` | Research + script gộp một call. Không review, không trợ ảnh/nhạc |
| `BALANCED` | Research và script tách. Review 1 lượt. Trợ query, rerank, mood, metadata. Repair 1 |
| `QUALITY` | Research sâu, review/polish 2 lượt, mọi trợ text, repair 2. Vision vẫn opt-in |
| `MAX` | Mọi trợ ở mức cao + fact-check, tìm ảnh rộng, vision top ảnh, đồng nhất scene, kiểm tra frame sau render. Scene dưới ngưỡng → `NEEDS_ATTENTION` |
| `CUSTOM` | Nền BALANCED + từng feature bật/tắt. Ước tính theo cấu hình |

Preset và cờ nằm ở `packages/shared/src/budget/modes.ts`. Danh sách tác vụ LLM (`LLM_TASKS`) ở `packages/shared/src/schemas/llm.ts`.

**Định tuyến:** mỗi task có `{provider, model, maxOutputTokens?, fallback?}`. Ưu tiên: project theo task → project mặc định → app theo task → app mặc định → ENV.

**Gateway OmniRoute** (chạy riêng, mặc định `http://127.0.0.1:20128/v1`): `off` | `prefer` (fallback khi mất kết nối/5xx) | `only`. Key endpoint trong `OMNIROUTE_API_KEY`. Token quản trị chỉ đọc (vault) dùng cho quota live và audit nhà cung cấp, không thay key gọi model.

**Quota:** bộ đếm local + cool-down 429; số OmniRoute (nếu có token) ghi đè ước tính. Chính sách hết hạn mức miễn phí: chờ reset, hoặc model trả phí trong trần USD/ngày.

### Quy tắc LLM

1. Việc code làm tốt thì viết code: tách câu, thời lượng, lọc trùng, timeline, render, validate.
2. LLM được gọi khi làm video tốt hơn (viết, biên tập, ngữ nghĩa, guideline, góp ý). ECO vẫn là lựa chọn tiết kiệm. Chat do người bấm được phép mọi mode và hiện chi phí từng tin.
3. UI ước tính call/token trước khi chạy. Không vượt mode một cách âm thầm.
4. Vision luôn opt-in trừ MAX/CUSTOM đã bật; vẫn có đường người duyệt ở gate.
5. Cache theo hash input + provider/model. Pre-flight theo giới hạn provider.
6. Timeout stage: một call LLM nhỏ (`stageTimeouts`) hoặc baseline code. Worker dùng plan đó, không một trần 10 phút chung.
7. Đường 0 token: người tự viết, hoặc MCP `video-agent` qua API.

## 4. Pipeline

Thứ tự chính (`STAGE_ORDER`):

```
RESEARCH → SCRIPT → SCENE_PLAN → VISUAL_SEARCH → [VISUAL_REVIEW]
        → VOICE → SUBTITLE → MUSIC_SEARCH → [MUSIC_REVIEW] → TIMELINE
        → [FINAL_APPROVAL] → RENDER
```

`[...]` là gate. `project.status`: `DRAFT | GENERATING | REVIEW | RENDERING | COMPLETED | FAILED`. Archive là `archivedAt`.

Job: `QUEUED → RUNNING → SUCCEEDED | FAILED | CANCELLED`, progress, retry backoff. Job `RUNNING` lúc restart được đưa lại `QUEUED`. Output lưu sau mỗi bước.

**Side job** (không nằm trong `STAGE_ORDER`, không đẩy stage pipeline): `PUBLISH`, `CLIP`.

Stage state: `PENDING | QUEUED | RUNNING | DONE | FAILED | STALE | WAITING_USER | SKIPPED`.

### Invalidation

Output lưu `inputHash`. Lệch hash → `STALE` từ stage đó trở đi (`markStaleFrom`).

```
topic ─► script ─► scenes ─┬─► visualQueries ─► candidates ─► selection ─┐
                           ├─► narration ─► voice ─► subtitle ──────────┤
                           └─► musicMood ─► music ──────────────────────┴─► timeline ─► render
```

Sửa narration một scene làm stale voice scene đó, subtitle, timeline, render. Đổi ảnh một scene chỉ stale selection đó, timeline, render (cache clip theo scene).

Chat review áp proposal có cấu trúc thì stage liên quan thành `STALE`. Có revision token và undo (web, Telegram, MCP).

## 5. Data model (lõi)

Schema Zod ở `packages/shared`. Cột lồng nhau là JSON trong SQLite. Chi tiết bảng: `apps/server/src/db/schema.ts`.

| Nhóm | Thực thể chính |
|---|---|
| Dự án | VideoProject (brief, mode, budget, stageExecutors, autoRender, status, stage), Script, Scene |
| Hình | VisualQuery, VisualCandidate, VisualSelection, LicenseMetadata |
| Âm thanh | VoiceTrack, SubtitleTrack (cues + word timing khi provider có), MusicTrack |
| Dựng | Timeline, edit plan, motion clips, Render output + version |
| Việc | Job + usage.calls |
| Ngoài pipeline | Profile, platform account, publication, schedule, comment, analytics snapshot, finance entry, notification, operator conversation, provider-intel rows, quota snapshot |

**Candidate và selection:** search tạo nhiều candidate. Selection trỏ một candidate. Đổi ảnh = đổi `candidateId`.

**VisualStatus:** `DISCOVERED → REVIEW_REQUIRED → APPROVED | REJECTED`; thêm `REPLACED`, `CUSTOM`, `AI_GENERATED`.

**Scene visual:** `NO_VISUAL → SEARCHING → REVIEW_REQUIRED → APPROVED → READY_FOR_RENDER`, cộng `NEEDS_ATTENTION`, `SKIPPED`.

LLM không bịa URL ảnh. License chỉ là metadata (`evidence`: `api | page_meta | user | none`). Không hard-block. Render xuất `credits.txt` khi `attributionRequired`.

## 6. Providers

| Loại | Hiện có |
|---|---|
| LLM | anthropic, gemini, openai, ollama, remote-ollama, openrouter, deepseek, groq, omniroute, opencode, custom, claude-cli, copilot-cli, antigravity-cli, mock (test) |
| Ảnh | wikimedia, openverse, pexels, pixabay, unsplash, nasa, met, loc, smithsonian, europeana, flickr. Thêm Brave + Gemini grounding + crawl khi bật web image search. Ảnh chưa rõ license không tự duyệt |
| TTS | edge-tts (mặc định), google_cloud, gemini, elevenlabs, openai, fpt_ai, viettel_ai, piper, vieneu, mock |
| Nhạc | openverse, thư viện local |

Cố vấn model, catalog OmniRoute, và scorecard provider intel chọn route. Chúng không tự ghi route hay combo OmniRoute cho đến khi người bấm.

## 7. Render và sau render

1. Edit plan (code + LLM khi bật): transition (`xfade`), emphasis, style phụ đề.
2. Mỗi scene → clip (Ken Burns / motion đã chọn, đúng duration voice). Cache theo hash.
3. Motion graphics: template HTML/GSAP (HyperFrames) → clip alpha, overlay.
4. Ghép clip, voice, nhạc (volume, fade, ducking), burn phụ đề, xuất `.srt`.
5. Biến thể khung (16:9 / 9:16 / 1:1) từ một project khi được yêu cầu.
6. Output `data/projects/<id>/renders/` + `credits.txt`. Kiểm tra ffprobe. MAX: vision frame giữa scene.
7. Thumbnail (frame + chữ), clip dọc (`CLIP`) đưa vào lịch, metadata (title, description, tags).
8. Publish: vault mã hoá, OAuth, job lịch, YouTube (dài + Shorts), TikTok, Facebook Reels, Instagram Reels, publisher mock cho test.

## 8. API (nhóm)

Lỗi: `{ "error": { "code", "message", "details" } }`.

| Nhóm | Việc |
|---|---|
| health, help | Sống, tìm hướng dẫn |
| projects, recommendations, budget, stage-timeouts | CRUD dự án, brief, ước tính, trần thời gian |
| pipeline, jobs, events | Chạy stage, duyệt gate, SSE |
| script, scenes, visuals, voice, subtitles, music, timeline, motion, render | Dữ liệu từng stage |
| review, guidelines, metadata, thumbnails, clips, auto-report | Góp ý, chính sách, xuất bản phụ |
| llm, usage | Route, gateway, quota, usage |
| profiles, automation, trends, translations | Hồ sơ, hàng đợi chủ đề, xu hướng, lồng tiếng |
| oauth, publications | Kết nối kênh, đăng, lịch |
| analytics, comments, finance, learning | Số liệu, hộp thư, doanh thu, bài học |
| notifications, assistant, operator, registry | Telegram, trợ lý, operator, tool chung |
| provider-intel | Hồ sơ nhà cung cấp, audit OmniRoute, combo (chỉ khi bấm) |

## 9. Điều khiển ngoài UI

Một registry tool (`assistant` | `mcp` | `operator` | `agent`). Nguồn `mcp` và `operator` biến việc `confirm` thành thao tác chờ. Nguồn `agent` (MCP Cursor với `VG_TOOL_SOURCE=agent`) chạy luôn các việc đó, kể cả xóa, đăng và bật lịch. Vẫn từ chối dự án được bảo vệ, đổi secret/thanh toán, bật fallback trả phí, và mọi công cụ tự duyệt thao tác chờ. MCP đăng ký tool sẵn, catalog registry, và `app_api` cho các route HTTP còn lại. `app_api` từ chối đường dẫn token, khóa TTS, khóa YouTube, app credentials và OAuth callback.

- **Web chat và Telegram:** trợ lý gọi tool, hỏi trước khi sửa/đăng/render.
- **Operator:** phiên Cursor CLI dài, không shell, chỉ MCP `video-agent` + ghi `notes/`. Handbook sinh lúc startup.
- **MCP IDE:** `.cursor/mcp.json` trong repo (nếu có) là tiện ích Cursor. Workspace operator là file riêng, chỉ một server `video-agent`.

### Hướng mở rộng cho agent vận hành

TASK-051 tách vòng đời operator khỏi Cursor CLI. Adapter Cursor hỗ trợ MCP, nối phiên, streaming và dừng. MCP của agent chạy nền chỉ công bố catalog từ registry. Runtime model dùng lịch sử cấp app và đưa lệnh native function calling hoặc lệnh từ cầu JSON qua cùng registry với quyền operator. Lượt runtime model ghi mức dùng theo mã lượt. Chọn runtime riêng cho web, Telegram và lịch chạy. API registry trả `inputSchema` đầy đủ cùng bản mô tả ngắn cho các client hiện tại.

Người dùng có hai lựa chọn độc lập. **Agent vận hành** nhận yêu cầu, lập kế hoạch, gọi công cụ và báo kết quả. **Model theo tác vụ** xử lý nội dung như nghiên cứu, viết kịch bản hoặc kiểm tra ảnh theo cấu hình và ngân sách của dự án. Ví dụ, Claude Desktop có thể vận hành qua MCP trong khi pipeline dùng model vision đã chọn cho dự án.

| Môi trường | Đường vận hành hiện có |
|---|---|
| Web và Telegram | Trợ lý tích hợp hoặc Cursor operator. Cursor operator chạy trên máy chủ app và có lệnh thường trực. |
| IDE hoặc desktop | Cursor, Claude Desktop và Copilot Chat có thể gọi MCP `video-agent` khi kết nối được với API. |
| Tác vụ nội dung | Router chọn provider/model theo task. Claude Code CLI ở chế độ provider nhận prompt để sinh nội dung. |

Khi thêm agent chạy nền, khai báo adapter theo khả năng của môi trường, gồm phát hiện runtime, mở hoặc nối phiên, nhận tiến độ và dừng. Chỉ hiện lựa chọn khả dụng và giữ lựa chọn của người dùng cho mỗi kênh. Mọi adapter chạy nền dùng cùng registry và nguồn `operator`; quyền cao hơn của MCP chủ máy phải được cấu hình riêng. Workflow và lịch chạy tiếp tục thuộc worker/SQLite. Agent đọc trạng thái job đã lưu trước khi quyết định thử lại một thao tác. Việc đăng công khai, bật lịch và thao tác có rủi ro đi theo bước duyệt của app.

Để giảm token, tra cứu skill và dữ liệu dự án liên quan trước khi đưa ngữ cảnh vào prompt. Dùng truy vấn có cấu trúc cho trạng thái, quota và lịch sử. Khi cần RAG cho tài liệu dài, chỉ lấy đoạn liên quan kèm nguồn và phạm vi hồ sơ. Ghi nhớ quyết định có thể dùng lại trong ghi chú theo phạm vi, còn checkpoint và trạng thái công việc nằm trong dữ liệu của app. Các bước cơ học chạy bằng code. Với bước cần LLM, chọn theo khả năng, chất lượng quan sát được, quota và ngân sách; dùng cache và chỉ nâng model khi bước đó cần thêm năng lực. Đo token, tỷ lệ thành công, lỗi định dạng và điểm đánh giá đầu ra trên cùng bộ mẫu trước khi đổi route mặc định.

Dùng scheduler và hook sự kiện hiện có cho tác vụ định kỳ và phản ứng theo sự kiện. Nhật ký lượt chạy, tool audit và usage cần cho phép đối chiếu agent, job, model và kết quả. Chỉ mở Computer Use cho tác vụ thực sự cần thao tác giao diện, với phạm vi và xác nhận theo loại thao tác. Phần mở rộng adapter, RAG theo hồ sơ và Computer Use là thiết kế tiếp theo.

## 10. Việc đã có sau MVP

Roadmap chi tiết và thứ tự: `docs/cursor/README.md`. File này không lặp từng TASK.

Đã có trong code, ngoài pipeline MVP (research → render):

- Guideline pack, review chat, metadata, version render, chế độ MAX, web image search, AUTO report
- Hồ sơ kênh, biến thể khung hình, publish đa nền tảng, lịch tự động
- OmniRoute gateway, cố vấn model, quota local + live
- Thông báo Telegram, trợ lý, analytics, tài chính, learning, thumbnail, clip ngắn
- Hộp bình luận, xu hướng, dịch kịch bản, nhiều TTS
- Edit plan, motion graphics, format/treatment, revision + undo
- Operator, provider intelligence, timeout theo stage
- Hướng dẫn trong app (`featureMap` + `docs/user-guide/`)

Việc còn vận hành thật (token OmniRoute, bấm áp route, phiên nghiên cứu trang nhà cung cấp) ghi ở `docs/tasks/CON-THIEU.md`, không phải lỗ hổng schema.

## 11. Công cụ ngoài (một người, máy của họ)

Một người chạy app trên máy của họ. Không có người dùng thứ hai, không bán app, không cho người khác đăng nhập. Điều kiện miễn phí của Remotion (cá nhân) và n8n Community Edition (tự host) **đã đúng với cách dùng này**. Binary FFmpeg GPL trong `ffmpeg-static` cũng vậy.

Vẫn chỉ gắn công cụ khi pipeline chưa làm được việc đó. Không thêm runtime thứ hai cho cùng một việc. License ghi theo nguồn ngày 2026-11-06.

| Công cụ | Trong app | Lý do |
|---|---|---|
| **HyperFrames** | Đã gắn (`hyperframes@0.9.14`, Apache-2.0) | Đồ họa động HTML/GSAP → clip alpha. Giữ. |
| **FFmpeg** | Đã gắn (`ffmpeg-static` GPL-3.0-or-later, gọi process) | Ken Burns, xfade, phụ đề, ducking, thumbnail. Một người chạy trên máy mình: đúng cách dùng. Không đổi bản binary hay bật codec khác. `ffprobe-static` đi cùng. |
| **Motion Canvas** | Không gắn | Cùng vai trò với HyperFrames. Hai engine đồ họa cho một app cá nhân. |
| **Remotion** | Không gắn | Điều kiện miễn phí cho một người đã đúng. Render React vẫn trùng HyperFrames + FFmpeg, nên không thêm. |
| **PySceneDetect** | Không gắn | Cắt scene đã có: timeline theo voice + `CLIP` (LLM chọn đoạn, FFmpeg cắt). Thêm Python CLI không đổi chất lượng video đang render từ ảnh. |
| **WhisperX** | Không gắn | Mốc từng từ lấy từ provider TTS khi provider có word timing. WhisperX cần GPU và model riêng. Không gọi trong test. |
| **OpenMontage** | Không gắn | Chạy riêng trên máy mình thì AGPL không bắt app này phải đổi giấy phép. Repo chính `calesthio/OpenMontage` vẫn là **AGPL-3.0** (không phải MIT). Không gộp mã vào repo này, vì app đã có pipeline riêng và repo có thể được đẩy lên Git. |
| **Postbase** | Không gắn | Self-host miễn phí nhưng cần Postgres/Supabase và API key từng mạng. App đã đăng YouTube, TikTok, Facebook Reels, Instagram Reels. Không thêm X/LinkedIn bằng một sản phẩm thứ hai. |
| **n8n** | Không gắn | Một người tự host Community Edition thì Sustainable Use License cho phép. Lịch và job đã nằm trong SQLite, nên không nhúng n8n. |
| **Mastra** | Không gắn | Trợ lý, registry tool, operator và MCP `video-agent` đã có. Core Mastra miễn phí, hạ tầng cloud của họ có thể tính phí. Không đổi framework agent. |

MCP trong repo (Cursor): `video-agent`, filesystem, fetch, git, playwright, duckduckgo-search. Xem `.cursor/mcp.json`. Không thêm MCP cho các công cụ ở bảng trên vì chúng không phải server MCP của app, và app không gọi chúng.

Khi một task mới thật sự thiếu cắt scene trên video có sẵn hoặc căn lời khi TTS không có word timing, thêm adapter tùy chọn (binary trên PATH, test giả lập, không mạng). Không thêm dependency npm cho việc đó.

### Tri thức pipeline (TASK-057)

retrieval_chunks là dữ liệu dẫn xuất theo hồ sơ (hoặc dự án không hồ sơ); retrieval_uses ghi đoạn thực dùng và retrieval_exclusions loại riêng cho một dự án. FTS5 external-content được tạo lúc chạy, đồng bộ bằng code, không trigger. Job retrieval_index độc lập pipeline, embedding tối đa 32 văn bản/call qua provider có khả năng; lỗi/quota dùng từ khoá. Ngữ cảnh được lọc lệnh, che secret và đặt trong khối untrusted_context_data trước khi hash cache. Không lập chỉ mục dự án được bảo vệ.
