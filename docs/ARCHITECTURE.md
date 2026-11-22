# AI Video Agent — Kiến trúc

> Trạng thái: **v1.0** (2026-11-21, Asia/Bangkok). Thay thế v0.2 (2026-11-06). Viết lại từ mã nguồn hiện tại (HEAD `f367f14` cộng thay đổi chưa commit). Đường dẫn, định danh và dòng code được kiểm ngày 2026-11-21. Các phần giữ từ v0.2 là §3.3, §3.5, §4.4, §6 (ngưỡng cổng), §7.2, §8.4, §9, §10, §12, §13 và §14: chỉ tên định danh được kiểm; hành vi, ngưỡng và số đo chưa chạy lại; mục chưa kiểm được ghi “chưa đối chiếu lại”.
> Kiến trúc đã làm: file này. Kiến trúc đang lên kế hoạch (chưa có trong mã): [`ARCHITECTURE-TARGET.md`](ARCHITECTURE-TARGET.md). Không coi tên trong file đó là hiện trạng.
> Hành vi người dùng: [`user-guide/`](user-guide/) và `packages/shared/src/features/featureMap.ts`.
> Thứ tự task và quy tắc agent: [`cursor/README.md`](cursor/README.md). Mỗi task có guide ở `docs/cursor/TASK-*.md` và báo cáo ở `docs/tasks/`. Khi guide của một task mâu thuẫn với file này, guide thắng cho phạm vi task đó.
> Mọi thay đổi kiến trúc phải cập nhật file này.
> Bố cục gần với arc42 và C4 (bối cảnh, container, khối, runtime, triển khai, khái niệm, quyết định, chất lượng, rủi ro). Số mục không khớp từng mục arc42.

## 1. Quyết định nền

| Hạng mục | Quyết định |
|---|---|
| Ngôn ngữ | TypeScript, monorepo npm workspaces (`packages/*`, `apps/*`) |
| Runtime | Node 22 trong Docker (`deploy/docker/Dockerfile:12,106`: `node:22-bookworm-slim`). Bản v0.2 ghi “Node 24.x”; không tìm thấy nguồn trong repo nên đã bỏ. Yêu cầu Node của OmniRoute bên ngoài chưa được kiểm trong repo |
| DB | SQLite (`better-sqlite3`) + Drizzle. Schema một file: `apps/server/src/db/schema.ts`. Migration chỉ sinh bằng `npx drizzle-kit generate` trong `apps/server` |
| File | `data/` (gitignored): `app.db`, `projects/<id>/`, vault bí mật |
| Job | Worker trong process, hàng đợi trong SQLite. Không Redis, không broker |
| Tiến độ | SSE + GET polling |
| UI | React + Vite + React Router + TanStack Query. Chữ UI tiếng Việt |
| Media | FFmpeg/ffprobe qua `ffmpeg-static` / `ffprobe-static` (hoặc `FFMPEG_PATH`) |
| Test | Vitest + `fastify.inject`. Không mạng, không LLM/TTS thật |
| MCP | `apps/mcp` nói HTTP với API local. Không mở SQLite |

Không dùng: microservices, Kubernetes, ORM thứ hai. Zustand chỉ thêm khi thật cần.

## 2. Ứng dụng và gói

```
videoGenerator/
├── package.json                    # workspaces: packages/*, apps/*
├── docs/                           # ARCHITECTURE.md (file này), cursor/, tasks/, user-guide/
├── packages/shared/src/            # zod + logic thuần, export qua index.ts (import dùng đuôi .js)
│   ├── schemas/  budget/  pipeline/  features/  script/  operator/  llm/  llmQuota/  markets/  metadata/  modelEval/  motion/
│   ├── agents/  automation/  brief/  clips/  comments/  compose/  connections/  edit/  events/  fleet/  formats/  guidelines/
│   ├── knowledge/  music/  originality/  providerIntel/  publishing/  render/  repair/  retrieval/  review/  scenes/  selfImprovement/
│   ├── style/  subtitles/  thumbnails/  timeline/  translations/  trends/  tts/  visuals/
│   ├── enums.ts  pipeline.ts  …    # JOB_STATUSES, STAGE_ORDER, GATES
├── apps/server/src/
│   ├── api/                        # route Fastify, mỗi nhóm một file, đăng ký trong app.ts (app.ts, index.ts ở gốc src)
│   ├── db/                         # schema.ts, client.ts (pragma), checkpoint.ts (WAL)
│   ├── pipeline/                   # orchestrator, invalidation, dataContract, inputVersion, stageTimeoutPlan
│   ├── jobs/                       # worker.ts, jobRepository.ts, SSE
│   ├── stages/                     # clip, music, publish, render, research, scenes, script, subtitle, timeline, visuals, voice
│   ├── services/                   # project, script, scene, visual, render (renderService.ts), …
│   ├── agents/                     # stageService.ts, stageAdapters/, toolkit theo stage
│   ├── node/                       # agent.ts (heartbeat), nodeService.ts, leaseService.ts, projectPlacement.ts
│   ├── fleet/                      # quản lý agent (service.ts), gồm loại hermes
│   ├── supervision/                # lease giám sát (leases.ts)
│   ├── registry/                   # policy.ts, invoke.ts, audit.ts: tool dùng chung
│   ├── operator/                   # workspace.ts, qualityRepair.ts, handbook
│   ├── assistant/                  # service.ts, tools.ts, telegramBridge.ts
│   ├── providers/                  # llm/ (có relay.ts), footage/, images/, music/, tts/, web/
│   ├── compose/                    # director/, render/, sceneClip.ts, planInputs
│   ├── style/  originality/        # xem §11
│   ├── review/  guidelines/  publishing/  providerIntel/  learning/  continuity/  knowledge/  research/  retrieval/
│   ├── finance/  analytics/  notifications/  comments/  trends/  translations/  reports/  missions/  settings/
│   ├── edit/  formats/  media/  timeline/  storage/  events/  auth/  lib/  cli/  help/  preview/  computerUse/
├── apps/web/src/features/          # 35 thư mục, mỗi màn hình một thư mục
├── apps/mcp/                       # MCP video-agent (stdio → REST)
├── provider-intelligence/          # hồ sơ nghiên cứu nhà cung cấp (file, không phải DB của app)
└── data/                           # gitignored
```

Workspace của operator Cursor nằm **ngoài** git root: `apps/server/src/operator/workspace.ts:33` dùng `.video-agent-operator`, không dùng `.cursor/` của repo.

## 3. Pipeline và hệ thống job

### 3.1 Thứ tự stage

`packages/shared/src/pipeline.ts:17–30` (`STAGE_ORDER`):

```
RESEARCH → SCRIPT → SCENE_PLAN → VISUAL_SEARCH → [VISUAL_REVIEW]
        → VOICE → SUBTITLE → MUSIC_SEARCH → [MUSIC_REVIEW] → TIMELINE
        → [FINAL_APPROVAL] → RENDER
```

`[...]` là gate (`GATES`, `isGate` trong cùng file). Trạng thái project và stage: xem `packages/shared/src/enums.ts` (chưa đối chiếu lại trong lần viết này).

| Mode | Hành vi |
|---|---|
| `AUTO` | Chạy tiếp các gate khi còn được phép. `VISUAL_REVIEW` và `MUSIC_REVIEW` tự duyệt nếu không có lý do chặn (`autoBlock`). `FINAL_APPROVAL` dừng trừ khi `autoRender`. Dừng bất ngờ thì báo attention |
| `ASSISTED` (mặc định) | Agent sinh, dừng ở cả ba gate |
| `MANUAL` | Chỉ chạy stage khi người dùng bấm |

Mỗi stage có thể đặt `executor` là `AGENT` hoặc `USER`. Ví dụ: `stageExecutors.visuals = USER` nghĩa là agent chỉ gợi ý truy vấn, người dùng dán URL hoặc tải ảnh lên, 0 token tìm ảnh.

