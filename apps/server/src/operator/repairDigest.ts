import type Database from "better-sqlite3";
import { localDateString } from "@vg/shared";

/** Digest lines for projects the quality repair loop shelved on a day (TASK-121, TASK-131). Read-only. */
export function shelvedDigestLines(sqlite: Database.Database, day: string, timeZone = "Asia/Ho_Chi_Minh"): string[] {
  const rows = sqlite.prepare("SELECT detail, last_seen_at FROM supervisor_findings WHERE kind = 'quality_shelved' ORDER BY first_seen_at")
    .all() as Array<{ detail: string; last_seen_at?: string | null }>;
  return rows.filter((row) => {
    if (!row.last_seen_at) return false;
    return row.last_seen_at.startsWith(day) || localDateString(new Date(row.last_seen_at), timeZone) === day;
  }).flatMap((row) => {
    try {
      const line = (JSON.parse(row.detail) as { line?: string }).line;
      return line ? [line] : [];
    } catch {
      return [];
    }
  });
}
