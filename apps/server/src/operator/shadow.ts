import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { RoutedPart } from "./routing.js";
import { getOperatorSettings } from "./settings.js";
import { shadowVersionFor } from "./skillVersions.js";
import { parseSkillMarkdown } from "./skills.js";

/**
 * TASK-074b-3b: runs needed before a shadow version is "du_mau", and the length of its clock. Both are
 * constants, not settings (the schema change for operator.shadowMinRuns is not done; see the report).
 */
export const SHADOW_MIN_RUNS = 5;
export const SHADOW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type ShadowProgress = {
  /** Counted runs of this shadow version, all time. */
  runs: number;
  /** The first row's created_at, which starts the clock. Null when there are no rows. */
  firstAt: string | null;
  status: "dang_thu" | "du_mau" | "chua_du_mau";
};

/**
 * Progress of one shadow version. Counts runs with COUNT(DISTINCT COALESCE(run_id, id)), as the guide defines.
 * The clock starts at MIN(created_at) for this skill and shadow_version. Re-shadowing the same version does
 * not restart it, because the old rows keep that version number (see the report).
 * No timer: the status is computed when it is read.
 */
export function shadowProgress(db: Database.Database, name: string, version: number, now: Date): ShadowProgress {
  const total = db.prepare(
    `SELECT COUNT(DISTINCT COALESCE(run_id, id)) AS runs, MIN(created_at) AS firstAt
     FROM operator_skill_shadow_runs WHERE skill_name = ? AND shadow_version = ?`,
  ).get(name, version) as { runs: number; firstAt: string | null };
  if (!total.firstAt || total.runs === 0) return { runs: 0, firstAt: null, status: "dang_thu" };
  const windowEnd = new Date(Date.parse(total.firstAt) + SHADOW_WINDOW_MS).toISOString();
  const inWindow = db.prepare(
    `SELECT COUNT(DISTINCT COALESCE(run_id, id)) AS n FROM operator_skill_shadow_runs
     WHERE skill_name = ? AND shadow_version = ? AND created_at <= ?`,
  ).get(name, version, windowEnd) as { n: number };
  if (inWindow.n >= SHADOW_MIN_RUNS) return { runs: total.runs, firstAt: total.firstAt, status: "du_mau" };
  return {
    runs: total.runs,
    firstAt: total.firstAt,
    status: now.toISOString() < windowEnd ? "dang_thu" : "chua_du_mau",
  };
}

/**
 * TASK-074b-3a: records what a shadow skill version would have planned for a routing call.
 * It never executes anything: this module imports no tool executor, no runner and no tool registry.
 * The routing result is not changed. Returns the names of the skills that got a row (TASK-074b-4 uses them to check auto-activation).
 */
export function recordShadowRuns(input: {
  sqlite: Database.Database;
  query: string;
  routed: RoutedPart[];
  runId: string | null;
  now: Date;
}): string[] {
  // Gate: when shadowEnabled is false nothing below runs, so no row and no log.
  if (!getOperatorSettings(input.sqlite).shadowEnabled) return [];

  // One row per skill per call: the first position where the skill is returned, across all parts.
  const firstRank = new Map<string, number>();
  for (const part of input.routed) {
    part.hits.forEach((hit, index) => {
      if (!firstRank.has(hit.name)) firstRank.set(hit.name, index + 1);
    });
  }

  const written: string[] = [];
  for (const [name, rank] of firstRank) {
    const shadow = shadowVersionFor(input.sqlite, name);
    if (!shadow) continue;
    const parsed = parseSkillMarkdown(shadow.markdown);
    const planned = parsed?.tools ?? [];
    input.sqlite.prepare(
      `INSERT INTO operator_skill_shadow_runs
        (id, skill_name, shadow_version, active_version, run_id, query, rank, planned, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      name,
      shadow.version,
      shadow.activeVersion,
      input.runId,
      input.query,
      rank,
      JSON.stringify(planned),
      input.now.toISOString(),
    );
    written.push(name);
  }
  return written;
}
