import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-158: the four guards of the private wake() are pinned on the real method.
// wake() runs unstubbed. schedule() is spied with no mock implementation, so it still does its real work.
// Timers never advance, so no tick runs; the observable is whether schedule() was called.
// Each guard test is paired with a mutant that drops that one term from wake()'s `if` (see docs/tasks/TASK-158.report.md).

type WorkerInternals = {
  started: boolean;
  stopping: boolean;
  wakeQueued: boolean;
  schedule: (delay: number) => void;
};

describe("TASK-158: wake() guards on the real method", () => {
  let h: ReturnType<typeof createPipelineHarness>;
  let schedule: ReturnType<typeof vi.spyOn>;

  function internals(): WorkerInternals {
    return h.worker as unknown as WorkerInternals;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await h.worker.stop?.();
    h.close();
    vi.useRealTimers();
  });

  function enabledWorker() {
    h = createPipelineHarness({ config: { WORKER_ENABLED: true } });
    schedule = vi.spyOn(internals(), "schedule");
  }

  it("wakeQueued: a second wake while one is queued does not schedule again", async () => {
    enabledWorker();
    await h.worker.start();
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenLastCalledWith(0);
    // Other guards open: started, not stopping, enabled. Only wakeQueued blocks this call.
    expect(internals().started).toBe(true);
    expect(internals().stopping).toBe(false);
    expect(internals().wakeQueued).toBe(true);

    h.worker.onGovernorChange();

    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("started: wake does nothing before start()", () => {
    enabledWorker();
    // Other guards open: not stopping, enabled, nothing queued.
    expect(internals().stopping).toBe(false);
    expect(internals().wakeQueued).toBe(false);

    h.worker.onGovernorChange();

    expect(schedule).not.toHaveBeenCalled();
  });

  it("WORKER_ENABLED: wake does nothing when the local worker is off", async () => {
    h = createPipelineHarness();
    schedule = vi.spyOn(internals(), "schedule");
    await h.worker.start();
    expect(schedule).not.toHaveBeenCalled();
    // Other guards open: started, not stopping, nothing queued.
    expect(internals().started).toBe(true);
    expect(internals().stopping).toBe(false);
    expect(internals().wakeQueued).toBe(false);

    h.worker.onGovernorChange();

    expect(schedule).not.toHaveBeenCalled();
  });

  it("stopping: wake does nothing while stop() is in progress", async () => {
    enabledWorker();
    await h.worker.start();
    schedule.mockClear();

    // stop() sets stopping synchronously, then waits; nudge() clears wakeQueued before wake().
    // Other guards open at the call: enabled and started (stop() has not finished yet).
    const stopping = h.worker.stop();
    expect(internals().stopping).toBe(true);
    expect(internals().started).toBe(true);
    h.worker.nudge();
    expect(schedule).not.toHaveBeenCalled();

    await stopping;
    expect(schedule).not.toHaveBeenCalled();
  });
});
