import { describe, expect, it } from "vitest";
import { PROTECTED_PROJECT_ID } from "@vg/shared";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { recordStageFeedback, pruneStageFeedback, STAGE_FEEDBACK_CAP_BYTES } from "../src/learning/stageFeedback.js";

describe("stage feedback writer (TASK-148a)", () => {
  it("writes a row with the stage, kind and source", () => {
    const h = createPipelineHarness();
    const id = recordStageFeedback(h.sqlite, { projectId: h.projectId, profileId: null, stage: "SCRIPT", kind: "user_edit", target: "hook", before: "old hook", after: "new hook", source: "user" });
    expect(id).toBeTruthy();
    const row = h.sqlite.prepare("SELECT * FROM stage_feedback WHERE id=?").get(id) as Record<string, unknown>;
    expect(row).toMatchObject({ stage: "SCRIPT", kind: "user_edit", target: "hook", before: "old hook", after: "new hook", source: "user" });
    h.close();
  });

  it("never writes rows for the protected project", () => {
    const h = createPipelineHarness();
    const id = recordStageFeedback(h.sqlite, { projectId: PROTECTED_PROJECT_ID, profileId: null, stage: "SCRIPT", kind: "user_edit", target: "hook", after: "x", source: "user" });
    expect(id).toBeNull();
    expect(h.sqlite.prepare("SELECT COUNT(*) AS c FROM stage_feedback").get()).toEqual({ c: 0 });
    h.close();
  });

  it("skips a user_edit whose before and after are identical", () => {
    const h = createPipelineHarness();
    const id = recordStageFeedback(h.sqlite, { projectId: h.projectId, profileId: null, stage: "SCRIPT", kind: "user_edit", target: "title", before: "same", after: "same", source: "user" });
    expect(id).toBeNull();
    h.close();
  });

  it("caps long text at 4 KB and redacts secrets", () => {
    const h = createPipelineHarness();
    const long = "a".repeat(STAGE_FEEDBACK_CAP_BYTES * 2);
    const id = recordStageFeedback(h.sqlite, { projectId: h.projectId, profileId: null, stage: "SCRIPT", kind: "user_edit", target: "section:1", before: "", after: long, source: "user" });
    const row = h.sqlite.prepare("SELECT after FROM stage_feedback WHERE id=?").get(id) as { after: string };
    expect(Buffer.byteLength(row.after, "utf8")).toBeLessThanOrEqual(STAGE_FEEDBACK_CAP_BYTES);
    h.close();
  });

  it("prunes rows older than 180 days", () => {
    const h = createPipelineHarness();
    const old = new Date(Date.now() - 200 * 86_400_000);
    recordStageFeedback(h.sqlite, { projectId: h.projectId, profileId: null, stage: "SCRIPT", kind: "user_edit", target: "hook", after: "x", source: "user", now: old });
    recordStageFeedback(h.sqlite, { projectId: h.projectId, profileId: null, stage: "SCRIPT", kind: "user_edit", target: "hook", after: "y", source: "user" });
    expect(pruneStageFeedback(h.sqlite)).toBe(1);
    h.close();
  });
});

import { captureScriptEdit } from "../src/learning/stageFeedback.js";

describe("script save capture (TASK-148a)", () => {
  it("records one row per changed part, not the whole script", () => {
    const h = createPipelineHarness();
    const before = { title: "T", hook: "H1", sections: [{ id: "s1", narration: "A" }, { id: "s2", narration: "B" }], outro: "O" };
    const after = { title: "T", hook: "H2", sections: [{ id: "s1", narration: "A" }, { id: "s2", narration: "B2" }], outro: "O" };
    const n = captureScriptEdit(h.sqlite, { projectId: h.projectId, profileId: null, before: before as never, after: after as never });
    expect(n).toBe(2);
    const targets = (h.sqlite.prepare("SELECT target FROM stage_feedback ORDER BY target").all() as { target: string }[]).map((r) => r.target);
    expect(targets).toEqual(["hook", "section:2"]);
    h.close();
  });
});
