# TASK-129a — báo cáo (chưa hoàn tất)

Trạng thái: các bước máy chủ và giao diện đã làm; bảng phủ §1 (mục "Cập nhật (2026-11-18)") liệt kê mục nào đã có sự kiện (không còn mục blocked trong §1), và đánh thức Hermes mới là tín hiệu file, chưa kiểm chứng trên Hermes thật. Tên file giữ nguyên `.report.md`, không đổi thành `.done`.

## Đã làm

- **Bước 4 — hộp thư cho sidecar:** `GET /api/agents/mailbox/peek` chỉ trả id, kind, người gửi, thời gian; không có thân tin. Người nhận lấy từ instance cố định của khóa; khóa không có tên hoặc có header giả đều bị 403. Workspace lỗi thì trả rỗng.
- **Bước 5 — báo cáo của sub-agent:** claim, release, complete thành công gửi đúng một `report` tới `duty`. Người gửi lấy từ hồ sơ khóa. Khóa chưa đặt tên bị từ chối ở tuyến trước khi claim. Lỗi gửi báo cáo chỉ ghi log theo mã, không làm hỏng chuyển trạng thái.
- **Bước 6 — luồng thread cho user (máy chủ):** `threadList`, `threadForUser`, `userPostToThread` trong `apps/server/src/supervision/mailbox.ts`; tuyến `/api/operator/fleet/threads` (GET danh sách, GET một chuỗi, POST tin) trong `apps/server/src/api/fleet.ts`. Chỉ chủ app, workspace lấy từ phiên và thiếu thì 403. Tin của user là directive, trừ khi đích không giải được thì thành question.
- **Bước 6 — giao diện:** `apps/web/src/features/operator/FleetThreads.tsx`, gắn vào `FleetTab.tsx`. Nội dung tin hiển thị dạng chữ thuần (pre-wrap). Ô gửi chặn quá 8 KB theo byte. Làm mới mỗi 15 giây.

- **Bước 4 (poller 15 giây, `apps/mcp`):** `runEventPollLoop` trong `apps/mcp/src/sync.ts` gọi `pollEventsOnce` và `pollInboxEventsOnce` mỗi 15 giây đến khi dừng. Lỗi không xử lý được ghi một dòng cố định (không có nội dung lỗi) và vòng lặp tiếp tục. Test: `apps/mcp/test/eventPollLoop.test.ts` (3/3).

## Kiểm thử

- `apps/server/test/fleetThreads.test.ts`: 8/8 (liệt kê, đọc, workspace khác 404, khóa máy 403, post giữ directive và tới hộp thư, đích không giải được thành question, quá 8 KB 422, chuỗi không tồn tại 404).
- Các file liên quan đến mailbox và fleet đều xanh: agentInboxPeek, agentPeekRoute, agentBusEvents, agentSubscriptions, agentMailbox, fleetRelay; agentStageReports, agentStagesApi.
- `apps/web/src/features/operator/FleetThreads.test.tsx`: 3/3 (chữ nguyên không thành thẻ HTML, trả lời tới người gửi gần nhất và hiện đúng kind máy chủ trả về, tin trên 8 KB khóa nút gửi).
- `apps/web/src/features/operator/FleetTab.test.tsx`: 1/1 sau khi thêm chốt `threads ?? []`.
- `tsc --noEmit` của server và web: exit 0.

## Kết quả full suite (lần chạy cũ, đã vượt; số mới nhất ở mục "Cập nhật (2026-11-18)")

- Server: 211 file đạt, 4 file bỏ qua; 1782 test đạt, 8 bỏ qua; exit 0.
- Web: 88 file đạt; 238 test đạt.
- Bước 1–3 (đã xong trước đó): thêm ở các mục trên; mcp 60/60 trong lần chạy trước.

## Chưa làm / chưa kiểm chứng

