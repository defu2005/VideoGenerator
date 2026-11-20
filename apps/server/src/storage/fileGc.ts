import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, copyFileSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, renameSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type Database from "better-sqlite3";
import { PROTECTED_PROJECT_ID } from "@vg/shared";
import { assetClass, collectReferences, DbReferenceIndex, isInside, referencesForPath, type FileReference } from "./references.js";
import { getGcSettings, type GcSettings } from "./gcSettings.js";
import { blobKey } from "./provider.js";
import type { BlobLocation } from "./blobStore.js";
import { ArtifactService, sha256File } from "../node/artifactService.js";

const day = 86_400_000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const managedFolders = new Set(["visuals", "voice", "music", "subtitles", "timeline", "preview", "render"]);

type Entry = { path: string; projectId: string; kind: "project" | "ephemeral"; size: number; stamp: string };
type Mark = { path: string; project_owner_id: string; stamp: string; orphaned_at: string; purge_after: string };
export type GcReport = {
  marked: number;
  cleared: number;
  purged: number;
  bytes: number;
  eligible: number;
  eligibleBytes: number;
  errors: number;
};

const emptyReport = (): GcReport => ({ marked: 0, cleared: 0, purged: 0, bytes: 0, eligible: 0, eligibleBytes: 0, errors: 0 });

function isMissing(error: unknown): boolean {
  return ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException | null)?.code ?? "");
}

