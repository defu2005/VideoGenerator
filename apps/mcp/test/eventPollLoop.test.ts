import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runEventPollLoop } from "../src/sync.js";

describe("runEventPollLoop (TASK-129a step 4, 15 s poller)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("polls once per 15 s interval and stops when asked", async () => {
    let stopped = false;
    const pollOnce = vi.fn(async () => {});
    const done = runEventPollLoop({ isStopped: () => stopped, pollOnce });

    await vi.advanceTimersByTimeAsync(0);
    expect(pollOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(pollOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pollOnce).toHaveBeenCalledTimes(2);

    stopped = true;
    await vi.advanceTimersByTimeAsync(15_000);
    await done;
    expect(pollOnce).toHaveBeenCalledTimes(2);
  });

  it("keeps polling after a poll throws, and logs one fixed line without the error text", async () => {
    let stopped = false;
    const log = vi.fn();
    const pollOnce = vi.fn()
      .mockRejectedValueOnce(new Error("token=secret-value network down"))
      .mockResolvedValue(undefined);
    const done = runEventPollLoop({ isStopped: () => stopped, pollOnce, log });

    await vi.advanceTimersByTimeAsync(0);
    expect(pollOnce).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).not.toContain("secret-value");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(pollOnce).toHaveBeenCalledTimes(2);

    stopped = true;
    await vi.advanceTimersByTimeAsync(15_000);
    await done;
  });

  it("does not poll at all when already stopped", async () => {
    const pollOnce = vi.fn(async () => {});
    await runEventPollLoop({ isStopped: () => true, pollOnce });
    expect(pollOnce).not.toHaveBeenCalled();
  });
});
