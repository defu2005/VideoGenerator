import { describe, expect, it } from "vitest";
import { estimateBudget, estimateSceneCount, recommendBrief, resolveBudget } from "../src/index.js";

const project = (mode: "ECO" | "BALANCED" | "QUALITY" | "MAX" | "CUSTOM") => ({
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
      semanticImageRerank: false, visionCheck: false, visionRetryRounds: 0, visionThreshold: 7,
      visualSearchBreadth: 8, renderVerify: false, thumbnailPick: false, factCheck: false,
      musicAssist: false, metadata: false, guidelineCheck: "off", webImageSearch: 0, modelAdvisor: true, topicSuggest: true, assistantChat: true, financeInsight: false, performanceInsight: true, clipPick: false, commentAssist: false, trendMatch: true, translateScript: false, outputHeadroom: 1,
    }],
    ["BALANCED", {
      storyMode: "separate", repairAttempts: 1, scriptReview: true, scriptReviewPasses: 1,
      researchDepth: "standard", altQueryAssist: true, sceneQueryAssist: true,
      semanticImageRerank: true, visionCheck: false, visionRetryRounds: 0, visionThreshold: 7,
      visualSearchBreadth: 8, renderVerify: false, thumbnailPick: false, factCheck: false,
      musicAssist: true, metadata: true, guidelineCheck: "check", webImageSearch: 3, modelAdvisor: true, topicSuggest: true, assistantChat: true, financeInsight: true, performanceInsight: true, clipPick: true, commentAssist: true, trendMatch: true, translateScript: true, outputHeadroom: 1.5,
    }],
    ["QUALITY", {
      storyMode: "separate", repairAttempts: 2, scriptReview: true, scriptReviewPasses: 2,
      researchDepth: "deep", altQueryAssist: true, sceneQueryAssist: true,
      semanticImageRerank: true, visionCheck: false, visionRetryRounds: 0, visionThreshold: 7,
      visualSearchBreadth: 8, renderVerify: false, thumbnailPick: false, factCheck: false,
      musicAssist: true, metadata: true, guidelineCheck: "checkAndFix", webImageSearch: 8, modelAdvisor: true, topicSuggest: true, assistantChat: true, financeInsight: true, performanceInsight: true, clipPick: true, commentAssist: true, trendMatch: true, translateScript: true, outputHeadroom: 2,
    }],
    ["MAX", {
      storyMode: "separate", repairAttempts: 2, scriptReview: true, scriptReviewPasses: 2,
      researchDepth: "deep", altQueryAssist: true, sceneQueryAssist: true,
      semanticImageRerank: true, visionCheck: true, visionRetryRounds: 2, visionThreshold: 7,
      visualSearchBreadth: 16, renderVerify: true, thumbnailPick: true, factCheck: true,
      musicAssist: true, metadata: true, guidelineCheck: "checkAndFix", webImageSearch: 999, modelAdvisor: true, topicSuggest: true, assistantChat: true, financeInsight: true, performanceInsight: true, clipPick: true, commentAssist: true, trendMatch: true, translateScript: true, outputHeadroom: 2,
    }],
  ] as const)("resolves the %s feature preset", (mode, expected) => {
    expect(resolveBudget(mode)).toEqual(expected);
  });

  it("uses BALANCED defaults with partial CUSTOM overrides", () => {
    expect(resolveBudget("CUSTOM", { storyMode: "merged", scriptReview: true, visionCheck: true })).toEqual({
      ...resolveBudget("BALANCED"),
      storyMode: "merged",
      scriptReview: true,
      visionCheck: true,
    });
  });

  it.each([
    ["ECO", 1, 1],
    // +1 Gemini grounding batch (up to 3 web scenes) vs pre-007C BALANCED max 13
    ["BALANCED", 8, 14],
    // +2 grounding batches (up to 8 web scenes) vs pre-007C QUALITY max 26
    ["QUALITY", 9, 28],
  ] as const)("estimates %s LLM call bounds", (mode, min, max) => {
    expect(estimateBudget(project(mode), "mock").total).toEqual({ min, max });
    expect(estimateBudget(project(mode), "mock").tokens).toBeDefined();
  });

  it("estimates MAX with vision and fact-check calls", () => {
    const scenes = estimateSceneCount(project("MAX"));
    const estimate = estimateBudget(project("MAX"), "mock");
    expect(estimate.features.visionCheck).toBe(true);
    expect(estimate.features.factCheck).toBe(true);
    expect(estimate.features.renderVerify).toBe(true);
    expect(estimate.later).toBeUndefined();
    // SCRIPT includes fact-check (+1 vs QUALITY)
    expect(estimate.perStage.find((stage) => stage.stage === "SCRIPT")?.calls.min).toBeGreaterThan(
      estimateBudget(project("QUALITY")).perStage.find((stage) => stage.stage === "SCRIPT")!.calls.min,
    );
    // VISUAL_SEARCH includes per-scene vision + consistency
    expect(estimate.perStage.find((stage) => stage.stage === "VISUAL_SEARCH")?.calls.min).toBeGreaterThanOrEqual(scenes);
    expect(estimate.perStage.find((stage) => stage.stage === "RENDER")?.calls.min).toBeGreaterThan(0);
    expect(estimate.total.min).toBeGreaterThan(estimateBudget(project("QUALITY"), "mock").total.min);
    expect(estimate.tokens?.input).toBeGreaterThan(0);
  });

  it.each([
    ["ECO", {
      RESEARCH: { min: 1, max: 1 }, VISUAL_SEARCH: { min: 0, max: 0 }, SCRIPT: { min: 0, max: 0 },
      SCENE_PLAN: { min: 0, max: 0 }, MUSIC_SEARCH: { min: 0, max: 0 }, TIMELINE: { min: 0, max: 0 },
    }],
    ["BALANCED", {
      RESEARCH: { min: 1, max: 2 }, VISUAL_SEARCH: { min: 1, max: 3 }, SCRIPT: { min: 3, max: 6 },
      SCENE_PLAN: { min: 1, max: 1 }, MUSIC_SEARCH: { min: 1, max: 1 }, TIMELINE: { min: 1, max: 1 },
    }],
    ["QUALITY", {
      RESEARCH: { min: 1, max: 3 }, VISUAL_SEARCH: { min: 1, max: 4 }, SCRIPT: { min: 4, max: 18 },
      SCENE_PLAN: { min: 1, max: 1 }, MUSIC_SEARCH: { min: 1, max: 1 }, TIMELINE: { min: 1, max: 1 },
    }],
  ] as const)("estimates per-stage calls for %s", (mode, expected) => {
    const estimate = estimateBudget(project(mode));
    expect(Object.fromEntries(estimate.perStage.map((stage) => [stage.stage, stage.calls]))).toEqual(expected);
  });

  it("estimates merged CUSTOM review and a user-set legacy research-off mode", () => {
    const custom = project("CUSTOM");
    custom.settings.budget.features = { storyMode: "merged", scriptReview: true };
    expect(estimateBudget(custom).total).toEqual({ min: 7, max: 12 });

    const off = project("BALANCED");
    off.settings.researchMode = "off";
    off.settings.userSet = ["researchMode"];
    expect(estimateBudget(off).total).toEqual({ min: 7, max: 12 });
  });

  it("reports zero for completed stages and hides token estimates for CLI requests", () => {
    const done = [
      { stage: "RESEARCH", state: "DONE" },
      { stage: "SCRIPT", state: "DONE" },
      { stage: "SCENE_PLAN", state: "DONE" },
      { stage: "VISUAL_SEARCH", state: "DONE" },
      { stage: "MUSIC_SEARCH", state: "DONE" },
      { stage: "TIMELINE", state: "DONE" },
      { stage: "RENDER", state: "DONE" },
    ];
    expect(estimateBudget(project("QUALITY"), "mock", done).total).toEqual({ min: 0, max: 0 });
    expect(estimateBudget(project("QUALITY"), "copilot-cli").tokens).toBeUndefined();
  });

  it("counts musicAssist and metadata and no longer lists visionCheck as later", () => {
    const estimate = estimateBudget(project("BALANCED"));
    expect(estimate.later).toBeUndefined();
    expect(estimate.perStage.find((stage) => stage.stage === "MUSIC_SEARCH")?.tasks).toContainEqual(
      expect.objectContaining({ task: "musicAssist", calls: { min: 1, max: 1 } }),
    );
    expect(estimate.perStage.find((stage) => stage.stage === "TIMELINE")?.tasks).toContainEqual(
      expect.objectContaining({ task: "metadata", calls: { min: 1, max: 1 } }),
    );
  });

  it("estimates visual search LLM bounds from budget features", () => {
    expect(estimateBudget(project("ECO")).perStage.find((item) => item.stage === "VISUAL_SEARCH")?.calls)
      .toEqual({ min: 0, max: 0 });
    expect(estimateBudget(project("BALANCED")).perStage.find((item) => item.stage === "VISUAL_SEARCH")?.calls)
      .toEqual({ min: 1, max: 3 });
    expect(estimateBudget(project("QUALITY")).perStage.find((item) => item.stage === "VISUAL_SEARCH")?.calls)
      .toEqual({ min: 1, max: 4 });
  });

  it("caps web image search scenes per budget mode and estimates grounding batches", () => {
    expect(resolveBudget("ECO").webImageSearch).toBe(0);
    expect(resolveBudget("BALANCED").webImageSearch).toBe(3);
    expect(resolveBudget("QUALITY").webImageSearch).toBe(8);
    expect(resolveBudget("MAX").webImageSearch).toBe(999);
    const balanced = estimateBudget(project("BALANCED"));
    expect(balanced.perStage.find((stage) => stage.stage === "VISUAL_SEARCH")?.tasks).toContainEqual(
      expect.objectContaining({ task: "webImageGrounding", calls: { min: 0, max: 1 } }),
    );
    expect(balanced.perStage.find((stage) => stage.stage === "VISUAL_SEARCH")?.reason).toMatch(/Brave request/);
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

  it("estimates realistic input tokens for a 10-minute Vietnamese video", () => {
    const base = {
      topic: "Lịch sử cà phê Việt Nam từ Buôn Ma Thuột đến xuất khẩu toàn cầu",
      description: "Video dài kể hành trình cà phê Việt.",
      settings: {
        language: "vi",
        targetDurationSec: 600,
        wordsPerMinute: 150,
        userSet: [] as string[],
      },
    };
    const balanced = estimateBudget({
      ...base,
      settings: { ...base.settings, budget: { mode: "BALANCED" as const } },
    }, "mock").tokens!.input;
    const quality = estimateBudget({
      ...base,
      settings: { ...base.settings, budget: { mode: "QUALITY" as const } },
    }, "mock").tokens!.input;
    const max = estimateBudget({
      ...base,
      settings: { ...base.settings, budget: { mode: "MAX" as const } },
    }, "mock").tokens!.input;
    expect(balanced).toBeGreaterThanOrEqual(15_000);
    expect(balanced).toBeLessThanOrEqual(80_000);
    expect(quality).toBeGreaterThan(balanced);
    expect(max).toBeGreaterThan(quality);
  });
});
