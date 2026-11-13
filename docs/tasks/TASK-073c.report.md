# TASK-073c — D3/D4 và lịch detector

Ngày kiểm tra: 2026-11-11. Phạm vi: §9 TASK-073, gồm hai phần còn thiếu của 073b. Không làm 073d.

## Kết quả triển khai

- **Lịch thật:** heartbeat worker gọi D1 theo từng knowledge entry/watch: weekly mỗi ngày, monthly mỗi 3,5 ngày, các mức chậm hơn mỗi tuần. Cùng URL dùng lại lần fetch nhưng mỗi entry có hash/cadence riêng. Đọc được state URL cũ của 073b. D6 stale và hai lệnh npm chỉ đọc chạy hằng tuần; prune hit quá 7 ngày chạy hằng ngày. Có coalescing, lịch lưu qua restart, audit ok/error/offline và retry lỗi sau một ngày.
- **Nguồn/AI:** provider intel và D1 dùng chung helper robots/bounded body. Runtime kiểm URL công khai, giới hạn body, timeout và cache 6 giờ. Tác vụ `knowledgeWatch` đi qua router/model hiện có, output schema, quote tối đa 25 từ phải khớp, proposal cùng ID/kind; ECO/hết ngân sách chỉ hash. Ngân sách dùng `ChangeInbox`, mặc định 20 lượt/ngày, có tính cả fallback. Usage được ghi với nhãn KNOWLEDGE. Không cho nội dung trang gọi tool.
- **D3:** checklist đọc coverage/verification/evidence từ resolver `account.*`, tách lịch sử manual khỏi polling. Poll YouTube status/processing/region/age; TikTok query/status fetch; Facebook video status/phases và debug_token; Instagram container status. Graph 190, lỗi refresh và dữ liệu không đọc được tạo unknown, không kết luận enforcement. API clear chỉ đóng sự kiện D3 tương ứng, không tự nhấc hold D7. D2 phát sinh bên trong OAuth refresh/identity của poller được gắn account bằng AsyncLocalStorage và fingerprint riêng: invalid_grant giữ kết nối đúng account, không lan sang kênh khác.
- **Webhook TikTok:** endpoint `/api/knowledge/webhooks/tiktok`, parser raw body riêng, HMAC SHA-256 trên đúng bytes, kiểm client/account và thời gian ±5 phút, dedup, bỏ sự kiện cũ hơn đã thấy. `authorization.removed` tách mất quyền với ban (chỉ reason=4); mất public visibility không bị suy thành removal. URL HTTPS khai báo trong UI; người dùng vẫn phải đăng ký cùng URL ở portal. Không mở tunnel hay đăng ký dịch vụ thay người dùng.
- **Manual/E3:** ghi kết quả, thời điểm, policy và video thuộc đúng tài khoản qua route owner-only. Manual strike giữ đúng account; tool registry không có quyền ghi checklist/nhấc hold. Eligibility dùng chương trình đã cài/được chấp nhận trong resolver, đối chiếu ngưỡng số theo cửa sổ qualified; dữ liệu thủ công hết hạn sau 7 ngày, followers fallback cũng phải mới. Cấu trúc điều kiện chưa hỗ trợ cho unknown. E3 là lời nhắc kiểm điều kiện số liệu, không xác nhận nền tảng đã duyệt.
- **D4:** lưu chuỗi ngày đóng, tối đa 180 ngày: views48h, CTR, avgViewPct, impressions theo traffic source, RPM. Snapshot 48h lấy mẫu đầu tiên trong 48–50h; analytics có lần sync tại mốc này trước khi chậm xuống 12h. Thiếu mẫu để null. RPM tự tính chỉ ghép doanh thu và views cùng toàn kênh/ngày; phân biệt zero tường minh với cột revenue bị thiếu. Raw snapshot lưu knowledgeRev của project, bản cũ unknown.
- **Phát hiện:** CUSUM hai phía (k=0,5, h=5), 14 ngày baseline và 3 ngày lệch liên tiếp, mặc định ít nhất 3 mẫu/ngày. Gap, null, thiếu mẫu hoặc đổi định nghĩa bắt đầu warmup lại. E4 luôn mở R5; cùng nền tảng nhiều kênh cùng ngày → giả thuyết B4; chỉ một format và có đối chứng → C2; revision đổi → our_change. Dữ liệu cũ không tạo cảnh báo mới mỗi ngày; sau sự kiện xây lại baseline.
- **G1:** creator_tactic có khoảng `metricBaseline` định lượng cùng metric/format/definition được so với 14 ngày đo mới. Đo ngoài khoảng tạo measured evidence và proposal rủi ro cao; giữ nguyên khoảng industry cho đến khi người dùng duyệt. Không tự suy một khoảng số từ câu văn nghiên cứu.
- **UI/tools:** tab Tài khoản và video, đường dẫn kiểm trong nền tảng, webhook/offline/ECO, form eligibility, bảng số liệu gần nhất và nhập chỉ số ngày có nguồn. Dashboard nhập tay bù connector thiếu chỉ số, giữ qua sync. Hai tool chỉ đọc `get_account_health`, `get_metric_series` dùng registry chung cho trợ lý/MCP/operator. Sự kiện high/critical chuyển qua NotificationService hiện có, có dedup/quiet hours/opt-in.

