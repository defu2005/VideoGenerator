import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";
import {
  activePromptVariant, promotePromptVariant, recordTrialEvidence, registerPromptVariant, trialVerdict,
} from "../src/learning/promptVariants.js";

describe("TASK-148e prompt variant registry", () => {
  let fixture: ReturnType<typeof createPipelineHarness>;
  beforeEach(() => { fixture = createPipelineHarness(); });
  afterEach(() => fixture.close());

  it("dedupes by stage and text hash and stores redacted text", () => {
    const db = fixture.sqlite;
    const a = registerPromptVariant(db, { stage: "SCRIPT", text: "Write short hooks. key=sk-abcdef1234567890" });
    const b = registerPromptVariant(db, { stage: "SCRIPT", text: "Write short hooks. key=sk-abcdef1234567890" });
    expect(b.id).toBe(a.id);
    expect(a.status).toBe("candidate");
    expect(a.text).not.toContain("sk-abcdef1234567890");
  });

  it("applies the decision rule: enough trials and a clear win rate", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ fixtureId: `f${i}`, winner: i < 7 ? "A" as const : "B" as const, at: "t" }));
    expect(trialVerdict(ten)).toEqual({ trials: 10, winRate: 0.7, recommend: true });
    expect(trialVerdict(ten.slice(0, 4)).recommend).toBe(false);
    expect(trialVerdict([{ fixtureId: "x", winner: "TIE", at: "t" }]).winRate).toBe(0.5);
  });

  it("only the user promotes, and promoting retires the previous active variant", () => {
    const db = fixture.sqlite;
    const first = registerPromptVariant(db, { stage: "SCRIPT", text: "variant one" });
    const second = registerPromptVariant(db, { stage: "SCRIPT", text: "variant two" });
    expect(() => promotePromptVariant(db, { id: first.id, decidedBy: "agent" })).toThrow("PROMPT_VARIANT_USER_ONLY");
    promotePromptVariant(db, { id: first.id, decidedBy: "user" });
    promotePromptVariant(db, { id: second.id, decidedBy: "user" });
    expect(activePromptVariant(db, "SCRIPT")?.id).toBe(second.id);
    expect(activePromptVariant(db, "RESEARCH")).toBeNull();
  });

  it("keeps trial evidence append-only", () => {
    const db = fixture.sqlite;
    const row = registerPromptVariant(db, { stage: "SCRIPT", text: "variant three" });
    recordTrialEvidence(db, row.id, [{ fixtureId: "f1", winner: "A", at: "t1" }]);
    const updated = recordTrialEvidence(db, row.id, [{ fixtureId: "f2", winner: "B", at: "t2" }]);
    expect(updated.evidence.map((item) => item.fixtureId)).toEqual(["f1", "f2"]);
  });
});