### 3.2 Job

- Trạng thái job: `JOB_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]` (`packages/shared/src/enums.ts:111`).
- Side job nằm ngoài `STAGE_ORDER` và không đẩy stage pipeline: `PUBLISH`, `CLIP`.
- Worker quét định kỳ mỗi 10 giây (`apps/server/src/jobs/worker.ts:225`, `sweepTimer`): chạy hàm đăng ký qua `setSweep` (`apps/server/src/app.ts:759`), `agentStages.sweep()`, `sweepRemote()`, rồi `wake()` nếu worker cục bộ bật. Timer chỉ được tạo khi đã gọi `setSweep` (`worker.ts:214`) và không phụ thuộc `WORKER_ENABLED`.
- Chưa đối chiếu lại: retry backoff; job `RUNNING` lúc restart được đưa về `QUEUED`; output lưu sau mỗi bước.

### 3.3 Invalidation

Output lưu `inputHash`. Lệch hash thì stage đó và các stage sau thành `STALE` qua `markStaleFrom` (`apps/server/src/pipeline/invalidation.ts:4`, gọi từ `pipeline/orchestrator.ts`).

Sơ đồ phụ thuộc (từ v0.2, chưa đối chiếu lại từng cạnh):

```
topic ─► script ─► scenes ─┬─► visualQueries ─► candidates ─► selection ─┐
                           ├─► narration ─► voice ─► subtitle ──────────┤
                           └─► musicMood ─► music ──────────────────────┴─► timeline ─► render
```

Chat review áp proposal có cấu trúc thì stage liên quan thành `STALE`. Có revision token và undo (web, Telegram, MCP).

### 3.4 Lease và thời gian (đã đối chiếu)

| Thông số | Giá trị | Nơi định nghĩa |
|---|---|---|
| Lease node | `NODE_LEASE_SEC` = 60 s mặc định (khoảng 10–600) | `lib/config.ts:65`; cấp lease ở `node/leaseService.ts` |
| Ngưỡng node offline | `NODE_OFFLINE_AFTER_MS` = 45 s | `node/nodeService.ts:30`; dùng để xét node mất kết nối (`nodeService.ts:344`) |
| Heartbeat node | 15 s | `node/agent.ts:177` |
| Lease agent stage | 10 phút | `agents/stageService.ts:18` |
| Lease giám sát | 10 phút | `supervision/leases.ts:4` |
| Quét node | 10 s | `jobs/worker.ts:225` |

Lưu ý: 45 s là ngưỡng offline, không phải thời hạn lease. Bản v0.2 đã nhầm hai khái niệm này.

Timeout stage: một lời gọi LLM nhỏ hoặc baseline bằng code, lấy từ `pipeline/stageTimeoutPlan.ts`. Không dùng một trần 10 phút chung.

### 3.5 Project run và upload (TASK-135a)

Điều khiển theo run: bảng `project_runs` (fence theo node, workspace, lease, hạn), `run_checkpoints` (khử trùng kết quả có thứ tự), `run_uploads` (tái dùng lõi upload có thể tiếp tục, khóa ngoại tới run). Upload output của node lưu offset và checksum theo job và lease trong `node_uploads`. Trước side effect của stage có một claim `finalizing_at` (kiểm bằng `db/schema.ts`). Control khởi động lại thì tiếp tục finalize từ bundle đang chờ và các upload đã kiểm. Node hết hạn không làm hỏng finalize mà control đang giữ. File tạm của job đã kết thúc hết hạn sau 24 giờ.

Snapshot dùng bảng không thuộc control, đọc tiến độ, tên file theo SHA đầy đủ, và tag journal Drizzle mới nhất. Import yêu cầu DB project rỗng đã migrate và file cache đã kiểm. Khi apply checkpoint, hệ thống so input version trước khi thay các hàng do stage sở hữu, trong một transaction `IMMEDIATE`. Sự kiện stage được phát sau commit.

## 4. Dữ liệu

### 4.1 SQLite

- Pragma (`apps/server/src/db/client.ts`): `journal_mode = WAL`, `busy_timeout = 5000`, `synchronous = NORMAL`, `foreign_keys = ON`.
- `PRAGMA quick_check` lúc khởi động; hành vi khi kết quả xấu chưa đối chiếu lại.
- `WalCheckpointManager` (`db/checkpoint.ts`): kiểm dung lượng WAL định kỳ và chạy `wal_checkpoint(TRUNCATE)` khi vượt ngưỡng (chưa đối chiếu lại hằng số).
- Batching: `audit_log` và `llm_relay_usage` gộp ghi trong RAM và xả định kỳ (chi tiết §13).

### 4.2 Migration

- Thư mục `apps/server/drizzle`. Dải `0080`–`0103` là các migration chưa commit tại thời điểm viết (theo `git status`; xem `docs/tasks/TASK-080.commit-plan.md`). Migration trước đó đã nằm trong git. Ví dụ `0102_improvement_done_at.sql`, `0103_acceptance_result.sql`. Journal: `meta/_journal.json`.
- Chỉ sinh migration trong `apps/server` bằng `npx drizzle-kit generate`. Không sinh tại chỗ cho file thử nghiệm: dùng thư mục nháp.
- Migration đi cùng schema trong cùng commit.

### 4.3 Bảng chính

| Nhóm | Bảng hoặc thực thể (nguồn: `db/schema.ts`) |
|---|---|
| Dự án | VideoProject (brief, mode, budget, stageExecutors, autoRender, status, stage), `script_drafts`, Scene |
| Chạy và bước | `project_runs`, `run_checkpoints`, `run_uploads`, `node_uploads`, Job + `usage.calls`, `stage_feedback`, `stage_notes`, `stage_quality` |
| Hình | VisualQuery, VisualCandidate, VisualSelection, LicenseMetadata, `visual_query_patterns` |
| Âm thanh | VoiceTrack, SubtitleTrack (cue + word timing khi provider có), MusicTrack |
| Dựng | Timeline, edit plan, motion clips, Render output + version |
| LLM | `llm_relay_usage`, `llm_relay_grants`, `stage_prompt_variants` |
| File | `blobs`, `file_gc_marks`, `file_gc_runs`, `retrieval_chunks`, `retrieval_uses`, `retrieval_exclusions` |
| Node và fleet | `nodes`, `agent_instances` (loại `hermes` là một giá trị của `kind`) |
| Ngoài pipeline | Profile, platform account, publication, schedule, comment, analytics snapshot, finance entry, notification, operator conversation, provider-intel rows, quota snapshot |

Trạng thái visual: `VisualStatus` là `DISCOVERED → REVIEW_REQUIRED → APPROVED | REJECTED`, thêm `REPLACED`, `CUSTOM`, `AI_GENERATED`. Scene visual là `NO_VISUAL → SEARCHING → REVIEW_REQUIRED → APPROVED → READY_FOR_RENDER`, cộng `NEEDS_ATTENTION`, `SKIPPED`.

Search tạo nhiều candidate; selection trỏ tới một candidate. Đổi ảnh là đổi `candidateId`. LLM không bịa URL ảnh. License chỉ là metadata (`evidence`: `api | page_meta | user | none`), không khóa cứng. Render xuất `credits.txt` khi `attributionRequired`.

### 4.4 Vòng đời tệp