- **Chưa xác minh giao diện trong trình duyệt.** Có cấu hình dev trong `.claude/launch.json` (api 3001, web 5180), nhưng chưa xác nhận thư mục dữ liệu của API là dev và chưa có tài khoản đăng nhập để tạo chuỗi tin thử; không chạy preview để tránh chạm dữ liệu thật. Mục này còn mở.
- **Đánh thức Hermes:** đã quyết (advisor) dùng tín hiệu file `vg-sync/wake-signal.json`. Sidecar ghi `vg-sync/wake-signal.json` khi có sự kiện mới và skill `vg-supervise` đọc file đó; chưa kiểm chứng trên Hermes thật.
- **Sự kiện trong đặc tả:** không còn mục blocked trong §1. Anomaly phát `supervisor_finding` khi finding mở mới hoặc mở lại. Thay đổi trạng thái mission đã có emitter sẵn (mission_created, mission_state_changed, mission_owner_changed).
- **Vai trò điều phối:** báo cáo gửi tới `duty`; mã chưa có vai trò `orchestrator`.

## Câu hỏi mở

Xem `docs/tasks/GOAL-2026-11-18.decisions.md`, mục "Câu hỏi chờ user".

## Cập nhật (2026-11-18)

- Sự kiện đã phát (spec §1), chỉ khi có việc thật, không phát theo từng tick:
  - `analytics_synced`: khi một tài khoản đồng bộ thành công, ở cả hai đường (thường và làm mới token sau 401). Phát từ `apps/server/src/analytics/syncService.ts`. Test: `apps/server/test/analytics.test.ts` (đường làm mới token có kiểm số sự kiện +1).
  - `stage_overdue`: mỗi lượt kiểm tra quá giờ được ghi (`recordOverdueCheck` trong `apps/server/src/jobs/overdueStore.ts`), phát ở nhánh kiểm tra tự động `apps/server/src/jobs/overdueRun.ts`, không phát từ `overdueStore.ts`. Test: `apps/server/test/overdueRun.test.ts`.
  - `repair_exhausted`: khi `runQualityRepair` trả kết quả `exhausted` (`apps/server/src/operator/qualityRepair.ts`). Test: `apps/server/test/qualityRepair.test.ts`.
  - `published` và `publish_failed`: đã phát từ trước, ở `apps/server/src/pipeline/orchestrator.ts` (cấp stage, không phải cấp publication). Lần sửa này KHÔNG thêm emit mới, vì emit trong `publishService` bị trùng và đã gỡ.
  - `publish_scheduled`: mỗi dòng publication mới tạo trong `createForProject` (`apps/server/src/publishing/publishService.ts`); dòng dùng lại không phát. Test: `apps/server/test/missionWiring.test.ts` (phát đúng 1 lần).
  - `repair_started`: một lần, ở lượt sửa đầu tiên của một đợt cho cặp dự án + cổng; cờ xóa khi đợt đó pass hoặc exhausted. Test: `apps/server/test/qualityRepair.test.ts`.
  - `quota_failover`: mỗi lần chuyển provider thật trong `FailoverTracker.recordFailover` (`apps/server/src/providers/llm/failover.ts`). Test: `apps/server/test/failoverEvents.test.ts`.
- Phần vừa bổ sung (đã phát):
  - Đã phát `node_offline` khi sweep (`apps/server/src/node/nodeService.ts`, hàm `sweep`) đổi node từ trạng thái khác sang offline, một lần mỗi lần chuyển. Đã phát `node_online` khi heartbeat đưa node từ offline trở lại (cùng file, hàm `heartbeat`). Test: `apps/server/test/workerNodes.test.ts` (expiry sweep, đếm theo delta).
  - Giới hạn node-runner: `node/runnerRuntime.ts` đặt hook `publishEvent` thành no-op, nên `quota_wait` và `stage_failed` của job chạy trên runner không lên bus điều khiển (cùng một hành vi).
  - `quota_wait`: đi qua hook `emitAgentEvent` như các sự kiện orchestrator khác (test: hook nhận đúng một `quota_wait`, bus chung không nhận thêm). Phát ở nhánh `LLM_QUOTA_WAIT` của `apps/server/src/pipeline/orchestrator.ts` (job RUNNING → QUEUED với `runAfter`), một lần mỗi lần chuyển. Test: `apps/server/test/llmQuota.test.ts` (delta +1).
