import { describe, expect, it } from "vitest";
import { scriptGateDecision, type ScriptGateInput } from "@vg/shared";

// TASK-145 row 18 (hold outcome). Test-only: pins the gate decision that the operator uses (scriptGateDecision in
// packages/shared/src/schemas/autonomy.ts). Score is the operator scale (total / 10). 55 total = 5.5, as in the guide.
// Open finding (not asserted here): minQualityScore is read from the spec with min 0, so a low spec floor can approve 5.5.

const base: ScriptGateInput = { score: 5.5, minQualityScore: 7, guidelinePass: true, blockingFacts: 0, reviseRound: 2 };

describe("scriptGateDecision hold outcome (TASK-145 row 18)", () => {
  it("holds a 5.5 script with no blocking fact once the revise budget is spent", () => {
    expect(scriptGateDecision(base, 2)).toBe("hold");
  });

  it("asks for a revision, not a hold, while revise budget remains", () => {
    expect(scriptGateDecision({ ...base, reviseRound: 0 }, 2)).toBe("revise");
  });

  it("never approves when blocking facts exist, even with a passing score", () => {
    expect(scriptGateDecision({ ...base, score: 9, blockingFacts: 1, reviseRound: 2 }, 2)).toBe("hold");
    expect(scriptGateDecision({ ...base, score: 9, blockingFacts: 1, reviseRound: 0 }, 2)).toBe("revise");
  });

  it("never approves a blocking fact at any revise round, even with minQualityScore 0 and a top score", () => {
    const floor0 = { ...base, score: 9, minQualityScore: 0, blockingFacts: 1 };
    for (const round of [0, 1, 2]) {
      expect(scriptGateDecision({ ...floor0, reviseRound: round }, 2)).not.toBe("approve");
    }
    expect(scriptGateDecision({ ...floor0, reviseRound: 0 }, 2)).toBe("revise");
    expect(scriptGateDecision({ ...floor0, reviseRound: 2 }, 2)).toBe("hold");
  });

  it("holds an unscored script", () => {
    expect(scriptGateDecision({ ...base, score: null }, 2)).toBe("hold");
  });

  it("approves a passing score with no blocking fact and a passing guideline check", () => {
    expect(scriptGateDecision({ ...base, score: 8, reviseRound: 0 }, 2)).toBe("approve");
  });
});