- Bảng tham chiếu được dựng từ cột tệp và JSON trong DB (`storage/references.ts`, `DbReferenceIndex`). Một lượt dọn dựng một chỉ mục, không quét lại cho từng tệp. Chỉ mục làm mới khi `PRAGMA data_version` hoặc `total_changes()` đổi, và được kiểm lại trong transaction ghi ngay trước khi gỡ tệp.
- Tệp cục bộ chỉ bị gỡ sau kiểm tra tham chiếu trong transaction SQLite và kiểm lại dấu tệp trên đĩa. `file_gc_marks` giữ dấu đường dẫn cục bộ kể cả khi project đã bị xóa. `blobs.orphaned_at/purge_after` giữ thời gian chờ của bản S3; `file_gc_runs` ghi từng lượt.
- Khi tham chiếu xuất hiện trong lúc chờ mạng, tệp cục bộ được giữ lại và bản S3 cần xác minh lại.
- Worker mặc định nhận tệp qua máy điều khiển. Khi bật S3, máy điều khiển sao lưu đầu vào bundle theo SHA-256 dưới `blobs/`. Worker kiểm hash sau khi tải và quay về route của máy điều khiển nếu hai lần tải trực tiếp thất bại.
- Worker gửi đầu ra qua URL PUT giới hạn theo lease, tên, kích thước và hash. Tệp chưa kiểm nằm trong `incoming/`, tách khỏi bản sao theo nội dung. Khóa nằm trong vault; chỉ URL ngắn hạn tới worker.

## 5. Registry, công cụ và chính sách

Tool dùng chung cho assistant, MCP, operator và agent. Mã nằm ở `apps/server/src/registry/`.

- `ToolSource = "assistant" | "mcp" | "operator" | "agent"` (`registry/policy.ts:11`).
- `AuditSource = "api" | "assistant" | "mcp" | "operator" | "system"` (`auth/auditLog.ts:12`). Nguồn `agent` được ghi thành `operator` (`registry/audit.ts:79`).
- `TOOL_GRANTS` (`packages/shared/src/schemas/autonomy.ts:98`) ánh xạ tên tool tới khóa quyền (`approveGates`, `publish`, `retries`, `providers`, …) hoặc `null`.
- `autonomyDecision` (`registry/policy.ts`, dòng 59–81): chặn cứng trước, rồi mức tự chủ `off` hoặc `assist` (cho chờ), rồi tool không có grant (chờ), rồi kiểm grant.
- `shouldCreatePending` (`registry/policy.ts`, dòng 104–132) quyết định việc tạo thao tác chờ theo thứ tự: `forcesUserPending`; `computer_act`; nếu có `autonomy` thì áp `autonomyDecision`; tool `confirm` không có khóa nào trong `TOOL_GRANTS` (`Object.hasOwn`, khóa `null` vẫn tính là có) thì chờ; khi automation đang pause (tham số `paused`, TASK-153) thì tool `confirm` từ nguồn `agent` chờ; nguồn `agent` còn lại thì chạy; `confirm` từ `mcp` hoặc `operator` thì chờ; `alwaysConfirm`; cuối cùng `autoConfirm`.
- `registry/invoke.ts:178`: với nguồn `agent` không truyền `autonomy`, nên nhánh tự chủ không chạy. Mọi lượt gọi `agent` đều được truyền `gated = true` vào `execute`.

**Đối chiếu với v0.2 (đã sửa).** v0.2 viết nguồn `agent` “chạy luôn” mọi thao tác `confirm`, kể cả xóa, đăng và bật lịch. Theo code ngày 2026-11-21, đó là quá rộng:
- `hardBlockMessage` (`registry/invoke.ts:44`) chạy trước mọi nhánh và áp cho **mọi nguồn**, kể cả `agent`. Các lượt bị chặn ghi `refused`.
- `forcesUserPending` (`registry/policy.ts:100`) đưa `delete_project`, `run_research` và việc bật tự động hóa vào chờ người dùng, với mọi nguồn.
- Nguồn `agent`: không có `autonomy` (`invoke.ts:178`), nên nhánh tự chủ không chạy. Tool `confirm` không có khóa trong `TOOL_GRANTS` thì chờ. Tool có khóa, như `publish_project` (grant `publish`), thì **chạy trực tiếp** với `gated = true`, không qua mức tự chủ của người dùng; riêng khi automation đang pause thì các tool `confirm` này chờ người dùng (TASK-153, test `apps/server/test/registry.test.ts`).

Tool có khóa `null` trong `TOOL_GRANTS` (chú thích trong code: “Null requires human review even with every grant”) có hai nhánh:
- Nguồn không phải `agent`: `autonomyDecision` không có grant nên trả `pending`. Đúng với chú thích.
- Nguồn `agent` không có `autonomy`, và khóa `null` vẫn qua `hasOwn`, nên tool `confirm` có khóa `null` **chạy trực tiếp** với `gated = true`, trừ khi `hardBlockMessage` chặn hoặc automation đang pause (khi đó chờ người dùng, TASK-153). Nhóm `null` này gồm 18 tool (đã đọc `risk` trong các file định nghĩa): `add_revenue_entry`, `make_shorts`, `make_translation`, `apply_review_proposal`, `undo_timeline_edit`, `update_stage_timeouts`, `crop_scene_images`, `dedupe_scene_visuals`, `switch_script_hook`, `rescore_script`, `set_node_drain`, `decide_stage_note`, `propose_knowledge_change`, `import_knowledge`, `resolve_change_event`, `report_change`, `set_style_pack`, `mark_change_reviewed` (`providerIntel/toolDefs.ts:161`).

Phạm vi đầy đủ rộng hơn nhóm `null`: mọi tool `confirm` có khóa bất kỳ trong `TOOL_GRANTS` (kể cả `publish_project` với grant `publish`) đều đi cùng nhánh này, trừ các ngoại lệ `forcesUserPending` (`delete_project`, `run_research`, bật tự động hóa) và `computer_act`. Phần có khóa không `null` chưa được đếm đầy đủ.

Chưa đối chiếu hết: hành vi trong một số hàm `execute` đổi theo `gated` (`assistant/tools.ts:985, 998, 1038, 1138`; hai dòng 998 và 1038 chỉ áp cho bước `SCRIPT` và `RENDER`). `research/toolDefs.ts:26` chỉ đổi cờ `manual` (`!ctx.gated && !ctx.autonomyRun`); `run_research` vẫn bị `forcesUserPending` chờ. Vì vậy “chạy trực tiếp” không đồng nhất cho mọi tool. `decide_stage_note` có tên trong `auth/toolActions.ts:61` và `supervision/leases.ts:53`; cách hai chỗ này áp lên lượt `agent` chưa đối chiếu. `propose_stage_note` có `risk: "safe"`, không ảnh hưởng.

Khóa `locked` (`invoke.ts:177`, `agentMayChange` ở `operator/autopilot.ts:274`) làm thao tác chờ với mọi nguồn, kể cả `agent`, khi người dùng vừa chạm khóa cài đặt đó trong 24 giờ (`needsPending = locked || shouldCreatePending(...)`).

Vì vậy, khi agent gọi (nguồn lấy từ header `x-vg-tool-source` do client gửi, `api/registry.ts:25–26`), các tool `confirm` nói trên chạy được khi không bị `hardBlockMessage`, `forcesUserPending`, khóa `locked` chặn, và automation không đang pause (khi pause, chúng chờ người dùng: TASK-153). Đường tiếp cận này (ai có thể đặt header đó) cần đối chiếu với lớp xác thực, chưa làm trong tài liệu này. Đây có phải thiết kế mong muốn hay không là quyết định sản phẩm, tài liệu này không tự kết luận.

## 6. Điều khiển từ ngoài UI

