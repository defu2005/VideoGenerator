# Cài Video Agent bằng Docker

Một image `vg` gồm Node 22, ffmpeg (gói `ffmpeg-static` tải bản Linux lúc build), chrome-headless-shell cho HyperFrames, và font Be Vietnam Pro. Vai trò chọn bằng biến môi trường: `VG_ROLE=control` hoặc `VG_ROLE=worker`.

Caddy (image chính thức) phục vụ giao diện đã build và chuyển `/api` sang server, kể cả SSE. Litestream (image chính thức, Apache-2.0) là profile tắt sẵn, dùng khi bạn muốn stream file SQLite.

Script không tự cài Docker và không ghi đè `.env` hoặc thư mục dữ liệu đã có.

## Một máy với Docker

Cần Docker Engine và Compose v2. Trên Ubuntu làm theo hướng dẫn của Docker, rồi:

```bash
bash deploy/install.sh
```

Chọn `control`. Bỏ trống tên miền nếu chỉ mở trên chính máy đó. Script tạo `/opt/vg` (đổi bằng `VG_HOME`), sinh `TOKEN_ENCRYPTION_KEY` và `BETTER_AUTH_SECRET`, build image `vg:dev`, rồi `docker compose up -d`.

Mở `http://<ip-máy>/`. API không gắn cổng ra host. Chỉ Caddy mở cổng 80 và 443.

Lệnh tay, từ thư mục repo, sau khi đã có `deploy/docker/.env`:

```bash
docker build -f deploy/docker/Dockerfile -t vg:dev .
docker compose -f deploy/docker/compose.control.yml up -d
```

## Control plane trên VPS có tên miền

1. Trỏ DNS của tên miền về VPS.
2. Mở cổng 80 và 443.
3. `bash deploy/install.sh control` và nhập tên miền, ví dụ `video.example.com`.

Caddy tự xin chứng chỉ HTTPS. `WEB_BASE_URL` trong `/opt/vg/.env` là `https://` cộng tên miền.

Đăng nhập người dùng thuộc task sau (TASK-114). Trước khi có đăng nhập, đừng để cổng 80/443 mở ra Internet: ai vào được địa chỉ đó là dùng được cả app, gồm token OAuth và operator.

## Chỉ trong LAN

Chạy script và bỏ trống tên miền. `DOMAIN` là `:80`, Caddy không xin chứng chỉ. Mở `http://<ip-lan>/`.

Không forward cổng ra router. Đăng nhập chưa có, nên máy trong cùng LAN đều vào được.

Đổi cổng host bằng `VG_HTTP_PORT` trong `.env` (ví dụ `8080`) rồi `docker compose -f compose.control.yml up -d`.

## Mạng riêng giữa các máy

Nên đặt control và worker trong một mạng riêng, không public.

- **Tailscale**: cài Tailscale trên từng VPS, dùng IP hoặc tên MagicDNS làm `VG_CONTROL_URL` (ví dụ `https://control.tailnet.ts.net` hoặc `http://100.x.y.z`).
- **Headscale** (BSD-3): tự chạy control plane của Tailscale nếu bạn không muốn dùng dịch vụ Tailscale. Các máy vẫn dùng client Tailscale.

Worker không mở cổng vào. Nó tự hỏi việc từ control bằng token máy.

Cách còn lại là HTTPS công khai qua Caddy. Vẫn dùng token node, và chỉ làm vậy khi đã có đăng nhập.

## Sao lưu

File SQLite nằm ở `/data/app.db` trong container, trên host là `$VG_HOME/data` (mặc định `/opt/vg/data`). App bật WAL.

Copy thư mục khi app đã dừng:

```bash
cd /opt/vg
docker compose -f compose.control.yml stop vg
cp -a data "/backup/vg-$(date +%F)"
docker compose -f compose.control.yml start vg
```

Copy cả file `-wal` và `-shm` nếu chúng còn. `docker compose down` không thêm `-v` thì dữ liệu còn. `down -v` xoá volume.

Litestream (tắt mặc định) stream liên tục. Trong `.env`:

```bash
LITESTREAM_REPLICA_URL=s3://ten-bucket/vg
LITESTREAM_ACCESS_KEY_ID=...
LITESTREAM_SECRET_ACCESS_KEY=...
```

Rồi:

```bash
docker compose -f compose.control.yml --profile litestream up -d
```

`file:///backup/vg` được nếu bạn mount thư mục đó vào container Litestream. Không đưa khoá vào image.

## Khôi phục và Diễn tập khôi phục (Restore & Drill)

