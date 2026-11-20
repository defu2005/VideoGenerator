import { dirname, isAbsolute, relative, resolve } from "node:path";
import { realpathSync, statSync } from "node:fs";
import type Database from "better-sqlite3";
import { getTableName } from "drizzle-orm";
import { PROTECTED_PROJECT_ID } from "@vg/shared";
import { PROJECT_TABLES, SHARED_FILE_TABLES, projectTableRows, visitProjectFileReferences } from "../pipeline/dataContract.js";
import { getRenderSettings } from "../settings/render.js";
import { resolveAssetPath } from "./paths.js";
import { ArtifactService } from "../node/artifactService.js";

export type AssetClass = "global" | "shared" | "project" | "ephemeral";
export interface FileReference {
  projectId: string | null;
  table: string;
  rowId: string;
  kind: AssetClass;
}

const dayMs = 86_400_000;
const activeRun = "('GRANTED','RUNNING','PAUSED_AT_GATE')";
const hashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const pathKey = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;

export function isInside(root: string, path: string): boolean {
  const subpath = relative(root, path);
  return !!subpath && !isAbsolute(subpath) && subpath !== ".." && !/^\.\.[/\\]/.test(subpath);
}

export function assetClass(dataDir: string, path: string): AssetClass {
  const parts = relative(dataDir, path).replaceAll("\\", "/").split("/");
  if (parts[0] === "cache") return "ephemeral";
  if (parts[0] === "projects") {
    return parts[2] === "preview" || (parts[2] === "render" && (parts[3] === "pending" || parts[3] === "clips" || parts[3] === "reviews"))
      ? "ephemeral" : "project";
  }
  if (parts[0] === "profiles" || parts[0] === "channels") return "shared";
  return "global";
}

