import { describe, expect, it } from "vitest";
import { scriptCritiqueNeedsHold, scriptCritiqueNeedsRewrite, type ScriptCritique } from "@vg/shared";

// TASK-145 row 18: hold rule boundaries. Thresholds are read from packages/shared/src/script/critique.ts:
// hold when total < 60, or accuracy < 3, or blocking facts exist.

function critique(total: number, accuracy: number): ScriptCritique {
  const scores = { structure: 5, hook: 5, accuracy, ttsNatural: 5, visualizable: 5, originality: 5 };
  return { total, scores, hookPaidOff: true, unclosedLoops: [] } as unknown as ScriptCritique;
}

describe("scriptCritiqueNeedsHold (TASK-145 row 18)", () => {
  it("holds when the total is below 60 and not when it is exactly 60", () => {
    expect(scriptCritiqueNeedsHold(critique(59, 5), false)).toBe(true);
    expect(scriptCritiqueNeedsHold(critique(60, 5), false)).toBe(false);
  });

  it("holds when accuracy is 2 and not when it is 3", () => {
    expect(scriptCritiqueNeedsHold(critique(90, 2), false)).toBe(true);
    expect(scriptCritiqueNeedsHold(critique(90, 3), false)).toBe(false);
  });

  it("holds when blocking facts exist even with a clean critique", () => {
    expect(scriptCritiqueNeedsHold(critique(90, 5), true)).toBe(true);
  });
});

describe("scriptCritiqueNeedsRewrite boundaries (TASK-145 row 18)", () => {
  it("requires a rewrite below total 75 and not at 75 when every other check passes", () => {
    expect(scriptCritiqueNeedsRewrite(critique(74, 5), false)).toBe(true);
    expect(scriptCritiqueNeedsRewrite(critique(75, 5), false)).toBe(false);
  });
});