- Anomaly đã phát ở `operator/supervisor.ts` (xem bảng §1). Không lấy từ `buildSupervisionSnapshot`, vì snapshot chỉ được gọi từ đường đọc, không có tick.
- Kênh bus: `app.ts` chuyển mọi sự kiện không thuộc hộp thư sang webhook có bộ lọc loại; endpoint không lọc (eventTypes rỗng) sẽ nhận thêm các loại mới. Không có đường nào đẩy bus sang Telegram; Telegram chạy qua `operator/events.ts` riêng.
- Bảng phủ §1 (mỗi mục spec → loại sự kiện → điểm phát):

| Mục §1 | Loại sự kiện | Điểm phát | Ghi chú |
|---|---|---|---|
| Stage bắt đầu / xong / bàn giao | stage_started, stage_finished, render_finished, published (stage publish), stage_handoff, stage_completed_by_agent | `orchestrator.ts` (~477 và `publishStageCompletion` ~750) | có từ trước; đã đối chiếu |
| Stage lỗi | stage_failed (hoặc publish_failed với stage publish) | `pipeline/orchestrator.ts` `failJob` (~829) | có từ trước; chỉ phát khi job thành FAILED hết lượt, không phát ở lượt retry |
| Cổng bị giữ | waiting_approval | `orchestrator.ts` (~1189) | có từ trước |
| Sửa chữa bắt đầu | repair_started | `operator/qualityRepair.ts` | một lần mỗi đợt; cờ trong bộ nhớ, reset khi khởi động lại |
| Sửa chữa cạn lượt | repair_exhausted | `operator/qualityRepair.ts` | một lần mỗi đợt; cờ trong bộ nhớ |
| Quá giờ | stage_overdue | `jobs/overdueRun.ts` (nhánh kiểm tra) | không phát ở nhánh quyết định |
| Xếp lịch đăng | publish_scheduled | `publishing/publishService.ts` `createForProject` | status lúc insert chỉ là QUEUED hoặc SCHEDULED (đã kiểm tra) |
| Đã đăng / đăng lỗi | published, publish_failed | `pipeline/orchestrator.ts` | có từ trước; không thêm emit trong publishService |
| Đồng bộ analytics | analytics_synced | `analytics/syncService.ts` (2 đường) | workspace lấy từ `profiles.workspace_id`; test `analytics.test.ts` gán ws-a: ws-a +1, ws-b +0 |
| Anomaly | supervisor_finding | `operator/supervisor.ts` (`runPass`, sau transaction) | một lần khi finding MỞ MỚI hoặc MỞ LẠI (prior không có hoặc resolved), không phát mỗi tick. Scope theo workspace của profile của finding (fallback `defaultWorkspaceId`); finding không có profile là toàn cục (không fallback). Test toàn cục: `llmFailover.test.ts` có default workspace và vẫn thấy sự kiện dưới lọc workspace khác. Có `projectId` khi detail có. Finding đi qua `detected` trong `runPass` phát ở đây; các INSERT trực tiếp phát tại chỗ qua `operator/findingEvents.ts` (xem mục "Lượt cuối" bên dưới). Test: `llmFailover.test.ts` (mở lại +1, pass sau +0) và `agentStagesApi.test.ts` (stage_release_loop, profile ws-a: ws-a +1, ws-b +0, projectId khớp). Kênh: bus → webhook (nếu endpoint bật, không lọc type; `listWebhookEndpoints` không lọc workspace với MỌI loại sự kiện, không riêng anomaly) và SSE feed; `notify` Telegram là kênh riêng, không bị nhân đôi |
| Quota chờ reset | quota_wait | `pipeline/orchestrator.ts` (nhánh LLM_QUOTA_WAIT) | một lần mỗi lần chuyển RUNNING → QUEUED |
| Chuyển provider khi quota | quota_failover | `providers/llm/failover.ts` `recordFailover` | tối đa một lần mỗi provider nguồn mỗi 10 phút; cờ trong bộ nhớ |
| Node online / offline | node_online, node_offline | `node/nodeService.ts` (`heartbeat`, `sweep`) | chỉ khi chuyển trạng thái thật; workspace của node, fallback workspace mặc định |
| Thay đổi trạng thái mission | mission_created, mission_state_changed, mission_owner_changed | `missions.ts` (~130, ~195) | có từ trước; đã đối chiếu emitter còn tồn tại |