function referencePath(dataDir: string, projectId: string | null, input: string): string | null {
  if (!input || /^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return null;
  const path = input.replaceAll("\\", "/");
  try {
    const full = isAbsolute(input) ? resolve(input) :
      /^(projects|profiles|channels|footage|style|library)\//.test(path) || !projectId
        ? resolve(dataDir, path) : resolveAssetPath(dataDir, projectId, path);
    return isInside(dataDir, full) ? full : null;
  } catch {
    return null;
  }
}

interface ProjectState {
  id: string;
  archived_at: string | null;
  status: string;
}

export interface ReferenceOptions {
  now?: Date;
  postPublishDays?: number;
}

export function busyProjects(db: Database.Database): Set<string> {
  const rows = db.prepare(`
    SELECT id AS project_id FROM projects WHERE status IN ('GENERATING','RENDERING')
    UNION SELECT project_id FROM jobs WHERE status IN ('RUNNING','QUEUED') OR finalizing_at IS NOT NULL AND status='RUNNING'
    UNION SELECT project_id FROM project_runs WHERE status IN ${activeRun}
  `).all() as Array<{ project_id: string | null }>;
  return new Set(rows.flatMap(({ project_id }) => project_id ? [project_id] : []));
}

/** The graph's keys are canonical absolute paths, SHA-256s and protected directory roots. */
export function collectReferences(
  db: Database.Database,
  dataDir: string,
  options: ReferenceOptions = {},
  registry?: ArtifactService,
): Map<string, FileReference[]> {
  const root = resolve(dataDir);
  const now = options.now ?? new Date();
  const archiveBefore = new Date(now.getTime() - (options.postPublishDays ?? 7) * dayMs).toISOString();
  const keep = getRenderSettings(db).keepVersions;
  const graph = new Map<string, FileReference[]>();
  const add = (key: string, ref: FileReference) => {
    const list = graph.get(key);
    if (!list) graph.set(key, [ref]);
    else if (!list.some((old) => old.table === ref.table && old.rowId === ref.rowId && old.projectId === ref.projectId)) list.push(ref);
  };
  const protect = (projectId: string, path: string, table: string, rowId: string) => {
    add(pathKey(path), { projectId, table, rowId, kind: assetClass(root, path) });
  };
  const busy = busyProjects(db);
  if (busy.size) add(pathKey(resolve(root, "cache")), { projectId: null, table: "jobs", rowId: "active-cache", kind: "ephemeral" });
  for (const id of new Set([...busy, PROTECTED_PROJECT_ID])) protect(id, resolve(root, "projects", id), "projects", id);

  const projects = db.prepare("SELECT id,archived_at,status FROM projects").all() as ProjectState[];
  for (const project of projects) {
    const projectId = project.id;
    const rowsByTable = new Map(PROJECT_TABLES.map((entry) => [getTableName(entry.table), projectTableRows(db, entry, projectId)]));
    const publications = rowsByTable.get("publications") ?? [];
    const retainedRenders = new Set(publications.flatMap((row) => typeof row.render_id === "string" ? [row.render_id] : []));
    const due = !!project.archived_at || publications.some((row) =>
      row.status === "PUBLISHED" && typeof row.published_at === "string" && row.published_at <= archiveBefore);
    const renders = rowsByTable.get("renders") ?? [];
    const ordered = renders.filter((row) => !row.deleted_at && row.status === "DONE")
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || Number(b.version) - Number(a.version));
    for (const row of ordered.slice(0, due ? 1 : keep)) if (typeof row.id === "string") retainedRenders.add(row.id);
    // A clip proposal can read the source render again. Retain versions while proposals remain.
    if ((rowsByTable.get("clip_sets") ?? []).some((row) => row.source === "project" && row.status !== "done")) {
      for (const row of ordered) if (typeof row.id === "string") retainedRenders.add(row.id);
    }
    const selected = new Set((rowsByTable.get("visual_selections") ?? []).map((row) => row.candidate_id));
    const activeJobs = new Set((rowsByTable.get("jobs") ?? []).filter((row) => row.status === "RUNNING" || row.status === "QUEUED").map((row) => row.id));
    const activeRuns = new Set((rowsByTable.get("project_runs") ?? []).filter((row) =>
      row.status === "GRANTED" || row.status === "RUNNING" || row.status === "PAUSED_AT_GATE").map((row) => row.id));

    for (const { table } of PROJECT_TABLES) {
      const name = getTableName(table);
      for (const row of rowsByTable.get(name) ?? []) {
        if (name === "visual_candidates" && !selected.has(row.id) && (due || !!row.discarded_at)) continue;
        if (name === "visual_search_checkpoints" && due && !busy.has(projectId)) continue;
        if (name === "renders" && !retainedRenders.has(String(row.id)) && !row.pinned && (due || row.deleted_at)) continue;
        if (name === "node_uploads" && !activeJobs.has(row.job_id)) continue;
        if ((name === "run_uploads" || name === "run_checkpoints") && !activeRuns.has(row.run_id)) continue;
        const rowId = String(row.id ?? row.job_id ?? row.run_id ?? projectId);
        visitProjectFileReferences(table, row, (kind, value) => {
          if (kind === "sha256") {
            add(value, { projectId, table: name, rowId, kind: "project" });
            return;
          }
          const path = referencePath(root, projectId, value);
          if (path) protect(projectId, path, name, rowId);
        });
        if (name === "renders" && typeof row.output_path === "string" && typeof row.id === "string") {
          const path = referencePath(root, projectId, row.output_path);
          const versionDir = resolve(root, "projects", projectId, "render", "versions", row.id);
          if (path && dirname(path) === versionDir) protect(projectId, versionDir, name, rowId);
        }
      }
    }
  }

  // External clips can have no project. Any source/output path they declare still protects local assets.
  const clipContract = PROJECT_TABLES.find(({ table }) => getTableName(table) === "clip_sets")!;
  for (const row of db.prepare("SELECT * FROM clip_sets WHERE project_id IS NULL").all() as Array<Record<string, unknown>>) {
    visitProjectFileReferences(clipContract.table, row, (kind, value) => {
      const key = kind === "sha256" ? value : referencePath(root, null, value);
      if (key) add(pathKey(key), { projectId: null, table: "clip_sets", rowId: String(row.id), kind: assetClass(root, key) });
    });
  }

  for (const table of SHARED_FILE_TABLES) {
    const name = getTableName(table);
    for (const row of db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all() as Array<Record<string, unknown>>) {
      visitProjectFileReferences(table, row, (kind, value) => {
        const path = kind === "path" ? referencePath(root, null, value) : value;
        if (path) add(pathKey(path), { projectId: null, table: name, rowId: String(row.id ?? "shared"), kind: "global" });
      });
    }
  }
  // A hash can have several local copies while the artifact index stores one path.
  // Resolve live path-only references before deciding that the remote hash is unused.
  const artifactRegistry = registry ?? new ArtifactService(db, options.now ? () => options.now! : undefined);
  for (const [path, refs] of [...graph]) {
    if (!isAbsolute(path) || !isInside(root, path)) continue;
    try {
      if (!statSync(path).isFile()) continue;
      const real = realpathSync.native(path);
      if (!isInside(realpathSync.native(root), real)) throw new Error("File reference escapes the data directory");
      const { sha256 } = artifactRegistry.registerSync(real);
      for (const ref of refs) add(sha256, ref);
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException | null)?.code ?? "")) throw error;
    }
  }
  const artifacts = db.prepare("SELECT sha256,path FROM artifacts").all() as Array<{ sha256: string; path: string }>;
  for (const row of artifacts) {
    const path = referencePath(root, null, row.path);
    if (!path || !hashPattern.test(row.sha256)) continue;
    if (assetClass(root, path) === "global") add(row.sha256, { projectId: null, table: "artifacts", rowId: row.sha256, kind: "global" });
    for (const ref of referencesForPath(graph, path, root)) add(row.sha256, ref);
    // A live reference to the same SHA can be in a different project.
    for (const ref of graph.get(row.sha256) ?? []) add(pathKey(path), ref);
  }
  return graph;
}