### 1. Khôi phục từ bản sao lưu snapshot thư mục
Khi cần khôi phục về một thời điểm đã lưu:
1. Dừng container server:
   ```bash
   cd /opt/vg
   docker compose -f compose.control.yml stop vg
   ```
2. Chép file snapshot vào thư mục data (chép cả `-wal` và `-shm` nếu có trong snapshot):
   ```bash
   cp /backup/vg-2026-XX-XX/app.db /opt/vg/data/app.db
   # Nếu có file WAL trong snapshot:
   cp /backup/vg-2026-XX-XX/app.db-wal /opt/vg/data/app.db-wal 2>/dev/null || true
   ```
3. Kiểm tra tính toàn vẹn của CSDL trước khi mở lại app:
   ```bash
   sqlite3 /opt/vg/data/app.db "PRAGMA integrity_check;"
   # Kết quả phải trả về "ok"
   ```
4. Khởi động lại container:
   ```bash
   docker compose -f compose.control.yml start vg
   ```

### 2. Khôi phục từ bản sao lưu Litestream
Nếu đang dùng replica Litestream (S3 hoặc file storage):
1. Dừng server:
   ```bash
   docker compose -f compose.control.yml stop vg
   ```
2. Dùng lệnh `litestream restore` để tái tạo lại file database chính xác:
   ```bash
   litestream restore -o /opt/vg/data/app.db "${LITESTREAM_REPLICA_URL}"
   ```
   Hoặc chạy qua container Litestream:
   ```bash
   docker run --rm \
     -v /opt/vg/data:/data \
     -e LITESTREAM_ACCESS_KEY_ID="..." \
     -e LITESTREAM_SECRET_ACCESS_KEY="..." \
     litestream/litestream:0.3.13 restore -o /data/app.db "${LITESTREAM_REPLICA_URL}"
   ```
3. Khởi động lại hệ thống:
   ```bash
   docker compose -f compose.control.yml up -d
   ```

### 3. Kịch bản diễn tập khôi phục (Restore Drill)
Để kiểm chứng định kỳ quy trình khôi phục mà không làm gián đoạn máy chủ đang chạy, hãy chạy script diễn tập khôi phục:
```bash
# Diễn tập với tạo fixture tự động:
bash deploy/docker/restore-drill.sh

# Hoặc diễn tập khôi phục từ replica S3:
bash deploy/docker/restore-drill.sh s3://my-bucket/vg-backup

# Hoặc diễn tập khôi phục từ snapshot thư mục:
bash deploy/docker/restore-drill.sh /backup/vg-2026-11-17/app.db
```
Script sẽ tự động:
- Tạo một thư mục trống độc lập.
- Khôi phục file SQLite từ nguồn chỉ định.
- Chạy `PRAGMA integrity_check;` để đảm bảo không bị lỗi hỏng cấu trúc B-tree.
- Kiểm tra các bảng lõi và schema migrations (`projects`, `__drizzle_migrations`).
- Báo cáo thời gian hoàn thành (wall-clock duration) và thoát mã 0 nếu đạt chuẩn.

## Cập nhật

Trong thư mục repo mới:

```bash
bash deploy/install.sh control
```

Script build lại image, chép file compose mới vào `/opt/vg`, và `up -d`. `.env` và `data` giữ nguyên. Container `web` copy lại file giao diện khi image đổi.

Worker: `bash deploy/install.sh worker`.

## Worker

```bash
bash deploy/install.sh worker
```

Script hỏi URL control và join token (tạo ở trang Máy worker → Thêm máy, dùng một lần, sống 1 giờ). Compose không mở cổng. Worker không có database: nó nhận token máy, lưu ở `/data/secrets/node.token`, rồi hỏi việc dựng video từ control.

Khóa tùy chọn trong `compose.worker.yml`: `VG_EXIT_FOR_UPDATE=1` (worker thoát với mã 75 khi control báo lệch phiên bản, `restart: on-failure` khởi động lại) và `VG_PULL_POLICY` (mặc định `missing`; đặt `always` khi image lấy từ kho).

Compose dùng `restart: on-failure`. Theo tài liệu Docker, chính sách này chỉ khởi động lại khi container thoát với mã khác 0. Máy bị thu hồi thoát mã 0 nên nằm yên, không lặp. Lỗi cấu hình (thiếu URL, token sai) thoát mã 1 và container thử lại.