- Lưu ý: dedupe cho repair và failover nằm trong bộ nhớ, khởi động lại sẽ reset. Dedupe anomaly dựa trên dòng `supervisor_findings` trong DB, nên không reset khi khởi động lại.
- Phạm vi workspace: các sự kiện có workspace riêng (node, analytics, publish, overdue, repair, quota_wait) truyền `workspaceId` của dòng liên quan, fallback `defaultWorkspaceId`. `quota_failover` không truyền workspace và là toàn cục theo thiết kế. Test `node_offline` đặt `workspace_id='ws-a'` trên node và assert: lọc ws-a +1, lọc ws-b +0. Test analytics gán `profiles.workspace_id='ws-a'` và assert ws-a +1, ws-b +0. Môi trường test không có workspace mặc định nên sự kiện không gắn workspace ở các test khác.
- Guard `AUTONOMY_BUDGET_WAIT` không phát `quota_wait`: đã kiểm bằng đọc code (chỉ nhánh `LLM_QUOTA_WAIT` gọi emit). `test/llmRouting.test.ts:55` không đi qua `failJob`, nên không có test delta-0 cho nhánh này.
- Lưu ý: một node mới được join lần đầu được đưa thẳng vào trạng thái online và KHÔNG phát `node_online`; chỉ chuyển offline → online mới phát.
- mcp: 63/63 đạt.
- Kiểm chứng sau thay đổi (lần cuối): `shared` build sạch; `apps/server` tsc sạch; full suite server 226 file, 1883 test đạt, 0 fail (sau khi thêm emit supervisor_finding và test; lần này có cả test quota_wait qua hook); mcp 63/63 và web 242/242 đã chạy lại sau mọi thay đổi (cùng lượt với máy chủ 1883 đạt, tsc 0). Lần web đầu có 1 fail không tái hiện trước đó, chưa xác định tên.
- Chưa làm: gộp thông báo câu hỏi 60 phút thành một bản tóm tắt mỗi lượt quét và không gắn cờ khi Telegram tắt (cần hàm kiểm tra Telegram đồng bộ; xem decisions). Mục này ĐÃ LÀM ở lượt cuối, xem bên dưới.

## Lượt cuối (2026-11-18)