export function referencesForPath(graph: ReadonlyMap<string, FileReference[]>, path: string, root: string): FileReference[] {
  const found: FileReference[] = [];
  for (let current = path; isInside(root, current); current = dirname(current)) {
    found.push(...(graph.get(pathKey(current)) ?? []));
  }
  return found;
}

/**
 * Checks whether a specific target (file path or SHA-256) is referenced in the current database state,
 * without building or hashing the entire workspace graph.
 * If target safety cannot be proven conclusively, returns true (treat as referenced / do not delete).
 */
export function isTargetReferencedInDb(
  db: Database.Database,
  dataDir: string,
  target: { path?: string; sha256?: string },
  options: ReferenceOptions = {},
  registry?: ArtifactService,
): boolean {
  const root = resolve(dataDir);
  const now = options.now ?? new Date();
  const archiveBefore = new Date(now.getTime() - (options.postPublishDays ?? 7) * dayMs).toISOString();
  const keep = getRenderSettings(db).keepVersions;

  const targetPath = target.path ? resolve(target.path) : null;
  const targetKey = targetPath ? pathKey(targetPath) : null;
  const targetSha = target.sha256 && hashPattern.test(target.sha256) ? target.sha256 : null;

  if (!targetKey && !targetSha) return true;

  // 1. Busy projects / protected project check
  const busy = busyProjects(db);
  const allProtected = new Set([...busy, PROTECTED_PROJECT_ID]);

  if (targetKey) {
    if (busy.size && (targetKey === pathKey(resolve(root, "cache")) || isInside(resolve(root, "cache"), targetKey))) {
      return true;
    }
    for (const id of allProtected) {
      const projDir = resolve(root, "projects", id);
      if (targetKey === pathKey(projDir) || isInside(projDir, targetKey)) {
        return true;
      }
    }
  }

  // 2. Determine target's project if it lives in projects/<id>
  let targetProjectId: string | null = null;
  if (targetPath) {
    const rel = relative(resolve(root, "projects"), targetPath).replaceAll("\\", "/").split("/");
    if (rel[0] && uuidPattern.test(rel[0])) {
      targetProjectId = rel[0];
    }
  }

  // If the target has a known SHA or if we can read its registered SHA, check if that SHA matches targetSha
  const artifactRegistry = registry ?? new ArtifactService(db, options.now ? () => options.now! : undefined);
  let resolvedTargetSha = targetSha;
  if (!resolvedTargetSha && targetPath) {
    try {
      if (statSync(targetPath).isFile()) {
        const { sha256 } = artifactRegistry.registerSync(realpathSync.native(targetPath));
        if (hashPattern.test(sha256)) resolvedTargetSha = sha256;
      }
    } catch {
      // If stat fails, check artifacts table directly
      const art = db.prepare("SELECT sha256 FROM artifacts WHERE path=?").get(targetPath) as { sha256: string } | undefined;
      if (art && hashPattern.test(art.sha256)) resolvedTargetSha = art.sha256;
    }
  }

  // Also, if we have targetSha but not targetPath, check artifacts table for its path!
  let resolvedTargetPath = targetPath;
  let resolvedTargetKey = targetKey;
  if (resolvedTargetSha && !resolvedTargetPath) {
    const art = db.prepare("SELECT path FROM artifacts WHERE sha256=?").get(resolvedTargetSha) as { path: string } | undefined;
    if (art?.path) {
      resolvedTargetPath = resolve(art.path);
      resolvedTargetKey = pathKey(resolvedTargetPath);
    }
  }

  // Helper to match a path or sha against our targets
  const matchesTarget = (valKind: "path" | "sha256", val: string, projId: string | null): boolean => {
    if (valKind === "sha256") {
      return !!resolvedTargetSha && val === resolvedTargetSha;
    }
    const resolvedRefPath = referencePath(root, projId, val);
    if (!resolvedRefPath) return false;
    const refKey = pathKey(resolvedRefPath);
    if (resolvedTargetKey && (resolvedTargetKey === refKey || isInside(resolvedRefPath, resolvedTargetKey))) {
      return true;
    }
    return false;
  };

  // 3. Scan shared file tables
  for (const table of SHARED_FILE_TABLES) {
    const name = getTableName(table);
    const rows = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      let matched = false;
      visitProjectFileReferences(table, row, (kind, value) => {
        if (matched) return;
        if (matchesTarget(kind, value, null)) matched = true;
      });
      if (matched) return true;
    }
  }

  // 4. Scan unprojected clip_sets
  const clipContract = PROJECT_TABLES.find(({ table }) => getTableName(table) === "clip_sets")!;
  const unprojectedClips = db.prepare("SELECT * FROM clip_sets WHERE project_id IS NULL").all() as Array<Record<string, unknown>>;
  for (const row of unprojectedClips) {
    let matched = false;
    visitProjectFileReferences(clipContract.table, row, (kind, value) => {
      if (matched) return;
      if (matchesTarget(kind, value, null)) matched = true;
    });
    if (matched) return true;
  }

  // 5. Scan project tables
  // If target belongs to a specific project and targetSha is not set, we can limit to targetProjectId.
  // BUT if resolvedTargetSha is set, another project might reference the same SHA!
  // Therefore, if resolvedTargetSha is set or targetProjectId is null, scan all projects.
  // Otherwise, we only need to scan targetProjectId.
  const projects = targetProjectId && !resolvedTargetSha
    ? (db.prepare("SELECT id,archived_at,status FROM projects WHERE id=?").all(targetProjectId) as ProjectState[])
    : (db.prepare("SELECT id,archived_at,status FROM projects").all() as ProjectState[]);

  for (const project of projects) {
    const projectId = project.id;
    const rowsByTable = new Map(PROJECT_TABLES.map((entry) => [getTableName(entry.table), projectTableRows(db, entry, projectId)]));
    const publications = rowsByTable.get("publications") ?? [];
    const retainedRenders = new Set(publications.flatMap((row) => typeof row.render_id === "string" ? [row.render_id] : []));
    const due = !!project.archived_at || publications.some((row) =>
      row.status === "PUBLISHED" && typeof row.published_at === "string" && row.published_at <= archiveBefore);
    const renders = rowsByTable.get("renders") ?? [];
    const ordered = renders.filter((row) => !row.deleted_at && row.status === "DONE")
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || Number(b.version) - Number(a.version));
    for (const row of ordered.slice(0, due ? 1 : keep)) if (typeof row.id === "string") retainedRenders.add(row.id);
    if ((rowsByTable.get("clip_sets") ?? []).some((row) => row.source === "project" && row.status !== "done")) {
      for (const row of ordered) if (typeof row.id === "string") retainedRenders.add(row.id);
    }
    const selected = new Set((rowsByTable.get("visual_selections") ?? []).map((row) => row.candidate_id));
    const activeJobs = new Set((rowsByTable.get("jobs") ?? []).filter((row) => row.status === "RUNNING" || row.status === "QUEUED").map((row) => row.id));
    const activeRuns = new Set((rowsByTable.get("project_runs") ?? []).filter((row) =>
      row.status === "GRANTED" || row.status === "RUNNING" || row.status === "PAUSED_AT_GATE").map((row) => row.id));

    for (const { table } of PROJECT_TABLES) {
      const name = getTableName(table);
      for (const row of rowsByTable.get(name) ?? []) {
        if (name === "visual_candidates" && !selected.has(row.id) && (due || !!row.discarded_at)) continue;
        if (name === "visual_search_checkpoints" && due && !busy.has(projectId)) continue;
        if (name === "renders" && !retainedRenders.has(String(row.id)) && !row.pinned && (due || row.deleted_at)) continue;
        if (name === "node_uploads" && !activeJobs.has(row.job_id)) continue;
        if ((name === "run_uploads" || name === "run_checkpoints") && !activeRuns.has(row.run_id)) continue;

        let matched = false;
        visitProjectFileReferences(table, row, (kind, value) => {
          if (matched) return;
          if (matchesTarget(kind, value, projectId)) matched = true;
        });
        if (matched) return true;

        if (name === "renders" && typeof row.output_path === "string" && typeof row.id === "string") {
          const path = referencePath(root, projectId, row.output_path);
          const versionDir = resolve(root, "projects", projectId, "render", "versions", row.id);
          if (path && dirname(path) === versionDir) {
            if (targetKey && (targetKey === pathKey(versionDir) || isInside(versionDir, targetKey))) return true;
          }
        }
      }
    }
  }

  // 6. Artifacts table check
  if (resolvedTargetSha) {
    const artifactRows = db.prepare("SELECT sha256,path FROM artifacts WHERE sha256=?").all(resolvedTargetSha) as Array<{ sha256: string; path: string }>;
    for (const row of artifactRows) {
      const path = referencePath(root, null, row.path);
      if (path && assetClass(root, path) === "global") return true;
    }
  }

  return false;
}

