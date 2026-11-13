import type Database from "better-sqlite3";

/** Digest lines for projects the quality repair loop shelved on a day (TASK-121). Read-only. */
export function shelvedDigestLines(sqlite: Database.Database, day: string): string[] {
  const rows = sqlite.prepare("SELECT detail FROM supervisor_findings WHERE kind = 'quality_shelved' AND last_seen_at LIKE ? ORDER BY first_seen_at")
    .all(`${day}%`) as Array<{ detail: string }>;
  return rows.flatMap((row) => {
    try {
      const line = (JSON.parse(row.detail) as { line?: string }).line;
      return line ? [line] : [];
    } catch {
      return [];
    }
  });
}
