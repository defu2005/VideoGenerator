import { afterEach, describe, expect, it } from "vitest";
import { checkStageQualityAlerts, recordStageQuality, stageQualityTrend } from "../src/learning/stageQuality.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

const NOW = new Date("2026-11-18T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe("stage quality ledger (TASK-148c)", () => {
  it("compares the last 14 days with the 14 before and opens one deduped alert on a 20% drop", () => {
    const harness = createPipelineHarness({ config: { LLM_DEFAULT_PROVIDER: "mock" } });
    harnesses.push(harness);
    const { sqlite, projectId } = harness;
    for (let i = 0; i < 6; i += 1) {
      recordStageQuality(sqlite, { projectId, profileId: null, stage: "SCRIPT", jobId: null, metrics: { quality_score: 80 }, now: daysAgo(1 + i) });
      recordStageQuality(sqlite, { projectId, profileId: null, stage: "SCRIPT", jobId: null, metrics: { quality_score: 100 }, now: daysAgo(20 + i) });
    }
    const trend = stageQualityTrend(sqlite, { stage: "SCRIPT", days: 14, now: NOW });
    expect(trend.current).toEqual({ runs: 6, mean: 80 });
    expect(trend.previous).toEqual({ runs: 6, mean: 100 });
    expect(trend.changePct).toBe(-20);

    const first = checkStageQualityAlerts(sqlite, { stages: ["SCRIPT"], now: NOW });
    expect(first).toEqual([{ stage: "SCRIPT", changePct: -20, opened: true }]);
    const again = checkStageQualityAlerts(sqlite, { stages: ["SCRIPT"], now: NOW });
    expect(again).toHaveLength(1);
    const open = sqlite.prepare("SELECT COUNT(*) AS n FROM agent_escalations WHERE kind = 'stage_quality_drop'").get() as { n: number };
    expect(open.n, "same stage, metric and week must dedupe to one escalation").toBe(1);
  });

  it("does not alert with fewer than five runs in the current window", () => {
    const harness = createPipelineHarness({ config: { LLM_DEFAULT_PROVIDER: "mock" } });
    harnesses.push(harness);
    const { sqlite, projectId } = harness;
    for (let i = 0; i < 3; i += 1) {
      recordStageQuality(sqlite, { projectId, profileId: null, stage: "TIMELINE", jobId: null, metrics: { quality_score: 40 }, now: daysAgo(1 + i) });
      recordStageQuality(sqlite, { projectId, profileId: null, stage: "TIMELINE", jobId: null, metrics: { quality_score: 90 }, now: daysAgo(20 + i) });
    }
    expect(checkStageQualityAlerts(sqlite, { stages: ["TIMELINE"], now: NOW })).toEqual([]);
  });
});
