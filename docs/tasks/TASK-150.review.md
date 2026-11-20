# TASK-150 — review chỉ đọc, 2026-11-19

**Kết luận:** chấp nhận cho phần A và B. Phần C chấp nhận về logic, chưa chấp nhận về vận hành vì chưa đo bằng Docker.

## Đã kiểm
- A (sidecar): không đổi `composeBridge.ts`; test pass. Đây chỉ là test cho hành vi đã có.
- B (inbox): `mailbox.ts:131–134` loại hàng `toKind === "duty"` do chính instance gửi. Tin trực tiếp (`toKind === "instance"`) vẫn được trả. Các truy vấn `acked_at IS NULL` còn lại không phải hộp thư của người đọc, nên không đổi là đúng.
- C (liveness): `LIVENESS_FILE` và `writeLiveness` trong `node/agent.ts` ghi vào `this.dataDir`, lấy từ `DATA_DIR`. Dockerfile đặt `ENV DATA_DIR=/data` (dòng 113), nên lệnh HEALTHCHECK đọc đúng file. Lệnh HEALTHCHECK chỉ kiểm tra khi `VG_ROLE=worker`; các role khác vẫn gọi `/api/health`.
- Test chạy lại hôm nay: `composeSidecarSurvivesEdit`, `preview`, `dutySelfReport`, `workerLivenessFile`, 4 file, 51/51 pass.

## Chưa xác minh (chặn việc coi là xong về vận hành)
- Chưa build image Docker và chưa chạy HEALTHCHECK thật trong container. Mọi kết luận về C là từ đọc code và lệnh `node -e` trên máy này.
- `--start-period=90s` và `--retries=5`: con số dựa trên timeout của probe (`PROBE_TIMEOUT_MS = 60_000`). Chưa đo.
- Runbook chưa cập nhật về việc worker unhealthy khi control plane không truy cập được.

## Ghi chú
- Báo cáo nói `agent.ts` đã có 352 dòng diff chưa commit từ trước phiên. Đây là thay đổi của phiên khác, không phải của TASK-150; không được revert.
- Báo cáo ghi đường dẫn `worker-alive` và `probe.ts:16`. Đã đối chiếu: đúng.
- **DATA_DIR khi không đặt (không chặn):** lệnh HEALTHCHECK dùng `process.env.DATA_DIR||'/data'`, còn worker dùng `resolvePath(env.DATA_DIR ?? "./data")` (`node/agent.ts:173`). Hai nơi chỉ khớp nhau khi image đặt `DATA_DIR=/data` (Dockerfile dòng 113). Nếu chạy worker ngoài image mà không đặt `DATA_DIR`, file ghi ở `./data/worker-alive` nhưng lệnh HEALTHCHECK kiểm `/data/worker-alive`, nên container sẽ báo unhealthy sai. Trong image hiện tại không xảy ra. Nên sửa để HEALTHCHECK dùng cùng mặc định `./data` nếu có chạy worker ngoài image.

## Lượt bổ sung 2026-11-20

- Chạy lại cùng lượt với 074b-4 và 149 (7 file gồm `composeSidecarSurvivesEdit`, `dutySelfReport`, `workerLivenessFile`, `preview`): **95/95 pass**. Các ca A, B, C vẫn pass.
- Đã đối chiếu Dockerfile: `ENV DATA_DIR=/data` ở dòng 113; HEALTHCHECK ở dòng 191 vẫn dùng `process.env.DATA_DIR||'/data'`. Mục DATA_DIR ở trên **vẫn đúng và chưa được sửa**: chạy worker ngoài image mà không đặt `DATA_DIR` sẽ làm HEALTHCHECK kiểm sai đường dẫn.
- Đã đọc lại các dòng đã trích: `mailbox.ts:133` (lọc `toKind === "duty"` và `fromInstance === instance`; báo cáo ghi 131–134, khớp), `node/agent.ts:363` (`writeLiveness`) và `:395` (gọi sau heartbeat). Khớp báo cáo.
- Chưa build image Docker; con số `--start-period=90s` vẫn chỉ dựa trên đọc code, chưa đo.
- Kết luận không đổi: chấp nhận về logic. Chưa chấp nhận về vận hành cho đến khi build và chạy HEALTHCHECK thật trong container.