- **Assistant (web và Telegram):** `apps/server/src/assistant/` (`service.ts`, `tools.ts`, `telegramBridge.ts`). Trợ lý gọi tool và hỏi trước khi sửa, đăng hoặc render.
- **MCP `video-agent`:** `apps/mcp` (stdio → REST, không mở SQLite). Biến `VG_TOOL_SOURCE` trong `apps/mcp/src/tools.ts` và `apiClient.ts` chọn nguồn. Với `VG_TOOL_SOURCE=agent`, các tool `confirm` đi theo §5. Đồng bộ phía MCP qua `apps/mcp/src/sync.ts` (lệnh `vg-hermes-sync`).
- **Operator:** `apps/server/src/operator/`. Phiên Cursor CLI dài, không có shell, chỉ MCP `video-agent` và ghi `notes/`. Workspace nằm ngoài git root (`workspace.ts:33`). Handbook sinh lúc khởi động (chưa đối chiếu lại).
- **Hermes:** một loại agent trong fleet, không phải module. Mã nằm ở `apps/server/src/fleet/service.ts`; route cài đặt là `/api/settings/hermes-fleet` (`api/fleet.ts`). Đồng bộ qua `vg-hermes-sync` (cũng xuất hiện trong `fleet/service.ts`). Bảng `agent_instances` lưu instance theo `kind`.
- **Adapter giao stage cho agent ngoài (TASK-147):** `apps/server/src/agents/stageAdapters/`. Chỉ `VISUAL_SEARCH` giữ `app_then_agent`; các stage khác mặc định là `app`. Người dùng bật từng stage theo kênh hoặc dự án. Cổng chất lượng của app luôn chạy cho agent, không tắt được. Nếu agent lỗi, app giữ việc để chạy lại cục bộ hoặc chuyển cho agent khác.

| Stage | Vai trò agent | Cổng của app (tóm tắt) |
|---|---|---|
| `VISUAL_SEARCH` | `visual_scout` | Kiểm ảnh theo luồng visual hiện có |
| `RESEARCH` | `research_scout` | ≥ 6 `keyFacts`; ≥ 60% fact có nguồn; nguồn http(s) không trỏ máy nội bộ; notes khớp `input_hash` |
| `MUSIC_SEARCH` | `music_scout` | Giấy phép thương mại; tối đa 8 bản nhạc mỗi job; app tự tải và đo thời lượng |
| `SCRIPT` | `script_writer` | Lint (chỉ ghi chú); critic; kiểm sự thật. Giữ khi tổng điểm dưới 60, độ chính xác dưới 3, hoặc có fact chặn. Tối đa 2 lần nộp lại |

Vì sao app giữ cổng: cổng không đọc lời tự khai của agent. Nó kiểm lại nội dung đã lưu, lease và đầu vào hiện tại.

### Hybrid: agent và người dùng

Chưa đối chiếu lại (từ v0.2 mục 3). Mỗi project có `mode`; từng stage có thể override `executor` (`AGENT` | `USER`).

| Mode | Hành vi |
|---|---|
| `AUTO` | Chạy tiếp các gate khi còn được phép. `VISUAL_REVIEW` và `MUSIC_REVIEW` tự duyệt nếu không có lý do chặn (`autoBlock`: thiếu ảnh, `NEEDS_ATTENTION`, v.v.). `FINAL_APPROVAL` vẫn dừng trừ khi `autoRender`. |
| `ASSISTED` (mặc định) | Agent sinh, dừng ở `VISUAL_REVIEW`, `MUSIC_REVIEW`, `FINAL_APPROVAL`. |
| `MANUAL` | Chỉ chạy stage khi người dùng bấm. |

Ví dụ: `stageExecutors.visuals = USER` nghĩa là agent chỉ gợi ý query, người dùng dán URL hoặc tải ảnh lên, và không tốn token tìm ảnh.

### API (nhóm route)

Route nằm trong `apps/server/src/api/`, chia theo file. Danh sách dưới đây là 66 file `.ts` trực tiếp trong `api/` (kiểm ngày 2026-11-21), xếp theo miền để đọc. Lỗi trả dạng `{ "error": { "code", "message", "details" } }` (từ v0.2, chưa kiểm lại). Chưa đối chiếu trong bản này: đường dẫn URL của từng route và việc từng file có được đăng ký trong `app.ts`. v0.2 nêu nhóm `jobs` và `events (SSE)`, nhưng không có file `jobs.ts` hay `events.ts` trong danh sách, nên chưa biết route nằm ở file nào. Chi tiết đọc từ mã nguồn.

- **Dự án và pipeline:** `projects`, `pipeline`, `budget`, `stageTimeouts`, `overdue`, `missions`, `dashboard`, `timeline`.
- **Dữ liệu từng stage và nội dung:** `script`, `scenes`, `visuals`, `voice`, `subtitles`, `music`, `motion`, `render`, `preview`, `clips`, `thumbnails`, `originality`, `style`, `retrieval`, `knowledge`, `resources`, `recommendations`.
- **Review và metadata:** `review`, `guidelines`, `metadata`, `comments`, `promptVariants`, `stageLessons`, `skillReports`, `autoReport`, `capabilityProbe`.
- **LLM, cài đặt và hệ thống:** `llm`, `llmRelay`, `usage`, `connections`, `ttsSettings`, `webImageSettings`, `imageSourcesSettings`, `storageSettings`, `adminDbStats`, `health`, `help`.
- **Hồ sơ, tự động hóa và kênh ra:** `profiles`, `automation`, `autonomy`, `trends`, `translations`, `publications`, `oauth`, `webhooks`, `notifications`.
- **Agent, fleet và vận hành:** `agentStages`, `agentEvents`, `fleet`, `nodes`, `assistant`, `operator`, `registry`, `providerIntel`, `research`.
- **Phân tích, tài chính và học tập:** `analytics`, `finance`, `learning`.

## 7. Node, worker và cổng LLM

### 7.1 Node

Worker chạy trên máy khác (`node/agent.ts`). Heartbeat mỗi 15 giây; payload không đổi được gộp trong RAM, chỉ ghi `UPDATE nodes` khi có thay đổi trạng thái hoặc phiên bản. Node mất kết nối sau 45 giây (§3.4). Thẻ placement của project nằm ở `node/projectPlacement.ts`.

### 7.2 Cổng LLM (relay, TASK-136)

Chỉ máy điều khiển giữ `OMNIROUTE_API_KEY`. Các máy khác (agent Hermes, scout, operator, node) gọi LLM qua relay tương thích OpenAI:

- Route: `/api/llm/relay/v1/{chat/completions,embeddings,models}` (`apps/server/src/api/llmRelay.ts`). Route quản trị là `/api/llm/relay-admin/*`.
- Khóa của người gọi: khóa agent có hồ sơ (`agent:<loại>/<tên>`) hoặc token node `vgn_…` (`node:<id>`).
- Relay chỉ gửi header an toàn (content-type, accept, khóa máy chủ), bỏ auth, cookie và `x-*` của người gọi, và che khóa máy chủ trong mọi phản hồi kể cả luồng SSE qua ranh giới chunk.
- Mỗi lời gọi qua `preflight` theo thứ tự: bật/tắt, model được phép, rpm/tpm trượt 60 giây, trần USD/ngày, rồi trạng thái quota dùng chung.
- Từ chối là lỗi kiểu OpenAI: `RELAY_DISABLED`, `RELAY_MODEL_NOT_ALLOWED`, `RELAY_RATE_LIMITED`, `RELAY_BUDGET_EXCEEDED`, kèm `retry-after`. Các lần này được ghi vào `llm_relay_usage`.
- Giới hạn nằm ở `llm_relay_grants` (hàng `*` là mặc định).
- Header `x-vg-job-id` chỉ được tính khi job đang `RUNNING` và được giao đúng cho người gọi. Khi đó chi phí đi qua `orchestrator.recordUsage` nên trang Chi phí chỉ đếm một lần.
- Khóa LLM (`llm:*`) không còn được node mượn. Cài mới mặc định gateway ở chế độ `only`.

## 8. LLM, ngân sách và chi phí

### 8.1 Tầng chi phí

| Tầng | Ví dụ | Chi phí |
|---|---|---|
| 0 — Code | Tách scene, rank/dedupe ảnh, timeline, FFmpeg, timeout, validate | Miễn phí |
| 1 — API rẻ | Tìm ảnh, tìm nhạc, TTS | Thấp |
| 2 — LLM text | Research, script, query, rerank, metadata, review chat, advisor, assistant | Theo budget mode và cache |
| 3 — LLM vision | Kiểm ảnh, đồng nhất scene, frame sau render, chọn thumbnail | Tắt mặc định, bật ở MAX hoặc CUSTOM |

