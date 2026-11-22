import { afterEach, describe, expect, it } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-146 parked-rerun guard: a SCRIPT run must not overwrite a parked outline (SCRIPT WAITING_USER,
// draft phase outline_ready) unless the user confirmed. Written 2026-11-22; not run (no test permission yet).

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
function makeHarness(options: Parameters<typeof createPipelineHarness>[0] = {}) {
  const harness = createPipelineHarness(options);
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

// Parks the project the way the executor does: SCRIPT waiting for the user, draft phase outline_ready.
// Returns the thrown error's code, or undefined when the call does not throw.
function codeOf(fn: () => unknown): { statusCode?: number; code?: string } | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error as { statusCode?: number; code?: string };
  }
}

function park(harness: ReturnType<typeof createPipelineHarness>, phase: "outline_ready" | "outline_approved" = "outline_ready") {
  harness.repository.ensureStages(harness.projectId);
  harness.repository.updateStage(harness.projectId, "SCRIPT", { state: "WAITING_USER", progress: 100 });
  harness.sqlite.prepare(
    `INSERT INTO script_drafts (project_id, outline, hook_candidates, critique, critique_history, engine_mode, input_hash, updated_at, phase)
     VALUES (?, '{"parked":true}', '{"candidates":[],"chosenHookId":null,"hookAssessments":[]}', NULL, NULL, 'off', 'parked-guard-hash', ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET outline = excluded.outline, phase = excluded.phase, input_hash = excluded.input_hash`,
  ).run(harness.projectId, new Date().toISOString(), phase);
}

const outlineOf = (harness: ReturnType<typeof createPipelineHarness>) =>
  (harness.sqlite.prepare("SELECT outline FROM script_drafts WHERE project_id = ?").get(harness.projectId) as { outline: string } | undefined)?.outline ?? null;

describe("TASK-146 parked-rerun guard", () => {
  it("a SCRIPT run on a parked outline is refused with 409 SCRIPT_OUTLINE_PENDING and changes nothing", () => {
    const harness = makeHarness({ mode: "MANUAL", scriptOutlineApproval: "outline" });
    park(harness);
    const before = outlineOf(harness);
    const error = codeOf(() => harness.orchestrator.runStage(harness.projectId, "SCRIPT"));
    expect(error).toMatchObject({ statusCode: 409, code: "SCRIPT_OUTLINE_PENDING" });
    expect(harness.repository.getStage(harness.projectId, "SCRIPT").state).toBe("WAITING_USER");
    expect(outlineOf(harness)).toBe(before);
  });

  it("the agent/repair path (runStageThenContinue) is refused the same way", () => {
    const harness = makeHarness({ mode: "MANUAL", scriptOutlineApproval: "outline" });
    park(harness);
    const error = codeOf(() => harness.orchestrator.runStageThenContinue(harness.projectId, "SCRIPT"));
    expect(error).toMatchObject({ code: "SCRIPT_OUTLINE_PENDING" });
  });

  it("assertScriptNotParked with confirmOverwrite passes on a parked outline", () => {
    const harness = makeHarness({ mode: "MANUAL", scriptOutlineApproval: "outline" });
    park(harness);
    expect(() => harness.orchestrator.assertScriptNotParked(harness.projectId, true)).not.toThrow();
  });

  it("an approved outline (phase outline_approved) is not refused, so a MANUAL resume cannot be blocked", () => {
    const harness = makeHarness({ mode: "MANUAL", scriptOutlineApproval: "outline" });
    park(harness, "outline_approved");
    expect(() => harness.orchestrator.assertScriptNotParked(harness.projectId, false)).not.toThrow();
  });

  it("a SCRIPT that is DONE with a stale outline_ready row is not treated as parked", () => {
    const harness = makeHarness({ mode: "MANUAL", scriptOutlineApproval: "outline" });
    park(harness);
    harness.repository.updateStage(harness.projectId, "SCRIPT", { state: "DONE", progress: 100 });
    expect(() => harness.orchestrator.assertScriptNotParked(harness.projectId, false)).not.toThrow();
  });
});
