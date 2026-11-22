import type Database from "better-sqlite3";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { PipelineStage } from "@vg/shared";
import * as schema from "../db/schema.js";

type Owner = PipelineStage | "project" | "control";
export type ProjectTableScope =
  | { column: string }
  | { column: string; via: SQLiteTable; parentKey: string; projectColumn: string };

export type ProjectTableContract = { table: SQLiteTable; owner: Owner; scope: ProjectTableScope };

function projectTable(table: SQLiteTable, owner: Owner): ProjectTableContract {
  return { table, owner, scope: { column: "project_id" } };
}

function childTable(table: SQLiteTable, owner: Owner, column: string, via: SQLiteTable): ProjectTableContract {
  return { table, owner, scope: { column, via, parentKey: "id", projectColumn: "project_id" } };
}

/** The stage that owns a durable output. Control rows stay out of content snapshots and input versions. */
export const PROJECT_TABLES: readonly ProjectTableContract[] = [
  { table: schema.projects, owner: "project", scope: { column: "id" } },
  projectTable(schema.researchNotes, "RESEARCH"),
  projectTable(schema.scripts, "SCRIPT"),
  projectTable(schema.scriptDrafts, "SCRIPT"),
  projectTable(schema.scenes, "SCENE_PLAN"),
  projectTable(schema.visualCandidates, "VISUAL_SEARCH"),
  projectTable(schema.visualSearchState, "VISUAL_SEARCH"),
  projectTable(schema.visualSearchCheckpoints, "VISUAL_SEARCH"),
  projectTable(schema.visualSelections, "VISUAL_REVIEW"),
  childTable(schema.visualCrops, "VISUAL_REVIEW", "scene_id", schema.scenes),
  projectTable(schema.voiceTracks, "VOICE"),
  projectTable(schema.subtitleTracks, "SUBTITLE"),
  projectTable(schema.musicCandidates, "MUSIC_SEARCH"),
  projectTable(schema.musicSelections, "MUSIC_REVIEW"),
  projectTable(schema.timelines, "TIMELINE"),
  projectTable(schema.timelineSnapshots, "TIMELINE"),
  projectTable(schema.renders, "RENDER"),
  projectTable(schema.videoLooks, "RENDER"),
  projectTable(schema.videoMetadata, "SCRIPT"),
  projectTable(schema.clipSets, "CLIP"),
  projectTable(schema.retrievalExclusions, "project"),

  projectTable(schema.profileTopics, "control"),
  projectTable(schema.publications, "control"),
  childTable(schema.publicationMetricsSnapshots, "control", "publication_id", schema.publications),
  childTable(schema.comments, "control", "publication_id", schema.publications),
  childTable(schema.revenueEntries, "control", "publication_id", schema.publications),
  childTable(schema.titleExperiments, "control", "publication_id", schema.publications),
  projectTable(schema.jobs, "control"),
  // TASK-148a: learning feedback is control-plane data, kept out of content snapshots and input versions.
  projectTable(schema.stageFeedback, "control"),
  projectTable(schema.stageQuality, "control"),
  childTable(schema.nodeLeaseSecrets, "control", "job_id", schema.jobs),
  childTable(schema.nodeUploads, "control", "job_id", schema.jobs),
  projectTable(schema.projectStages, "control"),
  projectTable(schema.projectRuns, "control"),
  childTable(schema.runCheckpoints, "control", "run_id", schema.projectRuns),
  childTable(schema.runUploads, "control", "run_id", schema.projectRuns),
  projectTable(schema.stageOverdueChecks, "control"),
  projectTable(schema.sourceManifests, "control"),
  projectTable(schema.guidelineFindings, "control"),
  projectTable(schema.autoReportEntries, "control"),
  projectTable(schema.reviewThreads, "control"),
  projectTable(schema.reviewMessages, "control"),
  projectTable(schema.reviewProposalApplications, "control"),
  projectTable(schema.costEntries, "control"),
  projectTable(schema.operatorEvents, "control"),
  projectTable(schema.qualityRepairs, "control"),
  projectTable(schema.retrievalChunks, "control"),
  projectTable(schema.retrievalUses, "control"),
  projectTable(schema.agentAssignments, "control"),
  // TASK-129a: mailbox rows are control-plane coordination, kept out of content snapshots and input versions.
  projectTable(schema.agentMessages, "control"),
];

const safeIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Shared library and profile rows can protect assets even when stored in a project directory. */
export const SHARED_FILE_TABLES: readonly SQLiteTable[] = (Object.values(schema) as unknown[])
  .filter((value): value is SQLiteTable => is(value, SQLiteTable))
  .filter((table) => !PROJECT_TABLES.some((entry) => getTableName(entry.table) === getTableName(table)))
  .filter((table) => !["artifacts", "blobs", "file_gc_marks", "file_gc_runs"].includes(getTableName(table)))
  .filter((table) => Object.values(getTableColumns(table)).some((column) => isProjectAssetPath(column.name) || column.dataType === "json"));

/** Legacy checkpoint columns predate Drizzle's JSON mode but still contain nested asset references. */
export function projectTableJsonColumns(table: SQLiteTable): Set<string> {
  const columns = new Set(Object.values(getTableColumns(table)).filter((column) => column.dataType === "json").map((column) => column.name));
  if (getTableName(table) === "visual_search_checkpoints") { columns.add("queries"); columns.add("candidates"); }
  return columns;
}

/** These two names describe the graphics strategy, not files. */
export function isProjectAssetPath(key: string): boolean {
  return !["renderPath", "graphicPath"].includes(key) && (key === "path" || /(?:_|[a-z])path$/i.test(key));
}

export function decodeProjectJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

/** Walk the same path fields and legacy JSON columns used by stage input versions. */
export function visitProjectFileReferences(
  table: SQLiteTable,
  row: Readonly<Record<string, unknown>>,
  visit: (kind: "path" | "sha256", value: string) => void,
): void {
  const json = projectTableJsonColumns(table);
  const walk = (value: unknown, key: string): void => {
    if (typeof value === "string") {
      if (isProjectAssetPath(key)) visit("path", value);
      if (/sha_?256$/i.test(key) && /^[a-f0-9]{64}$/.test(value)) visit("sha256", value);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
    } else if (value && typeof value === "object") {
      for (const [field, child] of Object.entries(value)) walk(child, field);
    }
  };
  for (const [key, value] of Object.entries(row)) {
    if (json.has(key) && typeof value === "string") {
      let parsed: unknown;
      try { parsed = JSON.parse(value); }
      catch {
        // A JSON-looking value that does not parse may hide a reference, so it cannot prove a file is unused.
        // Plain scalars (timestamps such as change.schedule.* stamps) are not serialized references: walk them as text.
        if (/^\s*[[{]/.test(value)) throw new Error(`Invalid file-reference JSON in ${getTableName(table)}.${key}`);
        walk(value, key);
        continue;
      }
      walk(parsed, key);
    } else walk(value, key);
  }
}

export function projectTableRows(db: Database.Database, entry: ProjectTableContract, projectId: string): Array<Record<string, unknown>> {
  const table = safeIdentifier(getTableName(entry.table));
  const column = safeIdentifier(entry.scope.column);
  if ("via" in entry.scope) {
    const parent = safeIdentifier(getTableName(entry.scope.via));
    const key = safeIdentifier(entry.scope.parentKey);
    const project = safeIdentifier(entry.scope.projectColumn);
    return db.prepare(`SELECT * FROM ${table} WHERE ${column} IN (SELECT ${key} FROM ${parent} WHERE ${project}=?)`)
      .all(projectId) as Array<Record<string, unknown>>;
  }
  return db.prepare(`SELECT * FROM ${table} WHERE ${column}=?`).all(projectId) as Array<Record<string, unknown>>;
}

export function unregisteredProjectTables(db: Database.Database, registry = PROJECT_TABLES): string[] {
  const registered = new Set(registry.map(({ table }) => getTableName(table)));
  const tables = db.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'
    UNION SELECT name FROM sqlite_temp_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>;
  return tables.filter(({ name }) => !registered.has(name) && db.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name IN ('project_id','scene_id')").get(name))
    .map(({ name }) => name);
}
