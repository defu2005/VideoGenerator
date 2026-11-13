import { describe, expect, it } from "vitest";
import {
  baselineStageTimeouts,
  planFromBaseline,
  planFromModel,
  resolveStageTimeoutMs,
  retryStageTimeoutMs,
  stageTimeoutCapMs,
  stageTimeoutInputHash,
  stageTimeoutPlanIsFresh,
} from "../src/index.js";

const reference = {
  targetDurationSec: 120,
  sceneDurationSec: 7,
  wordsPerMinute: 150,
  style: "storytelling",
  platform: "youtube",
  aspectRatio: "16:9",
};

describe("stage timeouts", () => {
  it("locks the 120 second reference ceilings", () => {
    expect(baselineStageTimeouts(reference)).toEqual({
      RESEARCH: 180_000,
      SCRIPT: 180_000,
      SCENE_PLAN: 120_000,
      VISUAL_SEARCH: 300_000,
      VOICE: 240_000,
      SUBTITLE: 90_000,
      MUSIC_SEARCH: 90_000,
      TIMELINE: 120_000,
      RENDER: 420_000,
      CLIP: 180_000,
      PUBLISH: 180_000,
    });
  });

  it("keeps a short near the floor and a long render much higher", () => {
    const short = baselineStageTimeouts({ ...reference, targetDurationSec: 30, platform: "tiktok" });
    const long = baselineStageTimeouts({ ...reference, targetDurationSec: 1800, style: "documentary" });
    expect(short.RESEARCH).toBe(60_000);
    expect(short.RENDER).toBeLessThan(420_000);
    expect(long.RENDER).toBeGreaterThan(baselineStageTimeouts(reference).RENDER);
    expect(long.VOICE).toBeGreaterThan(baselineStageTimeouts(reference).VOICE);
    expect(long.VISUAL_SEARCH).toBeGreaterThan(baselineStageTimeouts(reference).VISUAL_SEARCH);
  });

  it("raises research for documentary and visual search for listicle and more scenes", () => {
    const doc = baselineStageTimeouts({ ...reference, style: "documentary" });
    const explainer = baselineStageTimeouts({ ...reference, style: "explainer" });
    const listicle = baselineStageTimeouts({ ...reference, style: "listicle" });
    expect(doc.RESEARCH).toBeGreaterThan(explainer.RESEARCH);
    expect(listicle.VISUAL_SEARCH).toBeGreaterThan(baselineStageTimeouts(reference).VISUAL_SEARCH);
    const dense = baselineStageTimeouts({ ...reference, sceneDurationSec: 4 });
    expect(dense.VISUAL_SEARCH).toBeGreaterThan(baselineStageTimeouts(reference).VISUAL_SEARCH);
    expect(dense.SCENE_PLAN).toBeGreaterThan(baselineStageTimeouts(reference).SCENE_PLAN);
    expect(dense.RENDER).toBeGreaterThan(baselineStageTimeouts(reference).RENDER);
  });

  it("raises script and voice for slower narration and render for a portrait frame", () => {
    const slow = baselineStageTimeouts({ ...reference, wordsPerMinute: 120 });
    const portrait = baselineStageTimeouts({ ...reference, aspectRatio: "9:16" });
    expect(slow.SCRIPT).toBeGreaterThan(baselineStageTimeouts(reference).SCRIPT);
    expect(slow.VOICE).toBeGreaterThan(baselineStageTimeouts(reference).VOICE);
    expect(portrait.RENDER).toBeGreaterThan(baselineStageTimeouts(reference).RENDER);
  });

  it("uses the baseline when a stored plan omits the stage", () => {
    expect(resolveStageTimeoutMs({
      ...reference,
      stageTimeouts: {
        source: "llm",
        inputHash: "x",
        summary: "",
        stages: { SCRIPT: { timeoutMs: 60_000, reason: "ngắn", source: "llm" } },
      },
    }, "RENDER", 600_000)).toBe(420_000);
  });

  it("clamps both ends", () => {
    const tiny = baselineStageTimeouts({ ...reference, targetDurationSec: 30 });
    expect(Math.min(...Object.values(tiny))).toBe(60_000);
    const huge = baselineStageTimeouts({ ...reference, targetDurationSec: 1800, sceneDurationSec: 2, aspectRatio: "9:16" });
    expect(huge.RENDER).toBe(7_200_000);
    expect(huge.SCRIPT).toBe(1_800_000);
  });

  it("uses a stored plan, then the baseline, and keeps user rows", () => {
    expect(resolveStageTimeoutMs({ ...reference, stageTimeouts: { source: "user", inputHash: "x", summary: "", stages: { RESEARCH: { timeoutMs: 50, reason: "t", source: "user" } } } }, "RESEARCH", 600_000)).toBe(50);
    expect(resolveStageTimeoutMs(reference, "RESEARCH", 600_000)).toBe(180_000);
    expect(resolveStageTimeoutMs(reference, "VISUAL_REVIEW", 600_000)).toBe(600_000);
    const brief = { ...reference, topic: "hố đen", budgetMode: "BALANCED" };
    const first = planFromModel(brief, {
      summary: "ok",
      stages: [{ stage: "NOPE", timeoutSec: 1, reason: "bỏ" }, { stage: "RENDER", timeoutSec: 99999, reason: "dài" }],
    });
    expect(first.stages.NOPE).toBeUndefined();
    expect(first.stages.RENDER?.timeoutMs).toBe(7_200_000);
    expect(first.stages.RENDER?.source).toBe("llm");
    expect(first.source).toBe("mixed");
    const again = planFromBaseline(brief, {
      ...first,
      stages: { ...first.stages, VOICE: { timeoutMs: 90_000, reason: "Bạn chọn.", source: "user" } },
    });
    expect(again.stages.VOICE?.source).toBe("user");
    const hash = stageTimeoutInputHash(brief);
    expect(stageTimeoutPlanIsFresh({ stageTimeouts: { ...again, inputHash: hash } }, hash)).toBe(true);
    expect(stageTimeoutPlanIsFresh({ stageTimeouts: again }, hash + "x")).toBe(false);
  });

  it("grows the limit after a timeout and stops at the stage cap", () => {
    expect(retryStageTimeoutMs("VISUAL_SEARCH", 300_000, 0)).toBe(300_000);
    expect(retryStageTimeoutMs("VISUAL_SEARCH", 300_000, 1)).toBe(450_000);
    expect(retryStageTimeoutMs("VISUAL_SEARCH", 300_000, 2)).toBe(675_000);
    expect(retryStageTimeoutMs("VISUAL_SEARCH", 1_600_000, 2)).toBe(stageTimeoutCapMs("VISUAL_SEARCH"));
    expect(stageTimeoutCapMs("VISUAL_SEARCH")).toBe(1_800_000);
    expect(retryStageTimeoutMs("RENDER", 6_000_000, 2)).toBe(stageTimeoutCapMs("RENDER"));
    expect(stageTimeoutCapMs("RENDER")).toBe(7_200_000);
  });
});
