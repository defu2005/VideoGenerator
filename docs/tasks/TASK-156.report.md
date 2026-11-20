# TASK-156 — test wake() trên timer 10 s (báo cáo)

Trạng thái: chỉ thêm test, không đổi `src/`. Commit cục bộ trên `dev`, **chưa push, không có `.done`**.

## Vì sao có task này

Limitation 1 của TASK-155: `wake()` có guard riêng nhưng không có test. Limitation 2 của TASK-155: không có test nào ghim việc timer tiếp tục chạy khi agent-stage sweep ném lỗi. Advisor (2026-11-21) quyết định làm ngay, dưới dạng test-only.

## Hạ tầng

`createPipelineHarness` đã nhận `config` (Partial<AppConfig>), nên `WORKER_ENABLED: true` truyền được mà không đổi fixture. `wake()` được spy bằng `mockImplementation` rỗng trước `start()`, rồi `mockClear()` sau `start()`, nên không có xử lý job thật.

## Test mới (`apps/server/test/workerSweepTick.test.ts`, describe "worker timer calls wake() on each tick, guarded per step")

1. "wakes the worker on the same tick when the node sweep throws": node sweep ném một lần, `wake` vẫn được gọi trên tick đó.
2. "keeps the timer running when wake() throws once": `wake` ném một lần, tick sau vẫn chạy node sweep (2 lần) và `wake` (2 lần).
3. "wakes the worker on the same tick when the agent-stage sweep throws, and keeps ticking": agent-stage ném một lần, node sweep và `wake` vẫn chạy trên tick đó, và agent-stage vẫn được gọi ở tick sau (đóng limitation 2 của TASK-155).

## Mutant (áp lên bản sao của `worker.ts`, rồi khôi phục và `cmp`)

| Mutant | Thay đổi | Kết quả |
|---|---|---|
| merge | gộp lại thành một `try` như bản gốc | đỏ 5: hai test wake, và các test overdue/agent từ TASK-154/155 |
| nowaketry | bỏ `try` riêng của `wake()` | đỏ 1: "keeps the timer running when wake() throws once" |

Cả hai đều khôi phục `worker.ts` và `cmp`-identical với bản sao sau TASK-155.

## Kết quả

- Hai file timer: 14/14 xanh.
- Sáu file hồi quy: `workerSweepTick`, `workerSweepRemote`, `workerOverdue`, `workerWatchdogWiring`, `overdueRun`, `agentStage`: 56/56 xanh, exit 0.
- `npx tsc --noEmit`: exit 0.

## Giới hạn còn lại

1. Lỗi vẫn được mô phỏng bằng `throw` trong stub. Không có lỗi DB thật.
2. Fake timers; không kiểm độ trễ thật.

## Không làm (theo ràng buộc)

- Không đổi `src/`, `app.ts`, `storageProvider.test.ts`.
- Không `git push`. Không tạo `TASK-156.done`.

## Sửa đi kèm

- `TASK-154.report.md`, limitation 5: đánh dấu đã đóng, vì toàn bộ suite đã chạy ở TASK-155.
