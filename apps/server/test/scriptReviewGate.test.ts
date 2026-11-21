import { afterEach, describe, expect, it } from "vitest";
import { STAGE_ORDER, type PipelineStage } from "@vg/shared";
import type { NotificationService } from "../src/notifications/notificationService.js";
import { markStaleFrom } from "../src/pipeline/invalidation.js";
import { createPipelineHarness, drainUntilGate } from "./pipelineFixtures.js";

// TASK-146 slice 6 commit A red tests: SCRIPT_REVIEW in off mode auto-passes, backfills legacy projects, keeps order.
const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
function makeHarness(options: Parameters<typeof createPipelineHarness>[0] = {}) {
  const harness = createPipelineHarness(options);
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

const stateOf = (harness: ReturnType<typeof createPipelineHarness>, stage: PipelineStage) =>
  harness.repository.getStage(harness.projectId, stage).state;

// Ticks the worker until no job is active, so a second runAll does not hit "A job is already active".
async function settleUntilIdle(harness: ReturnType<typeof createPipelineHarness>): Promise<void> {
  for (let iteration = 0; iteration < 60; iteration += 1) {
    if (!harness.orchestrator.getPipeline(harness.projectId).activeJob) return;
    await harness.worker.tick();
  }
}

describe("TASK-146 slice 6 commit A: SCRIPT_REVIEW in off mode", () => {
  it("passes the gate without waiting in assisted and auto modes", async () => {
    for (const mode of ["ASSISTED", "AUTO"] as const) {
      const harness = makeHarness({ mode });
      harness.orchestrator.runAll(harness.projectId);
      await drainUntilGate(harness);
      expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("DONE");
      expect(stateOf(harness, "SCENE_PLAN")).not.toBe("PENDING");
    }
  });

  it("keeps the gate rows in display order even when the gate row is inserted late", () => {
    const harness = makeHarness();
    harness.repository.getStages(harness.projectId);
    harness.sqlite.prepare("DELETE FROM project_stages WHERE project_id = ? AND stage = 'SCRIPT_REVIEW'").run(harness.projectId);
    harness.repository.getStages(harness.projectId);
    expect(harness.repository.getStages(harness.projectId).map((row) => row.stage)).toEqual([...STAGE_ORDER]);
  });

  it("backfills a legacy project whose SCRIPT is done as passed, so SCENE_PLAN is not blocked", () => {
    const harness = makeHarness();
    harness.repository.getStages(harness.projectId);
    harness.sqlite.prepare("DELETE FROM project_stages WHERE project_id = ? AND stage = 'SCRIPT_REVIEW'").run(harness.projectId);
    // Direct SQL: updateStage would call ensureStages and recreate the gate row before SCRIPT is DONE.
    harness.sqlite.prepare("UPDATE project_stages SET state = 'DONE', progress = 100 WHERE project_id = ? AND stage = 'SCRIPT'").run(harness.projectId);
    expect(harness.repository.getStages(harness.projectId).find((row) => row.stage === "SCRIPT_REVIEW")?.state).toBe("DONE");
  });

  it("backfills a legacy project whose SCRIPT is not done as pending", () => {
    const harness = makeHarness();
    harness.repository.getStages(harness.projectId);
    harness.sqlite.prepare("DELETE FROM project_stages WHERE project_id = ? AND stage = 'SCRIPT_REVIEW'").run(harness.projectId);
    expect(harness.repository.getStages(harness.projectId).find((row) => row.stage === "SCRIPT_REVIEW")?.state).toBe("PENDING");
  });

  it("never rewrites a gate row that already exists", () => {
    const harness = makeHarness();
    harness.repository.getStages(harness.projectId);
    harness.repository.updateStage(harness.projectId, "SCRIPT_REVIEW", { state: "WAITING_USER", progress: 0 });
    harness.repository.getStages(harness.projectId);
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("WAITING_USER");
  });

  it("a SCRIPT rerun marks the auto-passed gate stale and passes it again", async () => {
    const harness = makeHarness();
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("DONE");
    markStaleFrom(harness.repository, harness.projectId, "SCRIPT");
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("STALE");
    await settleUntilIdle(harness);
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("DONE");
  });

  it("changing the review setting does not stale a finished SCRIPT", async () => {
    const harness = makeHarness();
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    const before = harness.orchestrator.inputVersions.inputVersion(harness.projectId, "SCRIPT");
    const settings = JSON.parse((harness.sqlite.prepare("SELECT settings FROM projects WHERE id = ?").get(harness.projectId) as { settings: string }).settings);
    harness.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(JSON.stringify({ ...settings, scriptOutlineApproval: "script" }), harness.projectId);
    expect(harness.orchestrator.inputVersions.inputVersion(harness.projectId, "SCRIPT")).toBe(before);
  });

  it("single-stage runs pass the off gate: RESEARCH, SCRIPT, then SCENE_PLAN is not refused", async () => {
    const harness = makeHarness();
    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    await settleUntilIdle(harness);
    harness.orchestrator.runStage(harness.projectId, "SCRIPT");
    await settleUntilIdle(harness);
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("DONE");
    expect(() => harness.orchestrator.runStage(harness.projectId, "SCENE_PLAN")).not.toThrow();
  });

  it("a SCRIPT that became DONE outside a job still passes the off gate before SCENE_PLAN is checked", () => {
    const harness = makeHarness();
    // A user-written script marks SCRIPT DONE without a SCRIPT job, so the gate was never auto-passed.
    harness.repository.updateStage(harness.projectId, "SCRIPT", { state: "DONE", progress: 100 });
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("PENDING");
    expect(() => harness.orchestrator.runStage(harness.projectId, "SCENE_PLAN")).not.toThrow();
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("DONE");
  });

  it("a node run whose stop set holds the gate does not auto-pass it when SCRIPT completes", async () => {
    // The node runtime reports SCRIPT_REVIEW as not allowed; control must decide the gate, not the run.
    const harness = makeHarness({ runtime: { allowedStage: (_project, stage) => stage !== "SCRIPT_REVIEW" } });
    harness.orchestrator.runAll(harness.projectId);
    await settleUntilIdle(harness);
    expect(stateOf(harness, "SCRIPT")).toBe("DONE");
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("PENDING");
  });

  it("after a single-stage SCRIPT rerun the gate goes stale, passes again, and SCENE_PLAN still runs", async () => {
    const harness = makeHarness();
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    await settleUntilIdle(harness);
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("DONE");
    harness.orchestrator.runStage(harness.projectId, "SCRIPT");
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("STALE");
    await settleUntilIdle(harness);
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("DONE");
    expect(() => harness.orchestrator.runStage(harness.projectId, "SCENE_PLAN")).not.toThrow();
  });

  it("a finished legacy project with no gate row does not go stale or re-enqueue when continued", async () => {
    const harness = makeHarness();
    // Stage rows are created lazily; create them first so the updates below have rows to match.
    harness.repository.getStages(harness.projectId);
    // Every stage DONE with its current input version, as an upgraded project would have them.
    for (const stage of STAGE_ORDER.filter((candidate) => candidate !== "SCRIPT_REVIEW")) {
      harness.sqlite.prepare("UPDATE project_stages SET state = 'DONE', progress = 100, input_version = ? WHERE project_id = ? AND stage = ?")
        .run(harness.orchestrator.inputVersions.inputVersion(harness.projectId, stage), harness.projectId, stage);
    }
    harness.sqlite.prepare("DELETE FROM project_stages WHERE project_id = ? AND stage = 'SCRIPT_REVIEW'").run(harness.projectId);
    harness.orchestrator.runAll(harness.projectId);
    await settleUntilIdle(harness);
    const stages = harness.repository.getStages(harness.projectId);
    expect(stages.filter((row) => row.state !== "DONE")).toEqual([]);
    expect(harness.orchestrator.getPipeline(harness.projectId).activeJob).toBeFalsy();
    // No job row of any stage: a re-enqueued gate would leave one here, and the failure names the stage.
    expect(harness.sqlite.prepare("SELECT stage FROM jobs WHERE project_id = ?").all(harness.projectId)).toEqual([]);
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("DONE");
  });
});

// TASK-146 slice 6 commit B: outline/script wait for the user in every mode, AUTO included.
describe("TASK-146 slice 6 commit B: SCRIPT_REVIEW in script mode", () => {
  it("waits for the user in AUTO mode and does not start SCENE_PLAN or VISUAL_REVIEW", async () => {
    const harness = makeHarness({ mode: "AUTO", scriptOutlineApproval: "script" });
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("WAITING_USER");
    expect(stateOf(harness, "SCENE_PLAN")).toBe("PENDING");
    expect(stateOf(harness, "VISUAL_REVIEW")).toBe("PENDING");
  });

  it("approving in AUTO mode marks the gate DONE and the run continues", async () => {
    const harness = makeHarness({ mode: "AUTO", scriptOutlineApproval: "script" });
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    harness.orchestrator.approveGate(harness.projectId, "SCRIPT_REVIEW");
    expect(harness.repository.getStage(harness.projectId, "SCRIPT_REVIEW")).toMatchObject({ state: "DONE", message: "Approved by user" });
    await settleUntilIdle(harness);
    expect(stateOf(harness, "SCENE_PLAN")).not.toBe("PENDING");
  });

  it("a resubmitted script after approval sends the gate back to waiting, and SCENE_PLAN does not run", async () => {
    const harness = makeHarness({ mode: "AUTO", scriptOutlineApproval: "script" });
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    harness.orchestrator.approveGate(harness.projectId, "SCRIPT_REVIEW");
    await settleUntilIdle(harness);
    markStaleFrom(harness.repository, harness.projectId, "SCRIPT");
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("STALE");
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("WAITING_USER");
    expect(stateOf(harness, "SCENE_PLAN")).toBe("STALE");
  });

  it("in MANUAL mode, approving leaves the run mode unset", async () => {
    const harness = makeHarness({ mode: "MANUAL", scriptOutlineApproval: "script" });
    // The gate is reached by the run-all advance loop; a single-stage SCRIPT run does not start gates.
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("WAITING_USER");
    harness.orchestrator.approveGate(harness.projectId, "SCRIPT_REVIEW");
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("DONE");
    const row = harness.sqlite.prepare("SELECT run_mode FROM projects WHERE id = ?").get(harness.projectId) as { run_mode: string | null };
    expect(row.run_mode).toBeNull();
  });

  it("the SCRIPT_REVIEW stop in AUTO mode sends the approval notice, not an unexpected auto-stop", async () => {
    const harness = makeHarness({ mode: "AUTO", scriptOutlineApproval: "script" });
    const sent: Array<Record<string, unknown>> = [];
    harness.orchestrator.setNotificationService({
      notify: async (event: Record<string, unknown>) => { sent.push(event); return "sent"; },
    } as unknown as NotificationService);
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    const waiting = sent.filter((event) => event.kind === "waiting_approval");
    expect(waiting).toEqual([expect.objectContaining({ gate: "SCRIPT_REVIEW" })]);
    expect(waiting[0]).not.toHaveProperty("unexpectedAutoStop");
  });
});