- **Finding mở trực tiếp đã phát** (`operator/findingEvents.ts`: `findingWillOpen` trước khi ghi, `publishFindingOpened` sau commit, chỉ khi thực sự mở): `app.ts` (model_removed), `circuitBreaker.ts` (breaker_open), `qualityRepair.ts` (breaker sửa lỗi), `autopilot.ts` (raise_code), `qualityGates.ts` (untrusted_text, strike), `autonomyBudget.ts` (budget warn/stop), `loopGuard.ts` (loop_guard, sau commit), `publishing/recoverSchedule.ts` (missed_publish, sau commit). `quality_shelved` cố ý KHÔNG phát vì trùng `repair_exhausted`.
- **Telegram burst** (`supervision/mailbox.ts`): Telegram tắt thì không gửi và không gắn `escalated_user_at`; từ hai câu hỏi trở lên trong một lượt thì gửi một bản tóm tắt và gắn cho tất cả. Notify và publish chạy sau commit. Cổng `telegramReady` chặn cả sự kiện `agent.question_escalated`: khi Telegram tắt, webhook và SSE cũng không nhận sự kiện escalation sang người dùng. Đây là hành vi đã quyết, không phải lỗi, nhưng báo cáo trước đó nói sai là cổng chỉ chặn Telegram.
- **Kiểm thử mới**: `findingEvents.test.ts` (4), `breakerFindingEmit.test.ts` (1), `operatorFindingEmit.test.ts` (2), `mailboxBurst.test.ts` (5), `autopilotFinish.test.ts` (5/5, gồm bản tin sáng), `publishing.test.ts` (kiểm missed_publish, 3 case).
- **Kết quả cuối (sau mọi thay đổi code)**: server tsc exit 0; server 240 file đạt / 4 skip, 1933 test đạt / 8 skip / 0 lỗi (lần chạy đầy đủ cuối; hai file tải-nhạy đều pass trong lần này, nguyên nhân gốc chưa xác định); mcp 65/65 (chạy lại 2026-11-18, 7 file); web 242/242. Ghi chú 2026-11-19: hai lần chạy đầy đủ chạy chồng nhau gây lỗi (12 và 6 test); lần chạy sạch một mình: 1920 pass, 0 lỗi.
- **Đã thêm (2026-11-18)**: assert phát sự kiện cho strike (`autonomyGates.test.ts`, lần ghi thứ hai không phát), raise_code lockout (`autonomyGates.test.ts`, không phát khi đang khóa) và budget_stop (`registry.test.ts`, có assert). budget_warn cũng được assert (lần warn phát một lần, lần lặp không phát; xem `registry.test.ts`). Server: tsc 0; vitest 234 file / 1908 test pass, 4/8 skip.
- **Đã thêm (2026-11-18, lượt sau)**: backoff 5 phút cho nhắc chờ duyệt thất bại (`missionReminderBackoff.test.ts`, `missionDelivery.test.ts` cập nhật); bản tin 07:05/21:05 giờ VN (`digestSchedule.test.ts`); `setState` lệch `from` không phát sự kiện (`missionSetStateRace.test.ts`).
- **Đánh thức Hermes**: bộ ghi `appendWakeSignal` (`apps/mcp/src/sync.ts`) được gọi trong `pollEventsOnce` trước khi lưu con trỏ, chỉ khi có sự kiện mới được đánh thức (poll rỗng không ghi file); có test (`syncEventPoll.test.ts`). Bên đọc là skill `.agents/skills/vg-supervise/SKILL.md` (mục đọc `vg-sync/wake-signal.json`). Callback đánh thức mặc định của poller chỉ đếm `woke=N`; kiểm chứng trên Hermes thật vẫn chưa làm.
- **Chưa làm / chưa kiểm chứng**: đánh thức Hermes thật; kiểm chứng trình duyệt cần tài khoản owner trên data-dev (user làm).

## Đóng lại (2026-11-19): ánh xạ test theo danh sách guide, Hermes, kiểm chứng ngoài

