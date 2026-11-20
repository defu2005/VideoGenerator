# TASK-143 fix2 — ghi chú, 2026-11-19 (goal, advisor điều khiển)

Trạng thái: đã kiểm chứng cục bộ, **chưa review lại**. Không commit, không push, không `.done`, không sửa `TASK-143.review.md`. Nguồn của thay đổi chưa commit trong `orchestrator.ts` không rõ (không phải do phiên này tạo ra).

## P1 flushUsage mất usage khi transaction lỗi
- Repro `tmp/codex-review-143-flush-loss.ts` trên working tree: `queuedAfterFailure: 1`, `usageAfterRetry: {llmCalls:1, costUsd:0.01}`. Repro không tái hiện mất usage: `flushUsage` đã dequeue sau commit. Finding P1 đúng với bản đã commit, không đúng với working tree.
- Đường terminal: `completeJob` và `failJob` gọi `flushUsage(jobId)` trước khi đổi trạng thái; `cancel` gọi trước `atomic` (`orchestrator.ts:362`); timer gọi `flushUsage()` mỗi 1 s, `stop()` gọi `flushUsage()` lần cuối.
- Sửa nhỏ: catch của timer (`orchestrator.ts:~656`) nay log `usage flush failed; will retry` thay vì bỏ qua.
- Test `apps/server/test/usageAuditFlushResilience.test.ts` (3 ca mới, 6/6 pass):
  - `atomic` ném một lần → queue còn 1, retry ghi đúng 1 lần, flush thừa không cộng lại;
  - hai job, transaction thật, ghi job thứ hai ném → job thứ nhất rollback (usage 0), cả hai còn trong queue, retry ghi mỗi job đúng một lần (2 và 5);
  - `stop()` sau flush lỗi → persist đủ 3 call.
- Chưa kiểm: lỗi xảy ra sau commit (không có đường trả lại, cần xem lại nếu có); đường `recordUsage` immediate không qua queue.

## P2 bằng chứng restore Litestream — CHƯA ĐẠT, BLOCKED
- `litestream` không có trong PATH.
- `docker info` thất bại: Docker daemon không chạy (`dockerDesktopLinuxEngine` không có). Không kiểm được image `litestream/litestream:0.3.13` có sẵn cục bộ hay không. Không pull.
- Blocker: người dùng cần khởi động Docker Desktop, hoặc cài Litestream, rồi mới chạy replicate/restore file-replica thật.
- Verifier `deploy/docker/restore-drill.sh` đã fail khi thiếu bảng. Đã chạy: DB chỉ có bảng `foo` → exit 1 với `MISSING:projects,jobs,__drizzle_migrations`; DB có đủ 3 bảng → exit 0 và in ROWS. Đây chỉ là kiểm verifier, không phải bằng chứng restore.

## Số đo tải — OPEN
- Review rejects: 3.000–5.000 writes/s và 250–300 node trong ARCHITECTURE/report không xuất phát từ bảng đo. Chưa đo workload thực (nhịp gửi/claim/flush, concurrency, event-loop delay). Coi là **chưa đo**.
- Load runner dùng async IIFE không await; chưa đi qua relay/accounting thật; profiler không reset sau setup.
- Runlog hai container trên một host: chưa có.

## Kiểm tra
- `npx tsc --noEmit` (apps/server), không pipe: exit 0.
- `npx vitest run test/usageAuditFlushResilience.test.ts`: 6/6 pass.
- Full `apps/server` `npx vitest run` (sau mọi thay đổi, lần chạy sạch): 243 file pass, 4 skipped; 1953 test pass, 8 skipped; exit 0. Ca `copilotCli` không tái diễn.

## Việc chưa kiểm toán
- Thay đổi trạng thái ngoài `orchestrator.ts` (`jobs/worker.ts`, `jobs/overdueRun.ts`) chưa được kiểm toán về mất usage batch.

## Đối chiếu lại 2026-11-19 (chỉ phần code và tài liệu)
- **P1 flush mất usage: đã sửa, xác minh lại.** Repro `tmp/codex-review-143-flush-loss.ts` chạy lại: `queuedAfterFailure: 1`, `usageAfterRetry: {llmCalls: 1, costUsd: 0.01}`. `flushUsage` (`apps/server/src/pipeline/orchestrator.ts:517`) dequeue sau khi commit; nếu có usage mới thì chỉ trừ phần đã commit. Test `usageAuditFlushResilience.test.ts`: 6/6 pass (chạy lại).
  - Chưa có test cho đường `completeJob`/`failJob` bị lỗi giữa chừng, và chưa kiểm clean shutdown trên DB tạm. Review yêu cầu cả hai. Đây là phần còn mở.
- **Mã thoát verifier (đã xác minh 2026-11-19, chạy thật qua wrapper shell, không Docker):** `deploy/docker/restore-drill.sh:189` gọi `process.exit(3)` bên trong `node -e`, nhưng mã đó chỉ được ghi vào `SCHEMA_RC`. Dòng 196 rồi `exit 1` của script. DB thiếu bảng: script thoát **1**, in `MISSING:projects,jobs,__drizzle_migrations`. DB đủ ba bảng: thoát **0**, in ROWS. Ghi chú "exit 1" ban đầu là đúng; ghi chú "exit 3" là mã của tiến trình node con, không phải của script. Không sửa script.
- **P2 Litestream: vẫn BLOCKED.** `litestream` không có trong PATH; Docker daemon không chạy. Không có replicate/restore file-replica thật. Không tải binary. Đây là điều kiện chưa đạt.
- **P2 số đo tải: đã sửa tài liệu, chưa đo đủ.** `docs/ARCHITECTURE.md` không còn "3.000–5.000 writes/s" hay "250–300 node". Mục giới hạn đo được dùng số đo ngày 2026-11-18 (`TASK-143.evidence.md:34`: 3.900–6.500 câu lệnh/s, một luồng, đợt ngắn). Đây là thông lượng câu lệnh, không phải durable writes. Chưa đo nhiều node, chưa đo qua relay thật, chưa có runlog hai container.
- **Trạng thái:** P1 đã xác minh; P2 Litestream blocked; P2 tải đã sửa tài liệu nhưng chưa đo đủ. Không ACCEPTED. Không `.done`, không commit.