Mỗi lời gọi ghi `usage` (task, provider, model, token, chi phí ước tính).

### 8.2 Budget mode (theo project)

Preset và cờ ở `packages/shared/src/budget/modes.ts`. Danh sách tác vụ LLM (`LLM_TASKS`) ở `packages/shared/src/schemas/llm.ts`.

| Mode | Ý tưởng (tóm tắt, chi tiết trong `modes.ts`) |
|---|---|
| `ECO` | Research và script gộp một lời gọi. Không review, không trợ ảnh/nhạc |
| `BALANCED` | Research và script tách. Review một lượt. Có trợ query, rerank, metadata, repair một lượt |
| `QUALITY` | Research sâu, review hai lượt, mọi trợ text, repair hai lượt. Vision vẫn opt-in |
| `MAX` | Mọi trợ ở mức cao, fact-check, tìm ảnh rộng, vision top ảnh, kiểm frame sau render. Scene dưới ngưỡng thành `NEEDS_ATTENTION` |
| `CUSTOM` | Nền BALANCED, từng cờ bật/tắt |

**Định tuyến:** mỗi task có `{provider, model, maxOutputTokens?, fallback?}`. Ưu tiên: project theo task → project mặc định → app theo task → app mặc định → ENV.

**Gateway OmniRoute:** chạy riêng, mặc định `http://127.0.0.1:20128/v1`. Chế độ `off` | `prefer` | `only`. Khóa endpoint trong `OMNIROUTE_API_KEY`. Token quản trị chỉ đọc dùng cho quota live và audit nhà cung cấp; không thay khóa gọi model.

**Quota:** bộ đếm cục bộ và cool-down khi 429. Số của OmniRoute (nếu có token) ghi đè ước tính.

### 8.3 Quy tắc LLM

1. Việc code làm tốt thì viết code: tách câu, thời lượng, lọc trùng, timeline, render, validate.
2. LLM được gọi khi làm video tốt hơn (viết, biên tập, ngữ nghĩa, guideline, góp ý). ECO vẫn là lựa chọn tiết kiệm. Chat do người bấm được phép mọi mode và hiện chi phí từng tin.
3. UI ước tính call và token trước khi chạy. Không vượt mode một cách âm thầm.
4. Vision luôn opt-in trừ MAX/CUSTOM đã bật; vẫn có đường người duyệt ở gate.
5. Cache theo hash input + provider/model. Pre-flight theo giới hạn provider.
6. Timeout stage theo `stageTimeouts` hoặc baseline code.
7. Đường 0 token: người tự viết, hoặc MCP `video-agent` qua API.

Cố vấn model, catalog OmniRoute và scorecard provider intel chỉ chọn route. Chúng không tự ghi route hay combo cho đến khi người bấm.

### 8.4 Provider

| Loại | Hiện có (theo v0.2, chưa đối chiếu lại đầy đủ) |
|---|---|
| LLM | anthropic, gemini, openai, ollama, remote-ollama, openrouter, deepseek, groq, omniroute, opencode, custom, claude-cli, copilot-cli, antigravity-cli, mock (test) |
| Ảnh | wikimedia, openverse, pexels, pixabay, unsplash, nasa, met, loc, smithsonian, europeana, flickr; Brave và crawl khi bật web image search. Ảnh chưa rõ license không tự duyệt |
| TTS | edge-tts (mặc định), google_cloud, gemini, elevenlabs, openai, fpt_ai, viettel_ai, piper, vieneu, mock |
| Nhạc | openverse, thư viện local |

## 9. Chất lượng, học và sửa

### 9.1 Kịch bản

- **Kể chuyện và lint (TASK-144):** `stages/script/narrationRules.ts` giữ bộ quy tắc và `WRITER_SYSTEM`. `packages/shared/src/script/lint.ts` chạy `lintNarration(script, recipe, language)` thuần mã, ngưỡng ở `NARRATION_LINT_THRESHOLDS`. Finding còn sót cuối cùng ghi vào `review_notes` với tiền tố `[lint]`, kể cả khi tắt review (không thêm lời gọi LLM).
- **Story Engine (TASK-145):** `stages/script/storyEngine.ts`, bật theo feature budget `storyEngine` (`off` | `lite` | `full`; ECO mặc định `off`, BALANCED `lite`, QUALITY và MAX `full`). Luồng: dàn ý và hook → chọn hook (tránh lặp chiến thuật của kênh) → viết → critic chấm sáu tiêu chí → sửa đúng phần lỗi → vừa độ dài. Bản nháp lưu ở `script_drafts`; API và MCP có `get_script_draft`, `switch_script_hook`, `rescore_script`.

### 9.2 Liền mạch hình ảnh (TASK-141)

- `buildContinuityPlan` chạy sau `SCENE_PLAN`: bảng màu, nhân vật lặp lại, nhịp cắt, mô-típ (tối đa 3). Kế hoạch lưu trong `visual_queries` của cảnh `order === 0` (không cần migration), nên sửa kế hoạch làm stale bước tìm ảnh.
- Lựa chọn ảnh cộng điểm liên tục theo khoảng cách Lab và nhịp. Điểm này nhân với `weight` và không bao giờ vượt cổng hay lựa chọn thủ công.
- `checkContinuity` chạy trước `VISUAL_REVIEW`: bước nhảy màu, lệch nhịp, thiếu tag mô-típ, và (nếu cấu hình) kiểm nhất quán nhân vật qua vision.
- Sửa liền mạch: `operator/qualityRepair.ts` (`repairStep`, `diagnose`). `color_jump` đi tới `pick_next_candidate`; `motif_missing` đi tới `research_scene` rồi `pick_next_candidate`. `pacing` và `character_mismatch` không có hành động tự động. Giới hạn đã chấp nhận: thang theo loại, nên cặp lệch màu thứ hai trong cùng cửa sổ không được thử.

### 9.3 Học theo bước (TASK-148)

- **Phản hồi:** `stage_feedback` ghi mỗi lần người dùng sửa kịch bản, sửa lời dẫn hoặc duyệt có chỉnh sửa (`learning/stageFeedback.ts`). Ghi best-effort, không làm hỏng thao tác của người dùng.
- **Bài học:** `stage_notes` có trạng thái `proposed`, `approved`, `rejected`, `retired`. `distillStageFeedback` và `recordStageNotes` chỉ đề xuất. Chỉ `decideStageNote` từ API người dùng mới duyệt. Ghi chú đã duyệt đi vào prompt của RESEARCH và SCRIPT qua `getProfilePromptContext`.
- **Quyền:** `POST /api/profiles/:id/stage-notes/:noteId/decision` cần `project.write`; khóa API của agent bị từ chối (`AGENT_CANNOT_DECIDE`).
- **Sổ chất lượng:** `stage_quality` có một dòng cho mỗi lần chạy stage không phải side job. `orchestrator.completeJob` gọi `recordStageQuality` (`learning/stageQuality.ts`), rồi `checkStageQualityAlerts`. Metric hiện chỉ có `quality_score` của SCRIPT.
- **Cảnh báo:** escalation `stage_quality_drop` mở khi điểm giảm trên 20% với ít nhất 5 lần chạy, so 14 ngày với 14 ngày trước. Mỗi tuần một cảnh báo cho mỗi bước. Cảnh báo chuyển cho người dùng, không đổi prompt, model hay cài đặt.
- **Mẫu truy vấn ảnh (148d):** `visual_query_patterns`, `learning/queryPatterns.ts`. `queryHints` tối đa 5 truy vấn; chỉ gợi ý, không đổi kết quả đã chọn. Gợi ý chỉ theo kênh của dự án.
- **Biến thể prompt (148e):** `stage_prompt_variants`, `learning/promptVariants.ts`. Đăng ký và duyệt đều chặn khóa agent. Chỉ biến thể `active` được nối vào quy tắc của hồ sơ trong `scriptExecutor.ts`. `variantTrialRunner.ts` chạy thử mù qua giám khảo được tiêm vào; khuyến nghị chỉ khi có ít nhất 10 lần thử và tỷ lệ thắng từ 0,6. Chưa có giao diện và chưa nối judge thật.
- **Giới hạn đã biết:** critic của TASK-145 chưa được chấp nhận làm nguồn điểm; quality chỉ lấy `script_drafts.critique`. Xem trước prompt có thể tăng `uses` của ghi chú (tác dụng phụ đã biết).

