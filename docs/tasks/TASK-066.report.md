# TASK-066

## Đã làm

- Cột `quality_score`, `blocking_facts`, `revise_round` trên `scripts`, migration `0059_script_quality_gate.sql` do drizzle-kit tạo. Điểm 0–10 từ lần duyệt kịch bản. Ghi chú kiểm tra sự kiện có `severity`. Sửa tay kịch bản thì điểm về null.
- `scriptGateInputs` đọc điểm từ dòng kịch bản. Tham số `quality` và `autopilot` bị từ chối bởi zod `.strict()` (chọn từ chối, không bỏ qua).
- `ctx.autonomyRun` chỉ bật khi quyền cho chạy và không có thẻ chờ. Cổng kịch bản và render khi tự chạy: sửa hoặc giữ, có việc `approve`, không ép cổng. Điểm null thì giữ.
- `shouldCreatePending`: xoá dự án và bật tự động hóa luôn chờ; `computer_act` chờ khi chưa có `computerUse`; quyền `run` thì không tạo thẻ. `publish_project` ở mức toàn quyền không còn bị ép chờ.
- Render đo `volumedetect` một lần, lưu `meanVolumeDb`, `maxVolumeDb`, `subtitlesInSync`. Im khi `maxVolumeDb < -50`. Render cũ thiếu trường thì cổng không qua.
- `publishGateCheck` kiểm tra tiêu đề, finding MUST, ảnh bìa, khung giờ và hạn mức. Chủ đề nhạy cảm đi qua `sensitivePublish`.
- YouTube: nếu phản hồi tải lên có `uploadStatus = rejected` và lý do `claim`, `copyright` hoặc `trademark` thì hồ sơ tắt tự động hóa, có finding `critical` và việc `info`. TikTok, Facebook và các nền tảng khác không có tín hiệu tương đương trong API app đang đọc. Không thêm trình thu thập.
- Xoá `toolsFromUntrustedText`. Bình luận và xu hướng nằm trong khối dữ liệu. Câu có vẻ chỉ dẫn tạo finding `info` qua `flagUntrustedText`, không đổi chữ và không có catalog công cụ. Mock LLM trả `tool_calls` cho `publish_project` và `add_topic` thì schema từ chối, registry không được gọi.
- `markUserTouch` khi sửa hồ sơ (tự động hóa, định hướng), thời gian chờ, giọng đọc hoặc kết nối model mà không có header `x-vg-tool-source`. Registry giữ 24 giờ với câu "Bạn vừa sửa mục này, agent chờ 24 giờ."
- Job `LLM_QUOTA_WAIT` của nhiều hồ sơ lần lượt qua `nextFairProfile`. Cảnh báo `automation_warning` trong giờ yên được xếp hàng. `savePreference` tắt quy tắc khi `guidelineWins`. Bản tin có đã đăng, đang làm, đang giữ và strike.
- Xoá `ensureAutopilotTables`. Mã nâng quyền dùng `crypto.randomInt` và `timingSafeEqual`. Năm lần sai trong 10 phút thì khóa 10 phút.
- Hướng dẫn: `tu-van-hanh.md`, `xu-ly-su-co.md`, nhật ký, `featureMap`.

## Kiểm tra

Lúc 20:23 giờ Bangkok (UTC+7) ngày 10/11/2026: `npm run typecheck` đạt, `npm run build` đạt mọi workspace, `npx drizzle-kit generate` in "No schema changes".

`npm test` lần cuối, sau test bình luận và xu hướng, khoảng 20:34 giờ Bangkok cùng ngày: shared 375, mcp 19, server 801 đạt và 1 bỏ qua, web 178. `npm run typecheck` chạy lại ngay trước đó và đạt.

Sau đó thêm test cạnh 11 và 12: bình luận đi qua `CommentInboxService.tick` với mock LLM, tiêu đề RSS đi qua `POST /trends/refresh`. Mock trả lời bằng `tool_calls` của `publish_project` và `add_topic`. Không có lời gọi registry, không có thẻ chờ, không có chủ đề mới, có finding `info`. Chữ bình luận giữ nguyên.

Khác hướng dẫn: lịch đăng nằm trong tự động hóa hồ sơ (`profile:<id>:automation`), không có route lịch riêng. TikTok và Facebook không có tín hiệu claim trong API đang đọc. Ngân sách, vòng lặp, cầu chì và xả hàng vẫn được kiểm ở `llmRouting.test.ts`, `registry.test.ts` và `autopilot.test.ts`.

Kiểm tra trực tiếp mục 10: not run. Không dựng server tạm và harness Telegram trong phiên này. Không đụng dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`.
