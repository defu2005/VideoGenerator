# TASK-117

Image `vg:dev`: 2 059 220 292 byte (1,92 GiB), linux/amd64. `docker build -f deploy/docker/Dockerfile -t vg:dev .` xong lúc 10:34 ICT, 26 phút 48 giây.

File mới: `.dockerignore`, `deploy/docker/Dockerfile`, `entrypoint.sh`, `Caddyfile`, `litestream.yml`, `compose.control.yml`, `compose.worker.yml`, `deploy/install.sh`, `deploy/README.md`. Sửa thêm `apps/server/src/index.ts`, `docs/user-guide/cai-dat.md`, `docs/user-guide/nhat-ky-thay-doi.md`. Không sửa `package.json` hay lockfile. Không commit.

Đã kiểm: compose cổng 18080, volume tạm. `GET /api/health` qua Caddy trả 200 (`db: ok`). Trang `/` trả HTML. Sau đó `down -v`. `VG_ROLE=worker` in `worker mode chưa có (TASK-118)` và thoát 0. ffmpeg-static 7.0.2 và ffprobe-static chạy trong image. Chrome headless-shell 152.0.7977.30 cài bằng `hyperframes browser ensure`. Font Be Vietnam Pro (OFL): URL variable trả 404, bản Regular 132 948 byte từ bettergui, `fc-list` thấy family. Tag Litestream `0.3.13` có trên registry; profile không bật. `npm run typecheck` đã qua. Đăng nhập: chưa kiểm vì 114 chưa xong.

Render: `VG_COMPOSE_SAMPLE_ONLY=list_full` không khớp tên mẫu (`list-bar`, `list-six`). Chạy test `style preset` với `VG_STYLE_SAMPLE_ONLY=newsroom-16x9` trong stage build. Lần đầu dừng ở 120 giây với `hết giờ render mẫu`: hyperframes ghi tiến độ ra stdout, `runHyperframes` không đọc pipe nên process kẹt. Cùng lệnh, chỉ trong container, đọc stdout: test đạt 21 giây, PNG 393 430 byte nằm trong container, không ghi `docs/compose/samples` của máy host. Render trực tiếp cùng mẫu: mov 38,7 MB, 1920×1080, 5 giây, 26,2 giây.

CLI: image không có claude, agy, copilot, cursor-agent, edge-tts hay OmniRoute. Nên dùng API key, hoặc OmniRoute trên máy host qua `host.docker.internal`. Không đưa đăng nhập vào image. Muốn CLI thì mount binary và thư mục cấu hình cho uid 10001.

Câu hỏi mở: worker chờ TASK-118. Hàm render cần đọc stdout của hyperframes thì đồ hoạ trong container mới không bị cắt ở 120 giây; task không cho sửa file đó. edge-tts chưa có trong image. Lockfile tạo trên Windows không kéo `@rollup/rollup-linux-x64-gnu`; Dockerfile cài gói đó trong image.
