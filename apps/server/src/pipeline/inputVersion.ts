import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type Database from "better-sqlite3";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { ProjectSettingsSchema, STAGE_DEPENDS, type PipelineStage } from "@vg/shared";
import { ArtifactService } from "../node/artifactService.js";
import { projectDir, resolveAssetPath } from "../storage/paths.js";
import { PROJECT_TABLES, projectTableRows, projectTableJsonColumns, isProjectAssetPath, decodeProjectJson } from "./dataContract.js";

const projectColumns = new Set(["id", "topic", "title", "description", "profile_id", "mode", "kind", "parent_project_id", "settings"]);
const timestamps = new Set(["createdat", "updatedat", "checkedat", "downloadedat", "reviewedat", "discardedat"]);
// scriptOutlineApproval is runtime: flipping the review setting must not stale a finished SCRIPT (TASK-146 slice 6).
export const runtimeSettings = new Set(["stageTimeouts", "onOverdue", "agentWaitMinutes", "stageExecution", "knowledgeRev", "formatReason", "userSet", "scriptOutlineApproval"]);
const tables = PROJECT_TABLES.filter(({ owner }) => owner !== "control").map((entry) => {
  const columns = Object.values(getTableColumns(entry.table));
  const key = [...columns.filter((column) => column.primary).map((column) => column.name),
    ...getTableConfig(entry.table).primaryKeys.flatMap((pk) => pk.columns.map((column) => column.name))];
  return { entry, name: getTableName(entry.table), key, json: projectTableJsonColumns(entry.table) };
}).sort((a, b) => a.name.localeCompare(b.name));

function upstreamOf(stage: PipelineStage): Set<PipelineStage> {
  const result = new Set<PipelineStage>();
  const pending = [...STAGE_DEPENDS[stage]];
  while (pending.length) {
    const current = pending.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    pending.push(...STAGE_DEPENDS[current]);
  }
  return result;
}

function compare(a: string, b: string) { return a === b ? 0 : a < b ? -1 : 1; }

function inside(root: string, path: string) {
  const subpath = relative(root, path);
  return !isAbsolute(subpath) && subpath !== ".." && !subpath.startsWith("../") && !subpath.startsWith("..\\");
}

export class StageInputVersions {
  private readonly artifacts: ArtifactService;
  private readonly fileVersions = new Map<string, { stamp: string; sha256: string }>();

  constructor(private readonly db: Database.Database, private readonly dataDir: string) {
    this.artifacts = new ArtifactService(db);
  }

  inputVersion(projectId: string, stage: PipelineStage): string {
    const upstream = upstreamOf(stage);
    const hash = createHash("sha256").update(`stage-input-v1\n${stage}\n`);
    const fileHashes = new Map<string, { sha256: string } | { missing: true }>();
    const projectRoot = projectDir(this.dataDir, projectId);
    const footageRoot = resolve(this.dataDir, "footage");
    const realRoots = new Map<string, string | null>();
    const realRoot = (root: string) => {
      if (!realRoots.has(root)) {
        try { realRoots.set(root, realpathSync.native(root)); } catch { realRoots.set(root, null); }
      }
      return realRoots.get(root);
    };
    const file = (path: string) => {
      const known = fileHashes.get(path);
      if (known) return known;
      const unavailable = { missing: true } as const;
      const normalized = path.replaceAll("\\", "/");
      let root = projectRoot;
      let resolved: string;
      try {
        if (normalized.startsWith("footage/") || (isAbsolute(path) && inside(footageRoot, resolve(path)))) {
          root = footageRoot;
          resolved = resolve(this.dataDir, path);
        } else if (normalized.startsWith(`projects/${projectId}/`)) {
          resolved = join(this.dataDir, normalized);
        } else {
          resolved = resolveAssetPath(this.dataDir, projectId, path);
        }
      } catch { return unavailable; }
      const rootPath = realRoot(root);
      if (!rootPath || !inside(root, resolved)) return unavailable;
      let location: string;
      let stamp: string;
      try {
        const stat = statSync(resolved, { bigint: true });
        if (!stat.isFile()) return unavailable;
        stamp = `${rootPath}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
        const cached = this.fileVersions.get(resolved);
        if (cached?.stamp === stamp) {
          const result = { sha256: cached.sha256 };
          fileHashes.set(path, result);
          return result;
        }
        location = realpathSync.native(resolved);
      } catch (error) {
        if (isMissingFile(error)) return unavailable;
        throw error;
      }
      if (!inside(rootPath, location)) return unavailable;
      let sha256: string;
      try { ({ sha256 } = this.artifacts.registerSync(location)); } catch (error) {
        if (isMissingFile(error)) return unavailable;
        throw error;
      }
      const result = { sha256 };
      if (this.fileVersions.size >= 4096) this.fileVersions.clear();
      this.fileVersions.set(resolved, { stamp, sha256 });
      fileHashes.set(path, result);
      return result;
    };
    const canonical = (value: unknown, key = ""): unknown => {
      if (typeof value === "string" && isProjectAssetPath(key)) return file(value);
      if (Array.isArray(value)) return value.map((item) => canonical(item));
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compare(a, b))
          .filter(([field]) => !timestamps.has(field.replaceAll("_", "").toLowerCase()))
          .map(([field, child]) => [field, canonical(child, field)]));
      }
      return value;
    };

    for (const { entry, name, key, json } of tables) {
      if (entry.owner !== "project" && (entry.owner === "control" || !upstream.has(entry.owner))) continue;
      const rows = projectTableRows(this.db, entry, projectId).map((row) => {
        const values = Object.fromEntries(Object.entries(row).filter(([field]) => name !== "projects" || projectColumns.has(field))
          .map(([field, value]) => [field, json.has(field) ? decodeProjectJson(value) : value]));
        if (name === "projects" && values.settings && typeof values.settings === "object") {
          // Legacy rows may omit schema defaults. Persisting those defaults during a
          // stage must have the same version as the settings the executor read.
          const settings = ProjectSettingsSchema.parse(values.settings) as Record<string, unknown>;
          // The script executor may choose a format during its own run. User-selected formats are still inputs.
          const autoFormat = (stage === "SCRIPT" || stage === "RESEARCH") && !(Array.isArray(settings.userSet) && settings.userSet.includes("format"));
          const writesTreatment = stage === "SCRIPT" || stage === "RESEARCH";
          values.settings = Object.fromEntries(Object.entries(settings).filter(([field]) => !runtimeSettings.has(field)
            && !(autoFormat && field === "format") && !(writesTreatment && field === "treatment")));
        }
        return { key: JSON.stringify(key.map((column) => row[column])), value: JSON.stringify(canonical(values)) };
      }).sort((a, b) => compare(a.key, b.key) || compare(a.value, b.value));
      hash.update(JSON.stringify([name, rows.map((row) => row.value)])).update("\n");
    }
    return hash.digest("hex");
  }
}

function isMissingFile(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
