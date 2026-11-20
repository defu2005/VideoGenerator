# TASK-154 — test nội dung của các sweep worker (báo cáo)

Trạng thái: test đã viết, xanh, và đã kiểm bằng mutant. Commit cục bộ trên `dev`, **chưa push, không có `.done`**. Phạm vi chỉ là test. Không đổi `apps/server/src/jobs/worker.ts`, không đổi closure `setSweep` trong `apps/server/src/app.ts`, không chạm `apps/server/test/storageProvider.test.ts`.

## Vì sao có task này

Ghi chú "Đối chiếu cuối" trong handoff: chỉ có callback 10 s được test, chưa ai kiểm sweep làm gì khi chạy. Advisor (2026-11-21) quyết định: không chặn TASK-080 hay TASK-153; làm test theo thứ tự ưu tiên, và chỉ viết test không trùng với test đã có.

## Phủ trước và sau

| Việc sweep làm | Trước TASK-154 | Sau TASK-154 |
|---|---|---|
| Timer 10 s gọi callback `setSweep` | `workerSweepTick.test.ts` (có sẵn) | không đổi |
| Timer 10 s gọi `agentStages.sweep()` | `workerSweepTick.test.ts` (có sẵn) | không đổi |
| `tick()` gọi `agentStages.sweep()`, và không chạy khi đã `stop()` | không có | **mới** (`workerSweepTick.test.ts`) |
| Timer tiếp tục chạy khi node sweep ném lỗi một lần | không có | **mới** (`workerSweepTick.test.ts`) |
| Timer gọi `sweepRemote`: job thuê node/agent quá hạn được đánh dấu | chỉ gọi trực tiếp, `agentStage.test.ts:63` (lease agent, facts nhịp tim) | **mới**, qua timer (`workerSweepRemote.test.ts`) |
| `sweepRemote`: job chưa quá hạn không bị đánh dấu | không có | **mới** (`workerSweepRemote.test.ts`) |
| `sweepRemote`: mất lease thì lần tick sau xóa dấu quá hạn | không có | **mới** (`workerSweepRemote.test.ts`) |
| Node sweep (`nodes.sweep()`) | `workerNodes.test.ts`, gọi trực tiếp ở service | không đổi (không kiểm qua timer) |
| Placement sweep | `projectPlacement.test.ts`, gọi trực tiếp | không đổi |
| Câu hỏi quá 15 phút, chốt mỗi 60 s | `agentMailbox.test.ts` (service), `workerSweepTick.test.ts` (stamp qua tick, có sẵn) | không đổi |
| Throttle 60 s dùng chung với watchdog | `workerWatchdogWiring.test.ts` (đã kiểm: tick thứ hai trong cùng phút không gọi lại) | không đổi, **không viết test throttle riêng** |
| `fileGc` mỗi 24 h, `cleanupFinishedUploads`, `pruneStageFeedback` trong closure `app.ts` | không kiểm ở mức worker | **chưa kiểm** (xem Giới hạn) |

Lý do không viết test throttle riêng cho câu hỏi: `watchdogDuty` và `sweepAllQuestions` nằm cùng một khối 60 s, dùng cùng một biến `lastQuestionSweepMs`. `workerWatchdogWiring.test.ts` đã đỏ nếu bỏ throttle, nên không trùng.

## Test mới

- `apps/server/test/workerSweepRemote.test.ts` (3 test). Mỗi test đều thiết lập theo thứ tự: `setOverdue` và `setSweep` trước, `start()` sau, rồi mới đặt job thành `RUNNING` với `lease_id` và `started_at` (vì `start()` gọi `resumeRunningJobs()` sẽ đưa job về `QUEUED`). Tiến trình thật được kiểm qua timer giả 10 s.
  1. Job có lease quá hạn 2 giờ: sau một tick, có dấu quá hạn; job vẫn `RUNNING`, lease vẫn là `lease-1`.
  2. Job có lease mới 60 giây: sau hai tick, không có dấu quá hạn.
  3. Mất lease (`lease_id = NULL`) rồi tick: `overdue_at` về `NULL`. Đọc trực tiếp cột, vì `readOverdueMark` chỉ báo job `RUNNING`.
- `apps/server/test/workerSweepTick.test.ts`: thêm một test trong describe timer (node sweep ném một lần, timer vẫn gọi lần thứ hai), và một describe mới "worker tick runs the agent-stage sweep and stops cleanly" (một test).

