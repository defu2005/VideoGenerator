import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { dependentStages, JobErrorSchema, localDateString, PipelineStageSchema, ProjectSettingsSchema, redactExportText, storyModeForProject, STAGE_DEPENDS, STAGE_ORDER, type ProjectRun } from "@vg/shared";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { PROJECT_TABLES, projectTableRows, projectTableJsonColumns, isProjectAssetPath } from "../pipeline/dataContract.js";
import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import { markStaleFrom } from "../pipeline/invalidation.js";
import type { NodeRow } from "./nodeService.js";
import type { ProjectRunService } from "./runService.js";
import { diffProjectSnapshot, exportProjectSnapshot, ProjectSnapshotCursorSchema, rewriteSnapshotRow, SnapshotRowSchema } from "./projectSnapshot.js";

export const RunCheckpointSchema = z.object({
  leaseId: z.string(), seq: z.number().int().positive(), stage: PipelineStageSchema,
  inputVersion: z.string().regex(/^[a-f0-9]{64}$/), tables: z.record(z.string(), z.array(SnapshotRowSchema)),
  costs: z.array(z.object({ kind: z.enum(["llm", "tts"]), amountUsd: z.number().finite().nonnegative(), provider: z.string().max(100) }).strict()).max(200),
  summary: z.string().max(500).default(""),
  snapshotCursor: ProjectSnapshotCursorSchema.optional(),
  state: z.enum(["DONE", "SKIPPED", "FAILED"]).default("DONE"),
  error: JobErrorSchema.optional(),
  // SCRIPT also persists its auto-selected format and treatment outside its owned tables.
  projectSettings: ProjectSettingsSchema.pick({ format: true, formatReason: true, treatment: true }).strict().optional(),
}).strict().refine((value) => (value.state === "FAILED") === Boolean(value.error), { message: "Failed checkpoint requires an error" });
export type RunCheckpoint = z.infer<typeof RunCheckpointSchema>;
type FileResolver = (run: ProjectRun, name: string) => string;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;

/** Control owns the transaction, sequence, scope and ledger. A node can replace only a stage's registered outputs. */
export class RunCheckpointService {
  constructor(private readonly db: Database.Database, private readonly runs: ProjectRunService,
    private readonly orchestrator: PipelineOrchestrator, private readonly dataDir: string,
    private readonly resolveFile: FileResolver, private readonly afterCommit: (run: ProjectRun, checkpoint: RunCheckpoint) => void,
    private readonly now: () => Date = () => new Date()) {}