### 9.4 Mẫu TASK-121: agent tự sửa lỗi chất lượng

Mẫu này áp dụng cho lỗi chất lượng ở gate. Lỗi không còn bị đẩy về người dùng nếu agent có quyền sửa.

Nguyên tắc: code giữ sự thật (đo, kiểm, giới hạn), agent chọn hành động trong giới hạn của grant.

- `approve_gate` kết thúc gate đã thất bại bằng vòng sửa trong code, khi profile có grant `retries`.
- Các chế độ `off` và `assist` giữ đường cũ `recordHeld`.
- Gate, ngưỡng và giới hạn cứng không đổi. Dự án được bảo vệ bị từ chối.
- Chi tiết: [`cursor/TASK-121.md`](cursor/TASK-121.md) và [`tasks/TASK-121.report.md`](tasks/TASK-121.report.md).

### 9.5 Tri thức pipeline (TASK-057)

Chưa đối chiếu lại (từ v0.2 mục 11). Đã kiểm trong code: embedding gửi tối đa 32 văn bản mỗi lần gọi (`apps/server/src/retrieval/embeddings.ts:49`, `indexer.ts:159`); đoạn tri thức đưa vào prompt nằm trong khối `<kien_thuc_kenh untrusted="true">` với `contentType: "untrusted_context_data"` (`retrieval/context.ts:29`). Các bảng `retrieval_chunks`, `retrieval_uses`, `retrieval_exclusions`, job `retrieval_index`, dự phòng từ khóa khi lỗi hay hết quota, và quy tắc không lập chỉ mục dự án được bảo vệ chưa đối chiếu lại.

### 9.6 Cổng duyệt dàn ý (TASK-146)

- **Cài đặt:** `scriptOutlineApproval` = `off` | `outline` | `script`, mặc định `off` (`packages/shared/src/schemas/project.ts`). Có trên form dự án. Mặc định theo kênh nằm trong `ProfileDefaultBriefSchema` và chỉ đi qua API; trang hồ sơ chưa có ô chọn. Đổi cài đặt là đầu vào lúc chạy (`runtimeSettings` trong `apps/server/src/pipeline/inputVersion.ts`), nên không làm SCRIPT đã xong thành cũ. `BriefSettings` không có trường này; brief không có ô chọn.
- **Cổng `SCRIPT_REVIEW`:** nằm sau SCRIPT và trước SCENE_PLAN trong `STAGE_ORDER` và `GATES`. Với `off`, `scriptReviewAutoPasses` trả đúng và orchestrator đánh dấu cổng đạt kèm ghi chú hệ thống, không chờ, không thông báo (`orchestrator.ts`, nhánh `SCRIPT_REVIEW`).
- **Mức `outline`:** `scriptExecutor` dừng sau dàn ý và hook. Bản nháp ở `script_drafts.phase = outline_ready`; SCRIPT vào `WAITING_USER`. `orchestrator.approveOutline` đặt phase `outline_approved` rồi đưa SCRIPT về PENDING để viết lời dẫn. Khi viết xong, `finishApprovedOutline` đặt phase `done` và `passScriptReviewAfterOutline` đánh dấu `SCRIPT_REVIEW` đạt.
- **Mức `script`:** SCRIPT chạy đủ rồi cổng chờ người duyệt, cùng API và thông báo với các cổng khác.
- **Khoá khi chờ duyệt:** khi phase là `outline_ready` hoặc `outline_approved`, đổi hook (`switchHook`) và chấm lại (`rescoreCritique`) bị từ chối bằng `OUTLINE_PENDING`, kiểm lại bên trong giao dịch. Nếu lượt gọi LLM đã trả tiền mà kết quả bị bỏ, app ghi một job FAILED kèm usage của lượt đã trả tiền (TASK-145; `llmCalls` là 1 khi có usage).
- **Chạy lại SCRIPT khi chờ duyệt:** `orchestrator.runStage` từ chối SCRIPT ở `WAITING_USER` với phase `outline_ready` bằng 409 `SCRIPT_OUTLINE_PENDING`, trừ khi có `confirmOverwrite`. API truyền cờ này; web hỏi xác nhận rồi gửi lại. Tác nhân và sửa kịch bản không truyền cờ. Chưa kiểm thử. Chạy lại RESEARCH khi đang chờ duyệt chưa bị chặn (xem báo cáo TASK-146). Nếu lượt gọi LLM đã trả tiền mà kết quả bị bỏ, app ghi một job FAILED kèm usage của lượt đã trả tiền (TASK-145; `llmCalls` là 1 khi có usage).
- **Phạm vi duyệt:** duyệt dàn ý là `approve_gate` với `gate: "SCRIPT"` (web `ScriptTab.tsx` gửi `pipeline.action({ type: "approve", stage: "SCRIPT" })`; `orchestrator.approveGate` chuyển SCRIPT sang `approveOutline`). Chỉ hợp lệ khi SCRIPT ở `WAITING_USER` và phase là `outline_ready`; nếu không, báo lỗi. Trước TASK-146, `GATES` không có `SCRIPT`, nên duyệt SCRIPT qua `approveGate` đã luôn lỗi; sau TASK-146 vẫn lỗi, chỉ đổi thông báo (xem báo cáo TASK-146). Ở mức `script`, cổng cần duyệt là `SCRIPT_REVIEW`. Trong lúc chờ dàn ý, quy tắc sửa chất lượng và giữ cổng kịch bản bị bỏ qua (`pipelineActions.ts`, biến `outlineWaiting`). Gate không chạy trên dự án được bảo vệ.
- **Agent:** agent không có tool nộp dàn ý (`script_submit_outline` chưa có). Việc duyệt cổng là của người dùng.
- **Web:** `StageStepper.tsx` có nhãn "Duyệt kịch bản" cho `SCRIPT_REVIEW`. `ScriptTab.tsx` có nút "Duyệt kịch bản" gửi `approve` cho stage `SCRIPT_REVIEW` khi cổng đang chờ. `PipelinePanel` (chỉ ở tab tổng quan) có nút Approve chung cho cùng stage. Chưa kiểm thử, chưa chạy.
- **Sửa dàn ý khi chờ duyệt:** `ScriptService.editOutline` và `POST /api/projects/:id/script/outline` (`apps/server/src/api/script.ts`) cho sửa câu hỏi trung tâm và khoảnh khắc cụ thể của từng nhịp. Chỉ được khi SCRIPT ở `WAITING_USER`, phase `outline_ready`, không có job đang chạy; ngoài ra trả 409 `INVALID_PIPELINE_STATE`. Nhịp không tồn tại trả 404 `BEAT_NOT_FOUND` trước khi ghi. Dàn ý sửa đổi làm đổi khoá cache khi viết lại (`scriptExecutor.ts`). Không chạy lại hook và không mở lại dàn ý đã duyệt. Web: `ScriptDraftPanel.tsx`. Chưa kiểm thử.
- **Kiểm thử:** quy tắc không chạy test có hiệu lực từ 2026-11-22. Lần chạy duy nhất được phép, cùng ngày: bốn bộ kiểm thử (shared, server, MCP, web) đều đạt; typecheck gốc đạt sau `c5014a5`. Suite server chạy trước `c5014a5`; sau đó chỉ chạy lại `tsc` của server. **Chưa kiểm thử:** `1137c54` và `5e73cac` (sửa dàn ý); ba file test sửa dàn ý chưa chạy. Xem `docs/tasks/TASK-146.report.md`.

