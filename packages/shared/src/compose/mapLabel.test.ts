import { describe, expect, it } from "vitest";
import { boxesOverlap, visibleLabelIndexes, visualLabelPoint, type LngLat } from "./mapLabel.js";

describe("visualLabelPoint", () => {
  it("stays in the corridor of a north-heavy shape instead of the wide northern tip", () => {
    const ring: LngLat[] = [
      [102, 23], [110, 23], [110, 20], [105.5, 20], [105.5, 8],
      [104.5, 8], [104.5, 20], [102, 20], [102, 23],
    ];
    const [lon, lat] = visualLabelPoint([[ring]]);
    expect(lat).toBeGreaterThan(11);
    expect(lat).toBeLessThan(19);
    expect(lon).toBeGreaterThan(104);
    expect(lon).toBeLessThan(106);
  });
});

describe("label collision", () => {
  it("keeps the larger neighbour and hides one that overlaps it", () => {
    const visible = visibleLabelIndexes([
      { box: { x: 0, y: 0, w: 10, h: 10 }, rank: 1 },
      { box: { x: 5, y: 0, w: 10, h: 10 }, rank: 5 },
      { box: { x: 40, y: 0, w: 8, h: 8 }, rank: 1 },
    ]);
    expect(visible).toEqual([false, true, true]);
    expect(boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 })).toBe(true);
    expect(boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 40, y: 0, w: 8, h: 8 })).toBe(false);
  });
});