Biến môi trường: `VG_CONTROL_URL`, `VG_JOIN_TOKEN`, `VG_NODE_NAME` (mặc định tên máy), `NODE_CACHE_MAX_GB` (mặc định 20), `NODE_SHUTDOWN_GRACE_SEC` (mặc định 120), `VG_ALLOW_INSECURE_CONTROL`. Địa chỉ `http://` công khai bị từ chối trừ khi đặt `VG_ALLOW_INSECURE_CONTROL=true`; mạng riêng và Tailscale dùng được.

## Kho tệp S3 và Cloudflare R2

TASK-138 đánh dấu object không còn tham chiếu rồi chờ thời gian giữ trước khi dọn. Lifecycle của bucket là lớp bổ sung. Tránh đặt lifecycle ngắn trên `blobs/` vì object còn được timeline hoặc bài đăng tham chiếu cần giữ lâu hơn. Xem thời gian chờ, chạy thử và xác nhận dọn ở trang Lưu trữ.

Máy điều khiển và worker cần truy cập được cùng endpoint. Tạo bucket riêng tư và key chỉ có quyền đọc, ghi, xóa object trong bucket đó. Với R2, dùng domain API S3 của tài khoản `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, vùng `auto` và tắt tùy chọn checksum SHA-256. [Tài liệu R2 về URL ký](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

Trong không gian làm việc mặc định, vào **Cài đặt → Lưu trữ**, nhập cấu hình và khóa, lưu rồi bấm **Kiểm tra kết nối**. Máy điều khiển ghi, đọc và xóa một tệp thử 1 KiB. Worker nhận URL cho từng object khi lease chạy và sử dụng lại đường truyền qua máy điều khiển nếu kho không sẵn sàng. Lần đầu dùng tệp, việc sao lưu nền có thể hoàn thành sau khi lease đã phát.

Đặt lifecycle xóa object cũ dưới các prefix `incoming/` và `probes/` sau một khoảng đủ cho lease và khôi phục finalize, ví dụ 7 ngày. `blobs/` là dữ liệu đã xác minh và có vòng đời riêng. Bản dự án cục bộ vẫn cần được sao lưu cùng SQLite.

## edge-tts trong image

Image runtime có sẵn `edge-tts` (giọng đọc mặc định), cài bằng pip trong venv `/opt/edge-tts` thuộc user `vg` (uid 10001) và liên kết ra `/usr/local/bin/edge-tts`. Không cần đặt `EDGE_TTS_PATH`. Khi build, bước `edge-tts --version` kiểm tra lệnh chạy được. Muốn nâng cấp: `docker compose exec vg /opt/edge-tts/bin/pip install -U edge-tts` (mất khi tạo lại container; build lại image để giữ).

## Việc không nằm trong image

Các provider gọi CLI trên máy phải đăng nhập tại máy đó. Image không chứa phiên đăng nhập.

Server gọi chúng như sau:

- **claude-cli** (`apps/server/src/providers/llm/claudeCli.ts`): spawn lệnh `CLAUDE_CLI_PATH` (mặc định `claude`). Biến `HOME` và `CLAUDE_CONFIG_DIR` được giữ. Cấu hình thường ở `~/.claude`.
- **agy / Gemini bằng tài khoản Google** (`antigravityCli.ts`): spawn `agy`, mặc định `~/.local/bin/agy` khi không phải Windows. Bật `ANTIGRAVITY_CLI_ENABLED`.
- **copilot-cli**: spawn `copilot`. Bật `COPILOT_CLI_ENABLED`.
- **cursor-agent** không nằm trong `providers/llm`. Operator (`operator/cli.ts`) trên Windows tìm `LOCALAPPDATA/cursor-agent`. Trên Linux điền đường dẫn binary trong cài đặt operator. Đăng nhập nằm ở `~/.cursor`.
- **codex**: không có provider spawn lệnh codex.
- **Gemini API, Anthropic, OpenAI, OpenRouter, DeepSeek, Groq, OpenCode, custom**: chỉ cần khoá trong `.env`. Dùng được trong Docker.
- **OmniRoute**: HTTP tới `OMNIROUTE_BASE_URL`, mặc định `http://127.0.0.1:20128/v1`. Trong container, địa chỉ đó là chính container, không phải máy host.

Ba cách:

1. **Chạy control plane ngay trên máy đã đăng nhập CLI** (`npm run dev` hoặc `node apps/server/dist/index.js`), không qua Docker. Worker vẫn có thể là container.
2. **Mount binary và thư mục cấu hình** vào user `vg` (uid 10001, home `/home/vg`), rồi bật cờ CLI. Ví dụ Claude:

