# Sổ tay vận hành hệ thống hai máy (Two-Machine Runbook) 🛡💻

Tài liệu này hướng dẫn thiết lập, kiểm tra và xử lý sự cố cho mô hình phân tán 2 máy của Video Agent:
- **Máy A (Control Plane)**: Chạy máy chủ điều khiển trung tâm (API, DB SQLite với WAL/Litestream, Caddy, Giao diện web). Thường đặt trên VPS hoặc máy chủ mini LAN.
- **Máy B (Worker Node)**: Chạy tiến trình dựng video và xử lý nặng (GPU NVIDIA/Apple Silicon, FFmpeg, HyperFrames, Remotion). Thường là PC đồ họa trong mạng LAN hoặc kết nối qua VPN riêng.

---

## 1. Yêu cầu tiên quyết (Prerequisites Checklist)

| Hạng mục | Máy A (Control Plane) | Máy B (Worker Node) | Cách kiểm tra |
| :--- | :--- | :--- | :--- |
| **Hệ điều hành** | Ubuntu 22.04+ / Debian 12 / Windows Server | Windows 10/11 / Ubuntu Desktop / macOS | `uname -a` hoặc `winver` |
| **Đồng bộ thời gian** | Lệch đồng hồ < 1 giây (bắt buộc để lease không lệch) | Lệch đồng hồ < 1 giây | Linux: `chronyc tracking` hoặc `timedatectl`<br>Windows: `w32tm /query /status` |
| **Docker Engine** | Docker Engine 24+ & Docker Compose v2 | Docker Engine 24+ (nếu chạy container worker) | `docker --version` |
| **Dung lượng đĩa trống** | ≥ 20 GB (chứa DB, logs, blob store) | ≥ 50 GB (chứa assets render, temp clips) | `df -h` hoặc `Get-PSDrive` |
| **GPU & Trình render** | Không bắt buộc | NVIDIA GPU (NVENC) / Apple Metal / CPU đa nhân | `nvidia-smi` |
| **Mở cổng mạng** | Cổng 80/443 (Caddy), hoặc cổng Tailscale | Không mở cổng vào (worker chỉ gọi outbound tới control) | `ss -tulpn` hoặc `netstat` |

> ⚠️ **Quy tắc vàng về an toàn dữ liệu**: Tuyệt đối không bao giờ duyệt cổng hoặc render thử nghiệm trên dự án có ID cố định được bảo vệ (`56374fb2-54cf-48ff-9441-2e6c653295d4`). Mọi lệnh kiểm tra phải tạo một dự án thử riêng (`test-project-*`).

---

## 2. Lựa chọn kết nối mạng (Network Topology)

### Lựa chọn 1: Mạng riêng ảo Tailscale (Khuyên dùng)
Tailscale tạo mạng mã hóa WireGuard ngang hàng giữa 2 máy, không cần mở cổng ra Internet:
1. Cài Tailscale trên Máy A và Máy B (`tailscale up`).
2. Control công khai qua Caddy (cổng 80 và 443, API 3001 nằm trong mạng Docker). Có hai cách:
   - Mạng Tailnet hoặc LAN: để `DOMAIN=:80`, dùng IP Tailnet của Máy A (ví dụ `100.101.102.103`). Worker chấp nhận `http://` tới IP riêng (dải 100.64–127 của Tailscale, RFC 1918), không cần thêm cổng.
   - Tên miền: đặt `DOMAIN=control.example.com` để Caddy tự lấy HTTPS. Tên `*.ts.net` qua `http://` bị worker từ chối. Muốn HTTPS cho tên Tailnet, người dùng phải tự bật `tailscale serve` hoặc cấu hình tương đương; repo không làm việc này.
3. Trên Máy B, đặt `VG_CONTROL_URL=http://100.101.102.103` (IP Tailnet của Máy A) hoặc `VG_CONTROL_URL=https://control.example.com` (tên miền đã trỏ tới Máy A).
4. Máy B không cần mở bất kỳ cổng nào; tường lửa chặn toàn bộ kết nối lạ ngoài Tailnet.

