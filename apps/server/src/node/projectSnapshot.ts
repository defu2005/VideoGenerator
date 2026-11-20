import { readFileSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type Database from "better-sqlite3";
import { getTableColumns, getTableName } from "drizzle-orm";
import { z } from "zod";
import { PipelineStageSchema, ProjectSettingsSchema, StageStateSchema, STAGE_ORDER, PROTECTED_PROJECT_ID, type PipelineStage } from "@vg/shared";
import { PROJECT_TABLES, projectTableRows, projectTableJsonColumns, isProjectAssetPath } from "../pipeline/dataContract.js";
import { projectDir, resolveAssetPath } from "../storage/paths.js";
import { AppError } from "../lib/errors.js";
import { ArtifactService } from "./artifactService.js";
import { exportProjectContext, importProjectContext, ProjectContextSchema } from "./projectContext.js";
import type { StageInputVersions } from "../pipeline/inputVersion.js";

const scalar = z.union([z.string(), z.number().finite(), z.null()]);
export const SnapshotRowSchema = z.record(z.string(), scalar);
const rowSchema = SnapshotRowSchema;
export const ProjectSnapshotSchema = z.object({
  snapshotVersion: z.literal(1), schemaHash: z.string().min(1), projectId: z.string().uuid(),
  tables: z.record(z.string(), z.array(rowSchema)),
  context: ProjectContextSchema,
  stages: z.array(z.object({ stage: PipelineStageSchema, state: StageStateSchema, inputVersion: z.string().nullable(), updatedAt: z.string() }).strict()),
  files: z.array(z.object({ name: z.string().regex(/^files\/[a-f0-9]{64}(?:\.[a-z0-9]{1,7})?$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative() }).strict()),
}).strict();
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const ProjectSnapshotCursorSchema = z.object({
  snapshotVersion: z.literal(1), schemaHash: z.string().min(1), projectId: z.string().uuid(),
  tables: z.record(z.string(), digest), context: digest, stages: digest, files: digest,
}).strict();
export type ProjectSnapshotCursor = z.infer<typeof ProjectSnapshotCursorSchema>;
export type ProjectSnapshotDelta = Pick<ProjectSnapshot, "snapshotVersion" | "schemaHash" | "projectId" | "tables">
  & Partial<Pick<ProjectSnapshot, "context" | "stages" | "files">>;

/** Hash the canonical wire representation. The caller keeps the imported wire snapshot for rebase. */
export function projectSnapshotCursor(snapshot: ProjectSnapshot): ProjectSnapshotCursor {
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return { snapshotVersion: snapshot.snapshotVersion, schemaHash: snapshot.schemaHash, projectId: snapshot.projectId,
    tables: Object.fromEntries(Object.entries(snapshot.tables).map(([name, rows]) => [name, hash(rows)])),
    context: hash(snapshot.context), stages: hash(snapshot.stages), files: hash(snapshot.files) };
}

export function diffProjectSnapshot(snapshot: ProjectSnapshot, base: ProjectSnapshotCursor): ProjectSnapshotDelta {
  const { snapshotVersion, schemaHash, projectId } = snapshot;
  if (base.projectId !== projectId || base.schemaHash !== schemaHash || base.snapshotVersion !== snapshotVersion) {
    throw new AppError(409, "RUN_SNAPSHOT_BASE_INVALID", "Snapshot nền không thuộc lần chạy này hoặc cần cập nhật node.");
  }
  const current = projectSnapshotCursor(snapshot);
  return { snapshotVersion, schemaHash, projectId,
    tables: Object.fromEntries(Object.entries(snapshot.tables).filter(([name]) => current.tables[name] !== base.tables[name])),
    ...(current.context !== base.context ? { context: snapshot.context } : {}),
    ...(current.stages !== base.stages ? { stages: snapshot.stages } : {}),
    ...(current.files !== base.files ? { files: snapshot.files } : {}),
  };
}

export function applyProjectSnapshotDelta(snapshot: ProjectSnapshot, delta: ProjectSnapshotDelta): ProjectSnapshot {
  if (snapshot.projectId !== delta.projectId || snapshot.schemaHash !== delta.schemaHash || snapshot.snapshotVersion !== delta.snapshotVersion) {
    throw new AppError(409, "RUN_SNAPSHOT_BASE_INVALID", "Delta không khớp snapshot nền.");
  }
  return ProjectSnapshotSchema.parse({ ...snapshot, ...delta, tables: { ...snapshot.tables, ...delta.tables } });
}
type Row = z.infer<typeof rowSchema>;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const contracts = PROJECT_TABLES.filter(({ owner }) => owner !== "control");
const isPath = isProjectAssetPath;
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel !== ".." && !rel.startsWith(`..\\`) && !rel.startsWith("../") && !isAbsolute(rel); };

/** The exact journal tag is shared by control and the disposable runner DB. */
export function projectSchemaHash(): string {
  const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: Array<{ tag: string }> };
  return journal.entries.at(-1)!.tag;
}

