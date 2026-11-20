import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";

// The 10 s timer must run the node sweep and the agent-stage sweep. Fake timers keep this instant.
describe("worker timer runs the sweeps every 10 s", () => {
  let h: ReturnType<typeof createPipelineHarness>;
  beforeEach(() => { vi.useFakeTimers(); h = createPipelineHarness(); });
  afterEach(async () => {
    await h.worker.stop?.();
    h.close();
    vi.useRealTimers();
  });

  it("calls the node sweep on each tick", async () => {
    const sweep = vi.fn();
    h.worker.setSweep(sweep);
    await h.worker.start();
    expect(sweep).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    expect(sweep).toHaveBeenCalledTimes(3);
  });

  it("calls the agent-stage sweep on each tick", async () => {
    const sweep = vi.fn();
    h.worker.setSweep(() => {});
    h.worker.setAgentStages({ sweep } as never);
    await h.worker.start();
    vi.advanceTimersByTime(10_000);
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it("still runs the agent-stage sweep on the same tick when the node sweep throws", async () => {
    const agent = vi.fn();
    h.worker.setSweep(vi.fn().mockImplementationOnce(() => { throw new Error("boom"); }));
    h.worker.setAgentStages({ sweep: agent } as never);
    await h.worker.start();
    vi.advanceTimersByTime(10_000);
    expect(agent).toHaveBeenCalledTimes(1);
  });

  // A throwing node sweep is caught and logged; the timer keeps running. The same tick's later sweeps may be skipped, which is not pinned here.
  it("keeps the 10 s timer running after a node sweep throws once", async () => {
    const sweep = vi.fn().mockImplementationOnce(() => { throw new Error("boom"); });
    h.worker.setSweep(sweep);
    await h.worker.start();
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(10_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });
});

// The tick is the worker's direct entry point: it runs the agent-stage sweep, and does nothing once the worker is stopped.
describe("worker tick runs the agent-stage sweep and stops cleanly", () => {
  let h: ReturnType<typeof createPipelineHarness>;
  beforeEach(() => { vi.useRealTimers(); h = createPipelineHarness(); });
  afterEach(async () => {
    await h.worker.stop?.();
    h.close();
  });

  it("calls the agent-stage sweep on tick, and not after stop()", async () => {
    const sweep = vi.fn();
    h.worker.setAgentStages({ sweep } as never);
    await h.worker.tick();
    expect(sweep).toHaveBeenCalledTimes(1);
    await h.worker.stop();
    await h.worker.tick();
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});

// TASK-156: wake() runs on the 10 s timer only when WORKER_ENABLED is on, and each step has its own guard.
// wake() is stubbed so no real job processing runs; the spy only counts calls.
describe("worker timer calls wake() on each tick, guarded per step", () => {
  let h: ReturnType<typeof createPipelineHarness>;
  beforeEach(() => { vi.useFakeTimers(); h = createPipelineHarness({ config: { WORKER_ENABLED: true } }); });
  afterEach(async () => {
    await h.worker.stop?.();
    h.close();
    vi.useRealTimers();
  });

  /** Spies on the private wake(), starts the worker, then clears the call start() made. */
  async function startWithWakeSpy() {
    const wake = vi.spyOn(h.worker as unknown as { wake: () => void }, "wake").mockImplementation(() => {});
    await h.worker.start();
    wake.mockClear();
    return wake;
  }

  it("wakes the worker on the same tick when the node sweep throws", async () => {
    h.worker.setSweep(vi.fn().mockImplementationOnce(() => { throw new Error("boom"); }));
    const wake = await startWithWakeSpy();
    vi.advanceTimersByTime(10_000);
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it("keeps the timer running when wake() throws once", async () => {
    const sweep = vi.fn();
    h.worker.setSweep(sweep);
    const wake = await startWithWakeSpy();
    wake.mockImplementationOnce(() => { throw new Error("boom"); });
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(10_000);
    expect(wake).toHaveBeenCalledTimes(2);
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it("wakes the worker on the same tick when the agent-stage sweep throws, and keeps ticking", async () => {
    const sweep = vi.fn();
    const agent = vi.fn().mockImplementationOnce(() => { throw new Error("boom"); });
    h.worker.setSweep(sweep);
    h.worker.setAgentStages({ sweep: agent } as never);
    const wake = await startWithWakeSpy();
    vi.advanceTimersByTime(10_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(wake).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(agent).toHaveBeenCalledTimes(2);
    expect(wake).toHaveBeenCalledTimes(2);
  });
});

// TASK-129a: the worker tick must escalate an unanswered question to the duty holder after 15 min.
describe("worker tick escalates unanswered questions", () => {
  let h: ReturnType<typeof createPipelineHarness>;
  beforeEach(() => { vi.useRealTimers(); h = createPipelineHarness(); });
  afterEach(async () => {
    await h.worker.stop?.();
    h.close();
  });

  it("stamps escalated_duty_at once the question is 15 min old", async () => {
    const { sendMessage } = await import("../src/supervision/mailbox.js");
    const { TEST_WORKSPACE_ID } = await import("./testActor.js");
    const asked = new Date(h.clock());
    const row = sendMessage(h.sqlite, { workspaceId: TEST_WORKSPACE_ID, from: "codex/bound", to: "duty", kind: "question", body: "ai trả lời?" }, asked);
    const stampOf = () => (h.sqlite.prepare("SELECT escalated_duty_at AS e FROM agent_messages WHERE id = ?").get(row.id) as { e: string | null }).e;
    expect(stampOf()).toBeNull();
    h.setNow(new Date(asked.getTime() + 14 * 60_000));
    await h.worker.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(stampOf()).toBeNull();
    h.setNow(new Date(asked.getTime() + 16 * 60_000));
    await h.worker.tick();
    await vi.waitFor(() => expect(stampOf()).not.toBeNull(), { timeout: 2000 });
  });
});
