import type Database from "better-sqlite3";
import { CHECKPOINTS, type MeasureFn } from "./checkpoints.js";
import { formatCheckpointReport, formatNoNumbersReport } from "./report.js";

// TASK-129c slice 2b: the checkpoint measure. Reads only local analytics (publication_metrics_snapshots).
//
// Per publication, the snapshot used for a checkpoint is the FIRST one taken at or after that checkpoint's due time,
// so a catch-up tick after downtime never reports the 7-day numbers under the 2-hour label.
//
// Coverage rule: analytics stops for some platforms or accounts (missing scopes, needs_reconnect), so one publication
// with no numbers must not stall the mission forever. Until GRACE_MS after the due time, the checkpoint waits (null).
// After that, it reports the publications that have numbers and states "k/m video có số liệu".
// Never fetches from a platform and never guesses a number.

export const MEASURE_GRACE_MS = 48 * 3_600_000;

export function localMeasure(sqlite: Database.Database, now: () => Date = () => new Date()): MeasureFn {
  const firstAfter = sqlite.prepare(
    `SELECT p.id AS id,
       (SELECT s.views FROM publication_metrics_snapshots s
          WHERE s.publication_id = p.id AND s.fetched_at >= ? AND s.views IS NOT NULL
          ORDER BY s.fetched_at ASC LIMIT 1) AS views
     FROM publications p
     WHERE p.mission_id = ? AND p.status = 'PUBLISHED'`,
  );
  return async (mission, kind, publishedAt) => {
    const checkpoint = CHECKPOINTS.find((c) => c.kind === kind);
    if (!checkpoint) return null;
    const dueMs = Date.parse(publishedAt) + checkpoint.ms;
    const rows = firstAfter.all(new Date(dueMs).toISOString(), mission.id) as Array<{ id: string; views: number | null }>;
    if (rows.length === 0) return null;
    const measured = rows.filter((row) => row.views != null);
    const complete = measured.length === rows.length;
    if (!complete && now().getTime() < dueMs + MEASURE_GRACE_MS) return null;
    if (measured.length === 0) {
      return {
        report: formatNoNumbersReport(kind, rows.length),
        metrics: { publications: rows.length, coverage: `0/${rows.length}` },
      };
    }
    const views = measured.reduce((sum, row) => sum + (row.views ?? 0), 0);
    const base = formatCheckpointReport(kind, { views }, null);
    const report = complete ? base : `${base}\nChỉ ${measured.length}/${rows.length} video có số liệu; phần còn lại chưa có số liệu từ nền tảng.`;
    return {
      report,
      metrics: { views, publications: rows.length, coverage: `${measured.length}/${rows.length}` },
    };
  };
}
