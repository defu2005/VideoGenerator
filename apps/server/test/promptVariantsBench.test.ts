import { afterEach, describe, expect, it } from "vitest";
import { registerPromptVariant, activePromptVariant, promotePromptVariant } from "../src/learning/promptVariants.js";
import { parseVariantArg, runVariantBench } from "../src/cli/benchScript.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-148e: scope and bench helpers. No network, no LLM, fake judge only.
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

describe("TASK-148e scope and bench helpers", () => {
  it("parses --variant and rejects a missing value", () => {
    expect(parseVariantArg(["node", "bench", "--variant", "abc"])).toBe("abc");
    expect(parseVariantArg(["node", "bench"])).toBeNull();
    expect(() => parseVariantArg(["node", "bench", "--variant"])).toThrow("--variant needs a variant id");
    expect(() => parseVariantArg(["node", "bench", "--variant", "--other"])).toThrow();
  });

  it("runs blind trials through the shared runner with a fake judge", async () => {
    const harness = createPipelineHarness();
    cleanups.push(() => harness.close());
    const variant = registerPromptVariant(harness.sqlite, { stage: "SCRIPT", text: "bench variant" });
    const result = await runVariantBench(harness.sqlite, {
      variantId: variant.id,
      fixtureIds: ["b1", "b2"],
      random: () => 0.1, // variant shown as A
      judge: async (_f, variantIsA) => (variantIsA ? "A" : "B"),
    });
    expect(result.trials.map((t) => t.winner)).toEqual(["A", "A"]);
  });

  it("scope is global per stage, not per profile: the table has no profile column and one active variant per stage", () => {
    const harness = createPipelineHarness();
    cleanups.push(() => harness.close());
    const columns = (harness.sqlite.prepare("PRAGMA table_info(stage_prompt_variants)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns).not.toContain("profile_id");
    expect(columns).not.toContain("profileId");

    const a = registerPromptVariant(harness.sqlite, { stage: "SCRIPT", text: "scope a" });
    const b = registerPromptVariant(harness.sqlite, { stage: "SCRIPT", text: "scope b" });
    promotePromptVariant(harness.sqlite, { id: a.id, decidedBy: "user" });
    promotePromptVariant(harness.sqlite, { id: b.id, decidedBy: "user" });
    // The one active row is returned for any caller, because the lookup takes only a stage.
    expect(activePromptVariant(harness.sqlite, "SCRIPT")?.id).toBe(b.id);
  });
});