/**
 * DB-only reference index for one purge sweep (TASK-138 fix3).
 * It mirrors the DB-side filters of isTargetReferencedInDb but scans the database once per change,
 * not once per candidate. The change stamp is PRAGMA data_version (other connections' commits)
 * plus total_changes() (this connection). Call refresh() inside the write transaction that decides
 * each delete, so a reference committed before that lock is always seen.
 * Disk-derived references (path-only copies matched by SHA) are NOT in this index; the caller
 * supplies the target's own SHA and keeps the pre-lock graph check.
 */
export class DbReferenceIndex {
  private shas = new Set<string>();
  private paths = new Set<string>();
  private stampValue = "";
  private readonly root: string;

  constructor(
    private readonly db: Database.Database,
    dataDir: string,
    private readonly options: ReferenceOptions = {},
    private readonly registry?: ArtifactService,
  ) {
    this.root = resolve(dataDir);
  }

  private currentStamp(): string {
    const version = (this.db.prepare("PRAGMA data_version").get() as { data_version: number }).data_version;
    const changes = (this.db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
    return `${version}:${changes}`;
  }

  /**
   * Rebuilds the index only if the database changed since the last build. Returns true when it rebuilt.
   * The stamp is read BEFORE the build: a commit that lands during the build makes the next refresh rebuild.
   */
  refresh(): boolean {
    const before = this.currentStamp();
    if (before === this.stampValue) return false;
    this.build();
    this.stampValue = before;
    return true;
  }

  /**
   * Call only in the same synchronous block as a refresh() inside a write transaction, after this
   * connection's own write to tables that do not hold references (blobs, file_gc_marks). Synchronous
   * better-sqlite3 transactions cannot interleave, so no other write can be swallowed here.
   */
  acknowledgeOwnWrites(): void {
    this.stampValue = this.currentStamp();
  }

  /** True when the SHA is referenced, or the path (or one of its ancestors) is a referenced or protected root. */
  isReferenced(path: string | null, sha: string | null): boolean {
    // Same fail-closed rule as isTargetReferencedInDb: no usable path and no valid SHA means keep.
    const validSha = !!sha && hashPattern.test(sha) ? sha : null;
    if (!path && !validSha) return true;
    if (validSha && this.shas.has(validSha)) return true;
    // Path-only target: the oracle resolves the SHA from the file or its artifacts row, then checks global SHAs.
    if (!validSha && path) {
      const byPath = this.db.prepare("SELECT sha256 FROM artifacts WHERE path=?").get(path) as { sha256: string } | undefined;
      if (byPath && hashPattern.test(byPath.sha256) && this.shas.has(byPath.sha256)) return true;
    }
    // Same as isTargetReferencedInDb: a SHA target also checks the path of its artifact row.
    if (!path && validSha) {
      const row = this.db.prepare("SELECT path FROM artifacts WHERE sha256=?").get(validSha) as { path: string } | undefined;
      if (row?.path) path = resolve(row.path);
    }
    if (!path) return false;
    for (let current = resolve(path); isInside(this.root, current); current = dirname(current)) {
      if (this.paths.has(pathKey(current))) return true;
    }
    return false;
  }

  private build(): void {
    const root = this.root;
    const shas = new Set<string>();
    const paths = new Set<string>();
    const now = this.options.now ?? new Date();
    const archiveBefore = new Date(now.getTime() - (this.options.postPublishDays ?? 7) * dayMs).toISOString();
    const keep = getRenderSettings(this.db).keepVersions;
    const busy = busyProjects(this.db);
    if (busy.size) paths.add(pathKey(resolve(root, "cache")));
    for (const id of new Set([...busy, PROTECTED_PROJECT_ID])) paths.add(pathKey(resolve(root, "projects", id)));
    const addRef = (kind: string, value: string, projectId: string | null) => {
      if (kind === "sha256") { shas.add(value); return; }
      const path = referencePath(root, projectId, value);
      if (!path) return;
      // A path reference protects that path only, as isTargetReferencedInDb does; byte-identical copies are not protected.
      paths.add(pathKey(path));
    };

    for (const table of SHARED_FILE_TABLES) {
      const name = getTableName(table);
      for (const row of this.db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all() as Array<Record<string, unknown>>) {
        visitProjectFileReferences(table, row, (kind, value) => addRef(kind, value, null));
      }
    }
    const clipContract = PROJECT_TABLES.find(({ table }) => getTableName(table) === "clip_sets")!;
    for (const row of this.db.prepare("SELECT * FROM clip_sets WHERE project_id IS NULL").all() as Array<Record<string, unknown>>) {
      visitProjectFileReferences(clipContract.table, row, (kind, value) => addRef(kind, value, null));
    }

    const projects = this.db.prepare("SELECT id,archived_at,status FROM projects").all() as ProjectState[];
    for (const project of projects) {
      const projectId = project.id;
      const rowsByTable = new Map(PROJECT_TABLES.map((entry) => [getTableName(entry.table), projectTableRows(this.db, entry, projectId)]));
      const publications = rowsByTable.get("publications") ?? [];
      const retainedRenders = new Set(publications.flatMap((row) => typeof row.render_id === "string" ? [row.render_id] : []));
      const due = !!project.archived_at || publications.some((row) =>
        row.status === "PUBLISHED" && typeof row.published_at === "string" && row.published_at <= archiveBefore);
      const renders = rowsByTable.get("renders") ?? [];
      const ordered = renders.filter((row) => !row.deleted_at && row.status === "DONE")
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || Number(b.version) - Number(a.version));
      for (const row of ordered.slice(0, due ? 1 : keep)) if (typeof row.id === "string") retainedRenders.add(row.id);
      if ((rowsByTable.get("clip_sets") ?? []).some((row) => row.source === "project" && row.status !== "done")) {
        for (const row of ordered) if (typeof row.id === "string") retainedRenders.add(row.id);
      }
      const selected = new Set((rowsByTable.get("visual_selections") ?? []).map((row) => row.candidate_id));
      const activeJobs = new Set((rowsByTable.get("jobs") ?? []).filter((row) => row.status === "RUNNING" || row.status === "QUEUED").map((row) => row.id));
      const activeRuns = new Set((rowsByTable.get("project_runs") ?? []).filter((row) =>
        row.status === "GRANTED" || row.status === "RUNNING" || row.status === "PAUSED_AT_GATE").map((row) => row.id));
      for (const { table } of PROJECT_TABLES) {
        const name = getTableName(table);
        for (const row of rowsByTable.get(name) ?? []) {
          if (name === "visual_candidates" && !selected.has(row.id) && (due || !!row.discarded_at)) continue;
          if (name === "visual_search_checkpoints" && due && !busy.has(projectId)) continue;
          if (name === "renders" && !retainedRenders.has(String(row.id)) && !row.pinned && (due || row.deleted_at)) continue;
          if (name === "node_uploads" && !activeJobs.has(row.job_id)) continue;
          if ((name === "run_uploads" || name === "run_checkpoints") && !activeRuns.has(row.run_id)) continue;
          visitProjectFileReferences(table, row, (kind, value) => addRef(kind, value, projectId));
          if (name === "renders" && typeof row.output_path === "string" && typeof row.id === "string") {
            const path = referencePath(root, projectId, row.output_path);
            const versionDir = resolve(root, "projects", projectId, "render", "versions", row.id);
            if (path && dirname(path) === versionDir) paths.add(pathKey(versionDir));
          }
        }
      }
    }

    for (const row of this.db.prepare("SELECT sha256,path FROM artifacts").all() as Array<{ sha256: string; path: string }>) {
      const path = referencePath(root, null, row.path);
      if (path && assetClass(root, path) === "global") shas.add(row.sha256);
    }
    this.shas = shas;
    this.paths = paths;
  }
}
