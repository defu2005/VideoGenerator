import { describe, expect, it } from "vitest";
import {
  baselineStageTimeouts,
  estimateStageMs,
  historyBucket,
  percentile,
  stageTimeoutInputHash,
  type StageEstimateBrief,
  type StageRun,
} from "../src/index.js";

const brief: StageEstimateBrief = {
  targetDurationSec: 120, sceneDurationSec: 7, wordsPerMinute: 150, style: "storytelling",
  platform: "youtube", aspectRatio: "16:9", budgetMode: "BALANCED", nodeId: null,
};
const SCENES = Math.ceil(120 / 7);

function run(index: number, over: Partial<StageRun> = {}): StageRun {
  return {
    stage: "RENDER", durationMs: 60_000, scenes: SCENES, targetSec: 120, budgetMode: "BALANCED",
    aspectRatio: "16:9", nodeId: null, provider: null,
    finishedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), ...over,
  };
}

describe("estimateStageMs", () => {
  it("uses the baseline alone with no history", () => {
    const e = estimateStageMs([], brief, "RENDER");
    expect(e.basis).toBe("baseline");
    expect(e.samples).toBe(0);
    expect(e.confidence).toBe("low");
    expect(e.limitMs).toBe(baselineStageTimeouts(brief).RENDER);
    expect(e.explanation).toContain("Chưa có lịch sử");
  });

  it("blends 3 samples with the baseline by n/5", () => {
    const history = [run(1), run(2), run(3)];
    const e = estimateStageMs(history, brief, "RENDER");
    expect(e.basis).toBe("blend");
    expect(e.samples).toBe(3);
    expect(e.confidence).toBe("low");
    expect(e.lowReasons.join(" ")).toContain("3 lần");
    const pure = estimateStageMs(Array.from({ length: 10 }, (_, i) => run(i)), brief, "RENDER");
    expect(pure.basis).toBe("history");
    expect(e.expectedMs).toBeGreaterThan(pure.expectedMs);
  });

  it("is not dragged by one outlier in 20 samples", () => {
    const history = Array.from({ length: 20 }, (_, i) => run(i, { durationMs: i === 7 ? 3_000_000 : 100_000 }));
    const e = estimateStageMs(history, brief, "RENDER");
    expect(e.basis).toBe("history");
    expect(e.expectedMs).toBe(100_000);
    expect(e.limitMs).toBeLessThan(260_000);
    expect(e.confidence).toBe("high");
  });

  it("scales per scene and per second", () => {
    const history = Array.from({ length: 10 }, (_, i) => run(i, { scenes: 10, durationMs: 100_000 }));
    const small = estimateStageMs(history, { ...brief, targetDurationSec: 70 }, "RENDER");
    const big = estimateStageMs(history, { ...brief, targetDurationSec: 140 }, "RENDER");
    expect(big.expectedMs).toBeCloseTo(small.expectedMs * 2, -3);
    const voice = Array.from({ length: 10 }, (_, i) => run(i, { stage: "VOICE", targetSec: 100, durationMs: 100_000 }));
    expect(estimateStageMs(voice, brief, "VOICE").expectedMs).toBe(120_000);
  });

  it("prefers the same machine when it has at least 5 runs", () => {
    const main = Array.from({ length: 6 }, (_, i) => run(i, { durationMs: 60_000 }));
    const remote = Array.from({ length: 6 }, (_, i) => run(10 + i, { durationMs: 600_000, nodeId: "n1" }));
    const mainEstimate = estimateStageMs([...main, ...remote], brief, "RENDER");
    const remoteEstimate = estimateStageMs([...main, ...remote], { ...brief, nodeId: "n1" }, "RENDER");
    expect(mainEstimate.expectedMs).toBe(60_000);
    expect(remoteEstimate.expectedMs).toBe(600_000);
  });

  it("goes low confidence for wide spread, bigger brief and a new node", () => {
    const wide = Array.from({ length: 10 }, (_, i) => run(i, { durationMs: i < 8 ? 60_000 : 400_000 }));
    expect(estimateStageMs(wide, brief, "RENDER").lowReasons.join(" ")).toContain("độ lệch");
    const steady = Array.from({ length: 10 }, (_, i) => run(i));
    expect(estimateStageMs(steady, { ...brief, targetDurationSec: 600 }, "RENDER").lowReasons.join(" ")).toContain("lớn hơn");
    expect(estimateStageMs(steady, { ...brief, nodeId: "n9" }, "RENDER").lowReasons.join(" ")).toContain("node n9");
    expect(estimateStageMs(steady, { ...brief, aspectRatio: "9:16" }, "RENDER").lowReasons.join(" ")).toContain("9:16");
    expect(estimateStageMs(steady, brief, "RENDER").confidence).toBe("high");
  });

  it("keeps only the 30 most recent runs", () => {
    const old = Array.from({ length: 30 }, (_, i) => run(i, { durationMs: 600_000 }));
    const fresh = Array.from({ length: 30 }, (_, i) => run(100 + i, { durationMs: 60_000 }));
    expect(estimateStageMs([...old, ...fresh], brief, "RENDER").expectedMs).toBe(60_000);
  });
});

describe("history in the plan hash", () => {
  it("changes the hash only when a bucket is given", () => {
    const input = { ...brief, topic: "t" };
    expect(stageTimeoutInputHash(input)).toBe(stageTimeoutInputHash({ ...input, historyBucket: undefined }));
    expect(stageTimeoutInputHash({ ...input, historyBucket: "5h" })).not.toBe(stageTimeoutInputHash(input));
    const b1 = historyBucket({ RENDER: { samples: 4, confidence: "low" } });
    const b2 = historyBucket({ RENDER: { samples: 5, confidence: "low" } });
    expect(b1).not.toBe(b2);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
});
