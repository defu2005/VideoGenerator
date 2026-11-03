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
    ["ECO", {
      storyMode: "merged", repairAttempts: 0, scriptReview: false, scriptReviewPasses: 0,
      researchDepth: "light", altQueryAssist: false, sceneQueryAssist: false,
      semanticImageRerank: false, visionCheck: false, musicAssist: false, metadata: false, outputHeadroom: 1,
    }],
    ["BALANCED", {
      storyMode: "separate", repairAttempts: 1, scriptReview: true, scriptReviewPasses: 1,
      researchDepth: "standard", altQueryAssist: true, sceneQueryAssist: true,
      semanticImageRerank: true, visionCheck: false, musicAssist: true, metadata: true, outputHeadroom: 1.5,
    }],
    ["QUALITY", {
      storyMode: "separate", repairAttempts: 2, scriptReview: true, scriptReviewPasses: 2,
      researchDepth: "deep", altQueryAssist: true, sceneQueryAssist: true,
      semanticImageRerank: true, visionCheck: false, musicAssist: true, metadata: true, outputHeadroom: 2,
    }],
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
    ["BALANCED", 5, 9],
    ["QUALITY", 6, 15],
  ] as const)("estimates %s LLM call bounds", (mode, min, max) => {
    expect(estimateBudget(project(mode), "mock").total).toEqual({ min, max });
    expect(estimateBudget(project(mode), "mock").tokens).toBeDefined();
  });

  it.each([
    ["ECO", { RESEARCH: { min: 1, max: 1 }, VISUAL_SEARCH: { min: 0, max: 0 }, SCRIPT: { min: 0, max: 0 }, SCENE_PLAN: { min: 0, max: 0 } }],
    ["BALANCED", { RESEARCH: { min: 1, max: 2 }, VISUAL_SEARCH: { min: 1, max: 2 }, SCRIPT: { min: 2, max: 4 }, SCENE_PLAN: { min: 1, max: 1 } }],
    ["QUALITY", { RESEARCH: { min: 1, max: 3 }, VISUAL_SEARCH: { min: 1, max: 2 }, SCRIPT: { min: 3, max: 9 }, SCENE_PLAN: { min: 1, max: 1 } }],
  ] as const)("estimates per-stage calls for %s", (mode, expected) => {
    const estimate = estimateBudget(project(mode));
    expect(Object.fromEntries(estimate.perStage.map((stage) => [stage.stage, stage.calls]))).toEqual(expected);
  });

  it("estimates merged CUSTOM review and a user-set legacy research-off mode", () => {
    const custom = project("CUSTOM");
    custom.settings.budget.features = { storyMode: "merged", scriptReview: true };
    expect(estimateBudget(custom).total).toEqual({ min: 4, max: 7 });

    const off = project("BALANCED");
    off.settings.researchMode = "off";
    off.settings.userSet = ["researchMode"];
    expect(estimateBudget(off).total).toEqual({ min: 4, max: 7 });
  });

  it("reports zero for completed stages and hides token estimates for CLI requests", () => {
    const done = [
      { stage: "RESEARCH", state: "DONE" },
      { stage: "SCRIPT", state: "DONE" },
      { stage: "SCENE_PLAN", state: "DONE" },
      { stage: "VISUAL_SEARCH", state: "DONE" },
    ];
    expect(estimateBudget(project("QUALITY"), "mock", done).total).toEqual({ min: 0, max: 0 });
    expect(estimateBudget(project("QUALITY"), "copilot-cli").tokens).toBeUndefined();
  });

  it("estimates visual search LLM bounds from budget features", () => {
    expect(estimateBudget(project("ECO")).perStage.find((item) => item.stage === "VISUAL_SEARCH")?.calls)
      .toEqual({ min: 0, max: 0 });
    expect(estimateBudget(project("BALANCED")).perStage.find((item) => item.stage === "VISUAL_SEARCH")?.calls)
      .toEqual({ min: 1, max: 2 });
    expect(estimateBudget(project("QUALITY")).perStage.find((item) => item.stage === "VISUAL_SEARCH")?.calls)
      .toEqual({ min: 1, max: 2 });
  });

  it("reports selected routes by task and tolerates cleared project overrides", () => {
    const estimate = estimateBudget(project("BALANCED"), {
      research: { provider: "mock", model: "research-model" },
      script: { provider: "mock", model: "script-model" },
      scriptReview: null,
    });
    expect(estimate.perStage.find((stage) => stage.stage === "RESEARCH")?.tasks).toContainEqual(
      expect.objectContaining({ task: "research", provider: "mock", model: "research-model", calls: { min: 1, max: 2 } }),
    );
    expect(estimate.perStage.find((stage) => stage.stage === "SCRIPT")?.tasks).toContainEqual(
      expect.objectContaining({ task: "scriptReview", calls: { min: 1, max: 2 } }),
    );
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