Ghi chú về `onOverdue: "abort"` trong test 1–3: worker chỉ coi riêng `notify_only`; mọi giá trị khác đều thành `check` đối với job remote (`worker.ts:183`). Việc đặt `"abort"` ở đây nhằm chứng minh đồng hồ không tự giết job remote: job vẫn chạy, chỉ có dấu.

## Kết quả

- `npx vitest run test/workerSweepTick.test.ts test/workerSweepRemote.test.ts`: 8/8 xanh.
- Hồi quy: `workerSweepTick`, `workerSweepRemote`, `workerOverdue`, `workerWatchdogWiring`, `overdueRun`, `agentStage`: 6 file, 50/50 test xanh, exit 0. Log: `scratchpad/sweep-regression.log`.
- `npx tsc --noEmit`: exit 0. Log: `scratchpad/sweep-tsc.log`.

## Mutant (mỗi test phải bắt được một lỗi cụ thể)

Áp từng mutant vào `worker.ts`, chạy hai file test mới, rồi khôi phục từ bản sao `scratchpad/worker.orig.ts` và kiểm bằng `cmp`. Sau khi xong, `worker.ts` giống hệt HEAD.

| Mutant | Bỏ | Kết quả |
|---|---|---|
| M1 | `this.sweepRemote();` khỏi timer | đỏ 2 test: "marks a leased job…" và "clears the overdue mark…" |
| M2 | guard `if (now - Date.parse(job.startedAt) < limitMs) continue;` | đỏ "leaves a leased job under its limit alone" |
| M3 | `clearOverdue(db, jobId);` khi mất lease | đỏ "clears the overdue mark…" |
| M4 | `if (this.stopping) return;` trong `tick()` | đỏ "calls the agent-stage sweep on tick, and not after stop()" |
| M5 | `this.agentStages?.sweep();` trong `tick()` | đỏ cùng test trên |
| M6 | `logger.error` trong catch của timer, thay bằng `throw error` | đỏ "keeps the 10 s timer running after a node sweep throws once" |
| M7 | ngưỡng throttle 60 s của khối câu hỏi/watchdog, đổi `>= 60_000` thành `>= 0` | đỏ `workerWatchdogWiring.test.ts` (test có sẵn): chứng minh throttle 60 s được kiểm, nên không viết test throttle riêng |

Mỗi mutant được kiểm trong cùng một lần chạy, sau đó khôi phục và `cmp` với bản sao gốc. Test 1 trong `workerSweepRemote.test.ts` có thêm `vi.waitFor` chờ lần kiểm tra quá hạn đầu tiên trước khi kiểm lease, nên các mutant được chạy lại sau thay đổi này. Chạy ba lần liên tiếp: 8/8 xanh cả ba lần, không có lỗi unhandled.

## Phát hiện (không sửa trong task này)

- `worker.ts`, khối timer 10 s (dòng 218–224): `run()`, `agentStages.sweep()` và `sweepRemote()` nằm trong một `try`. Nếu node sweep ném lỗi, hai sweep còn lại bị bỏ qua tick đó, và được chạy lại sau 10 s. Test không khóa hành vi "bỏ qua" này. Đề xuất: task riêng, tách mỗi sweep vào `try` riêng nếu muốn độc lập.

## Giới hạn còn lại

1. Không có tiến trình node thật. Lease được gán bằng SQL trực tiếp, không qua join/heartbeat của node. `workerNodes.test.ts` và `workerNodeE2E.test.ts` vẫn là nơi kiểm luồng node thật.
2. `OverdueRun` chạy không có LLM, nên kiểm tra quá hạn theo bậc thang mặc định. Test không khóa quyết định của model.
3. `fileGc` 24 h, `cleanupFinishedUploads` và `pruneStageFeedback` trong closure `app.ts` vẫn chưa có test ở mức worker. Theo ràng buộc, không đụng `app.ts`.
4. Timer dùng fake timers. Không kiểm độ trễ thật của `setInterval`.
5. Chưa chạy toàn bộ suite server; chỉ các file trong bảng trên.

## Không làm (theo ràng buộc)

- Không `git push`. Không tạo `TASK-154.done`.
- Không sửa `worker.ts`, `app.ts`, `storageProvider.test.ts`, `.gitignore`.
