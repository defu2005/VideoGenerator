# Báo cáo TASK-060

## Phần 1 · Khớp quota

`callTargetsOmniProvider` không coi hai prefix lạ là cùng một nhà cung cấp. `ruleCoveredByLive` và `latestSnapshotFetchedAt` cũng bỏ qua kết quả map `null`. Test: `packages/shared/test/llmQuota.test.ts`.

## Phần 2 · Ảnh lệch chủ đề

`packages/shared/src/visuals/rank.ts` đánh dấu lệch khi điểm từ khóa dưới 0.34, khi có thực thể mà không cụm nào khớp, hoặc khi ảnh có từ fan mà cảnh không nói tới. Ba ví dụ Hermes nằm trong `packages/shared/test/rank.test.ts`.

Tìm web chạy khi ứng viên tốt nhất lệch. Sau bước nhìn, cảnh bị từ chối được tìm Brave thêm một lần, cảnh tệ nhất trước, vẫn trong hạn mức. Tóm tắt bước ghi `low_relevance` hoặc `vision_reject` kèm mã cảnh. Brave và Gemini tắt thì bước không hỏng; một mục Cần bạn cho cả dự án và cảnh được ghi «Ảnh có thể không đúng chủ đề — bật Brave hoặc tự chọn ảnh».

`POST /api/projects/:id/visuals/research` nhận `{ sceneIds?, reason }`, tìm lại các cảnh đó (mặc định là cảnh lệch hoặc bị nhìn từ chối), tôn trọng hạn mức, và từ chối dự án đang chạy hoặc đang render. Công cụ `research_scene_visuals` chạy không cần xác nhận. Registry chỉ có mức `read`, `safe`, `confirm`, nên công cụ dùng `safe`. Dự án được bảo vệ chỉ bị chặn ở công cụ này khi đang render. Nút **Tìm lại ảnh cho cảnh lệch chủ đề** gửi body JSON.

`allowCopyrightedStills` mặc định tắt. Tắt thì ảnh web chưa có giấy phép không vượt ảnh có giấy phép còn đúng chủ đề. Bình luận thì ảnh được gắn `usage: "commentary"`, timeline giữ tối đa 4 giây, và danh sách trước khi đăng có dòng «Video có ảnh có bản quyền — rủi ro Content ID». Chỉ người dùng đổi được, qua `PUT /api/profiles/:id/visual-copyright`. Trợ lý và operator bị chặn khóa này.

## Phần 3 · Catalog và khả năng

Đọc catalog khi cần giữ bản cũ 10 phút rồi làm mới nền. Job nền chạy 30 giây sau khi mở app và mỗi 15 phút. Ba lần lỗi thì nghỉ 60 phút. Lần làm mới hỏng không xóa cache. Diff thêm, mất và đổi khả năng nằm trong bộ nhớ. Model thêm hoặc mất ghi một dòng `notification_log`. Model mất mà còn nằm trên route hồ sơ thì thành finding `model_removed`.

Khả năng lấy theo từng trường: lựa chọn người dùng, catalog OmniRoute, bảng LiteLLM đã chép, tên model, rồi ảnh thử. Nút **Kiểm tra khả năng** gửi ảnh 1×1, nhớ 7 ngày, tính một khoản nhỏ vào chi phí, và không chạy khi `VITEST` bật. Danh sách model ghi nguồn: từ OmniRoute, từ bảng LiteLLM, đã thử, hoặc tự đặt.

## Phần 4 · Đổi model khi hết quota

`findEquivalentModel` chọn model cùng họ, cùng hoặc cao hơn bậc, không đưa ECO sang model trả phí, và không đổi model nhìn ảnh sang model không nhìn ảnh. Không có ứng viên thì `LLM_QUOTA_WAIT` giữ `retryAt`. Đổi model chỉ cho lượt đó, ghi `quota_swap`, và chỉ chạy khi `autoSwapOnQuota` bật. Mặc định bật ở mức giám sát và tự chạy, tắt ở tắt và hỗ trợ. Route đã lưu không bị sửa. Playbook `quota_wait` dùng cùng hàm chọn.

## Phần 5 · Sự kiện và webhook

`packages/shared/src/events/agentEvents.ts` có danh sách sự kiện và schema zod, kể cả `ping`. Bus giữ 500 sự kiện. `GET /api/events` đọc lại theo `Last-Event-ID`. Webhook ký Standard Webhooks bằng `node:crypto` ở server, vì đưa `node:crypto` vào barrel của `@vg/shared` làm vỡ trang web. Vector `msg_p5jXN8AQM9LWM0D4loKWxJek` / `1614265330` / `{"test": 2432232314}` khớp `v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=`. Giao hàng nằm trong worker. API có GET, POST, PATCH, DELETE, gửi thử, đổi bí mật và nhật ký. Thẻ Thông báo có tạo, gửi thử, đổi bí mật và nhật ký.

SDK `@modelcontextprotocol/sdk` 1.32.2 có schema `resources/subscribe`, nhưng lớp `McpServer` không đăng ký handler đó. Không gửi `notifications/resources/updated`. Agent dùng `get_events`. Resource đọc `vg://events` vẫn được khai báo.

## Phần 6 · Kiểm tra trên app tạm

App tạm trong thư mục tạm, `IMAGE_PROVIDERS=mock`, không khóa Brave/Gemini, không đụng dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`. Khoảng 11:21 giờ Bangkok (UTC+7):

- `POST /visuals/research` trả `webSearch: false` và có một mục Cần bạn.
- Dự án MANUAL chạy tới cổng duyệt. `GET /api/events` có `stage_started`, `stage_finished`, `waiting_approval`.
- Máy nhận `http://127.0.0.1:3222` nhận 18 lần gửi, cả ba loại sự kiện, chữ ký HMAC khớp bí mật vừa tạo. Bí mật đã xóa khỏi đĩa sau khi đối chiếu.
- Test catalog: thêm `new-model` thì `lastDiff.added` là `["new-model"]`.

## Phần 7 · Hướng dẫn

Đã cập nhật trang ảnh, trang model, `docs/user-guide/ket-noi-agent.md` (mẫu kiểm chữ ký), changelog và feature map.

## Kiểm tra mã

- `tsc` server và web không lỗi. `@vg/shared` đã build lại.
- Shared: rank, timeline, task060.
- Server: webhookSign, visionMax (Brave đúng số cảnh `vision_reject`), visualSearch (một Cần bạn và từ chối khi đang render), omnirouteGateway.
