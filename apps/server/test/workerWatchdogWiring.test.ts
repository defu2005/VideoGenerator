import { afterEach, describe, expect, it, vi } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";

const watchdogDuty = vi.fn();
vi.mock("../src/supervision/duty.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/supervision/duty.js")>()),
  watchdogDuty: (...args: unknown[]) => watchdogDuty(...args),
}));

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => {
  watchdogDuty.mockReset();
  for (const harness of harnesses.splice(0)) harness.close();
});

describe("worker duty watchdog wiring (TASK-129c)", () => {
  it("runs the watchdog once per minute from the 60 s block, with the worker start time", async () => {
    const harness = createPipelineHarness();
    harnesses.push(harness);
    const sqlite = harness.sqlite;

    await harness.worker.tick();
    await vi.waitFor(() => expect(watchdogDuty).toHaveBeenCalledTimes(1));
    const [db, , now, since] = watchdogDuty.mock.calls[0];
    expect(db).toBe(sqlite);
    expect(now).toBeInstanceOf(Date);
    expect(since).toBeInstanceOf(Date);

    // Within the same minute the throttle must hold the watchdog back.
    await harness.worker.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(watchdogDuty).toHaveBeenCalledTimes(1);

    // After a minute it runs again, and the start time does not move.
    harness.advance(60_000);
    await harness.worker.tick();
    await vi.waitFor(() => expect(watchdogDuty).toHaveBeenCalledTimes(2));
    expect(watchdogDuty.mock.calls[1][3]).toBe(since);
  });
});
