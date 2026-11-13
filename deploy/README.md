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
