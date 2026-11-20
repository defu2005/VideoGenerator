import type Database from "better-sqlite3";

/**
 * TASK-074c-5a: the operator halves its daily improvement-request limit when fewer than 30% of its last 20 decided requests were accepted.
 * Derived on every call. Nothing is stored and no setting is written, so the user's own limit is never changed.
 * "Decided" means any status except open, but rows copied from the old table (TASK-074c-5d) are not counted: see the query below.
 * "Accepted" means any decided status except rejected.
 * Rows carry no decision time, so the window is ordered by created_at.
 */
export const SELF_TUNE_WINDOW = 20;

export type SelfTuneStats = { window: number; decided: number; accepted: number; rate: number | null; halved: boolean };

export function improvementSelfTuneStats(db: Database.Database): SelfTuneStats {
  // TASK-074c-5d: a row copied from the old table is rejected with no acceptance signal behind it. It is recognised by its
  // legacy evidence ref (raw JSON, so a native note cannot forge it: quotes inside a note are escaped) and by updated_at
  // still equal to created_at (a native dismissal moves updated_at). Excluded rows take no window slot.
  const rows = db.prepare(`SELECT status FROM improvement_requests
      WHERE status != 'open'
        AND NOT (status = 'rejected' AND updated_at = created_at AND instr(evidence, '"ref":"operator_tool_proposals:') > 0)
      ORDER BY created_at DESC, id LIMIT ?`)
    .all(SELF_TUNE_WINDOW) as Array<{ status: string }>;
  const decided = rows.length;
  const accepted = rows.filter((row) => row.status !== "rejected").length;
  const ready = decided >= SELF_TUNE_WINDOW;
  return {
    window: SELF_TUNE_WINDOW,
    decided,
    accepted,
    rate: ready ? accepted / SELF_TUNE_WINDOW : null,
    // Integer form of accepted / window < 30%, which avoids floating-point rounding at the boundary.
    halved: ready && accepted * 10 < 3 * SELF_TUNE_WINDOW,
  };
}

/** The limit to enforce. Halved with a floor of 1 for a non-zero limit; zero stays zero. Never above the user's limit. */
export function effectiveImprovementRequestLimit(userLimit: number, stats: SelfTuneStats): number {
  if (!stats.halved) return userLimit;
  return userLimit === 0 ? 0 : Math.max(1, Math.floor(userLimit / 2));
}
