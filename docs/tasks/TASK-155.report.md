# TASK-155 — mỗi sweep trên timer 10 s có `try` riêng (báo cáo)

Trạng thái: sửa `apps/server/src/jobs/worker.ts` và thêm test đỏ trước khi sửa. Test xanh, mutant bị bắt, tsc exit 0. Commit cục bộ trên `dev`, **chưa push, không có `.done`**. Không đổi `tick()`, không đổi `app.ts`, không chạm `apps/server/test/storageProvider.test.ts`.

## Vì sao có task này

Finding mở của TASK-154: khối `try` của timer 10 s bao cả `run()`, `agentStages.sweep()`, `sweepRemote()` và `wake()`. Node sweep ném lỗi thì hai sweep còn lại và `wake()` bị bỏ qua tick đó.

## Khảo sát (chỉ đọc)

- `worker.ts` khối timer (dòng 216–238 sau sửa): cả bốn lệnh nằm trong một `try` trước khi sửa. `git blame`: khối `run/sweepRemote/wake/catch` từ commit `f8dc8275` (2026-11-13); dòng `agentStages?.sweep()` thêm bởi `3ffe586b` (2026-11-16). Không có commit nào tách `try` cố ý.
- Không tài liệu nào nói việc bỏ qua các sweep là chủ đích. `docs/ARCHITECTURE.md` (dòng 93) chỉ mô tả thứ tự gọi (`setSweep`, `agentStages.sweep()`, `sweepRemote()`, `wake()`), không nói gì về hành vi khi có lỗi. Không đóng như "closed as designed".
- Không có `docs/cursor/TASK-154.md`, nên TASK-155 cũng chỉ có báo cáo, theo cùng quy ước của TASK-154.

## Thay đổi

`apps/server/src/jobs/worker.ts`, timer 10 s: một `try` được thay bằng bốn `try` độc lập, mỗi cái có nhãn log riêng:

| Bước | Nhãn log khi lỗi |
|---|---|
| `run()` (callback `setSweep`) | `node sweep failed` (giữ nguyên) |
| `this.agentStages?.sweep()` | `agent-stage sweep failed` |
| `this.sweepRemote()` | `remote sweep failed` |
| `if (this.config.WORKER_ENABLED) this.wake()` | `worker wake failed` |

Thứ tự gọi không đổi. `tick()` và `start()` ngoài timer không đổi. Diff: 14 dòng thêm, 1 dòng bỏ.

## Test mới (đỏ trước khi sửa)

- `apps/server/test/workerSweepTick.test.ts`, 1 test: "still runs the agent-stage sweep on the same tick when the node sweep throws". Trước khi sửa: đỏ với `expected "vi.fn()" to be called 1 times, but got 0 times`.
- `apps/server/test/workerSweepRemote.test.ts`, 2 test (B và C), và helper `startLeasedJob` nhận thêm tham số `sweep`:
  - "marks the overdue job on the same tick when the node sweep throws": đỏ với `expected null not to be null`.
  - "marks the overdue job on the same tick when the agent-stage sweep throws": đỏ với `expected null not to be null`.

Lý do đỏ đúng: sweep ném lỗi làm bước sau bị bỏ qua, nên lần kiểm quá hạn không xảy ra trên tick đó.

## Kết quả

- Hai file timer: 11/11 xanh sau sửa.
- Mutant (mỗi mutant được xây từ bản sao sau sửa `scratchpad/worker.fixed155.ts`, sau đó khôi phục và `cmp`-identical):

| Mutant | Thay đổi | Kết quả |
|---|---|---|
| merge | gộp lại thành một `try` như trước | đỏ 3: agent-stage và node sweep ném lỗi cùng tick, và sweep remote bị bỏ qua (test A, B, C) |
| rethrow-node | catch của node sweep ném lại lỗi | đỏ 3: "keeps the 10 s timer running…" (có sẵn), A, B |
| rethrow-agent | catch của agent-stage ném lại lỗi | đỏ 1: C |

- `npx tsc --noEmit` (apps/server): exit 0. Log: `scratchpad/tsc-155.log`.
- Toàn bộ server suite (`npx vitest run` trong `apps/server`): 299 file passed / 4 skipped (303), 2482 test passed / 9 skipped (2491), exit 0. Log: `scratchpad/full-155.log`.

## Giới hạn

1. ~~`wake()` có guard riêng nhưng không có test ghim: fixture đặt `WORKER_ENABLED: "false"`, nên `wake()` trong timer không chạy. Lỗi của `wake()` không được kiểm tra bằng test.~~ Đã đóng bởi TASK-156 (`8d84baa`, `251d178`): test wake trên timer, có spy. Guard bên trong thân `wake()` đã đóng bởi TASK-158 (`workerWakeGuards.test.ts`).
2. ~~Mutant rethrow-agent chỉ bị bắt bởi test C. Không có test nào ghim "timer tiếp tục chạy sau khi agent-stage sweep ném lỗi" (test "keeps the timer running" chỉ dùng node sweep).~~ Đã đóng bởi TASK-156 (`8d84baa`): test "wakes the worker on the same tick when the agent-stage sweep throws, and keeps ticking".
3. Lỗi được mô phỏng bằng `throw` trong stub: không có sweep thật bị lỗi (ví dụ lỗi DB).
4. Timer dùng fake timers; không kiểm độ trễ thật.

## Không làm (theo ràng buộc)

- Không `git push`. Không tạo `TASK-155.done`.
- Không sửa `tick()`, `app.ts`, `storageProvider.test.ts`.
- Không sửa `ARCHITECTURE.md`: thứ tự gọi trong tài liệu vẫn đúng sau sửa.

## Sửa theo review TASK-154

- Dòng 3 của `TASK-154.report.md`: thêm hash `96970b3`.
- Mục mutant của TASK-154: M7 được bắt bởi `workerWatchdogWiring.test.ts` (file có sẵn), không phải hai file test mới.
- Finding "try block" của TASK-154: đánh dấu đã xử lý ở TASK-155.