### Ánh xạ danh sách test của guide `docs/cursor/TASK-129.md` (mục "Tests / 129a")
- Subscription lọc theo kind và scope: `agentSubscriptions.test.ts` "filters by kind when kinds are set", "filters by project scope", "refuses a profile or stage scope at subscribe time".
- Webhook ký, retry, backoff: `agentSubscriptions.test.ts` "delivers through the existing deliverer: signed headers, body is the stored payload, status sent", "retries a network failure with a later next_attempt_at".
- Poller chỉ đánh thức khi có sự kiện đăng ký: `apps/mcp/test/syncEventPoll.test.ts` "keeps the cursor across two cycles and wakes once per new subscribed event" (poller gửi `types=` theo kind đã đăng ký, `sync.ts` `pollEventsOnce`).
- SSE tiếp tục từ Last-Event-ID: `apps/server/test/agentEventsResume.test.ts` "returns only events after the Last-Event-ID the client already has" (mới, 2026-11-19, pass).
- Định danh lấy từ khóa: `apps/server/test/agentMailboxRegistry.test.ts` "lets agent A send, agent B read and ack, and refuses a second acker with 409"; "refuses a keyless call and a key with no instance name"; "refuses a viewer key on every mailbox tool".
- Directive hạng thấp lên hạng cao thành question: `apps/server/test/agentMailbox.test.ts` "turns a lower-rank directive to a higher rank into a question".
- Escalation chưa ack ở 15 / 60 phút: `agentMailbox.test.ts` "escalates an unanswered question to duty at 15 min and to the user at 60 min, once each"; "shows an escalated question to the duty holder after 15 min"; "does not escalate an answered question".
- Giới hạn tốc độ 60/phút: `agentMailbox.test.ts` "rate-limits a sender to 60 messages per minute" (`MAILBOX_RATE_PER_MIN = 60`).
- User post là directive hạng cao nhất: `agentMailbox.test.ts` "posts from the user as a directive from the top rank".
- Sự kiện có scope → instance theo assignment, không scope → duty: `agentSubscriptions.test.ts` "pushes a duty escalation only to the duty holder, with the escalated event type"; "pushes a no-project direct message to a project-assigned subscriber, matching its inbox"; "never pushes a message addressed to a third instance".
- Chế độ giao: subscription chỉ lưu `delivery='webhook'` (`subscriptions.ts`, `subscribe`). SSE và poller là kênh kéo/luồng riêng, không lưu như chế độ đăng ký, nên không có chế độ "lưu nhưng không gửi".

### Hermes (đã đọc, 2026-11-19; nguồn: trang webhook và api-server của Hermes; trang webhook bị cắt ở ~40k/50k ký tự, phần cuối là tóm tắt, không phải nguyên văn)
- Điểm vào: `POST http://<host>:8644/webhooks/<route-name>` (`WEBHOOK_PORT` mặc định 8644). Kiểm tra: `GET /health`.
- Header chữ ký theo chuẩn Standard Webhooks: `webhook-id`, `webhook-timestamp`, `webhook-signature`. Đây là đúng tên mà `apps/server/src/events/webhooks.ts` đang gửi, nên khớp tên header. Chưa xác minh định dạng giá trị chữ ký (tiền tố, mã hoá khoá) với Hermes thật.
- Không có tiêu đề route; route lấy từ đường dẫn URL. Thân JSON không có schema cố định; route dùng `prompt` template.
- Khử trùng: `webhook-id` trùng trong 1 giờ trả `200 status=duplicate`. Hermes không ghi rõ hành vi retry phía người gửi.
- Bật: `WEBHOOK_ENABLED=true`, `WEBHOOK_SECRET=...` trong `~/.hermes/.env`, hoặc `hermes gateway setup`. Đăng ký route động: `hermes webhook subscribe <name>`.
- Mã phản hồi: 200, 400, 404 (route sai hoặc chữ ký sai), 413, 429 (30 yêu cầu/phút mỗi route), 502.
- Không tìm thấy trong tài liệu: cách Hermes trả retry; định dạng chữ ký v1 chi tiết; schema thân.

### Kiểm chứng ngoài máy này (ghi nhận giới hạn, không đánh dấu đạt)
- Hermes live: `hermes` không có trên PATH của máy này (`Get-Command hermes` không tìm thấy). Không cài. Việc đánh thức Hermes thật KHÔNG kiểm chứng được tại đây.
- Trình duyệt, tuyến threads trên trang fleet: cần tài khoản owner trong DB dữ liệu. Không chạy trên `data-dev` hay `data`. Không cách ly được thư mục dữ liệu tách biệt an toàn trong lượt này, nên bỏ qua và ghi nhận. Component test (`FleetThreads.test.tsx` 3/3) và tuyến server (`fleetThreads.test.ts` 8/8) đã phủ hành vi.

### Kết luận trạng thái
- Các mục test trong guide đã có test tương ứng (ánh xạ trên).
- Những mục còn lại là kiểm chứng ngoài máy (Hermes live, trình duyệt). Chưa làm, không đánh dấu đạt.
