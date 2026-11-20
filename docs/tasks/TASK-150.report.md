# TASK-150 — báo cáo: sidecar kế hoạch, inbox tự gửi, HEALTHCHECK worker

**Trạng thái:** đã implement và test (A, B, C). Chưa review, chưa commit, chưa push, chưa dispatch.
**Căn cứ:** `docs/cursor/TASK-150.md`. Phạm vi theo ruling advisor 2026-11-19 (ngoại lệ một lần, không commit, không push, không ghi `data/app.db`, không tạo tài khoản data-dev, không đổi code sản phẩm khác).

## A. Sidecar kế hoạch khi sửa cảnh (chỉ test, không đổi sản phẩm)

- Không đổi `editSavedComposeShot` (`apps/server/src/services/composeBridge.ts:489`). Sidecar không bị xóa.
- Lý do: đọc sidecar chỉ ở `apps/server/src/preview/planSource.ts:127`. Xóa sidecar khiến preview lập lại kế hoạch và mất chỉnh tay.
- Test: `apps/server/test/composeSidecarSurvivesEdit.test.ts`
  - sau `editSavedComposeShot`, sidecar vẫn còn và giữ nguyên fingerprint;
  - khi thiếu sidecar, `readPlanInputs` trả `null`, nên điều kiện ở `planSource.ts:127` không khớp và preview phải lập lại.
- Ca đi qua `planSource`: `apps/server/test/preview.test.ts`, "preview after a saved shot edit returns the edited shot and no rebuild note (TASK-150 A)". Dùng harness `renderPlan` có sẵn, sửa shot bằng `editSavedComposeShot` (`{locked: true}`), rồi `loadPreviewPlan`: shot giữ `locked`, không có ghi chú dựng lại. Chạy riêng: pass 1/1.

## B. `inbox()` không trả tin tự gửi tới duty

- Sửa: `apps/server/src/supervision/mailbox.ts:131–134` (trong `inbox()`). Loại hàng khi `toKind === "duty"` và `fromInstance === instance`. Tin gửi trực tiếp cho chính instance (`toKind === "instance"`) vẫn được trả.
- Phạm vi: `TASK-150.md` §B nói loại hàng gửi tới giá trị `toKind` dùng cho duty, nên chỉ loại `"duty"`. Tin tự gửi tới `role:` (`toKind === "role"`) không bị loại. README đã sửa từ "role" thành "duty" cho khớp guide.
- Re-pin: `apps/server/test/dutySelfReport.test.ts`. Báo cáo của duty holder không còn xuất hiện trong hộp thư của nó. Thêm ca: tin trực tiếp từ instance tới chính nó vẫn được trả.
- Các truy vấn `acked_at IS NULL` còn lại (`mailbox.ts:172`, `mailbox.ts:217`) phục vụ câu hỏi chưa trả lời, không phải hộp thư người đọc, nên không đổi.

## C. HEALTHCHECK worker theo file liveness

- Sửa: `apps/server/src/node/agent.ts:46` (`LIVENESS_FILE = "worker-alive"`), `:363–370` (`writeLiveness`, bắt lỗi và log), `:395` (gọi sau heartbeat thành công).
- Sửa: `deploy/docker/Dockerfile` (khối HEALTHCHECK). Khi `VG_ROLE=worker`, lệnh pass chỉ khi `DATA_DIR/worker-alive` có mtime dưới 60 giây. Các role khác vẫn kiểm tra `/api/health`.
- Test: `apps/server/test/workerLivenessFile.test.ts` (2 ca)
  - heartbeat 200 → file được ghi với timestamp ISO;
  - heartbeat 500 → không ghi file.
- Kiểm tra lệnh HEALTHCHECK chạy trên máy này bằng `node -e` với `VG_ROLE=worker`:
  - file mới → exit 0;
  - file cũ 5 phút → exit 1;
  - file thiếu → exit 1.
- Hệ quả đã chấp nhận: control plane không truy cập được thì heartbeat lỗi, file cũ dần, container báo unhealthy. Ghi trong comment Dockerfile. Chưa cập nhật runbook.

### Chưa xác minh

- Tính toán: `--start-period=90s`, `--retries=5` ở chu kỳ 15 s, nên container chuyển unhealthy sau khoảng 165 s kể từ khi khởi động nếu chưa có heartbeat nào.
- `--start-period` tăng từ 40 s lên 90 s. Lý do đọc code: `run()` (`apps/server/src/node/agent.ts:196`) chạy `runProbe()` trước `join()` và heartbeat đầu. `runRenderProbe` có timeout `PROBE_TIMEOUT_MS = 60_000` (`apps/server/src/node/probe.ts:16`), nên heartbeat đầu có thể trễ tới khoảng 60 s cộng thời gian join. 40 s không đủ trong trường hợp xấu nhất.
- **Chưa đo bằng Docker.** Con số 90 s dựa trên đọc code (timeout của probe), chưa đo thời gian thực tế. Chưa có Docker build trên máy này để kiểm tra.
- Chưa build image, nên chưa chạy HEALTHCHECK thật trong container.

## Kết quả kiểm tra

- `npx tsc --noEmit` trong `apps/server`: **exit 0**.
- Focused test: 9 file, **60/60 pass** (gồm `composeSidecarSurvivesEdit`, `planInputsOrder`, `dutySelfReport`, `workerLivenessFile`, `workerAgent`, `registry`, `autonomyGates`, `operatorFindingEmit`, `budgetNeedsUserEvents`).
- Full suite `apps/server` (`npx vitest run`, chạy một lần sau khi sửa code sản phẩm): **Test Files 243 passed, 4 skipped (247); Tests 1948 passed, 8 skipped (1956); exit 0**.
- Các file test gọi `inbox()` (20 file gồm `dutySelfReport`, `mailboxBurst`, `agentMailbox`, `agentInboxPeek`, `webhookMailboxGuard`...): **20/20 file, 126/126 test pass**, chạy sau thay đổi cuối cùng.

## Thay đổi chưa commit có sẵn trước phiên này

`apps/server/src/node/agent.ts` đã có diff chưa commit trước phiên (352 dòng). Thay đổi của TASK-150 nằm chồng lên đó. Không revert.

## Dispatch

Theo quy tắc 2026-11-17, guide này không do Claude dispatch. Phần implement này là ngoại lệ một lần đã được advisor cho phép.
