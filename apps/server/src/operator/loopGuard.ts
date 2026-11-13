import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { operatorActionKey } from "./checkpoints.js";

const WINDOW_MS = 6 * 60 * 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function claimOperatorAction(
  db: Database.Database, runId: string, tool: string, args: unknown, now = new Date(),
): { attemptId: number | bigint } | { message: string } {
  const actionKey = operatorActionKey(tool, args);
  const timestamp = now.toISOString();
  const cutoff = new Date(now.getTime() - WINDOW_MS).toISOString();
  return db.transaction(() => {
    db.prepare("DELETE FROM operator_action_attempts WHERE attempted_at < ?")
      .run(new Date(now.getTime() - RETENTION_MS).toISOString());
    const { count: thisRun } = db.prepare(
      "SELECT COUNT(*) AS count FROM operator_action_attempts WHERE action_key = ? AND run_id = ?",
    ).get(actionKey, runId) as { count: number };
    const { count: failedRuns } = db.prepare(
      "SELECT COUNT(DISTINCT run_id) AS count FROM operator_action_attempts WHERE action_key = ? AND failed_at >= ? AND failed_at <= ?",
    ).get(actionKey, cutoff, timestamp) as { count: number };
    if (thisRun >= 2 || failedRuns >= 3) {
      const reason = thisRun >= 2 ? "same_run" : "failed_runs";
      db.prepare(`INSERT INTO supervisor_findings
        (id, kind, severity, dedupe_key, detail, first_seen_at, last_seen_at, status)
        VALUES (?, 'loop_guard', 'warn', ?, ?, ?, ?, 'open')
        ON CONFLICT(dedupe_key) DO UPDATE SET detail = excluded.detail, last_seen_at = excluded.last_seen_at,
          status = 'open', resolution = NULL`).run(
        randomUUID(), `loop_guard:${reason}:${actionKey}`,
        JSON.stringify({ tool, runId, reason, failedRuns }), timestamp, timestamp,
      );
      return { message: thisRun >= 2 ? "Đã dừng thao tác lặp lần thứ ba trong lượt này."
        : "Đã dừng thao tác đã lỗi trong ba lượt trong sáu giờ qua." };
    }
    const attempt = db.prepare("INSERT INTO operator_action_attempts (action_key, run_id, attempted_at) VALUES (?, ?, ?)")
      .run(actionKey, runId, timestamp);
    return { attemptId: attempt.lastInsertRowid };
  }).immediate();
}

export function recordOperatorActionFailure(db: Database.Database, attemptId: number | bigint, now = new Date()): void {
  db.prepare("UPDATE operator_action_attempts SET failed_at = ? WHERE id = ? AND failed_at IS NULL")
    .run(now.toISOString(), attemptId);
}