### Lựa chọn 2: HTTPS công khai qua Caddy
Nếu Máy A là VPS có IP tĩnh và tên miền (ví dụ `https://video.example.com`):
1. Caddy trên Máy A tự động xin chứng chỉ Let's Encrypt qua cổng 80/443.
2. Trên Máy B, đặt `VG_CONTROL_URL=https://video.example.com`.
3. Worker xác thực thông qua header token bí mật (`Authorization: Bearer <node-token>`).

---

## 3. Các bước thiết lập từng bước (Step-by-step Setup)

### Bước 1: Khởi tạo Máy A (Control Plane)
1. Trên Máy A, tải repo và tạo thư mục `/opt/vg`:
   ```bash
   bash deploy/install.sh control
   ```
2. Cấu hình biến môi trường tại `/opt/vg/.env`:
   - `LITESTREAM_REPLICA_URL`: URL lưu trữ bản sao dự phòng (ví dụ `s3://my-bucket/vg` hoặc `file:///backup/vg`).
3. Khởi chạy cụm điều khiển:
   ```bash
   cd /opt/vg
   docker compose -f compose.control.yml --profile litestream up -d
   ```
4. Kiểm tra trạng thái:
   ```bash
   curl -s http://localhost/api/admin/db-stats | jq .
   ```

### Bước 2: Khởi tạo token và gia nhập từ Máy B (Worker Node)
1. Đăng nhập giao diện web Máy A, vào mục **Cài đặt** → **Máy worker** (`/nodes`), hoặc gọi API tạo token gia nhập:
   ```bash
   # Tạo Join Token có hiệu lực 60 phút
   curl -X POST http://localhost/api/nodes/join-tokens -H "Authorization: Bearer <ADMIN_TOKEN>"
   ```
2. Trên Máy B, cấu hình `.env` cho worker:
   ```env
   VG_CONTROL_URL=http://100.101.102.103
   VG_JOIN_TOKEN=<token_vừa_tạo>
   VG_NODE_NAME=pc-gpu-rtx4090
   VG_NODE_CAPABILITIES=render,thumbnail,vision
   ```
3. Khởi chạy worker trên Máy B:
   ```bash
   # Nếu chạy trực tiếp trên Windows Node.js:
   npm run start:worker
   # Hoặc chạy qua Docker:
   docker compose -f deploy/docker/compose.worker.yml up -d
   ```
4. Máy A sẽ xác nhận node mới chuyển sang trạng thái `online` trong danh sách máy worker.

---

## 4. Kịch bản kiểm tra hoạt động (Scripted Smoke Test)

Chạy chuỗi kiểm tra end-to-end trên một dự án mẫu:
1. **Tạo dự án kiểm tra**:
   Tạo dự án mới với tiêu đề `Smoke Test 2-Machine`, xác nhận ID dự án là UUID ngẫu nhiên.
2. **Kích hoạt bước Render**:
   - Chạy pipeline đến bước `RENDER`.
   - Máy A tạo job RENDER ở trạng thái `PENDING`.
3. **Kiểm tra Lease**:
   - Máy B polling `POST /api/nodes/claim`, nhận việc và nhận `leaseId`.
   - Kiểm tra DB Máy A: Job đổi sang `status = 'RUNNING'`, `node_id = '<id-máy-B>'`, `lease_until` được gia hạn định kỳ mỗi 15 giây theo heartbeat.
4. **Kiểm tra tải lên và Relay Usage**:
   - Máy B render xong, tải video artifact lên Máy A qua chunked upload.
   - Máy A ghi nhận dung lượng và checksum SHA-256.
   - Ghi nhận `llm_relay_usage` và `audit_log` được flush vào SQLite.
5. **Duyệt hoàn tất (Finalize Claim)**:
   - Máy B gọi hoàn tất job (`POST /api/nodes/jobs/:id/complete`).
   - Máy A cập nhật job `status = 'COMPLETED'`, mở khóa cho bước tiếp theo.

---

## 5. Kịch bản diễn tập sự cố (Failure Drills)

### Sự cố 1: Máy B (Worker) tắt đột ngột giữa chừng khi đang render
- **Mô phỏng**: Đang render ở 50%, tắt đột ngột tiến trình worker trên Máy B (`kill -9` hoặc ngắt nguồn).
- **Hiện tượng**:
  - Máy A ngừng nhận heartbeat từ Máy B.
  - Khi thời gian lease (`lease_until`) hết hạn (sau 45 giây), job lease chuyển sang `expired`.
  - JobRepository tự động chuyển job về hàng chờ thử lại (`PENDING`), tăng số lần thử `attempts`.