### 9.7 Nhịp kể, chuyển động và nhạc (TASK-146, các lát 1–5)

- **Nhịp trên cảnh:** `beatPurpose`, `emotion`, `visualIntent`, `factIds` được sao chép khi lập cảnh (`packages/shared/src/scenes/planScenes.ts`, `beatFields`). Cảnh đầu tiên của mỗi phần dẫn bằng `visualIntent` trong truy vấn ảnh. Kiểm tra thị giác và khoá kết quả (`visualVerdict`) cũng đọc nhịp (`apps/server/src/timeline/sceneBeats.ts`). Bản dịch lấy nhịp từ kịch bản gốc (`translationService`).
- **Chuyển động theo nhịp:** `BEAT_MOTION` và `applyBeatMotion` (`packages/shared/src/motion/beatMotion.ts`) được gọi trong `packages/shared/src/edit/plan.ts`. Cảnh đầu mỗi nhịp đổi sang chuyển động của nhịp, trừ khi trùng pan cùng chiều với cảnh liền kề hoặc punch_in quá gần (`strongMoveEverySec`). Cảnh mà LLM đã chọn chuyển động thì giữ nguyên. `COMPOSE_RENDER_VERSION` là 3 (`packages/shared/src/compose/schema.ts`).
- **Chưa có:** hệ số tốc độ theo cảm xúc (spec `docs/cursor/TASK-146.md` dòng 65). `applyBeatMotion` và `presetMotion` không nhận cảm xúc; `BeatScene` trong `edit/plan.ts` không có trường cảm xúc; preset được dựng ở hai nơi (`compose/render/still.ts`, `preview/shotRenderer.ts`), nên đổi một chỗ sẽ làm preview lệch render. Tốc độ thật cần thiết kế easing hoặc số frame, và chỉ kiểm được bằng render.

Bảng `BEAT_MOTION` (đúng như mã trong `beatMotion.ts`):

| Nhịp | Chuyển động |
|---|---|
| hook | punch_in |
| setup | pan_right |
| tension | push_in |
| reveal | punch_in |
| evidence | push_in |
| explanation | static |
| payoff | pull_out |
| reflection | pull_out |
| transition | null (giữ vòng chuyển động) |
| cta | static |

Lệch so với spec TASK-146 (§3): `evidence` không có highlight hay chú thích đồ họa; `reveal` không có cắt cứng hay kiểm soát dissolve; `payoff` kéo ra ngay, không giữ trước; `reflection` không có dissolve hay cảnh dài hơn; `transition` là null thay vì theo preset; `tension` chưa rút ngắn cảnh về cuối nhịp; chưa có hệ số tốc độ theo cảm xúc. Tương tác với bảng `FREQUENCY` chưa được kiểm.
- **Đường nhạc theo nhịp:** `musicCurveExpr` (`packages/shared/src/render/plan.ts`) tạo đường âm lượng theo nhịp: giảm dưới `tension` và `reflection`, hạ nhẹ trước `reveal`, nâng ở `payoff`. Đường này nhân thêm với ducking giọng. Mặc định vẫn là một bản nhạc.
- **Chưa nối:** `musicSegments` (`packages/shared/src/music/segments.ts`) là hàm thuần, chưa có lời gọi trong pipeline. Vì vậy chưa có truy vấn nhạc theo từng đoạn cho chế độ nhiều bản nhạc.
- **Chưa làm (lát 4):** director chưa nhận nhịp hay lý do override. `compose/director` không có tham chiếu nhịp. Spec ghi "chờ TASK-141", nhưng TASK-141 đã có `.done`; xem báo cáo để quyết định.

## 10. Render và sau render

- Xem trước nhanh dùng cùng timeline, compose plan, template và biến GSAP ở độ phân giải thấp. Chromium lấy khung đúng thời điểm của shot; FFmpeg xử lý footage, ảnh tĩnh, ghép sheet và encode đoạn tối đa ba giây. Cache lưu facts cùng sidecar đo chữ.
- Kế hoạch dựng đã lưu (`render/compose-plan.json`) chỉ được preview tái dùng khi sidecar `render/compose-plan.inputs.json` khớp fingerprint của đầu vào. Fingerprint do `compose/planInputs.ts` tính. Thiếu sidecar, sai version hoặc JSON hỏng thì preview dựng lại tạm. Sửa shot chỉnh tay không ghi sidecar.
- Render chạy trong `services/renderService.ts` (không phải `apps/server/src/renderService.ts`).
- Chuỗi render (theo v0.2, chưa đối chiếu lại từng bước): edit plan → clip cho từng scene (cache theo hash) → motion graphics (HyperFrames) → ghép clip, voice, nhạc, phụ đề, `.srt` → biến thể khung hình khi được yêu cầu → output `data/projects/<id>/renders/` cùng `credits.txt`, kiểm ffprobe → thumbnail, clip dọc (`CLIP`), metadata → publish.

## 11. Phong cách và độc đáo nội dung

- **Phong cách (`apps/server/src/style/`):** `service.ts`, `designer.ts`, `frames.ts`, `preview.ts`, `toolDefs.ts`; API ở `api/style.ts`. Tool `set_style_pack` có khóa `null` trong `TOOL_GRANTS`, vì diện mạo kênh là quyết định của người dùng. Với nguồn `agent`, tool này thuộc nhóm `confirm` có khóa `null` nên chạy trực tiếp khi không bị chặn (§5); đó là điểm cần quyết định.
- **Độc đáo (`apps/server/src/originality/`):** `service.ts`, `manifest.ts`, `recheckSafely.ts`; API ở `api/originality.ts`. Kiểu `SourceManifest` và `OriginalityReport` nằm trong `@vg/shared`. Manifest ghi nguồn của từng tài sản (nhà cung cấp, URL nguồn, license, `phash`).
- Chi tiết thuật toán và ngưỡng: xem guide của task tương ứng qua [`cursor/README.md`](cursor/README.md). Tài liệu này không lặp lại.

## 12. Phân tích, đăng bài, tài chính và thông báo

- **Phân tích (`analytics/`):** `overview.ts`, `registry.ts`, `syncService.ts`, và bộ lấy số liệu theo nền tảng (`facebookFetcher.ts`, `instagramFetcher.ts`, `tiktokFetcher.ts`, …). Số liệu lưu thành snapshot.
- **Đăng bài (`publishing/`):** `guardrail.ts`, `appCredentialValidation.ts`, `envAppCredentials.ts`, và publisher cho Facebook Reels và Instagram Reels. Thứ tự nền tảng: YouTube (dài và Shorts), TikTok, Facebook Reels, Instagram Reels. Token OAuth nằm trong vault mã hóa. Publisher mock dùng cho test.
- **Tài chính (`finance/`):** `financeService.ts`, `csvImport.ts`, `profit.ts`, `youtubeRevenue.ts`, `currencySettings.ts`.
- **Thông báo, bình luận, xu hướng, dịch:** `notifications/`, `comments/`, `trends/`, `translations/`. Thông báo Telegram đi qua cùng assistant bridge.

## 13. Khả năng phục hồi và giới hạn đo được

Nguồn: `apps/server/test/load/controlPlaneLoad.ts`, chạy qua `controlPlaneLoad.gated.test.ts` với `RUN_LOAD_TEST=1` (không mạng, không provider thật). Số đo lấy từ v0.2 §12 (lần đo 2026-11-18); lần viết v1.0 không chạy lại.