export function projectRunBaseVersion(versions: Pick<StageInputVersions, "inputVersion">, projectId: string): string {
  const stageVersions = STAGE_ORDER.map((stage) => [stage, versions.inputVersion(projectId, stage)]);
  return createHash("sha256").update(JSON.stringify(stageVersions)).digest("hex");
}

function walk(value: unknown, visit: (value: string, key: string) => string, key = ""): unknown {
  if (typeof value === "string") return visit(value, key);
  if (Array.isArray(value)) return value.map((item) => walk(item, visit, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([field, item]) => [field, walk(item, visit, field)]));
  return value;
}

export function rewriteSnapshotRow(row: Row, jsonColumns: Set<string>, visit: (value: string, key: string) => string): Row {
  return Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key,
    jsonColumns.has(key) && typeof value === "string" ? JSON.stringify(walk(JSON.parse(value), visit)) : walk(value, visit, key),
  ])) as Row;
}

/** Registry driven: jobs, tokens, publications and other control tables cannot enter this payload. */
export function exportProjectRows(db: Database.Database, dataDir: string, projectId: string, owner?: PipelineStage) {
  if (projectId === PROTECTED_PROJECT_ID) throw new AppError(403, "PROJECT_PROTECTED", "Không xuất dự án được bảo vệ cho node.");
  if (!db.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId)) throw new AppError(404, "PROJECT_NOT_FOUND", "Không thấy dự án.");
  const artifacts = new ArtifactService(db);
  const files = new Map<string, ProjectSnapshot["files"][number] & { path: string }>();
  const roots = [projectDir(dataDir, projectId), resolve(dataDir, "footage")];
  const rewrite = (value: string, key: string): string => {
    if (!isPath(key) || !value) return value;
    const normalized = value.replaceAll("\\", "/");
    let location: string;
    try {
      if (isAbsolute(value) && roots.some((root) => inside(root, resolve(value)))) location = resolve(value);
      else if (normalized.startsWith("footage/") || normalized.startsWith(`projects/${projectId}/`)) location = resolve(dataDir, normalized);
      else location = resolveAssetPath(dataDir, projectId, value);
    } catch {
      throw new AppError(409, "SNAPSHOT_FILE_SCOPE", "Tệp đầu vào nằm ngoài phạm vi dự án.");
    }
    let real: string;
    try { real = realpathSync.native(location); } catch { throw new AppError(409, "SNAPSHOT_FILE_MISSING", "Tệp đầu vào của dự án không còn tồn tại."); }
    const allowed = roots.some((root) => {
      if (!inside(root, location)) return false;
      try { return inside(realpathSync.native(root), real); } catch { return false; }
    });
    if (!allowed || !statSync(real).isFile()) throw new AppError(409, "SNAPSHOT_FILE_SCOPE", "Tệp đầu vào nằm ngoài phạm vi dự án.");
    const { sha256, size } = artifacts.registerSync(real);
    const ext = extname(real).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 8);
    const name = `files/${sha256}${ext}`;
    files.set(name, { name, sha256, size, path: real });
    return name;
  };
  const tables: ProjectSnapshot["tables"] = {};
  for (const entry of contracts) {
    if (owner && entry.owner !== owner) continue;
    const name = getTableName(entry.table);
    const json = projectTableJsonColumns(entry.table);
    tables[name] = projectTableRows(db, entry, projectId).map((raw) => {
      const row = { ...raw } as Row;
      // A pin is a control identity, absent in a runner's isolated database.
      if (name === "projects") {
        row.execution_node = null;
        row.settings = JSON.stringify(ProjectSettingsSchema.parse(JSON.parse(String(row.settings))));
      }
      return rewriteSnapshotRow(row, json, rewrite);
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return { tables, files: [...files.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

export function exportProjectSnapshot(db: Database.Database, dataDir: string, projectId: string): ProjectSnapshot {
  const { tables, files } = exportProjectRows(db, dataDir, projectId);
  const progress = db.prepare("SELECT stage,state,input_version AS inputVersion,updated_at AS updatedAt FROM project_stages WHERE project_id=?").all(projectId) as ProjectSnapshot["stages"];
  const stages = STAGE_ORDER.map((stage) => {
    const stored = progress.find((row) => row.stage === stage);
    return stored ? { ...stored, state: ["RUNNING", "QUEUED"].includes(stored.state) ? "STALE" : stored.state }
      : { stage, state: "PENDING", inputVersion: null, updatedAt: tables.projects![0]!.created_at };
  });
  return ProjectSnapshotSchema.parse({ snapshotVersion: 1, schemaHash: projectSchemaHash(), projectId, tables, stages, context: exportProjectContext(db, projectId), files: files.map(({ path: _path, ...file }) => file) });
}

/** Only imports into a migrated, disposable DB. File resolution is supplied by the verified artifact cache. */
export function importProjectSnapshot(db: Database.Database, input: unknown, resolveFile: (file: ProjectSnapshot["files"][number]) => string): ProjectSnapshot {
  const snapshot = ProjectSnapshotSchema.parse(input);
  if (snapshot.schemaHash !== projectSchemaHash()) throw new AppError(409, "NODE_SCHEMA_MISMATCH", "Phiên bản dữ liệu không khớp. Hãy cập nhật node.");
  if (snapshot.projectId === PROTECTED_PROJECT_ID) throw new AppError(403, "PROJECT_PROTECTED", "Không nhập dự án được bảo vệ trên node.");
  const allowed = new Set(contracts.map(({ table }) => getTableName(table)));
  if (Object.keys(snapshot.tables).some((name) => !allowed.has(name)) || Object.keys(snapshot.tables).length !== allowed.size) {
    throw new AppError(400, "SNAPSHOT_TABLE_INVALID", "Snapshot có bảng không được phép hoặc thiếu bảng.");
  }
  if ((db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n !== 0) throw new AppError(409, "SNAPSHOT_DATABASE_NOT_EMPTY", "Snapshot cần cơ sở dữ liệu dự án trống.");
  const files = new Map(snapshot.files.map((file) => [file.name, file]));
  const paths = new Map<string, string>();
  const artifacts = new ArtifactService(db);
  for (const file of snapshot.files) {
    if (!file.name.startsWith(`files/${file.sha256}`)) throw new AppError(400, "SNAPSHOT_FILE_INVALID", "Tên tệp không khớp mã nội dung.");
    const path = resolveFile(file), actual = artifacts.registerSync(path);
    if (actual.sha256 !== file.sha256 || actual.size !== file.size) throw new AppError(409, "SNAPSHOT_FILE_CHANGED", "Nội dung tệp không khớp snapshot.");
    paths.set(file.name, path);
  }
  db.transaction(() => {
    db.pragma("defer_foreign_keys = ON");
    importProjectContext(db, snapshot.context, snapshot.tables.projects?.[0] ?? {});
    for (const entry of contracts) {
      const name = getTableName(entry.table), columns = Object.values(getTableColumns(entry.table));
      const names = new Set(columns.map((column) => column.name));
      const json = projectTableJsonColumns(entry.table);
      for (const original of snapshot.tables[name]!) {
        const row = rewriteSnapshotRow(original, json, (value, key) => {
          if (!isPath(key) || !value) return value;
          if (!files.has(value)) throw new AppError(400, "SNAPSHOT_FILE_INVALID", "Tham chiếu tệp không có trong manifest.");
          return paths.get(value)!;
        });
        const keys = Object.keys(row);
        if (keys.some((key) => !names.has(key))) throw new AppError(400, "SNAPSHOT_COLUMN_INVALID", "Snapshot có cột không được phép.");
        if (!("via" in entry.scope) && row[entry.scope.column] !== snapshot.projectId) throw new AppError(400, "SNAPSHOT_PROJECT_INVALID", "Dòng dữ liệu không thuộc dự án.");
        db.prepare(`INSERT INTO ${quote(name)} (${keys.map(quote).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((key) => row[key]!));
      }
    }
    for (const entry of contracts) {
      if (projectTableRows(db, entry, snapshot.projectId).length !== snapshot.tables[getTableName(entry.table)]!.length) throw new AppError(400, "SNAPSHOT_PROJECT_INVALID", "Dòng con không thuộc dự án.");
    }
    if (snapshot.stages.length !== STAGE_ORDER.length || new Set(snapshot.stages.map(({ stage }) => stage)).size !== STAGE_ORDER.length) {
      throw new AppError(400, "SNAPSHOT_STAGE_INVALID", "Snapshot thiếu hoặc lặp trạng thái bước.");
    }
    const insertStage = db.prepare("INSERT INTO project_stages(project_id,stage,state,progress,input_version,updated_at) VALUES (?,?,?,?,?,?)");
    for (const row of snapshot.stages) insertStage.run(snapshot.projectId, row.stage, row.state, row.state === "DONE" ? 100 : 0, row.inputVersion, row.updatedAt);
  }).immediate();
  return snapshot;
}
