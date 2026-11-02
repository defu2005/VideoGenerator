import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MergedStorySchema, ResearchNotesSchema, ScriptEnergySchema } from "../src/index.js";

describe("deterministic normalization of LLM output (avoids repair calls)", () => {
  it("accepts a real GitHub Copilot CLI merged story (Vietnamese enum words, numeric energy, string outline)", () => {
    const raw = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/copilot-merged-story-vi.json", import.meta.url)), "utf8"));
    const parsed = MergedStorySchema.parse(raw);
    expect(parsed.research.keyFacts.every((fact) => ["high", "medium", "low"].includes(fact.confidence))).toBe(true);
    expect(parsed.script.sections.every((section) => ["high", "medium", "low"].includes(section.energy))).toBe(true);
    expect(parsed.research.outline[0]).toMatchObject({ section: expect.any(String), purpose: expect.any(String), points: [] });
  });

  it.each([
    ["Cao", "high"], ["trung bình", "medium"], ["Thấp", "low"], ["HIGH", "high"],
    [1, "low"], [3, "medium"], [5, "high"], ["4", "high"], [0.2, "low"],
  ])("maps %s to %s", (input, expected) => {
    expect(ScriptEnergySchema.parse(input)).toBe(expected);
  });

  it("still rejects unknown words", () => {
    expect(ScriptEnergySchema.safeParse("super").success).toBe(false);
    expect(ResearchNotesSchema.shape.cautions.safeParse([1]).success).toBe(false);
  });
});
