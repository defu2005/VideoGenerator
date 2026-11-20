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