## Tệp trong phạm vi

- `apps/server/src/knowledge/`: thêm accountHealth, statusPoller, tiktokWebhook, milestones, driftMonitor, metricInputs, detectorScheduler, detectorRuntime, officialPage, watchModel, changeAlerts; nối changeInbox, documentWatch, httpSignal, toolDefs.
- `apps/server/src/app.ts`, `api/knowledge.ts`, `analytics/syncService.ts`, `analytics/freshness.ts`, `finance/youtubeRevenue.ts`, `providerIntel/service.ts`, `providers/llm/mock.ts`, `operator/skills.ts`.
- `packages/shared/src/knowledge/drift.ts`, `knowledge/schema.ts`, snapshot account_policy/api_contract, `index.ts`, `schemas/llm.ts`, `providerIntel/routing.ts`, `features/featureMap.ts`.
- `apps/web/src/features/settings/`: AccountHealthPanel, MetricObservationForm, ExternalKnowledgePage; test panel và page.
- Test server: statusDetectors, statusProtocols; test shared: metricDrift, llm. Test llm đổi số tác vụ 33 → 34 và kiểm cấu hình tác vụ mới, do chủ ý bổ sung knowledgeWatch.
- User guide `tri-thuc-va-thay-doi.md`, `nhat-ky-thay-doi.md`; báo cáo này và marker hoàn thành.

Không thêm dependency, bảng hay migration. Dùng các bảng analytics/finance và app_settings hiện có. Snapshot chỉ thêm 48 account_policy và 19 api_contract status từ RESEARCH-073 qua schema validation; giữ nguyên evidence. Không nhập toàn bộ research, không sửa market snapshot/evidence inference.

## Kiểm chứng