**Cấu hình SQLite và bảo vệ:**
- Pragma như §4.1. Lỗi `SQLITE_BUSY` được thử lại tối đa 5 lần với backoff ngẫu nhiên; đếm thành công và thất bại; ghi độ trễ p50, p95, max.
- `audit_log` gộp ghi trong RAM, xả mỗi 1 giây hoặc khi tắt sạch (`SIGTERM`, `SIGINT`). `llm_relay_usage` gộp cập nhật mỗi 1 giây và xả trước khi đọc bảng.
- `WalCheckpointManager` kiểm dung lượng WAL mỗi 30 giây; chạy `wal_checkpoint(TRUNCATE)` khi WAL vượt 16 MB và khi tắt sạch.

**Kịch bản:** một tiến trình, một luồng, SQLite tệp thật trong thư mục tạm. Mỗi node gửi 8 heartbeat qua đường thật (có gộp). 40 lần INSERT usage trực tiếp và 10 job tạo kèm lease. Profiler được xóa sau khi đăng ký node.

| Node | Câu lệnh/s | p95 (ms) | max (ms) | SQLITE_BUSY |
|---|---|---|---|---|
| 5 | 4571 | 0.34 | 0.44 | 0 |
| 20 | 3940 | 0.24 | 20.15 | 0 |
| 50 | 5349 | 0.27 | 0.51 | 0 |
| 250 | 6458 | 0.24 | 16.54 | 0 |
| 300 | 6350 | 0.28 | 8.29 | 0 |

Đọc đúng số đo:
- Đến 300 node, p95 dưới 0.35 ms và không có `SQLITE_BUSY`. Kịch bản **chưa đạt điểm bão hòa**, nên không có ngưỡng node nào được suy ra.
- 3.900–6.500 câu lệnh/s là thông lượng trong một đợt ngắn, một luồng. Không phải số ghi bền mỗi giây dưới tải nhiều tiến trình.
- Chưa đo: tải kéo dài, nhiều tiến trình ghi đồng thời, độ trễ replica Litestream, và lặp lại để lấy phương sai.

**Điểm chuyển khỏi SQLite (tiêu chí, không phải số đo):**
1. p95 ghi vượt 50 ms liên tục trong vận hành bình thường;
2. `SQLITE_BUSY` vượt 5% tổng số lệnh ghi;
3. cần nhiều cụm điều khiển active-active.

**Cửa sổ mất dữ liệu khi sập đột ngột** (`SIGKILL` hoặc mất điện): tối đa 1–2 giây bản ghi audit và usage còn trong RAM. Trạng thái dự án và kịch bản được commit ngay. Lease node hết hạn sau 60 giây (`NODE_LEASE_SEC`, §3.4) và job được thử lại.

## 14. Công cụ ngoài (một người, máy của họ)

Một người chạy app trên máy của họ. Không có người dùng thứ hai, không bán app. Các điều kiện giấy phép được ghi theo nguồn ngày 2026-11-06 (chưa kiểm lại).

Chỉ gắn công cụ khi pipeline chưa làm được việc đó. Không thêm runtime thứ hai cho cùng một việc.

| Công cụ | Trong app | Lý do |
|---|---|---|
| HyperFrames | Đã gắn (`hyperframes@0.9.14`, Apache-2.0) | Đồ họa động HTML/GSAP → clip alpha |
| FFmpeg | Đã gắn (`ffmpeg-static`, GPL-3.0-or-later, gọi process) | Ken Burns, xfade, phụ đề, ducking, thumbnail |
| Motion Canvas | Không gắn | Cùng vai trò với HyperFrames |
| Remotion | Không gắn | Render React trùng HyperFrames và FFmpeg |
| PySceneDetect | Không gắn | Cắt scene đã có: timeline theo voice và `CLIP` |
| WhisperX | Không gắn | Mốc từng từ lấy từ provider TTS khi có word timing; cần GPU |
| OpenMontage | Không gắn | Repo chính là AGPL-3.0; không gộp mã vào repo này |
| Postbase | Không gắn | Cần Postgres/Supabase; app đã có các nền tảng cần thiết |
| n8n | Không gắn | Lịch và job đã nằm trong SQLite |
| Mastra | Không gắn | Trợ lý, registry tool, operator và MCP đã có |

Khi task mới thật sự thiếu cắt scene trên video có sẵn, hoặc căn lời khi TTS không có word timing, thêm adapter tùy chọn (binary trên PATH, test giả lập, không mạng). Không thêm dependency npm cho việc đó.

## 15. Đính chính so với v0.2

| Mục v0.2 | Sửa trong v1.0 | Căn cứ |
|---|---|---|
| Lease 45 giây | Lease node là `NODE_LEASE_SEC` = 60 s; 45 s là ngưỡng offline | `lib/config.ts:65`; `node/nodeService.ts:30` |
| Node 24.x | Node 22 trong Docker; nguồn cho 24.x không có trong repo | `deploy/docker/Dockerfile:12,106` |
| `apps/server/src/hermes` | Hermes là loại agent trong fleet | `fleet/service.ts`; không có thư mục `hermes/` |
| `pipeline/stale.ts` | `pipeline/invalidation.ts` (`markStaleFrom`) | `pipeline/invalidation.ts:4` |
| `apps/server/src/renderService.ts`, `orchestrator.ts` | `services/renderService.ts`, `pipeline/orchestrator.ts` | Hai đường cũ không tồn tại |
| `jobs/queue.ts` | Hàng đợi nằm trong `jobs/worker.ts` và `jobs/jobRepository.ts` | `jobs/queue.ts` không tồn tại |
| Nguồn `agent` chạy mọi việc `confirm` | Tool `confirm` có khóa trong `TOOL_GRANTS` (kể cả khóa `null`, 18 tool; khóa khác như `publish_project` cũng vậy) chạy trực tiếp, trừ khi automation đang pause (khi đó chờ người dùng, TASK-153); tool ngoài bảng, `delete_project`, `run_research` và bật tự động hóa thì chờ; `locked` cũng làm chờ. Mọi nguồn đều bị `hardBlockMessage` chặn trước (§5) | `registry/policy.ts:100–132`, `registry/invoke.ts:44,178` |
| “Thư mục `.cursor/`” là workspace operator | Workspace operator là `.video-agent-operator` ngoài git root | `operator/workspace.ts:33` |

## 16. Liên kết tới tài liệu sâu

- Kế hoạch (chưa có trong mã): [`ARCHITECTURE-TARGET.md`](ARCHITECTURE-TARGET.md). Gồm: registry tham số, playbook kênh, lab, thư viện mẫu; tách `assistant/tools.ts` thành `registry/tools/<nhóm>.ts`; tách schema thành `db/schema/<domain>.ts`; tách `visuals/`. Tên trong file đó là đề xuất.
- Roadmap và thứ tự: [`ROADMAP.md`](ROADMAP.md), [`BLUEPRINT.md`](BLUEPRINT.md), [`cursor/README.md`](cursor/README.md).
- Vận hành hai máy: [`RUNBOOK-two-machines.md`](RUNBOOK-two-machines.md).
- Hướng dẫn người dùng: [`user-guide/`](user-guide/) và `packages/shared/src/features/featureMap.ts`.
- Báo cáo và trạng thái task: `docs/tasks/`. Việc còn vận hành thật (token OmniRoute, bấm áp route) ở `docs/tasks/CON-THIEU.md`.
- Hướng mở rộng cho agent vận hành (v0.2 mục 9) là kế hoạch, không phải hiện trạng: xem [`ARCHITECTURE-TARGET.md`](ARCHITECTURE-TARGET.md) §4 (bề mặt tool) và §6 (điểm mở rộng).
- Việc đã có sau MVP (v0.2 mục 10): xem [`ROADMAP.md`](ROADMAP.md) và `docs/tasks/`. Không chép lại danh sách v0.2.
