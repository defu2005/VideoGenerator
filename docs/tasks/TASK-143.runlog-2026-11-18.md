# TASK-143 — runlog hai container trên một máy (2026-11-18)

**Môi trường:** Windows 11 + Docker Desktop, một máy. Control và worker chạy trong hai container trên volume tạm (`vg-r143-control`, `vg-r143-worker`). Không mount `.env`, không đụng `data/` hay `data-dev/`, không dùng dự án được bảo vệ. Cổng control: `127.0.0.1:3311`. Không dùng 3001, 5173, 3100, 5100.

**Image:**
- `vg-app:diag` (build trước đó, giữ làm mốc "trước").
- `vg-app:r143fix` (build từ cây làm việc đang dirty, nằm trên commit `f367f14`). Image này gồm cả thay đổi chưa commit của các task khác (ví dụ 135b), không chỉ fix worker. Build exit 0; kiểm tra `keepAlive` có trong `dist/node/agent.js`.

**Dữ liệu giả, không phải thật:** mật khẩu owner, khóa nội bộ và mã thiết lập đều là giá trị test. Mã thiết lập, session token, join token đã được che.

## 1. Lỗi phát hiện: worker thoát sau một heartbeat (trước khi sửa)

- Với `vg-app:diag`, worker enrol thành công (`Đã tham gia hệ thống.`) rồi thoát mã **13**: `Detected unsettled top-level await at .../index.js:6`.
- DB control: node `r143-worker` ở trạng thái `offline`, `last_seen_at` = 02:57:40 (một heartbeat duy nhất).
- Nguyên nhân: `NodeAgent.sleep()` (`apps/server/src/node/agent.ts`) dùng `setTimeout(...).unref()`. Giữa hai heartbeat không còn handle nào giữ event loop, nên Node thoát. Lỗi này có trong `HEAD` (dòng 280).

**Sửa:** trong `runWorkerAgent` thêm `setInterval(() => undefined, 60_000)` giữ tiến trình sống, và `clearInterval` trong `finally`. Không đổi `NodeAgent`. Typecheck `apps/server` sạch. `workerAgent`, `workerNodeE2E`, `workerNodes`: 41 passed, 1 skipped.

## 2. Sau khi sửa (`vg-app:r143fix`)

| Kiểm tra | Kết quả |
|---|---|
| Worker còn sống sau 60 s | Có (`Up`) |
| `last_seen_at` qua 3 lần đọc, cách ~20 s | 03:06:16 → 03:06:31 → 03:07:01, status `online` |
| Kill worker, chờ ~75 s | `offline` (last_seen 03:07:01; ngưỡng `NODE_OFFLINE_AFTER_MS` = 45 s) |
| Start lại cùng volume, không có join token | Online lại (last_seen 03:08:54), không yêu cầu token mới |
| `docker restart` control khi worker đang chạy | Control healthy sau 30 s; worker vẫn online (last_seen 03:09:26) |
| `docker pause` control 120 s, rồi unpause | Worker online lại (last_seen 03:12:09). Đây là **xấp xỉ** cho đứt mạng, không phải đứt cáp thật |
| `GET /api/admin/db-stats` (runbook 1.4) | Trả dữ liệu: `journalMode=wal`, `busyTimeout=5000`, `synchronous=NORMAL`, `busyCount=0`, `dbSize≈2.1 MB`, `walSize≈4.1 MB`, `lastCheckpoint=null` |

**Startup `quick_check`:** `apps/server/src/db/client.ts` chỉ ghi log khi kết quả không phải `ok` (hoặc khi lệnh lỗi). Lúc khởi động bình thường không có dòng log nào, đây là thiết kế chứ không phải lỗi. Không kiểm chứng được nhánh cảnh báo vì không làm hỏng DB.

## 3. Quan sát (không phải lỗi đã xác nhận)

- **Loopback qua Docker NAT:** `POST /api/setup/owner` từ host bị 403 "Chỉ tạo được chủ sở hữu từ máy này". Phải dùng mã thiết lập một lần in trong log control.
- **`http://` tới địa chỉ công khai:** worker từ chối (`Từ chối http:// tới địa chỉ công khai`). Cần `VG_ALLOW_INSECURE_CONTROL=true` cho chạy một máy. Đã thêm vào runbook.
- **`mcp.up: false`** trong `/api/health` của control: container này không chạy service MCP.
- **Control gọi ra ngoài khi khởi động:** watcher tri thức (`watch:guideline.youtube`, `market.US`...) gọi tới các trang công khai và ghi `status: error` khi không tới được. Đây là hành vi nền, không liên quan tới đo lường.

## 4. Lỗi do image (mới phát hiện)

- `HEALTHCHECK` trong `deploy/docker/Dockerfile` gọi `http://127.0.0.1:3001/api/health`. Worker không mở cổng đó, nên container worker luôn `unhealthy` dù worker đang online (log health: exit code 1 liên tiếp). **Đã sửa trong `deploy/docker/compose.worker.yml`** bằng `healthcheck: disable: true` (xác nhận bằng `docker compose config`). Image không đổi. Chỉ xác minh bằng `docker compose config` (thấy `healthcheck: disable`), chưa chạy container worker bằng compose. Lần chạy `docker run` ở trên vẫn dùng HEALTHCHECK của image nên vẫn `unhealthy`.

## 5. Chưa chạy (cần job thật)

| Drill | Lý do chưa chạy |
|---|---|
| Kill worker giữa render, lease hết hạn, job quay về `PENDING` | Cần dự án ở RENDER, cần LLM và TTS thật |
| Đứt mạng khi upload, resume từ chunk cuối (134) | Cần upload artifact thật |
| Finalize claim, `POST /api/nodes/jobs/:id/complete` | Cần job đã claim |
| Relay usage (`llm_relay_usage`) được flush | Cần lượt gọi LLM qua relay |
| Restore Litestream từ replica thật trên MinIO | Chưa làm. Bản file replica đã chạy và PASS ở vòng trước, xem `TASK-143.evidence.md` mục 1 |

## 6. Dọn dẹp

Đã xóa: container `vg-r143-control`, `vg-r143-worker`; volume `vg-r143-control`, `vg-r143-worker`; jar cookie trong scratchpad. Giữ `vg-app:diag` và `vg-app:r143fix`.

## Kết luận

Hai container trên một máy: enrol, heartbeat, offline khi kill, online lại không cần token, control restart và pause 120 s đều phục hồi. Lỗi worker thoát sớm đã được sửa và kiểm chứng trên image. Đã sửa: healthcheck của worker (tắt trong compose). Chưa đạt: toàn bộ drill cần job; restore Litestream trên MinIO (file replica đã PASS ở vòng trước).

Chưa commit, chưa push, chưa promote.

## 7. Hồi quy keep-alive (đã thêm sau khi chạy)

- `apps/server/test/workerKeepAlive.test.ts`: chạy child process `runWorkerAgent` từ `dist` với control stub trên loopback, đợi ít nhất 3 heartbeat rồi kiểm tra tiến trình còn sống.
- Có fix: PASS. Đã thay `setInterval` bằng mutant (xóa keep-alive): FAIL với `Detected unsettled top-level await`, exit 13. Đã khôi phục fix.
- Bộ worker (`workerKeepAlive`, `workerAgent`, `workerNodes`): 42 passed. `tsc --noEmit` apps/server: exit 0.