- `npm run typecheck` và `npm run build`: đạt cả bốn workspace. Sau sửa cuối ở HTTP account context, chạy lại typecheck/build server và đạt. Build web có cảnh báo chunk lớn/annotation Zod sẵn có, không có lỗi build.
- Test toàn workspace ở trạng thái cuối: **shared 565 đạt; MCP 19 đạt; server 926 đạt, 4 skipped (110 file); web 184 đạt (67 file)**. Server cuối chạy `npm test -w apps/server -- --maxWorkers=4`, hoàn tất lúc khoảng 18:28 UTC+7 trong 210,53 giây.
- Lượt `npm test --workspaces -- --maxWorkers=2` đầu có lỗi count task LLM 33 → 34 (đã sửa test theo chức năng mới), một ca freshness trong lượt đã khởi động trước khi sửa mã và FFmpeg tạo PNG bị dừng. Shared toàn suite chạy lại 565/565; hai file server chạy riêng 11/11; cuối cùng chạy lại toàn server được 926/926 ca thực thi. Không sửa imageHash hay nới timeout để cho qua.
- Test đích cuối: **48/48** (statusDetectors, statusProtocols, changeEvents, analytics, finance), gồm D2 invalid_grant giữ đúng account, không giữ một kênh YouTube khác.
- Browser Chromium thật, API routes thật với SQLite tạm ngoài `data/`, hồ sơ/tài khoản và project `qa-project-073c` dùng riêng. Ghi checklist và chỉ số 0,05, đọc API xác nhận đã lưu. Desktop 1440px/mobile 390px không có JS error hoặc tràn ngang. Ảnh ở `tmp/task073c-desktop.png`, `tmp/task073c-mobile.png`.
- Các test detector mới dùng fake clock, HTTP/npm/model fixtures và SQLite tạm; không gọi mạng, LLM/TTS hoặc renderer thật. Không gọi tài khoản thật/đăng bài, không thao tác project được bảo vệ. Các lỗi selector/timeout của harness browser đã sửa trước lượt QA đạt.
- Node validate lại snapshot: account_policy 48 entry, api_contract 26 entry, **0 invalid**. Kiểm UTF-8/NUL ở 19 tệp trọng tâm: **0 lỗi**; `git diff --check` cho các tệp tracked trong phạm vi không báo lỗi khoảng trắng. Đã dừng API/Vite QA trên cổng 3983/3984.

## Giới hạn và lựa chọn

- Connector Analytics hiện chưa tự tải YouTube Reporting reach CSV. CTR/impressions chưa có sẽ null; người dùng có thể ghi daily dashboard với nguồn để D4 theo dõi ngay. Không lấy views làm impressions, không gọi API private, không scrape trang đăng nhập. Adapter Reporting CSV tự động là phần mở rộng sau này; không cần để dùng detector với nguồn nhập tay.
- E3 chỉ hoạt động với monetization_program đang có trong resolver; snapshot nhóm đó hiện rỗng. Test dùng vài entry thật từ research qua proposal/accept, không nhập research vào dữ liệu người dùng.
- KnowledgeRev là revision được project lưu, không phải chứng cứ nhân quả; cross-check chỉ là giả thuyết mở điều tra. Chưa có revision hay định nghĩa khác nhau thì không gán nguyên nhân đó.
- Không thử OAuth/webhook bằng credentials hoặc tài khoản thật. Việc xác nhận tài khoản/nền tảng thực tế vẫn cần quyền của người dùng. Webhook chưa ghép được publication chỉ tạo unknown để đối chiếu.
- Tái dùng code nội bộ theo guide; thuật toán CUSUM tự viết theo tài liệu phương pháp. Không chép mã bên ngoài, không thêm thư viện. Không thay phần render/visual/compose của các task song song.

## Nguồn

Nguồn kiểm ngày 2026-11-11, không trích nguyên văn:

- Repo: `docs/research/change-signals/status-apis.md`, `knowledge.json`, guide TASK-073 và README Cursor.
- [NIST CUSUM](https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc323.htm): phương pháp k/h; guard sample/warmup là lựa chọn của app.
- [TikTok verification](https://developers.tiktok.com/docs/en/webhooks-verification), [events](https://developers.tiktok.com/docs/en/webhooks-events), [publish status](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status).
- [YouTube metrics](https://developers.google.com/youtube/analytics/metrics), [revision history](https://developers.google.com/youtube/analytics/revision_history): reach Reporting API có thumbnail impressions/CTR từ 2026-01-15, không coi đó là fields của reports.query hiện tại.
- [Meta debug_token](https://developers.facebook.com/docs/graph-api/reference/debug_token/): web fetch trực tiếp hôm nay trả 429; phần payload/coverage dùng tài liệu RESEARCH-073 đã lưu và code Meta có sẵn, test HTTP fixture. [Meta first-party token guidance](https://github.com/meta/agentic-tools/blob/main/plugins/devtools/skills/debug-access-token/SKILL.md) đối chiếu code 190, không tải/cài skill đó.

Không commit, push, đổi branch hay npm install; không sửa `.env`, `.claude/`, `data/`, `scripts/`. Các thay đổi khác đang có trong worktree được giữ nguyên.
