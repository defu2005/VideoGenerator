# TASK-123 — Đội Hermes đồng bộ

## Phạm vi và file
- MCP: `apps/mcp/src/http.ts`, `index.ts`, `apiClient.ts`, `tools.ts`; HTTP Streamable tại `/mcp`, stdio giữ nguyên; catalog thay đổi được cập nhật ở phiên đang mở.
- `apps/mcp/src/sync.ts`, bin `vg-hermes-sync`: heartbeat, kiểm hash, đổi symlink generation nguyên tử trên WSL/Docker (Windows dùng thư mục staging và rollback), gộp YAML có backup, gửi bản nháp mới/đổi, báo lệnh cron thiếu; không gọi Hermes CLI hay LLM.
- Shared: `packages/shared/src/fleet/schema.ts`; kiểm đường dẫn, định dạng gói và bề mặt cấu hình quản lý.
- Server: `fleet/{service,lessons,toolDefs}.ts`, `api/fleet.ts`, `registry/catalog.ts`; nối vào app, registry, policy, snapshot và handbook/runtime model.
- Schema: mở rộng `agent_instances`, thêm `agent_lessons` theo workspace; migration Drizzle `0077_zippy_riptide.sql` và snapshot, không sửa SQL tay.
- Skill: giữ các nháp từ nhiều instance, nguồn/phiên bản gốc/tệp tham chiếu; `needs_merge` không kích hoạt được; user gộp dựa trên phiên bản đã chọn và giữ tệp của nó. Tự kích hoạt chỉ đọc mặc định tắt; tệp hỗ trợ text có giới hạn, không nhận file thực thi/auth.
- Web: Fleet cạnh Hermes và `/settings/hermes-fleet`; cấu hình, trạng thái từng máy, cách sửa, chép lệnh cài/cron; SkillVersions so sánh hai bản cần gộp.
- Đóng gói: compose MCP + route Caddy, compose Hermes/sidecar cùng UID và volume; `install.sh --with-hermes` chỉ chuẩn bị mẫu khóa trống; Dockerfile có repo skills.
- Tài liệu: `deploy/README.md`, hướng dẫn tự vận hành, changelog, featureMap; không thêm npm dependency. package/lock chỉ thêm bin sidecar, dùng YAML parser đang có.

## Endpoint và quyền
- `GET /api/agents/bundle`: khóa máy loại Hermes; `POST /api/agents/instances/heartbeat`: danh tính theo khóa, không giả tên instance.
- `POST /api/agents/skills/drafts`: agent đã xác thực, lưu qua saveSkillDraft và routing eval; có provenance và phát hiện parent cũ.
- `GET /api/operator/fleet`, `GET/PUT /api/settings/hermes-fleet`: chỉ chủ instance đăng nhập qua UI; khóa agent không bật được auto-activate.
- Registry có `record_lesson`, `search_lessons`, `retire_lesson` (ngừng dùng chỉ Hermes đang trực); dedup, digest giới hạn 6 KB, tách workspace/phạm vi profile. Handbook và runtime model cùng nhận bài học dưới dạng dữ liệu được escape.
- HTTP MCP chỉ giữ dấu băm khóa/workspace trong session; kiểm quyền qua API mỗi request và truyền khóa của request; không fallback khóa local. Header nguồn `agent` không nâng actor thành owner.
- `/api/health` có MCP liveness/count/hash qua URL nội bộ được cấu hình; lỗi MCP không làm health DB giả lỗi.

