import { afterEach, describe, expect, it } from "vitest";
import { exportProjectSnapshot, importProjectSnapshot } from "../src/node/projectSnapshot.js";
import { diffProjectSnapshot, projectSnapshotCursor } from "../src/node/projectSnapshot.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-145 snapshot/invalidation: script_drafts is owned by SCRIPT (pipeline/dataContract.ts) and must
// travel in the node snapshot and move downstream input versions. Temp DB only, no network, no LLM.

const fixtures: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => fixtures.splice(0).forEach((h) => h.close()));
function harness() { const h = createPipelineHarness(); fixtures.push(h); return h; }

const DRAFT_HASH = "task145-snapshot-draft";

function seedDraft(h: ReturnType<typeof createPipelineHarness>, critique: string) {
  h.sqlite.prepare("DELETE FROM script_drafts WHERE project_id = ?").run(h.projectId);
  h.sqlite
    .prepare("INSERT INTO script_drafts (project_id, outline, hook_candidates, critique, critique_history, engine_mode, input_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      h.projectId,
      JSON.stringify({ centralQuestion: "Q", promise: "P", framework: "three_act", surprises: [], beats: [], loops: [], setupPayoffs: [] }),
      JSON.stringify({ candidates: [{ id: "h1", tactic: "question", text: "Hook", promise: "p" }], chosenHookId: "h1", hookAssessments: [] }),
      critique,
      JSON.stringify([]),
      "full",
      DRAFT_HASH,
      h.clock().toISOString(),
    );
}

const critiqueA = JSON.stringify({ total: 80, scores: { structure: 4, hook: 4, accuracy: 4, ttsNatural: 4, visualizable: 4, originality: 4 }, hookPaidOff: true, unclosedLoops: [], sectionIssues: [], history: [] });
const critiqueB = JSON.stringify({ total: 60, scores: { structure: 3, hook: 3, accuracy: 3, ttsNatural: 3, visualizable: 3, originality: 3 }, hookPaidOff: false, unclosedLoops: [], sectionIssues: [], history: [] });

describe("TASK-145 snapshot: script_drafts is carried by the node snapshot", () => {
  it("exports the seeded draft row, not just an empty table key", () => {
    const source = harness();
    seedDraft(source, critiqueA);
    const snapshot = exportProjectSnapshot(source.sqlite, source.config.DATA_DIR, source.projectId);
    // exportProjectRows emits every contract table, so a bare key proves nothing: check the row content.
    expect(snapshot.tables.script_drafts).toHaveLength(1);
    expect(snapshot.tables.script_drafts![0]).toMatchObject({ project_id: source.projectId, input_hash: DRAFT_HASH, engine_mode: "full" });
  });

  it("round trips the draft through import and re-export", () => {
    const source = harness(), target = harness();
    source.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(source.projectId);
    seedDraft(source, critiqueA);
    const snapshot = exportProjectSnapshot(source.sqlite, source.config.DATA_DIR, source.projectId);
    target.sqlite.prepare("DELETE FROM projects").run();
    importProjectSnapshot(target.sqlite, snapshot, () => { throw new Error("no files"); });
    expect(target.sqlite.prepare("SELECT COUNT(*) AS n FROM script_drafts WHERE project_id = ?").get(snapshot.projectId)).toEqual({ n: 1 });
    expect(exportProjectSnapshot(target.sqlite, target.config.DATA_DIR, snapshot.projectId)).toEqual(snapshot);
  });

  it("a draft-only edit moves only the script_drafts table in the sync cursor and delta", () => {
    const source = harness();
    seedDraft(source, critiqueA);
    const before = exportProjectSnapshot(source.sqlite, source.config.DATA_DIR, source.projectId);
    const base = projectSnapshotCursor(before);
    seedDraft(source, critiqueB);
    const after = exportProjectSnapshot(source.sqlite, source.config.DATA_DIR, source.projectId);
    expect(Object.keys(diffProjectSnapshot(after, base).tables)).toEqual(["script_drafts"]);
  });
});

describe("TASK-145 invalidation: a draft-only edit reaches downstream input versions, not SCRIPT itself", () => {
  it("changes SCENE_PLAN input version and leaves SCRIPT input version unchanged", () => {
    const h = harness();
    seedDraft(h, critiqueA);
    const versions = h.orchestrator.inputVersions;
    const scenePlanBefore = versions.inputVersion(h.projectId, "SCENE_PLAN");
    const scriptBefore = versions.inputVersion(h.projectId, "SCRIPT");
    seedDraft(h, critiqueB);
    expect(versions.inputVersion(h.projectId, "SCENE_PLAN")).not.toBe(scenePlanBefore);
    expect(versions.inputVersion(h.projectId, "SCRIPT")).toBe(scriptBefore);
  });
});
