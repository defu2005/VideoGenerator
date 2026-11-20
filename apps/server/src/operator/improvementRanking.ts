/** TASK-074c-2: pure ranking for improvement_requests. No database access here. */

export type RankableImprovement = {
  id: string;
  status: string;
  weight: number;
  /** Stored as text: "S" | "M" | "L" from the spec, or null. */
  effort: string | null;
  /** Stored as text (JSON `{metric, direction, note}` in the spec). Not read for scoring yet. */
  expectedImpact: string | null;
  updatedAt: string;
};

/** Spec 074 §5: effort S=1, M=2, L=3. A missing or unknown effort counts as 1. */
const EFFORT_FACTOR = new Map<string, number>([["S", 1], ["M", 2], ["L", 3]]);

/** Spec 074 §5 ranks by weight × expected impact ÷ effort. The impact is an object with no number,
 *  so its factor is 1 until the spec defines one (assumption recorded in TASK-074c-2.report.md). */
export function scoreImprovement(row: RankableImprovement): number {
  const effort = row.effort === null ? 1 : (EFFORT_FACTOR.get(row.effort) ?? 1);
  return row.weight / effort;
}

/** Highest score first; ties go to the most recently updated row, then to the smaller id. */
export function rankImprovements<T extends RankableImprovement>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => scoreImprovement(b) - scoreImprovement(a)
    || (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const WEEKLY_DIGEST_MAX = 3;

/** Top open rows for a digest. Not wired to any digest yet: no weekly improvement digest exists in the codebase. */
export function selectWeeklyDigest<T extends RankableImprovement>(rows: readonly T[], max = WEEKLY_DIGEST_MAX): T[] {
  return rankImprovements(rows.filter((row) => row.status === "open")).slice(0, max);
}
