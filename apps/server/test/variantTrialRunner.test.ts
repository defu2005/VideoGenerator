import { afterEach, describe, expect, it } from "vitest";
import { registerPromptVariant } from "../src/learning/promptVariants.js";
import { runVariantTrials } from "../src/learning/variantTrialRunner.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

describe("variant trial runner (TASK-148e)", () => {
  it("maps blind winners back to the variant regardless of which side it was shown on", async () => {
    const harness = createPipelineHarness();
    cleanups.push(() => harness.close());
    const variant = registerPromptVariant(harness.sqlite, { stage: "SCRIPT", text: "Viết ngắn, nhịp nhanh." });
    // Judge always picks the side that holds the variant: expect every trial recorded as "A".
    const alwaysVariant = await runVariantTrials(harness.sqlite, {
      variantId: variant.id,
      fixtureIds: ["f1", "f2", "f3", "f4"],
      random: () => 0.1, // variant shown as A
      judge: async (_f, variantIsA) => (variantIsA ? "A" : "B"),
    });
    expect(alwaysVariant.trials.map((t) => t.winner)).toEqual(["A", "A", "A", "A"]);
    expect(alwaysVariant.verdict.winRate).toBe(1);
    expect(alwaysVariant.verdict.recommend).toBe(false); // fewer than 10 trials

    const ties = await runVariantTrials(harness.sqlite, {
      variantId: variant.id,
      fixtureIds: ["f5"],
      random: () => 0.9,
      judge: async () => "TIE",
    });
    expect(ties.trials[0].winner).toBe("TIE");
  });

  it("recommends only after enough trials with a clear win rate", async () => {
    const harness = createPipelineHarness();
    cleanups.push(() => harness.close());
    const variant = registerPromptVariant(harness.sqlite, { stage: "SCRIPT", text: "Kể chuyện theo ba màn." });
    const fixtures = Array.from({ length: 10 }, (_, i) => `fx${i}`);
    const result = await runVariantTrials(harness.sqlite, {
      variantId: variant.id,
      fixtureIds: fixtures,
      random: () => 0.1,
      judge: async (fixtureId) => (fixtureId === "fx0" ? "B" : "A"),
    });
    expect(result.verdict.trials).toBe(10);
    expect(result.verdict.winRate).toBe(0.9);
    expect(result.verdict.recommend).toBe(true);
  });
});
