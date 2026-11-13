import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { markMissingVoices, type Timeline } from "@vg/shared";
import type Database from "better-sqlite3";

export type SnapshotSource = "chat" | "assistant" | "mcp" | "manual";

export function rememberTimelineSnapshot(
  sqlite: Database.Database,
  projectId: string,
  timeline: Timeline,
  source: SnapshotSource,
  summary: string,
): void {
  sqlite.prepare(
    `INSERT INTO timeline_snapshots (id, project_id, revision, snapshot, source, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    projectId,
    timeline.revision ?? 0,
    JSON.stringify(timeline),
    source,
    summary.slice(0, 240),
    new Date().toISOString(),
  );
  const stale = sqlite.prepare(
    `SELECT id FROM timeline_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 30`,
  ).all(projectId) as Array<{ id: string }>;
  for (const row of stale) {
    sqlite.prepare("DELETE FROM timeline_snapshots WHERE id = ?").run(row.id);
  }
}

export function undoTimelineSnapshot(
  sqlite: Database.Database,
  projectId: string,
  fileExists: (path: string) => boolean = existsSync,
): { timeline: Timeline; summary: string } | null {
  const row = sqlite.prepare(
    `SELECT id, snapshot, summary FROM timeline_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).get(projectId) as { id: string; snapshot: string; summary: string } | undefined;
  if (!row) return null;
  const parsed = JSON.parse(row.snapshot) as Timeline;
  const timeline = markMissingVoices(parsed, fileExists);
  sqlite.prepare("DELETE FROM timeline_snapshots WHERE id = ?").run(row.id);
  return { timeline, summary: row.summary };
}
