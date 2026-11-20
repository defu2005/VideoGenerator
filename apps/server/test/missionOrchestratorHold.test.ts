import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createPipelineHarness, drainUntilGate } from "./pipelineFixtures.js";
import { TEST_WORKSPACE_ID } from "./testActor.js";

// TASK-129c: the real orchestrator puts a producing mission on hold at a gate the autonomy level does not pass.
// Fakes only: the pipeline runs on the fake executors, no network, no real LLM.
const harnesses: Array<ReturnType<typeof createPipelineHarness>> = [];
afterEach(() => {
  for (const h of harnesses.splice(0)) h.close();
});

function insertMission(h: ReturnType<typeof createPipelineHarness>, projectIds: string[]): string {
  const id = randomUUID();
  const at = new Date().toISOString();
  h.sqlite.prepare(
    `INSERT INTO missions (id, workspace_id, created_by, command, channel_profile_id, project_ids, plan, state, owner, autonomy_level, created_at, updated_at)
     VALUES (?, ?, 'user', 'làm video', NULL, ?, '[]', 'producing', NULL, 'assist', ?, ?)`,
  ).run(id, TEST_WORKSPACE_ID, JSON.stringify(projectIds), at, at);
  return id;
}

const stateOf = (h: ReturnType<typeof createPipelineHarness>, id: string) =>
  (h.sqlite.prepare("SELECT state FROM missions WHERE id = ?").get(id) as { state: string }).state;

describe("mission hold at a real gate (orchestrator)", () => {
  it("a non-AUTO project that reaches a gate holds its producing mission", async () => {
    const h = createPipelineHarness({ mode: "ASSISTED" });
    harnesses.push(h);
    const missionId = insertMission(h, [h.projectId]);
    h.orchestrator.runAll(h.projectId);
    await drainUntilGate(h);
    expect(h.orchestrator.getPipeline(h.projectId).stages.some((stage) => stage.state === "WAITING_USER")).toBe(true);
    expect(stateOf(h, missionId)).toBe("waiting_user");
  });

  it("an AUTO project stopped at a gate leaves its mission producing", async () => {
    const h = createPipelineHarness({ mode: "AUTO", autoBlock: () => "fake block for test" });
    harnesses.push(h);
    const missionId = insertMission(h, [h.projectId]);
    h.orchestrator.runAll(h.projectId);
    await drainUntilGate(h);
    expect(stateOf(h, missionId)).toBe("producing");
  });
});
