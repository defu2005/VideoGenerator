# TASK-158 — test bốn guard của wake() (báo cáo)

Trạng thái: chỉ thêm test, không đổi `src/`. Commit cục bộ trên `dev` theo quyết định advisor (2026-11-21), **chưa push, không có `.done`**.

## Vì sao có task này

`wake()` trong `apps/server/src/jobs/worker.ts` có bốn guard: `!started`, `stopping`, `!WORKER_ENABLED`, `wakeQueued`. TASK-156 chỉ kiểm `wake()` bằng stub, nên không có test nào chạy thân thật của `wake()`. TASK-156 limitation 3 và TASK-155 limitation 1 (phần guard bên trong) được đóng bởi task này.

## Vì sao không dùng số tick

- `tick()` trả về ngay khi `stopping`, nên không phân biệt được guard `stopping` của `wake()` với guard của `tick()`.
- `wakeQueued` chặn lần wake thứ hai, nhưng lần wake thứ hai chỉ tái lập cùng một timer, nên số tick vẫn là 1.

Vì vậy test quan sát trực tiếp số lần gọi `schedule()`.

## Hạ tầng

`apps/server/test/workerWakeGuards.test.ts` (mới, LF). Fake timers, không advance timer nên không có tick nào chạy. `vi.spyOn(worker, "schedule")` không có mock implementation, nên `schedule()` vẫn làm việc thật. Điểm vào là `onGovernorChange()` (gọi thẳng `wake()`) và `nudge()` (xóa `wakeQueued` trước rồi gọi `wake()`).

## Test (4 test)

| Guard | Test | Ràng buộc được ghim |
|---|---|---|
| `wakeQueued` | wakeQueued: a second wake while one is queued does not schedule again | sau `start()`, `schedule` được gọi đúng 1 lần với 0; `onGovernorChange()` không gọi thêm |
| `started` | started: wake does nothing before start() | chưa `start()` thì `onGovernorChange()` không gọi `schedule` |
| `WORKER_ENABLED` | WORKER_ENABLED: wake does nothing when the local worker is off | worker tắt: `start()` và `onGovernorChange()` không gọi `schedule` |
| `stopping` | stopping: wake does nothing while stop() is in progress | trong lúc `stop()` chưa xong, `nudge()` không gọi `schedule`; `stop()` tự nó cũng không gọi `schedule` |

Test 4 không gọi wake sau khi `stop()` xong. Kiểm tra guard đang mở chỉ được làm ở các test có `expect` trực tiếp (ví dụ `started`, `stopping`, `wakeQueued` trong test 1 và 3). Test 2 không kiểm `WORKER_ENABLED` riêng (bật bằng config). Bằng chứng guard nào là điều kiện duy nhất chặn là kết quả mutant ở trên, không phải assert.

## Mutant (sửa bản sao của `worker.ts`, chạy, khôi phục, `cmp`)

| Mutant | Thay đổi | Kết quả |
|---|---|---|
| nowq | bỏ `this.wakeQueued` khỏi `if` của `wake()` | đỏ 1: test wakeQueued |
| nostarted | bỏ `!this.started` | đỏ 1: test started |
| noenabled | bỏ `!this.config.WORKER_ENABLED` | đỏ 1: test WORKER_ENABLED |
| nostopping | bỏ `this.stopping` | đỏ 1: test stopping |

Mỗi mutant chỉ làm đỏ đúng một test. `worker.ts` được khôi phục và `cmp`-identical; `git diff` của `worker.ts` rỗng.

## Kết quả

- `workerWakeGuards.test.ts`: 4/4 xanh (trên mã chưa mutate).
- Hồi quy sáu file của TASK-156 (`workerSweepTick`, `workerSweepRemote`, `workerOverdue`, `workerWatchdogWiring`, `overdueRun`, `agentStage`): 57/57 xanh, chạy riêng, không tính test mới.
- `npx tsc --noEmit`: exit 0.
- Mã hóa dòng: `worker.ts` vẫn CRLF; mutant chỉ đổi trong một dòng, không đụng ký tự xuống dòng.

## Phát hiện (không sửa)

1. `stopping` được đặt `true` tại `apps/server/src/jobs/worker.ts:301` và chỉ được đặt `false` trong `start()` (`worker.ts:212`). `stop()` không đặt lại nó; `stop()` kết thúc bằng `started = false` (`worker.ts:313`). Hệ quả: sau khi `stop()` xong, `stopping` vẫn `true`, và `wake()` bị chặn bởi cả `!started` lẫn `stopping`. Không có khóa vĩnh viễn, vì `start()` lần sau đặt `stopping = false`. Guard `stopping` chỉ độc lập với `!started` trong lúc `stop()` đang chờ.
2. `schedule()` (`worker.ts:347`) gán `this.timer`; callback (`:349–350`) xóa `this.timer` và `wakeQueued`. Test không advance timer nên đường `schedule()` → callback → `tick()` không được kiểm.
3. Timer của `wake()` không `unref()`: grep trong `worker.ts` cho thấy chỉ `sweepTimer` gọi `unref()` (`:239`). Chưa đo tác động, chỉ ghi nhận.
4. Không phải phát hiện: `stop()` xóa `this.timer` tại `worker.ts:304`, sau `await this.indexTask` (`:303`). Một timer được tạo trong lúc chờ bị xóa tại đó, nên không sống sót qua `stop()`.

## Giới hạn còn lại

- `schedule()` và `started`, `stopping`, `wakeQueued` là field và method private; test đọc và spy qua `as unknown as`, cùng kiểu với TASK-156.
- Không kiểm `tick()` thật sau khi timer chạy; việc đó đã có ở TASK-154/155/156.

## Sửa đi kèm

- `TASK-156.report.md`, giới hạn 3: đánh dấu đã đóng bởi TASK-158.
- `TASK-155.report.md`, giới hạn 1: ghi rằng guard bên trong `wake()` đã đóng bởi TASK-158.

## Không làm (theo ràng buộc)

- Không đổi `src/`, không đổi `app.ts`, không đổi `storageProvider.test.ts`.
- Không `git push`. Không tạo `TASK-158.done`.
