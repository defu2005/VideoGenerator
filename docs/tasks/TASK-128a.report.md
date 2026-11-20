# TASK-128a — Agent nhận stage tìm ảnh

Phạm vi: §1–§4 của guide TASK-128; tự review theo chỉ dẫn người dùng, không commit/push. TASK-128b là phần kế tiếp, chưa triển khai trong phần này.

## Thay đổi

- Shared: `src/agents/stageExecution.ts`, schemas project/profile/job/visual/vision/usage, brief presets/recommend, agent events và exports. Cấu hình từng stage kế thừa hồ sơ → dự án; VISUAL_SEARCH mặc định `app_then_agent`, chờ 30 phút. Chỉ VISUAL_SEARCH cho phép agent ở phiên bản này. Profile PATCH dùng null để xóa override; dự án reset trả về kế thừa động.
- DB: `apps/server/src/db/schema.ts`; migration **0079_common_dexter_bennett.sql**, snapshot và journal do Drizzle sinh. Thêm executor/handoffReason/handoffAt/agentInstance; tái sử dụng lease/fencing TASK-118, không tạo hệ lease khác.
- Server: `agents/{stageService,visualToolkit,toolDefs,usage,releaseMonitor}.ts`, `api/agentStages.ts`, nối tại app/assistant/worker/orchestrator. Claim nguyên tử, machine-key identity, heartbeat 10 phút, complete kiểm tra dữ liệu thật rồi tiếp tục pipeline; release, take-back, mất lease và hết thời gian chờ. Giao agent ngay tại enqueue ngay cả khi worker nội bộ tắt; sweep khôi phục hàng đợi tồn tại. `cannot_do` và user take-back không bị giao ngược lại.
- Handoff sau cạn provider/quota vision, rate limit đã hết retry, cảnh chưa kiểm được và sau repair TASK-121. Giữ cảnh có lựa chọn hợp lệ/người dùng bảo vệ; context gồm truy vấn đã dùng (cả lượt không có kết quả), ảnh loại/lý do, phong cách, tỉ lệ, kích thước, ngân sách và copyrightMode.
- `services/visualService.ts`, `imageStore.ts`: tải an toàn bằng webCrawl, giới hạn 25 MB, kiểm ảnh/kích thước, SHA/phash; provenance bắt buộc. Chống trùng trong cảnh và với ảnh đã chọn toàn dự án; ảnh bị loại ở cảnh khác không ngăn nó được đánh giá cho đúng chủ thể. Preview chính tệp đã lưu, mặc định 768 px; MCP trả image content thật.
- Verdict gắn danh tính/model và SHA. Select kiểm pass, chủ thể, file không đổi, cổng nguồn/watermark/bản quyền và chống trùng, dùng đường chọn ảnh hiện có. Complete kiểm lại tất cả cảnh, file và cổng. Không tự duyệt gate/crop cần xác nhận; quy trình crop/render hiện có tiếp tục áp dụng.
- Quyền: `auth/{routePermissions,toolActions,permissionHook}.ts`, `registry/invoke.ts`, `supervision/{leases,snapshot}.ts`. Kiểm quyền trước preempt; workspace/kênh và dự án legacy chưa gán đều được kiểm. User sửa dự án ngắt fence; khóa máy không sửa copyrightMode. Dự án được bảo vệ bị loại khỏi handoff/claim. Không đụng dữ liệu dự án thật đó.
- Quan sát: `jobs/{jobRepository,worker,overdueRun}.ts`, `operator/{qualityRepair,supervisor}.ts`; heartbeat agent đi vào tín hiệu TASK-125, không dừng job đang sống theo đồng hồ; bốn sự kiện stage và cảnh báo nhận–trả hơn ba lần, lọc theo phạm vi ở snapshot.
- Usage: shared job/usage schemas, `services/usageService.ts`, hai panel Usage. Provider agent riêng, không phân bổ chi phí app sang agent. Chi phí/token/số lượt chưa báo hiển thị chưa rõ; placeholder không bịa thành một lời gọi AI.
- Web: `AgentStageCard`, `PipelinePanel`, `BriefFields`, Create/EditProjectDialog, ProfileDetailPage, VisualReview, UsagePage/ProjectUsagePanel và CSS. Hiển thị holder/lý do/thời điểm/heartbeat, nút lấy lại, provenance ảnh và cấu hình kế thừa/xóa override.
- MCP: `apps/mcp/src/tools.ts`; tám tool protocol/toolkit dùng chung registry và REST. Skill `video-hinh-anh-va-giong`, hub `video-van-hanh-app`, mapping `agentSkillPack`, guide mới `docs/user-guide/agent-nhan-stage.md`, mục lục, featureMap và changelog.

