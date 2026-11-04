import { randomUUID } from "node:crypto";
import {
  AutoReportResponseSchema,
  STAGE_ORDER,
  type AutoReportCode,
  type AutoReportEntry,
  type AutoReportResponse,
  type AutoReportSeverity,
  type PipelineStage,
} from "@vg/shared";
import type Database from "better-sqlite3";

type EntryRow = {
  id: string;
  project_id: string;
  stage: string;
  scene_id: string | null;
  code: string;
  severity: "INFO" | "WARN";
  message: string;
  data: string | Record<string, unknown> | null;
  created_at: string;
};

export type AutoReportDraft = {
  stage: PipelineStage;
  sceneId?: string | null;
  code: AutoReportCode;
  severity: AutoReportSeverity;
  message: string;
  data?: Record<string, unknown> | null;
};

export class AutoReportService {
  constructor(private readonly sqlite: Database.Database) {}

  clearStage(projectId: string, stage: PipelineStage): void {
    this.sqlite.prepare("DELETE FROM auto_report_entries WHERE project_id = ? AND stage = ?")
      .run(projectId, stage);
  }

  add(projectId: string, draft: AutoReportDraft): AutoReportEntry {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.sqlite.prepare(
      `INSERT INTO auto_report_entries
        (id, project_id, stage, scene_id, code, severity, message, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      draft.stage,
      draft.sceneId ?? null,
      draft.code,
      draft.severity,
      draft.message,
      draft.data ? JSON.stringify(draft.data) : null,
      createdAt,
    );
    return {
      id,
      projectId,
      stage: draft.stage,
      sceneId: draft.sceneId ?? null,
      code: draft.code,
      severity: draft.severity,
      message: draft.message,
      data: draft.data ?? null,
      createdAt,
    };
  }

  list(projectId: string): AutoReportEntry[] {
    const rows = this.sqlite.prepare(
      "SELECT * FROM auto_report_entries WHERE project_id = ? ORDER BY created_at ASC",
    ).all(projectId) as EntryRow[];
    return rows.map(toEntry);
  }

  responseFor(projectId: string): AutoReportResponse {
    const entries = this.list(projectId);
    const byStage = new Map<PipelineStage, AutoReportEntry[]>();
    for (const entry of entries) {
      const list = byStage.get(entry.stage) ?? [];
      list.push(entry);
      byStage.set(entry.stage, list);
    }
    const groups = STAGE_ORDER
      .filter((stage) => byStage.has(stage))
      .map((stage) => ({ stage, entries: byStage.get(stage)! }));
    return AutoReportResponseSchema.parse({
      projectId,
      warnCount: entries.filter((entry) => entry.severity === "WARN").length,
      groups,
    });
  }

  warnCount(projectId: string): number {
    const row = this.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM auto_report_entries WHERE project_id = ? AND severity = 'WARN'",
    ).get(projectId) as { count: number };
    return row.count;
  }
}

function toEntry(row: EntryRow): AutoReportEntry {
  const data = row.data == null
    ? null
    : typeof row.data === "string"
      ? JSON.parse(row.data) as Record<string, unknown>
      : row.data;
  return {
    id: row.id,
    projectId: row.project_id,
    stage: row.stage as PipelineStage,
    sceneId: row.scene_id,
    code: row.code as AutoReportCode,
    severity: row.severity,
    message: row.message,
    data,
    createdAt: row.created_at,
  };
}
