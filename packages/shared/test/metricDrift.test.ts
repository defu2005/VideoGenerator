import { describe, expect, it } from "vitest";
import { metricDrift, driftCategory, type MetricPoint } from "../src/knowledge/drift.js";

function points(values: Array<number | null>, revision = "v1"): MetricPoint[] {
  return values.map((value, i) => ({ date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    value, samples: 4, knowledgeRev: revision, format: "*", definition: "views48h:v1" }));
}
describe("guarded CUSUM", () => {
  it("warms up again after missing data instead of disabling the detector permanently", () => {
    const p = points([null, ...Array(14).fill(100), 60, 60, 60]);
    expect(metricDrift(p)?.direction).toBe("down");
    const boundary = points([...Array(17).fill(100), ...Array(14).fill(200), 100, 100, 100])
      .map((x, i) => i >= 17 ? { ...x, definition: "new-counting" } : x);
    expect(metricDrift(boundary)?.direction).toBe("down");
  });
  it("confirms sustained increases and decreases, not an isolated outlier", () => {
    const base = Array.from({ length: 14 }, (_, i) => 100 + i % 2);
    expect(metricDrift(points([...base, 60, 60, 60]))?.direction).toBe("down");
    expect(metricDrift(points([...base, 140, 140, 140]))?.direction).toBe("up");
    expect(metricDrift(points([...base, 500, 100, 100]))).toBeNull();
    expect(metricDrift(points([...base, 100, 101, 100]))).toBeNull();
  });
  it("does not bridge sparse samples, missing days, nulls or a metric definition change", () => {
    const p = points([...Array(14).fill(100), 60, 60, 60]);
    expect(metricDrift(p.map(x => ({ ...x, samples: 1 })))).toBeNull();
    expect(metricDrift(p.filter((_, i) => i !== 4))).toBeNull();
    expect(metricDrift(p.map((x, i) => i === 15 ? { ...x, value: null } : x))).toBeNull();
    expect(metricDrift(p.map((x, i) => i >= 14 ? { ...x, definition: "new-counting" } : x))).toBeNull();
    expect(metricDrift(p.slice(0, 16))).toBeNull();
  });
  it("separates knowledge revision changes from platform and format hypotheses", () => {
    const p = points([...Array(14).fill(100), 60, 60, 60]).map((x, i) => ({ ...x, knowledgeRev: i < 14 ? "old" : "new" }));
    expect(metricDrift(p)?.knowledgeChanged).toBe(true);
    expect(driftCategory({ knowledgeChanged: true, allPlatformChannels: true, oneFormat: false })).toBe("G1");
    expect(driftCategory({ knowledgeChanged: false, allPlatformChannels: true, oneFormat: false })).toBe("B4");
    expect(driftCategory({ knowledgeChanged: false, allPlatformChannels: false, oneFormat: true })).toBe("C2");
  });
});