## Cấu hình và nguồn đã kiểm
- Quản lý `model.provider/default/base_url`, `providers.<name>.api/api_mode/api_key`, `mcp_servers.video-agent.url/headers.Authorization`, `skills.external_dirs`, `memory.memory_enabled`.
- Provider giữ tham chiếu biến `VG_HERMES_MODEL_KEY`; MCP giữ tham chiếu `VG_API_KEY`/`VG_MCP_URL`, không gửi giá trị. Khi chuyển từ stdio, bỏ command/args/env/transport cũ của riêng entry video-agent.
- Giữ khóa YAML ngoài phạm vi và comment; giữ external_dirs khác, thêm thư mục gói cục bộ theo Docker/WSL; backup trước đổi, marker yêu cầu reload; không restart gateway.
- Tài liệu chính thức và [example cấu hình v0.23.1](https://github.com/NousResearch/hermes-agent/blob/v0.23.1/cli-config.yaml.example) xác nhận memory, provider và tham chiếu biến. Khác guide: `providers.<name>.api` là URL, wire format dùng `api_mode: chat_completions`; model chọn `custom:<name>`.
- [MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp): remote URL + headers; [Docker](https://hermes-agent.nousresearch.com/docs/user-guide/docker): /opt/data và entrypoint hạ quyền. Pin 0.23.1 theo [release chính thức](https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.1).
- [LICENSE Hermes](https://github.com/NousResearch/hermes-agent/blob/main/LICENSE) là MIT. Dùng Hermes và MCP SDK nguyên trạng, không vendor/copy mã bên ngoài.
- Đã đọc [profile distributions](https://hermes-agent.nousresearch.com/docs/user-guide/profile-distributions): cần git hosting, khác mô hình hub pull hiện tại.
- Đã đọc [remote config](https://hermes-agent.nousresearch.com/docs/user-guide/remote-config) và config-backend seam: có phân tầng/lock/CAS, OAuth on-prem, startup fail-closed. Tài liệu chưa cung cấp hợp đồng HTTP server đầy đủ cho app làm plane; không thay YAML merge trong task này. Có thể đánh giá thành task riêng nếu muốn quản lý lock tập trung.

## Kiểm chứng
- Typecheck/build toàn workspace đã qua; sau sửa atomic sync, MCP typecheck/build và 30/30 test chạy lại qua.
- Test mới phủ tách client HTTP/khóa/workspace, cập nhật catalog; đường dẫn/hash/secret, giữ config/khóa/memory/session, push thay đổi và parent trước pull; bundle/version, xung đột, read-only opt-in, duty, drift, scope và lesson data trong runtime.
- Smoke SDK HTTP thật với API fixture: initialize hai client, gọi tool bằng khóa riêng và cập nhật catalog thành công.
- Docker container MCP với dist mới mount read-only: `/mcp` không khóa trả 401, `/health` trả 200; container đã dọn. Không chạy gateway Hermes thật.
- Smoke Linux trong container không mạng: chuyển generation, giữ được reader gói cũ, loại symlink ra ngoài; qua. Generation cũ giữ trong volume để reader đang mở không bị mất tệp.
- Compose control + Hermes kiểm cú pháp qua config với env fixture trống, không xuất bí mật.
- Chromium desktop/375px, toàn bộ API fixture: hiển thị drift/cron, lưu model, không tràn ngang; ảnh chụp đã kiểm.
- Lượt toàn workspace: shared 752/752, MCP 30/30, server 1.296 qua + 6 bỏ qua, web 217/217 (tổng 2.295 qua). Sau bổ sung một test phạm vi, nhóm fleet/auth/supervision chạy lại 39/39 qua.
- Test đã bắt lỗi gộp YAML khi chưa có entry MCP; đã sửa, toàn workspace chạy lại qua. Test model runtime dùng stub structured response, không gọi model thật.
- Fleet lọc instance theo workspace và phát hiện gói đổi sau heartbeat cuối, kể cả sidecar không gửi heartbeat mới; đã có test hai workspace và thời gian trễ 15 phút.
- Quét UTF-8/NUL các file thay đổi: qua; `bash -n deploy/install.sh`: qua. Hai lần generate Drizzle: lần sau không còn schema thay đổi.

## Phần người dùng làm và giới hạn
- Người dùng tạo khóa riêng từng máy, chọn model/URL, điền biến trên máy đó, tạo cron được tab Fleet chỉ ra, chạy `/reload-mcp` hoặc restart gateway; đổi image tag khi nâng phiên bản.
- Cron store chỉ đọc để phát hiện thiếu; không chỉnh JSON Hermes trực tiếp. Hub mất kết nối thì giữ gói cũ; không đọc/gửi `.env`, auth, memory hay session của Hermes.
- TASK-074b chưa có: dùng routing eval hiện tại và để mốc tích hợp behaviour/shadow; không tự cho skill ghi dữ liệu hoạt động.
- Người dùng đã cho phép tự review rồi chuyển task không chờ commit; không commit/push. Không tác động dữ liệu thật hay dự án được bảo vệ.