function statFile(path: string, singleLink = true) {
  try {
    const stat = lstatSync(path, { bigint: true });
    if (!stat.isFile() || (singleLink && stat.nlink !== 1n)) return null;
    return {
      size: Number(stat.size),
      stamp: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`,
    };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function list(path: string) {
  try { return readdirSync(path, { withFileTypes: true }); }
  catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

export class FileGc {
  private readonly root: string;
  private readonly artifacts: ArtifactService;

  constructor(
    private readonly db: Database.Database,
    dataDir: string,
    private readonly settings: () => GcSettings = () => getGcSettings(db),
    private readonly now: () => Date = () => new Date(),
    private readonly location: () => BlobLocation | null = () => null,
    private readonly mutate: <T>(work: () => Promise<T>) => Promise<T> = (work) => work(),
    artifacts?: ArtifactService,
  ) {
    this.root = resolve(dataDir);
    this.artifacts = artifacts ?? new ArtifactService(db, this.now);
  }

  private isReferencedInGraph(graph: ReadonlyMap<string, FileReference[]>, sha: string): boolean {
    if (graph.has(sha)) return true;
    const artifact = this.db.prepare("SELECT path FROM artifacts WHERE sha256=?").get(sha) as { path: string } | undefined;
    if (!artifact) return true;
    const path = resolve(artifact.path);
    const owner = relative(join(this.root, "projects"), path).replaceAll("\\", "/").split("/")[0] ?? "";
    // Unknown ownership remains outside automatic collection.
    return !uuid.test(owner) || owner.toLowerCase() === PROTECTED_PROJECT_ID ||
      assetClass(this.root, path) === "global" || referencesForPath(graph, path, this.root).length > 0;
  }

  private inventory(onlyProject?: string, includeRetained = false): Map<string, Entry> {
    const projects = new Set((this.db.prepare("SELECT id FROM projects").all() as Array<{ id: string }>).map(({ id }) => id));
    const entries = new Map<string, Entry>();
    const tree = join(this.root, "projects");
    for (const dir of this.canonical(tree) === null ? [] : list(tree)) {
      const projectId = dir.name;
      if (onlyProject !== undefined && projectId !== onlyProject) continue;
      if (!dir.isDirectory() || !uuid.test(projectId) || (!includeRetained && projectId.toLowerCase() === PROTECTED_PROJECT_ID)) continue;
      const project = join(tree, projectId);
      if (this.canonical(project) === null) continue;
      const pending = [project];
      const exists = projects.has(projectId);
      while (pending.length) {
        const parent = pending.pop()!;
        for (const child of list(parent)) {
          const path = join(parent, child.name);
          if (!includeRetained && exists && parent === project && !managedFolders.has(child.name)) continue;
          if (!includeRetained && exists && parent === join(project, "render") && child.isDirectory() && !["versions", "pending", "clips", "reviews"].includes(child.name)) continue;
          if (child.isDirectory()) {
            if (this.canonical(path) !== null) pending.push(path);
          } else if (child.isFile()) {
            const file = statFile(path, !includeRetained);
            if (!file) continue;
            const kind = assetClass(this.root, path) === "ephemeral" ? "ephemeral" : "project";
            entries.set(path, { path, projectId, kind, ...file });
          }
        }
      }
    }
    if (onlyProject === undefined) {
      const cache = join(this.root, "cache");
      const pending = this.canonical(cache) ? [cache] : [];
      while (pending.length) {
        const parent = pending.pop()!;
        for (const child of list(parent)) {
          const path = join(parent, child.name);
          if (child.isDirectory() && this.canonical(path)) pending.push(path);
          else if (child.isFile()) {
            const file = statFile(path, !includeRetained);
            if (file) entries.set(path, { path, projectId: "@cache", kind: "ephemeral", ...file });
          }
        }
      }
    }
    return entries;
  }

  /** Require the entire path to resolve inside DATA_DIR without a symlink or junction. */
  private canonical(path: string): string | null {
    if (!isInside(this.root, path)) return null;
    try {
      const root = realpathSync.native(this.root);
      const actual = realpathSync.native(path);
      const requested = relative(this.root, path);
      const resolved = relative(root, actual);
      if (isAbsolute(resolved) || !isInside(root, actual)) return null;
      const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
      return normalize(requested) === normalize(resolved) ? actual : null;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  largestProjects(limit = 10): Array<{ projectId: string; bytes: number }> {
    const totals = new Map<string, number>();
    for (const entry of this.inventory(undefined, true).values()) {
      if (entry.projectId === "@cache") continue;
      totals.set(entry.projectId, (totals.get(entry.projectId) ?? 0) + entry.size);
    }
    return [...totals].sort(([, a], [, b]) => b - a).slice(0, limit).map(([projectId, bytes]) => ({ projectId, bytes }));
  }

  report(projectIds?: ReadonlySet<string>) {
    const now = this.now().toISOString();
    const marks = new Map((this.db.prepare("SELECT path,purge_after FROM file_gc_marks").all() as Array<{ path: string; purge_after: string }>)
      .map((row) => [row.path, row.purge_after]));
    const classes = { global: 0, shared: 0, project: 0, ephemeral: 0 };
    const projects = new Map<string, { projectId: string; bytes: number; orphanedBytes: number; dueBytes: number }>();
    const orphaned: Array<{ projectId: string; path: string; bytes: number; purgeAfter: string }> = [];
    for (const file of this.inventory(undefined, true).values()) {
      if (projectIds && !projectIds.has(file.projectId)) continue;
      classes[file.kind] += file.size;
      let project = projects.get(file.projectId);
      if (!project) {
        project = { projectId: file.projectId, bytes: 0, orphanedBytes: 0, dueBytes: 0 };
        projects.set(file.projectId, project);
      }
      project.bytes += file.size;
      const purgeAfter = marks.get(file.path);
      if (!purgeAfter) continue;
      project.orphanedBytes += file.size;
      if (purgeAfter <= now) project.dueBytes += file.size;
      orphaned.push({ projectId: file.projectId, path: relative(file.projectId === "@cache" ? this.root : join(this.root, "projects", file.projectId), file.path).replaceAll("\\", "/"), bytes: file.size, purgeAfter });
    }
    if (!projectIds) {
      const pending = list(this.root).filter((entry) => entry.isDirectory() && !["projects", "cache"].includes(entry.name)).map((entry) => join(this.root, entry.name));
      while (pending.length) {
        const parent = pending.pop()!;
        if (!this.canonical(parent)) continue;
        for (const child of list(parent)) {
          const path = join(parent, child.name);
          if (child.isDirectory()) pending.push(path);
          else if (child.isFile()) {
            const file = statFile(path);
            if (file) classes[assetClass(this.root, path)] += file.size;
          }
        }
      }
    }
    const total = orphaned.reduce((sum, row) => sum + row.bytes, 0);
    const due = orphaned.filter((row) => row.purgeAfter <= now);
    const remoteRows = this.db.prepare(`SELECT b.sha256,b.size,b.orphaned_at,b.purge_after,a.path
      FROM blobs b LEFT JOIN artifacts a ON a.sha256=b.sha256 WHERE b.provider='s3'`).all() as Array<{
      sha256: string; size: number; orphaned_at: string | null; purge_after: string | null; path: string | null;
    }>;
    const remote = remoteRows.filter((row) => {
      if (!projectIds) return true;
      if (!row.path || !isInside(join(this.root, "projects"), resolve(row.path))) return false;
      const owner = relative(join(this.root, "projects"), resolve(row.path)).replaceAll("\\", "/").split("/")[0] ?? "";
      return projectIds.has(owner);
    });
    const remoteOrphans = remote.filter((row) => row.orphaned_at && row.purge_after);
    return {
      settings: this.settings(), classes,
      projects: [...projects.values()].filter((row) => row.projectId !== "@cache").sort((a, b) => b.bytes - a.bytes),
      orphanedBytes: total, dueBytes: due.reduce((sum, row) => sum + row.bytes, 0), dueCount: due.length,
      orphaned: orphaned.sort((a, b) => a.purgeAfter.localeCompare(b.purgeAfter)).slice(0, 200),
      orphanedCount: orphaned.length,
      remote: {
        bytes: remote.reduce((sum, row) => sum + row.size, 0),
        orphanedBytes: remoteOrphans.reduce((sum, row) => sum + row.size, 0),
        dueBytes: remoteOrphans.filter((row) => row.purge_after! <= now).reduce((sum, row) => sum + row.size, 0),
        dueCount: remoteOrphans.filter((row) => row.purge_after! <= now).length,
        orphanedCount: remoteOrphans.length,
        orphaned: remoteOrphans.slice(0, 200).map((row) => ({ sha256: row.sha256, bytes: row.size, purgeAfter: row.purge_after! })),
      },
    };
  }

  async runBlobs(options: { dryRun?: boolean; purge?: boolean } = {}): Promise<GcReport> {
    const result = emptyReport();
    const started = Date.now();
    const at = this.now();
    const location = this.location();
    if (!location) return result;
    // A committed backup survives a failed DELETE/PUT and process restarts. Never
    // include this directory in the ordinary orphan inventory.
    const recoveryDir = join(this.root, "gc-recovery", createHash("sha256").update(location.id).digest("hex"));
    const backupPath = (sha: string) => join(recoveryDir, sha);
    const artifactPath = (sha: string) => (this.db.prepare("SELECT path FROM artifacts WHERE sha256=?").get(sha) as { path: string } | undefined)?.path;
    const durable = (path: string) => {
      const fd = openSync(path, process.platform === "win32" ? "r+" : "r");
      try { fsyncSync(fd); } finally { closeSync(fd); }
    };
    const validBackup = async (sha: string, size: number) => {
      const path = backupPath(sha);
      return this.canonical(path) !== null && statFile(path)?.size === size && await sha256File(path) === sha;
    };
    const prepareBackup = async (sha: string, size: number, key: string) => {
      if (await validBackup(sha, size)) return;
      mkdirSync(recoveryDir, { recursive: true });
      if (!this.canonical(recoveryDir)) throw new Error("Unsafe GC recovery directory");
      const temporary = join(recoveryDir, `${sha}.${randomUUID()}.tmp`);
      try {
        const local = artifactPath(sha);
        if (local && this.canonical(local) && statFile(local)?.size === size && await sha256File(local) === sha) {
          copyFileSync(local, temporary, constants.COPYFILE_EXCL);
        } else await location.provider.downloadTo(key, temporary, size);
        if (statFile(temporary)?.size !== size || await sha256File(temporary) !== sha) throw new Error("Invalid GC recovery content");
        durable(temporary);
        renameSync(temporary, backupPath(sha));
        // POSIX needs the directory entry flushed as well. Windows disallows
        // opening directories; the already-flushed file remains the recovery copy.
        if (process.platform !== "win32") durable(recoveryDir);
      } finally { try { unlinkSync(temporary); } catch (error) { if (!isMissing(error)) throw error; } }
    };
    const restore = async (sha: string, size: number, key: string) => {
      if (!await validBackup(sha, size)) throw new Error("GC recovery content unavailable");
      const local = artifactPath(sha);
      if (!local || !isInside(this.root, resolve(local))) throw new Error("GC recovery local path unavailable");
      // Do not follow a newly introduced junction or overwrite replacement data.
      let ancestor = dirname(resolve(local));
      while (isInside(this.root, ancestor)) {
        try { lstatSync(ancestor); break; } catch (error) { if (!isMissing(error)) throw error; ancestor = dirname(ancestor); }
      }
      if (ancestor !== this.root && !this.canonical(ancestor)) throw new Error("Unsafe GC recovery target");
      mkdirSync(dirname(local), { recursive: true });
      if (!this.canonical(dirname(local))) throw new Error("Unsafe GC recovery target");
      if (statFile(local)) {
        if (!this.canonical(local) || await sha256File(local) !== sha) throw new Error("GC recovery target changed");
      } else {
        const temporary = join(dirname(local), `.gc-${sha}-${randomUUID()}.tmp`);
        try {
          copyFileSync(backupPath(sha), temporary, constants.COPYFILE_EXCL);
          durable(temporary);
          // Link publishes a complete file atomically and refuses to replace a
          // concurrent writer. A crash cannot leave a partially copied target.
          linkSync(temporary, local);
          if (process.platform !== "win32") durable(dirname(local));
        } finally { try { unlinkSync(temporary); } catch (error) { if (!isMissing(error)) throw error; } }
      }
      await location.provider.put(key, backupPath(sha), sha);
      const head = await location.provider.head(key);
      if (!head || head.size !== size || (head.sha256 && head.sha256 !== sha)) throw new Error("GC remote recovery verification failed");
      if (!head.sha256) {
        const verify = join(recoveryDir, `${sha}.${randomUUID()}.verify`);
        try {
          await location.provider.downloadTo(key, verify, size);
          if (statFile(verify)?.size !== size || await sha256File(verify) !== sha) throw new Error("GC remote recovery SHA mismatch");
        } finally { try { unlinkSync(verify); } catch (error) { if (!isMissing(error)) throw error; } }
      }
      if (this.location()?.id !== location.id) throw new Error("Storage location changed during recovery");
      this.db.prepare("UPDATE blobs SET verified_at=?,orphaned_at=NULL,purge_after=NULL WHERE sha256=? AND location_id=?")
        .run(this.now().toISOString(), sha, location.id);
      unlinkSync(backupPath(sha));
    };
    const rows = this.db.prepare("SELECT * FROM blobs WHERE provider='s3' AND location_id=?").all(location.id) as Array<{
      sha256: string; size: number; key: string; orphaned_at: string | null; purge_after: string | null;
    }>;
    const baseGraph = collectReferences(this.db, this.root, { now: this.now(), postPublishDays: this.settings().postPublishDays }, this.artifacts);
    const referenced = (sha: string) => this.isReferencedInGraph(baseGraph, sha);
    // One DB-only index for the whole sweep. refresh() runs only inside a write transaction or synchronously
    // inside one, never across an await, so a reference committed during provider I/O is still seen.
    const index = new DbReferenceIndex(this.db, this.root, { now: this.now(), postPublishDays: this.settings().postPublishDays }, this.artifacts);
    // Refresh, write, then acknowledge: the sweep's own blob writes must not force a rebuild per object,
    // and acknowledging after a refresh cannot hide another connection's commit.
    const ownWrite = <T>(work: () => T): T => {
      index.refresh();
      const value = work();
      index.acknowledgeOwnWrites();
      return value;
    };
    const decideReferenced = (sha: string) => {
      index.refresh();
      return index.isReferenced(artifactPath(sha) ?? null, sha);
    };
    const currentReferenced = (sha: string) => {
      if (this.isReferencedInGraph(baseGraph, sha)) return true;
      return this.db.inTransaction ? decideReferenced(sha) : this.db.transaction(() => decideReferenced(sha)).immediate();
    };
    for (const row of rows) {
      // Recovery runs even during a mark-only sweep after a crash. Dry runs
      // never mutate objects or local files.
      if (!options.dryRun && referenced(row.sha256) && await validBackup(row.sha256, row.size)) {
        try {
          await this.mutate(async () => { await restore(row.sha256, row.size, row.key); result.cleared++; });
        } catch { result.errors++; }
        continue;
      }
      const eligible = this.db.transaction(() => ownWrite(() => {
        if (this.location()?.id !== location.id || row.key !== blobKey(row.sha256)) return false;
        if (referenced(row.sha256)) {
          if (row.orphaned_at) {
            result.cleared++;
            if (!options.dryRun) this.db.prepare("UPDATE blobs SET orphaned_at=NULL,purge_after=NULL WHERE sha256=? AND location_id=?").run(row.sha256, location.id);
          }
          return false;
        }
        if (!row.orphaned_at) {
          result.marked++;
          const path = artifactPath(row.sha256);
          const grace = path && assetClass(this.root, resolve(path)) === "ephemeral" ? 1 : this.settings().graceDays;
          if (!options.dryRun) this.db.prepare("UPDATE blobs SET orphaned_at=?,purge_after=? WHERE sha256=? AND location_id=?")
            .run(at.toISOString(), new Date(at.getTime() + grace * day).toISOString(), row.sha256, location.id);
          return false;
        }
        if (!row.purge_after || row.purge_after > at.toISOString()) return false;
        result.eligible++;
        result.eligibleBytes += row.size;
        return !options.dryRun && !!options.purge;
      })).immediate();
      if (!eligible) continue;
      try {
        await this.mutate(async () => {
          if (currentReferenced(row.sha256)) return;
          const claimed = this.db.transaction(() => ownWrite(() => {
            if (this.location()?.id !== location.id) return false;
            const current = this.db.prepare("SELECT orphaned_at,purge_after FROM blobs WHERE sha256=? AND location_id=?")
              .get(row.sha256, location.id) as { orphaned_at: string | null; purge_after: string | null } | undefined;
            if (!current?.orphaned_at || !current.purge_after || current.purge_after > at.toISOString()) return false;
            // Acquire the fence inside the object-mutation queue, after any earlier PUT has finished.
            return !!this.db.prepare("UPDATE blobs SET verified_at='' WHERE sha256=? AND location_id=? AND orphaned_at=? AND purge_after=?")
              .run(row.sha256, location.id, current.orphaned_at, current.purge_after).changes;
          })).immediate();
          if (!claimed) return;
          await prepareBackup(row.sha256, row.size, row.key);
          // Downloading a recovery copy can itself take time.
          if (currentReferenced(row.sha256)) { await restore(row.sha256, row.size, row.key); result.cleared++; return; }
          await location.provider.delete(row.key);
          if (currentReferenced(row.sha256)) { await restore(row.sha256, row.size, row.key); result.cleared++; return; }
          const removed = this.db.transaction(() => ownWrite(() => {
            if (currentReferenced(row.sha256)) return false;
            const changed = this.db.prepare("DELETE FROM blobs WHERE sha256=? AND location_id=? AND verified_at=''").run(row.sha256, location.id);
            if (!changed.changes) return false;
            result.purged++;
            result.bytes += row.size;
            return true;
          })).immediate();
          if (removed) unlinkSync(backupPath(row.sha256));
          else { await restore(row.sha256, row.size, row.key); result.cleared++; }
        });
      } catch { result.errors++; }
    }
    this.db.prepare(`INSERT INTO file_gc_runs(id,started_at,duration_ms,dry_run,marked,cleared,purged,bytes,error)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), at.toISOString(), Date.now() - started, options.dryRun ? 1 : 0,
        result.marked, result.cleared, result.purged, result.bytes, result.errors ? `${result.errors} lỗi khi dọn S3` : null);
    return result;
  }

  run(options: { dryRun?: boolean; purge?: boolean; ephemeralOnly?: boolean; projectId?: string } = {}): GcReport {
    const startedAt = this.now();
    const started = Date.now();
    const settings = this.settings();
    const result = emptyReport();
    const entries = this.inventory(options.projectId);
    const select = this.db.prepare("SELECT path,project_owner_id,stamp,orphaned_at,purge_after FROM file_gc_marks WHERE (? IS NULL OR project_owner_id=?)");
    const put = this.db.prepare(`INSERT INTO file_gc_marks(path,project_owner_id,kind,size,stamp,orphaned_at,purge_after)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET project_owner_id=excluded.project_owner_id,kind=excluded.kind,
      size=excluded.size,stamp=excluded.stamp,orphaned_at=excluded.orphaned_at,purge_after=excluded.purge_after`);
    const clear = this.db.prepare("DELETE FROM file_gc_marks WHERE path=?");

    const graph = collectReferences(this.db, this.root, { now: startedAt, postPublishDays: settings.postPublishDays }, this.artifacts);
    const owner = options.projectId ?? null;
    const marks = new Map((select.all(owner, owner) as Mark[]).map((row) => [row.path, row]));

    const toClear: string[] = [];
    for (const mark of marks.values()) {
      if (entries.has(mark.path) && !referencesForPath(graph, mark.path, this.root).length) continue;
      result.cleared++;
      toClear.push(mark.path);
    }

    const toMark: Array<{ path: string; projectId: string; kind: "project" | "ephemeral"; size: number; stamp: string; purgeAfter: string }> = [];
    const toPurge: Array<{ file: Entry; prior: Mark }> = [];

    for (const file of entries.values()) {
      if (options.ephemeralOnly && file.kind !== "ephemeral") continue;
      if (referencesForPath(graph, file.path, this.root).length) continue;
      const prior = marks.get(file.path);
      if (!prior || prior.stamp !== file.stamp || prior.project_owner_id !== file.projectId) {
        const grace = file.kind === "ephemeral" ? 1 : settings.graceDays;
        const purgeAfter = new Date(startedAt.getTime() + grace * day).toISOString();
        result.marked++;
        toMark.push({ path: file.path, projectId: file.projectId, kind: file.kind, size: file.size, stamp: file.stamp, purgeAfter });
        continue;
      }
      if (prior.purge_after > startedAt.toISOString()) continue;
      result.eligible++;
      result.eligibleBytes += file.size;
      if (options.dryRun || !options.purge) continue;
      toPurge.push({ file, prior });
    }

    if (!options.dryRun && (toClear.length > 0 || toMark.length > 0)) {
      this.db.transaction(() => {
        for (const path of toClear) clear.run(path);
        for (const item of toMark) put.run(item.path, item.projectId, item.kind, item.size, item.stamp, startedAt.toISOString(), item.purgeAfter);
      }).immediate();
    }

    if (!options.dryRun && options.purge) {
      // Hash outside the write lock (TASK-138 fix4). registerSync caches by stat stamp, so the in-lock
      // call is a cache hit unless the file changed since; a changed file is still hashed under the lock.
      // Runs before the index warms, so its artifacts writes do not force a rebuild per candidate.
      for (const { file } of toPurge) {
        const warm = this.canonical(file.path);
        if (warm) { try { this.artifacts.registerSync(warm); } catch { /* the in-lock check re-decides */ } }
      }
      // One DB-only index per run: rebuilt inside a write transaction only when the database changed.
      const index = new DbReferenceIndex(this.db, this.root, { now: startedAt, postPublishDays: settings.postPublishDays }, this.artifacts);
      // Warm outside the lock; the in-lock refresh() rebuilds only if a commit landed since.
      index.refresh();
      for (const { file, prior } of toPurge) {
        try {
          const purged = this.db.transaction(() => {
            if (referencesForPath(graph, file.path, this.root).length > 0) return false;
            index.refresh();
            const target = this.canonical(file.path);
            if (!target || statFile(file.path)?.stamp !== prior.stamp) return false;
            let sha: string | null = null;
            try { sha = this.artifacts.registerSync(target).sha256; } catch { sha = null; }
            if (index.isReferenced(file.path, sha)) return false;
            unlinkSync(target);
            clear.run(file.path);
            index.acknowledgeOwnWrites();
            return true;
          }).immediate();
          if (purged) {
            result.purged++;
            result.bytes += file.size;
          }
        } catch (error) {
          if (!isMissing(error)) result.errors++;
        }
      }
    }

    this.db.prepare(`INSERT INTO file_gc_runs(id,started_at,duration_ms,dry_run,marked,cleared,purged,bytes,error)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), startedAt.toISOString(), Date.now() - started, options.dryRun ? 1 : 0,
        result.marked, result.cleared, result.purged, result.bytes, result.errors ? `${result.errors} lỗi khi dọn tệp` : null);
    return result;
  }
}