  apply(node: Pick<NodeRow, "id">, runId: string, input: unknown): { ok: true; seq: number; duplicate: boolean } {
    const checkpoint = RunCheckpointSchema.parse(input);
    const { snapshotCursor, ...content } = checkpoint;
    const contentHash = createHash("sha256").update(JSON.stringify(canonical(content))).digest("hex");
    let appliedRun: ProjectRun | undefined;
    const result = this.orchestrator.repository.atomic(() => {
      const run = this.runs.holding(node, runId, checkpoint.leaseId);
      const previous = this.db.prepare("SELECT content_hash FROM run_checkpoints WHERE run_id=? AND seq=?").get(run.id, checkpoint.seq) as { content_hash: string } | undefined;
      if (previous) {
        if (previous.content_hash !== contentHash) throw new AppError(409, "RUN_SEQUENCE_CONFLICT", "Số checkpoint đã được dùng cho nội dung khác.");
        return { ok: true as const, seq: checkpoint.seq, duplicate: true };
      }
      if (checkpoint.seq !== run.lastSeq + 1) throw new AppError(409, "RUN_SEQUENCE_GAP", "Checkpoint phải đến đúng thứ tự.", { nextSeq: run.lastSeq + 1 });
      const index = STAGE_ORDER.indexOf(checkpoint.stage);
      if (index < STAGE_ORDER.indexOf(run.fromStage) || run.stopBefore.some((held) => held === checkpoint.stage || dependentStages(held).includes(checkpoint.stage))) {
        throw new AppError(409, "RUN_STAGE_OUTSIDE_SEGMENT", "Bước không thuộc đoạn đã giao.");
      }
      if (checkpoint.projectSettings && (checkpoint.stage !== "SCRIPT" || checkpoint.state !== "DONE")) throw new AppError(400, "RUN_PROJECT_PATCH_INVALID", "Chỉ bước kịch bản hoàn tất được trả mẫu và treatment đã sinh.");
      const project = this.orchestrator.repository.getProject(run.projectId)!;
      if (checkpoint.state === "SKIPPED" && (checkpoint.stage !== "RESEARCH" || storyModeForProject(project) !== "off")) {
        throw new AppError(400, "RUN_SKIP_INVALID", "Bước này không được bỏ qua.");
      }
      const entries = checkpoint.state === "DONE" ? PROJECT_TABLES.filter(({ owner }) => owner === checkpoint.stage) : [];
      const allowed = new Set(entries.map(({ table }) => getTableName(table)));
      if (Object.keys(checkpoint.tables).length !== allowed.size || Object.keys(checkpoint.tables).some((name) => !allowed.has(name))) throw new AppError(400, "RUN_TABLE_INVALID", "Checkpoint phải chứa đúng các bảng của bước.");
      if (this.orchestrator.inputVersions.inputVersion(run.projectId, checkpoint.stage) !== checkpoint.inputVersion) {
        const snapshot = exportProjectSnapshot(this.db, this.dataDir, run.projectId);
        const details = snapshotCursor ? { delta: diffProjectSnapshot(snapshot, snapshotCursor) } : { snapshot };
        throw new AppError(409, "RUN_REBASE", "Đầu vào đã thay đổi trên máy chính. Node cần cập nhật snapshot.", details);
      }
      const unmet = STAGE_DEPENDS[checkpoint.stage].find((stage) => !["DONE", "SKIPPED"].includes(this.orchestrator.repository.getStage(run.projectId, stage).state));
      if (unmet) throw new AppError(409, "RUN_DEPENDENCY_PENDING", "Đầu ra của bước trước chưa được nhận trên máy chính.", { stage: unmet });
      this.db.pragma("defer_foreign_keys = ON");
      // Keep matching primary keys in place so foreign key cascades cannot remove
      // downstream rows merely because an unchanged parent was sent again.
      const existingKeys = new Map<string, Set<string>>();
      const primaryKey = (entry: (typeof entries)[number]) => [
        ...Object.values(getTableColumns(entry.table)).filter((column) => column.primary).map((column) => column.name),
        ...getTableConfig(entry.table).primaryKeys.flatMap((key) => key.columns.map((column) => column.name)),
      ];
      const keyOf = (keys: string[], row: Record<string, unknown>) => JSON.stringify(keys.map((key) => row[key]));
      for (const entry of [...entries].reverse()) {
        const name = getTableName(entry.table), keys = primaryKey(entry);
        if (!keys.length) throw new Error(`Missing project checkpoint primary key: ${name}`);
        const incoming = new Set(checkpoint.tables[name]!.map((row) => keyOf(keys, row)));
        if (incoming.size !== checkpoint.tables[name]!.length) throw new AppError(400, "RUN_ROWS_DUPLICATE", "Checkpoint có khóa dữ liệu trùng.");
        const retained = new Set<string>();
        for (const row of projectTableRows(this.db, entry, run.projectId)) {
          const key = keyOf(keys, row);
          if (incoming.has(key)) { retained.add(key); continue; }
          if (name === "renders" && this.db.prepare("SELECT 1 FROM publications WHERE render_id=?").get(row.id)) {
            throw new AppError(409, "RUN_RENDER_IN_USE", "Checkpoint không được xóa bản dựng đang gắn với bản xuất bản.");
          }
          this.db.prepare(`DELETE FROM ${quote(name)} WHERE ${keys.map((key) => `${quote(key)}=?`).join(" AND ")}`).run(...keys.map((key) => row[key]));
        }
        existingKeys.set(name, retained);
      }
      let rowCount = 0;
      for (const entry of entries) {
        const name = getTableName(entry.table), columns = Object.values(getTableColumns(entry.table));
        const names = new Set(columns.map((column) => column.name));
        const json = projectTableJsonColumns(entry.table);
        for (const raw of checkpoint.tables[name]!) {
          const row = rewriteSnapshotRow(raw, json, (value, key) => {
            if (!value || !isProjectAssetPath(key)) return value;
            if (!/^files\/[a-f0-9]{64}(?:\.[a-z0-9]{1,7})?$/.test(value)) throw new AppError(400, "RUN_FILE_INVALID", "Checkpoint chỉ nhận tệp theo mã nội dung.");
            return this.resolveFile(run, value);
          });
          const keys = Object.keys(row);
          if (!keys.length || keys.some((key) => !names.has(key))) throw new AppError(400, "RUN_COLUMN_INVALID", "Checkpoint có cột không được phép.");
          if (!("via" in entry.scope) && row[entry.scope.column] !== run.projectId) throw new AppError(400, "RUN_PROJECT_INVALID", "Dòng dữ liệu thuộc dự án khác.");
          for (const [key, parent] of [["scene_id", "scenes"], ["candidate_id", "visual_candidates"], ["render_id", "renders"]] as const) {
            if (typeof row[key] === "string" && !this.db.prepare(`SELECT 1 FROM ${parent} WHERE id=? AND project_id=?`).get(row[key], run.projectId)) {
              throw new AppError(400, "RUN_PROJECT_INVALID", "Tham chiếu đầu ra không thuộc dự án.");
            }
          }
          if ("workspace_id" in row && row.workspace_id !== run.workspaceId) throw new AppError(400, "RUN_WORKSPACE_INVALID", "Dòng dữ liệu thuộc workspace khác.");
          if ("profile_id" in row && row.profile_id !== this.orchestrator.repository.getProject(run.projectId)!.profileId) throw new AppError(400, "RUN_PROFILE_INVALID", "Dòng dữ liệu thuộc hồ sơ khác.");
          const primary = primaryKey(entry);
          if (primary.some((key) => row[key] == null)) throw new AppError(400, "RUN_COLUMN_INVALID", "Checkpoint thiếu khóa dữ liệu.");
          if (existingKeys.get(name)!.has(keyOf(primary, row))) {
            const fields = keys.filter((key) => !primary.includes(key));
            if (fields.length) this.db.prepare(`UPDATE ${quote(name)} SET ${fields.map((key) => `${quote(key)}=?`).join(",")} WHERE ${primary.map((key) => `${quote(key)}=?`).join(" AND ")}`)
              .run(...[...fields, ...primary].map((key) => row[key]!));
          } else {
            this.db.prepare(`INSERT INTO ${quote(name)} (${keys.map(quote).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((key) => row[key]!));
          }
          rowCount++;
        }
        if (projectTableRows(this.db, entry, run.projectId).length !== checkpoint.tables[name]!.length) throw new AppError(400, "RUN_PROJECT_INVALID", "Dòng con thuộc dự án khác.");
      }
      const at = this.now().toISOString();
      if (checkpoint.projectSettings) {
        if (project.settings.userSet?.includes("format") && checkpoint.projectSettings.format !== undefined && checkpoint.projectSettings.format !== project.settings.format) {
          throw new AppError(409, "RUN_PROJECT_PATCH_INVALID", "Node không được thay mẫu do người dùng đã chọn.");
        }
        this.orchestrator.repository.updateProject(run.projectId, { settings: ProjectSettingsSchema.parse({ ...project.settings, ...checkpoint.projectSettings }) });
      }
      checkpoint.costs.forEach((cost, index) => this.db.prepare(`INSERT INTO cost_entries(id,workspace_id,profile_id,project_id,kind,date,amount,currency,source,note,created_at) VALUES (?,?,?,?,?,?,?,'USD',?,?,?)`)
        .run(`run:${run.id}:${checkpoint.seq}:${index}`, run.workspaceId, project.profileId, run.projectId, cost.kind, localDateString(new Date(at), "Asia/Ho_Chi_Minh"), cost.amountUsd, `run:${run.id}`, cost.provider, at));
      this.orchestrator.repository.ensureStages(run.projectId);
      markStaleFrom(this.orchestrator.repository, run.projectId, checkpoint.stage);
      const error = checkpoint.error ? { ...checkpoint.error, message: redactExportText(checkpoint.error.message).slice(0, 500) } : null;
      this.orchestrator.repository.updateStage(run.projectId, checkpoint.stage, {
        state: checkpoint.state, progress: error ? 0 : 100, inputVersion: checkpoint.inputVersion, jobId: null, error,
        message: error?.message ?? (checkpoint.state === "SKIPPED" ? "Bỏ qua trên node" : "Hoàn tất trên node"),
      });
      if (error) this.orchestrator.repository.updateProject(run.projectId, { stage: checkpoint.stage, status: "FAILED", runMode: null });
      this.db.prepare("INSERT INTO run_checkpoints(run_id,seq,stage,input_version,applied_at,rows,bytes,result,content_hash) VALUES (?,?,?,?,?,?,?,'applied',?)")
        .run(run.id, checkpoint.seq, checkpoint.stage, checkpoint.inputVersion, at, rowCount, Buffer.byteLength(JSON.stringify(checkpoint)), contentHash);
      this.db.prepare("UPDATE project_runs SET last_seq=?,status='RUNNING' WHERE id=?").run(checkpoint.seq, run.id);
      appliedRun = run;
      return { ok: true as const, seq: checkpoint.seq, duplicate: false };
    }, "immediate");
    if (appliedRun) this.afterCommit(appliedRun, checkpoint);
    return result;
  }
}