```yaml
volumes:
  - /usr/local/bin/claude:/usr/local/bin/claude:ro
  - /home/ban/.claude:/home/vg/.claude
environment:
  CLAUDE_CLI_ENABLED: "true"
  CLAUDE_CLI_PATH: /usr/local/bin/claude
```

Đăng nhập bằng cách chạy CLI trên host. Không copy thư mục đó vào image.

3. **Trong Docker chỉ dùng provider có API key**, hoặc OmniRoute chạy trên host. Compose đã thêm `host.docker.internal`. Đặt `OMNIROUTE_BASE_URL=http://host.docker.internal:20128/v1` và `OMNIROUTE_API_KEY` trong `.env`, rồi `docker compose up -d`.

Nên dùng cách 3 trên VPS. Giữ Claude CLI, agy và cursor-agent trên máy bạn đã đăng nhập.

## Hermes Supervisor

Khi vận hành cùng Hermes (giao tiếp qua MCP), bạn có thể tạo lịch cron để Hermes định kỳ kiểm tra và giám sát hệ thống:

```bash
hermes cron create "every 15m" "Run the vg-supervise skill" --skill vg-supervise --name vg-supervise
```

Lưu ý: Tác vụ cron yêu cầu tiến trình Hermes gateway đang chạy (bộ lập lịch hoạt động bên trong gateway).
## Hermes trên nhiều máy

### Nhóm scout tìm ảnh

Dùng `deploy/docker/compose.hermes-scout.yml` khi cần nhiều scout. Với N scout, chạy N Compose project từ cùng mẫu. Mỗi project tạo một volume `<project>_scout-data` cho cặp gateway và sidecar của riêng nó. Chọn tên project khác nhau kể cả khi các scout chạy trên cùng host.

Tạo khóa máy riêng và gắn tên instance, ví dụ `Hermes-2` và `Hermes-3`. Chuẩn bị file biến riêng trên máy cho mỗi scout với `VG_AGENT_NAME` khớp tên trên khóa, `VG_API_URL`, `VG_MCP_URL`, `VG_API_KEY` và `VG_IMAGE` nếu khác mặc định. Chạy từ thư mục repo:

```bash
docker compose -p vg-scout-2 --env-file scout-2.env -f deploy/docker/compose.hermes-scout.yml up -d
docker compose -p vg-scout-3 --env-file scout-3.env -f deploy/docker/compose.hermes-scout.yml up -d
```

Trong Cài đặt → Đội Hermes, giao vai trò `visual_scout` cho từng instance hoặc cho nhóm `*` với giới hạn phù hợp. Sau khi sidecar đồng bộ, khởi động lại gateway để đọc cấu hình lần đầu. Với mỗi scout cần chạy theo lịch, thêm cron nạp skill `visual-scout` trong container tương ứng:

```bash
docker compose -p vg-scout-2 --env-file scout-2.env -f deploy/docker/compose.hermes-scout.yml exec hermes-scout hermes cron create "every 5m" "Run the visual-scout skill once" --skill visual-scout --name vg-visual-scout
```

Lặp lại với tên project và file biến tương ứng của các scout khác. Chỉ định một Hermes khác trực giám sát nếu scout chỉ làm ảnh. Khi scout gọi `delegate_task` để chia cảnh, các agent con dùng chung lease của job và agent nhận việc giữ heartbeat. [Tài liệu skill của Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)

Chuẩn bị bằng `bash deploy/install.sh control --with-hermes`. Bước này chỉ sao chép compose và mẫu `.env.hermes` trống; không khởi động Hermes trước khi bạn đặt khóa riêng. Image mặc định được pin `nousresearch/hermes-agent:0.23.1`; không dùng tag `latest`. Giữ entrypoint chính thức: nó khởi tạo volume rồi hạ quyền xuống user Hermes. Sidecar dùng cùng UID/GID (mặc định 10000) và cùng volume, không chạy root.

