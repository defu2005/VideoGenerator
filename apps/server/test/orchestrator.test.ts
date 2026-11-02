import { afterEach, describe, expect, it } from "vitest";
import { STAGE_ORDER, type PipelineStage } from "@vg/shared";
import { markStaleFrom } from "../src/pipeline/invalidation.js";
import { deriveProjectStatus } from "../src/pipeline/orchestrator.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { AppError } from "../src/lib/errors.js";
import { createPipelineHarness, drainUntilGate } from "./pipelineFixtures.js";

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
function makeHarness(options: Parameters<typeof createPipelineHarness>[0] = {}) {
  const harness = createPipelineHarness(options);
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

describe("pipeline state machine", () => {
  it("derives project status for every required branch", () => {
    const pending = [{ state: "PENDING" as const }];
    expect(deriveProjectStatus({ activeJob: { stage: "RENDER" }, stages: pending, projectStage: "TOPIC" })).toBe("RENDERING");
    expect(deriveProjectStatus({ activeJob: { stage: "SCRIPT" }, stages: pending, projectStage: "TOPIC" })).toBe("GENERATING");
    expect(deriveProjectStatus({ activeJob: null, stages: [{ state: "WAITING_USER" }], projectStage: "VISUAL_REVIEW" })).toBe("REVIEW");
    expect(deriveProjectStatus({ activeJob: null, stages: [{ state: "FAILED" }], projectStage: "SCRIPT" })).toBe("FAILED");
    expect(deriveProjectStatus({ activeJob: null, stages: pending, projectStage: "DONE" })).toBe("COMPLETED");
    expect(deriveProjectStatus({ activeJob: null, stages: pending, projectStage: "TOPIC" })).toBe("DRAFT");
  });

  it("runs assisted mode through gates and finishes after approvals", async () => {
    const harness = makeHarness();
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    let state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.currentStage).toBe("VISUAL_REVIEW");
    expect(state.status).toBe("REVIEW");
    expect(state.stages.find((stage) => stage.stage === "VISUAL_REVIEW")?.state).toBe("WAITING_USER");

    harness.orchestrator.approveGate(harness.projectId, "VISUAL_REVIEW");
    await drainUntilGate(harness);
    state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.currentStage).toBe("MUSIC_REVIEW");
    harness.orchestrator.approveGate(harness.projectId, "MUSIC_REVIEW");
    await drainUntilGate(harness);
    state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.currentStage).toBe("FINAL_APPROVAL");
    harness.orchestrator.approveGate(harness.projectId, "FINAL_APPROVAL");
    await harness.worker.tick();
    state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.status).toBe("COMPLETED");
    expect(state.currentStage).toBe("DONE");
    expect(state.stages.every((stage) => stage.state === "DONE")).toBe(true);
  });

  it("automatically passes visual and music gates but pauses at final approval", async () => {
    const harness = makeHarness({ mode: "AUTO" });
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    const state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.currentStage).toBe("FINAL_APPROVAL");
    expect(state.stages.find((stage) => stage.stage === "VISUAL_REVIEW")?.message).toBe("Auto-approved (AUTO mode)");
    expect(state.stages.find((stage) => stage.stage === "MUSIC_REVIEW")?.state).toBe("DONE");
    expect(state.stages.find((stage) => stage.stage === "FINAL_APPROVAL")?.state).toBe("WAITING_USER");
  });

  it("auto-renders when enabled and manual approval never continues automatically", async () => {
    const automatic = makeHarness({ mode: "AUTO", autoRender: true });
    automatic.orchestrator.runAll(automatic.projectId);
    for (let step = 0; step < 20; step += 1) {
      const state = automatic.orchestrator.getPipeline(automatic.projectId);
      if (!state.activeJob || state.activeJob.status !== "QUEUED") break;
      await automatic.worker.tick();
    }
    expect(automatic.orchestrator.getPipeline(automatic.projectId).status).toBe("COMPLETED");

    const manual = makeHarness({ mode: "MANUAL" });
    expect(() => manual.orchestrator.runStage(manual.projectId, "SCRIPT")).toThrowError(AppError);
    manual.orchestrator.runAll(manual.projectId);
    await drainUntilGate(manual);
    manual.orchestrator.approveGate(manual.projectId, "VISUAL_REVIEW");
    const state = manual.orchestrator.getPipeline(manual.projectId);
    expect(state.activeJob).toBeNull();
    expect(state.runMode).toBeNull();
    expect(state.stages.find((stage) => stage.stage === "VOICE")?.state).toBe("PENDING");
  });

  it("allows only one active job per project and marks downstream completed stages stale", () => {
    const harness = makeHarness();
    harness.orchestrator.runAll(harness.projectId);
    expect(() => harness.orchestrator.runAll(harness.projectId)).toThrowError(
      expect.objectContaining({ statusCode: 409, code: "INVALID_PIPELINE_STATE" }),
    );
    harness.repository.atomic(() => {
      for (const stage of STAGE_ORDER.slice(2, 5)) {
        harness.repository.updateStage(harness.projectId, stage, { state: "DONE", progress: 100 });
      }
    });
    markStaleFrom(harness.repository, harness.projectId, "SCRIPT");
    for (const stage of STAGE_ORDER.slice(2, 5)) {
      expect(harness.repository.getStage(harness.projectId, stage).state).toBe("STALE");
    }
  });

  it("enforces earlier stage completion before a single-stage run", () => {
    const harness = makeHarness();
    expect(() => harness.orchestrator.runStage(harness.projectId, "SCENE_PLAN")).toThrowError(
      expect.objectContaining({ statusCode: 409, code: "INVALID_PIPELINE_STATE" }),
    );
    expect(() => harness.orchestrator.runStage(harness.projectId, "VISUAL_REVIEW")).toThrowError(AppError);
  });

  it("stales later completed stages when re-running a completed stage", () => {
    const harness = makeHarness();
    harness.repository.atomic(() => {
      for (const stage of STAGE_ORDER.slice(0, 5)) {
        harness.repository.updateStage(harness.projectId, stage, { state: "DONE", progress: 100 });
      }
    });
    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    expect(harness.repository.getStage(harness.projectId, "RESEARCH").state).toBe("QUEUED");
    for (const stage of STAGE_ORDER.slice(1, 5)) {
      expect(harness.repository.getStage(harness.projectId, stage).state).toBe("STALE");
    }
  });

  it("releases every project event listener after repeated subscriptions", () => {
    const events = new PipelineEventBus();
    const projectId = "55555555-5555-4555-8555-555555555555";
    const unsubscribe = Array.from({ length: 20 }, () => events.subscribe(projectId, () => undefined));
    expect(events.listenerCount(projectId)).toBe(20);
    for (const remove of unsubscribe) remove();
    expect(events.listenerCount(projectId)).toBe(0);
  });

  it("does not publish events from a nested transaction when the outer transaction rolls back", () => {
    const harness = makeHarness();
    let published = 0;
    const unsubscribe = harness.events.subscribe(harness.projectId, () => { published += 1; });

    expect(() => harness.repository.atomic(() => {
      harness.repository.atomic(() => {
        harness.repository.updateStage(harness.projectId, "RESEARCH", { state: "RUNNING" });
      });
      throw new Error("rollback outer transaction");
    })).toThrow("rollback outer transaction");

    unsubscribe();
    expect(published).toBe(0);
    expect(harness.repository.getStage(harness.projectId, "RESEARCH").state).toBe("PENDING");
  });
});
