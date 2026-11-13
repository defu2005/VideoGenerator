import { describe, expect, it } from "vitest";
import {
  OverdueCheckChoiceSchema,
  OverdueDecisionActionSchema,
  clampCheckerExtendMs,
  clampDecisionExtendMs,
  overdueCheckSpacingMs,
  overdueLadder,
  overdueOverride,
  workSignalsMoving,
  type OverdueFacts,
} from "../src/index.js";

const quiet: OverdueFacts = {
  stage: "RENDER", attempt: 1, maxAttempts: 3, elapsedMs: 900_000, expectedMs: 300_000, limitMs: 600_000,
  overRatio: 3, progress: 40, progressAtLimit: 40, sinceProgressMs: 400_000, trend: "flat",
  bytesWrittenLast2Min: 0, childAlive: false, childNote: null, llmInFlight: false, quotaWait: false,
  noSignalMs: 700_000, logTail: [], historyNote: null, remote: false,
};

describe("overdue rules", () => {
  it("the checker has only wait and escalate", () => {
    expect(OverdueCheckChoiceSchema.safeParse({ action: "abort_retry", reason: "x" }).success).toBe(false);
    expect(OverdueCheckChoiceSchema.safeParse({ action: "wait", reason: "x", extendMs: 5000 }).success).toBe(true);
    expect(OverdueDecisionActionSchema.options).toEqual(["wait", "abort_retry", "abort_fail", "ask_user"]);
  });

  it("ladder: moving waits, otherwise escalates", () => {
    expect(overdueLadder(quiet).action).toBe("escalate");
    for (const patch of [{ trend: "up" }, { bytesWrittenLast2Min: 10 }, { childAlive: true }, { llmInFlight: true }, { quotaWait: true }] as const) {
      const facts = { ...quiet, ...patch } as OverdueFacts;
      expect(workSignalsMoving(facts)).toBe(true);
      expect(overdueLadder(facts).action).toBe("wait");
    }
  });

  it("code overrides a wait with no signals for 10 min", () => {
    const wait = { action: "wait" as const, reason: "chờ", extendMs: 60_000 };
    expect(overdueOverride(wait, quiet)).toMatchObject({ choice: { action: "escalate" }, overridden: "wait_without_signals" });
    const fine = overdueOverride(wait, { ...quiet, childAlive: true, noSignalMs: 0 });
    expect(fine.choice).toMatchObject({ action: "wait", extendMs: 120_000 });
    expect(fine.overridden).toBeNull();
  });

  it("clamps the extensions and grows the spacing", () => {
    expect(clampCheckerExtendMs(600_000, 1)).toBe(120_000);
    expect(clampCheckerExtendMs(600_000, 9_999_999)).toBe(300_000);
    expect(clampDecisionExtendMs(600_000, 1)).toBe(300_000);
    expect(clampDecisionExtendMs(600_000, 9_999_999_999)).toBe(1_200_000);
    expect([1, 2, 3, 4, 5, 9].map(overdueCheckSpacingMs).map((v) => v / 60_000)).toEqual([2, 5, 10, 20, 30, 30]);
  });
});
