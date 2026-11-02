import { describe, expect, it } from "vitest";
import { estimateBudget, recommendBrief, resolveBudget } from "../src/index.js";

const project = (mode: "ECO" | "BALANCED" | "QUALITY" | "CUSTOM") => ({
  topic: "A video topic",
  description: "",
  settings: {
    budget: { mode },
    language: "en",
    targetDurationSec: 120,
    wordsPerMinute: 150,
    userSet: [],
  },
});

describe("budget modes", () => {
  it.each([
    ["ECO", { storyMode: "merged", repairAttempts: 0, scriptReview: false, altQueryAssist: false, semanticImageRerank: false, visionCheck: false, musicAssist: false }],
    ["BALANCED", { storyMode: "separate", repairAttempts: 1, scriptReview: false, altQueryAssist: true, semanticImageRerank: false, visionCheck: false, musicAssist: false }],
    ["QUALITY", { storyMode: "separate", repairAttempts: 1, scriptReview: true, altQueryAssist: true, semanticImageRerank: true, visionCheck: false, musicAssist: true }],
  ] as const)("resolves the %s feature preset", (mode, expected) => {
    expect(resolveBudget(mode)).toEqual(expected);
  });

  it("uses BALANCED defaults with partial CUSTOM overrides", () => {
    expect(resolveBudget("CUSTOM", { storyMode: "merged", scriptReview: true })).toEqual({
      ...resolveBudget("BALANCED"),
      storyMode: "merged",
      scriptReview: true,
    });
  });

  it.each([
    ["ECO", 1, 1],
    ["BALANCED", 2, 4],
    ["QUALITY", 3, 6],
  ] as const)("estimates %s LLM call bounds", (mode, min, max) => {
    expect(estimateBudget(project(mode), "mock").total).toEqual({ min, max });
    expect(estimateBudget(project(mode), "mock").tokens).toBeDefined();
  });

  it("estimates merged CUSTOM review and a user-set legacy research-off mode", () => {
    const custom = project("CUSTOM");
    custom.settings.budget.features = { storyMode: "merged", scriptReview: true };
    expect(estimateBudget(custom).total).toEqual({ min: 2, max: 4 });

    const off = project("BALANCED");
    off.settings.researchMode = "off";
    off.settings.userSet = ["researchMode"];
    expect(estimateBudget(off).total).toEqual({ min: 1, max: 2 });
  });

  it("reports zero for completed stages and hides token estimates for CLI requests", () => {
    const done = [
      { stage: "RESEARCH", state: "DONE" },
      { stage: "SCRIPT", state: "DONE" },
    ];
    expect(estimateBudget(project("QUALITY"), "mock", done).total).toEqual({ min: 0, max: 0 });
    expect(estimateBudget(project("QUALITY"), "copilot-cli").tokens).toBeUndefined();
  });

  it("recommends BALANCED with the specified reason", () => {
    const result = recommendBrief({ topic: "A video" });
    expect(result.values.settings.budget.mode).toBe("BALANCED");
    expect(result.recommendations["budget.mode"]).toMatchObject({
      value: "BALANCED",
      reason: "Default balance of cost and quality",
      source: "recommended",
    });
  });
});