## Kiểm chứng

- `npm run typecheck`, `npm run build` và `npm test --workspaces -- --maxWorkers=2` đều đạt. Shared 755, MCP 31, server 1.369 đạt và 6 skip, web 223. Build báo cảnh báo kích thước chunk Vite. Log nằm trong `tmp/task128a-verified-{typecheck,build,tests}.log`.

- Test tập trung cuối về enqueue khi worker tắt, recovery/take-back, protocol/API, quality repair và hai test CLI giả lập/FFmpeg: **94 đạt**, 5 file. Không dùng mạng hoặc LLM/TTS/agent CLI thật.
- Trình duyệt dùng React/Vite thật với API giả lập, chặn mạng ngoài: desktop 1440 px và mobile 375 px; thẻ stage và lấy lại việc; lưu/reset override dự án; xóa mặc định hồ sơ; provenance cả ảnh đang chọn và danh sách. Không tràn ngang. Ảnh kiểm tra: `tmp/task128a-desktop.png`, `tmp/task128a-mobile.png`; log `tmp/task128a-browser.log`.
- Test preview tạo PNG cục bộ bằng FFmpeg, kiểm ảnh resize và SHA thực. Test download dùng HTTP fixture; kiểm lease cũ sau tác vụ bất đồng bộ, SHA đổi, pass/reject, copyright off, scope/identity, race claim, expiry, timeout, protected project và pipeline tiếp tục.
- Drizzle chạy lần hai báo không thay đổi schema (`tmp/task128a-final-schema.log`). Không thêm dependency; không sửa `.env`, `.claude/`, dữ liệu thật hay root `scripts/`.

## Tự review và khác biệt

- Dùng lại TASK-118/122, ImageStore/webCrawl và phash trong repo. Queue claim theo guarded UPDATE/transaction; graphile-worker/pg-boss chỉ là ý tưởng như guide yêu cầu. Không copy/vendor mã bên ngoài, không thêm thư viện.
- Theo giới hạn xác nhận của TASK-062, chọn ảnh không tự gọi công cụ crop cần user duyệt. Cổng chất lượng không bị nới; ảnh hợp lệ DISCOVERED đang chờ review không bị coi là cảnh thiếu ảnh. Lựa chọn hỏng watermark/download vẫn được mở lại.
- Chưa có assignment/cache/role skill trong 128a: pool workspace tối đa một job mỗi instance, sẽ thay bằng §5–§8 trong 128b và migration riêng.
- Cập nhật có chủ đích test catalog từ 35.000 lên 37.000 ký tự để chứa tám tool mới; fixture supervision có executor; coverage skill thêm trang hướng dẫn mới. Không bỏ test cũ.
- Một lần chạy đầy đủ ở mức song song mặc định gặp timeout ở CLI giả lập và FFmpeg; bộ trước đó đạt. Hai test đó đã chạy lại đạt trong bộ 94 test; lần cuối giới hạn hai worker để kiểm toàn bộ mà không đổi timeout/hành vi sản phẩm.
- Chưa chạy Hermes/provider thật hay thao tác app đang vận hành; đây là kiểm chứng fixture/API giả lập, không khẳng định nghiệm thu vận hành trực tiếp. Không commit/push theo chỉ dẫn người dùng.
