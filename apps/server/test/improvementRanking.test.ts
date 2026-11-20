import { describe, expect, it } from "vitest";
import {
  rankImprovements, scoreImprovement, selectWeeklyDigest, type RankableImprovement,
} from "../src/operator/improvementRanking.js";

function row(overrides: Partial<RankableImprovement> = {}): RankableImprovement {
  return {
    id: "r", status: "open", weight: 1, effort: null, expectedImpact: null,
    updatedAt: "2026-11-20T00:00:00.000Z", ...overrides,
  };
}

describe("TASK-074c-2 scoreImprovement: weight × impact ÷ effort (S=1, M=2, L=3)", () => {
  it("divides weight by the effort factor", () => {
    expect(scoreImprovement(row({ weight: 3, effort: "S" }))).toBe(3);
    expect(scoreImprovement(row({ weight: 3, effort: "M" }))).toBe(1.5);
    expect(scoreImprovement(row({ weight: 3, effort: "L" }))).toBe(1);
  });

  it("treats a null effort as factor 1 and never returns NaN", () => {
    expect(scoreImprovement(row({ weight: 4, effort: null }))).toBe(4);
    expect(Number.isFinite(scoreImprovement(row({ effort: null, expectedImpact: null })))).toBe(true);
  });

  it("treats an unknown effort value as factor 1", () => {
    expect(scoreImprovement(row({ weight: 5, effort: "XL" as never }))).toBe(5);
  });

  it("ignores expectedImpact, because the spec object has no numeric field (factor 1)", () => {
    const impact = JSON.stringify({ metric: "views", direction: "up", note: "tăng lượt xem" });
    expect(scoreImprovement(row({ weight: 2, effort: "M", expectedImpact: impact }))).toBe(1);
  });

  it("tolerates expectedImpact text that is not JSON", () => {
    expect(scoreImprovement(row({ weight: 2, effort: null, expectedImpact: "không phải json" }))).toBe(2);
  });
});

describe("TASK-074c-2 rankImprovements: score desc, then updatedAt desc, then id asc", () => {
  it("orders the rows and breaks ties by recency and then id", () => {
    const ranked = rankImprovements([
      row({ id: "b", weight: 2, effort: "S", updatedAt: "2026-11-19T00:00:00.000Z" }),
      row({ id: "a", weight: 2, effort: "S", updatedAt: "2026-11-20T00:00:00.000Z" }),
      row({ id: "c", weight: 3, effort: "L", updatedAt: "2026-11-21T00:00:00.000Z" }),
      row({ id: "d", weight: 2, effort: "S", updatedAt: "2026-11-19T00:00:00.000Z" }),
    ]);
    expect(ranked.map((item) => item.id)).toEqual(["a", "b", "d", "c"]);
  });
});

describe("TASK-074c-2 selectWeeklyDigest: at most 3 open rows, ranked", () => {
  it("returns the top 3 open rows and drops rejected and done rows", () => {
    const rows = [
      row({ id: "w1", weight: 1 }), row({ id: "w2", weight: 2 }), row({ id: "w3", weight: 3 }),
      row({ id: "w4", weight: 4 }), row({ id: "w5", weight: 5 }),
      row({ id: "rejected", weight: 99, status: "rejected" }),
      row({ id: "done", weight: 98, status: "done" }),
    ];
    expect(selectWeeklyDigest(rows).map((item) => item.id)).toEqual(["w5", "w4", "w3"]);
  });

  it("returns fewer than 3 when fewer open rows exist", () => {
    expect(selectWeeklyDigest([row({ id: "only", weight: 1 })]).map((item) => item.id)).toEqual(["only"]);
  });
});
