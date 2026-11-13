import { describe, expect, it } from "vitest";
import { estimateRenderSeconds } from "./estimate.js";
import type { EstimatePlan } from "./estimate.js";

/** Shot mixes from RESEARCH-075 modes.md (1080×1920 model), split evenly inside each kind. */
const FIXTURES: Record<string, { videoSec: number; kinetic: number; chart: number; footage: number; still: number; graphicSec: number }> = {
  explainer: { videoSec: 34.2, kinetic: 1, chart: 2, footage: 6, still: 4, graphicSec: 7.78 },
  listicle: { videoSec: 32.167, kinetic: 4, chart: 0, footage: 8, still: 5, graphicSec: 7.56 },
  story: { videoSec: 29, kinetic: 2, chart: 0, footage: 6, still: 3, graphicSec: 3.34 },
};

function fixture(name: string): EstimatePlan {
  const row = FIXTURES[name]!;
  const graphicCount = row.kinetic + row.chart;
  const graphicEach = graphicCount > 0 ? row.graphicSec / graphicCount : 0;
  const rest = Math.max(0, row.videoSec - row.graphicSec);
  const pictureCount = row.footage + row.still;
  const pictureEach = pictureCount > 0 ? rest / pictureCount : 0;
  let cursor = 0;
  const shot = (kind: "kinetic_text" | "chart" | "footage" | "still", length: number) => {
    const startSec = cursor;
    cursor += length;
    return { kind, startSec, endSec: cursor };
  };
  const shots = [
    ...Array.from({ length: row.kinetic }, () => shot("kinetic_text", graphicEach)),
    ...Array.from({ length: row.chart }, () => shot("chart", graphicEach)),
    ...Array.from({ length: row.footage }, () => shot("footage", pictureEach)),
    ...Array.from({ length: row.still }, () => shot("still", pictureEach)),
  ];
  return { scenes: [{ shots }] };
}

describe("estimateRenderSeconds", () => {
  it("prices map, compare, quote and list like a chart", () => {
    const cost = (kind: "chart" | "map" | "compare" | "quote_full" | "list_full") => estimateRenderSeconds(
      { scenes: [{ shots: [{ kind, startSec: 0, endSec: 3 }] }] },
      { composeGraphics: "animated", graphicGrain: true },
    ).seconds;
    expect(cost("map")).toBe(cost("chart"));
    expect(cost("compare")).toBe(cost("chart"));
    expect(cost("quote_full")).toBe(cost("chart"));
    expect(cost("list_full")).toBe(cost("chart"));
  });

  it("is monotone on the three eval fixtures: off ≤ static ≤ animated", () => {
    for (const name of Object.keys(FIXTURES)) {
      const plan = fixture(name);
      const off = estimateRenderSeconds(plan, { composeGraphics: "off" }).seconds;
      const still = estimateRenderSeconds(plan, { composeGraphics: "static" }).seconds;
      const animated = estimateRenderSeconds(plan, { composeGraphics: "animated", graphicGrain: false }).seconds;
      expect(off, name).toBeLessThanOrEqual(still);
      expect(still, name).toBeLessThanOrEqual(animated);
    }
  });

  it("costs a cached shot nothing and widens the line by 40 percent", () => {
    const plan: EstimatePlan = { scenes: [{ shots: [{ kind: "kinetic_text", startSec: 0, endSec: 3, cached: true }] }] };
    const estimate = estimateRenderSeconds(plan, { composeGraphics: "animated" });
    expect(estimate.seconds).toBeCloseTo(0.10 + (0.6 - 0.10) * 3 / 3, 5);
    expect(estimate.lowSec).toBeCloseTo(estimate.seconds * 0.6, 5);
    expect(estimate.highSec).toBeCloseTo(estimate.seconds * 1.4, 5);
    expect(estimate.textVi).toContain("Ước tính:");
    expect(estimate.textVi).toContain("Không gồm giọng đọc");
    expect(estimate.measuredOn).toBe("2026-11-11");
  });

  it("charges grain only for animated graphics", () => {
    const plan: EstimatePlan = { scenes: [{ shots: [{ kind: "chart", startSec: 0, endSec: 3 }] }] };
    const plain = estimateRenderSeconds(plan, { composeGraphics: "animated", graphicGrain: false }).seconds;
    const grain = estimateRenderSeconds(plan, { composeGraphics: "animated", graphicGrain: true }).seconds;
    expect(grain).toBeGreaterThan(plain);
    expect(estimateRenderSeconds(plan, { composeGraphics: "static", graphicGrain: true }).seconds)
      .toBeCloseTo(estimateRenderSeconds(plan, { composeGraphics: "static", graphicGrain: false }).seconds, 5);
  });
});
