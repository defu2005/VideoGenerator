import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { subscribeAgentEvents } from "../src/events/agentBus.js";
import { createRunnerRuntime } from "../src/node/runnerRuntime.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

it("uses the stock pipeline on the runner and leaves held gates and publish work to control", async () => {
  const fixture = createPipelineHarness({ mode: "AUTO", autoRender: true, config: { FAKE_STAGE_DELAY_MS: 0, WORKER_CONCURRENCY: 2 } });
  const publish = vi.fn(async () => ({ message: "unexpected publish" }));
  const canApprove = vi.fn(() => ({ allowed: true } as const));
  const outbound = vi.fn();
  const unsubscribe = subscribeAgentEvents(outbound);
  const runtime = createRunnerRuntime({
    sqlite: fixture.sqlite, config: fixture.config, logger: Fastify().log,
    executors: new Map([...fixture.executors, ["PUBLISH", { stage: "PUBLISH", run: publish }]]),
    projectId: fixture.projectId, stopBefore: ["VISUAL_REVIEW", "MUSIC_REVIEW"], canApprove, now: fixture.clock,
  });
  try {
    runtime.orchestrator.runAll(fixture.projectId);
    runtime.repository.createJob({ projectId: fixture.projectId, stage: "PUBLISH", maxAttempts: 1, previousState: "PENDING" });
    for (let step = 0; step < 10; step++) await runtime.worker.tick();
    const state = (stage: "VISUAL_SEARCH" | "VOICE" | "VISUAL_REVIEW" | "MUSIC_REVIEW" | "RENDER") =>
      runtime.repository.getStage(fixture.projectId, stage).state;
    expect(runtime.role).toBe("node-runner");
    expect(state("VISUAL_SEARCH")).toBe("DONE");
    expect(state("VOICE")).toBe("DONE");
    expect(state("VISUAL_REVIEW")).toBe("PENDING");
    expect(state("MUSIC_REVIEW")).toBe("PENDING");
    expect(state("RENDER")).toBe("PENDING");
    expect(canApprove).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(outbound).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
    await runtime.worker.stop();
    fixture.close();
  }
});