- **Phục hồi**: Bật lại Máy B hoặc một worker khác trong fleet nhận lại job và hoàn tất video.

### Sự cố 2: Đứt cáp mạng giữa 2 máy trong 2 phút
- **Mô phỏng**: Ngắt mạng Máy B tạm thời (ví dụ ngắt adapter mạng 120 giây) khi đang tải tệp video render lên Máy A.
- **Hiện tượng**:
  - Kết nối HTTP upload bị ngắt kết nối giữa chừng.
  - Máy A giữ nguyên các chunk đã nhận trong bộ đệm upload tạm thời.
- **Phục hồi**:
  - Khi mạng kết nối lại, client upload của Máy B tự động truy vấn chunk cuối cùng đã nhận và tiếp tục tải từ byte tiếp theo (resumable upload theo TASK-134).
  - Tệp hoàn thành nguyên vẹn mà không cần render lại từ đầu.

### Sự cố 3: Máy A (Control Plane) khởi động lại khi Worker đang giữ Lease
- **Mô phỏng**: Khởi động lại container `vg` trên Máy A trong lúc Máy B đang thực hiện render.
- **Hiện tượng**:
  - Khi Máy A tắt sạch (clean shutdown), toàn bộ hàng đợi ghi gộp (audit log, usage queue) được xả xuống SQLite và thực thi WAL checkpoint TRUNCATE.
  - Khi Máy A khởi động lại, `PRAGMA quick_check` xác minh CSDL hợp lệ.
  - Máy B gửi heartbeat kế tiếp, Máy A đọc lại thông tin node và giữ nguyên trạng thái lease đang còn hiệu lực nếu chưa vượt quá thời gian timeout.
  - Tiến trình render của Máy B không bị ngắt quãng.

---

## 6. Chạy thử trên một máy (hai container)

Đã kiểm trên Docker Desktop (xem `docs/tasks/TASK-143.runlog-2026-11-18.md`). Dùng để kiểm enrol, heartbeat, offline và phục hồi; không thay thế kiểm trên hai máy thật.

1. Control: `docker volume create vg-test-control` rồi chạy image với `VG_ROLE=control`, `DATABASE_PATH=/data/app.db`, `DATA_DIR=/data`, và các biến bí mật giả chỉ cho thử nghiệm. Cổng publish vào `127.0.0.1` với cổng khác 3001.
2. Tạo owner: `POST /api/setup/owner` kèm mã thiết lập một lần in trong log control (`docker logs`). Từ host qua Docker NAT, truy cập loopback không được coi là "máy này", nên phải dùng mã.
3. Đăng nhập `POST /api/auth/sign-in/email`, lấy cookie, rồi `POST /api/nodes/join-tokens` để có join token.
4. Worker: `VG_ROLE=worker`, `VG_CONTROL_URL=http://host.docker.internal:<cổng>`, `VG_JOIN_TOKEN=<token>`, và **`VG_ALLOW_INSECURE_CONTROL=true`** vì URL là http không phải địa chỉ riêng. Thêm `--add-host host.docker.internal:host-gateway`.
5. Lần sau khởi động lại worker trên cùng volume không cần join token; token đã lưu.
6. Healthcheck của image trỏ tới `/api/health` cổng 3001, worker không có cổng này. `deploy/docker/compose.worker.yml` đã tắt healthcheck (`healthcheck: disable: true`), nên chạy bằng compose thì worker không còn `unhealthy`. Chạy bằng `docker run` thẳng: HEALTHCHECK của image (TASK-150 C) kiểm tra `DATA_DIR/worker-alive` còn mới dưới 60 giây. Khi control plane không truy cập được, heartbeat lỗi, file cũ dần và container báo `unhealthy`. Đây là chủ ý. Ghi chú: `--start-period=90s` được chọn theo timeout của render probe (60 s), chưa đo thực tế. Chưa kiểm chứng trên Docker build thật.
7. Dọn sau khi thử: xóa container và volume thử nghiệm.