1. Trong Tài khoản của tôi, tạo **một khóa máy cho mỗi instance**, gắn loại `hermes`, tên instance riêng; chỉ bật `canSupervise` cho máy được phép nhận trực. Mỗi khóa API gắn với một workspace.
2. Điền `VG_API_URL`, `VG_API_KEY`, `VG_MCP_URL` (URL công khai kết thúc `/mcp`) và `VG_AGENT_NAME` vào `.env.hermes` trên máy đó. Máy Hermes không giữ khóa mô hình nào: mọi lời gọi LLM đi qua `${VG_API_URL}/api/llm/relay/v1` bằng chính `VG_API_KEY` của máy, còn OmniRoute chỉ chạy trên máy điều khiển (nếu OmniRoute chạy trên host, giữ `host.docker.internal` cho `OMNIROUTE_BASE_URL` của control). Chỉ điền khóa trực tiếp vào file của máy; không dán vào prompt, bundle hay báo cáo. Đặt `HERMES_VERSION=0.23.1` hoặc tag cố định khớp Cài đặt → Đội Hermes.
3. Chạy `docker compose --env-file .env.hermes -f compose.control.yml -f compose.hermes.yml up -d hermes vg-hermes-sync`. Để control đọc được `.env` riêng khi dùng `--env-file`, đảm bảo các biến triển khai như `VG_IMAGE`/`DOMAIN` được xuất từ môi trường của control hoặc giữ giá trị mặc định. Trên máy Hermes độc lập, chỉ cần `-f compose.hermes.yml`; API URL trỏ về hub từ xa.
4. Mỗi volume `hermes-data` chỉ có một gateway và một sidecar. Máy khác dùng volume riêng. Không nối hai gateway vào cùng thư mục.
5. Sau đồng bộ cấu hình, chạy `/reload-mcp` hoặc restart gateway. Sidecar chỉ viết `vg-sync/reload-needed`, không restart thay bạn. Tab Fleet hiển thị lệnh cron thiếu; bạn chạy nó, không sửa `cron/jobs.json` bằng tay. Gateway phải chạy để cron hoạt động.
6. Chỉ một Hermes nhận duty tại một thời điểm; máy khác dự phòng. Không dùng token Telegram của app cho Hermes: tắt Telegram ở Hermes hoặc dùng bot khác.
7. Nâng cấp: đổi phiên bản trong Cài đặt → Đội Hermes và `HERMES_VERSION` trong `.env.hermes`, rồi chạy compose với cùng `--env-file`, `pull` và `up -d`. Không xóa volume.

### WSL và stdio

Stdio vẫn chạy `node apps/mcp/dist/index.js`. Để chuyển sang HTTP, sửa riêng mục `mcp_servers.video-agent` trong config Hermes theo ví dụ dưới; không chia sẻ thư mục Hermes đang dùng với một gateway khác:

```yaml
mcp_servers:
  video-agent:
    url: ${VG_MCP_URL}
    headers:
      Authorization: "Bearer ${VG_API_KEY}"
```

Xuất các biến khóa trên WSL bằng cơ chế giữ bí mật bạn đang dùng, đặt `VG_HERMES_HOME` tới thư mục Hermes của instance và `HERMES_VERSION` tới bản đang chạy. Chạy `node apps/mcp/dist/sync.js --once` để kiểm tra, rồi bỏ `--once` để chạy vòng lặp (mặc định 300 giây; có thể đặt `VG_SYNC_INTERVAL_SEC`). Không cần chạy Hermes CLI từ sidecar. Dừng hub không làm sidecar xóa gói đang dùng; lỗi mạng chỉ ghi một dòng gọn.

Bộ đồng bộ giữ các khóa YAML ngoài phạm vi quản lý và ghi `config.yaml.vg-bak` trước khi cấu hình đổi. Chỉ thư mục `vg-skills`, trạng thái trong `vg-sync` và các khóa model/provider/MCP/skills/memory được chỉ định mới được ghi. `skills.external_dirs` của máy được giữ, thêm thư mục gói cục bộ. `.env`, `auth.json`, `memories/` và `sessions/` không được đọc hay gửi đi.

## Hook hoàn tất opencode cho Codex giám sát (dev)

Goal có thể giữ tạm dừng khi opencode đang làm. [Hook cục bộ](dev/OPENCODE-HOOK.md) chờ sự kiện tiến trình thoát bằng Windows process handle, lưu sự kiện vào `tmp/opencode-hook/events/`, rồi dùng CLI đã đăng nhập `codex queue --resume` gửi về đúng chat giám sát. Không có lịch gọi LLM định kỳ; các lượt review/giao việc sau sự kiện vẫn dùng token như bình thường.

Các phiên mới chạy qua `deploy/dev/Run-OpencodeTask.ps1`; phiên đã chạy có thể gắn `Watch-OpencodeCompletion.ps1` mà không khởi động lại worker. Cấu hình đường dẫn CLI/thread ở `tmp/opencode-hook/config.json`, không chứa khóa. Đặt `Enabled=false` để ngừng gửi callback mà không dừng worker. Helper và Codex daemon cần còn chạy; reboot không tự phục hồi các watcher hiện tại. Xem tài liệu hook để kiểm tra outbox, gửi lại lỗi vận chuyển và chạy bộ kiểm tra offline.
