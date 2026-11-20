import { setTimeout as delay } from "node:timers/promises";
import { copyFile, link, mkdir, mkdtemp } from "node:fs/promises";
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isGate, ProjectRunSchema, PROTECTED_PROJECT_ID, redactExportText, type PipelineStage, type ProjectRun, type StageRecord } from "@vg/shared";
import { openDatabase } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import { AppError } from "../lib/errors.js";
import { projectDir } from "../storage/paths.js";
import { StageInputVersions } from "../pipeline/inputVersion.js";
import { applyProjectSnapshotDelta, exportProjectRows, exportProjectSnapshot, importProjectSnapshot, ProjectSnapshotSchema, projectRunBaseVersion, projectSchemaHash, projectSnapshotCursor, type ProjectSnapshot, type ProjectSnapshotCursor, type ProjectSnapshotDelta } from "./projectSnapshot.js";
import type { createRunnerRuntime } from "./runnerRuntime.js";
import type { RunCheckpoint } from "./runCheckpoint.js";
import type { RunCommand } from "./runCommands.js";

type Runtime = ReturnType<typeof createRunnerRuntime>;
type StageFile = ReturnType<typeof exportProjectRows>["files"][number];

/** Install verified cache files under the run's project root, so the stock
 * storage and input version code can resolve them on every platform. */
export async function openProjectRun(input: {
  nodeDataDir: string;
  run: ProjectRun;
  snapshot: unknown;
  download: (file: ProjectSnapshot["files"][number], signal: AbortSignal) => Promise<string>;
  signal: AbortSignal;
  rebase?: boolean;
}) {
  const run = ProjectRunSchema.parse(input.run);
  const snapshot = ProjectSnapshotSchema.parse(input.snapshot);
  if (run.projectId === PROTECTED_PROJECT_ID || snapshot.projectId !== run.projectId || snapshot.schemaHash !== projectSchemaHash()) {
    throw new AppError(409, "RUN_SNAPSHOT_BASE_INVALID", "Snapshot không thuộc lần chạy này hoặc cần cập nhật node.");
  }
  const runRoot = resolve(input.nodeDataDir, "runs", run.id);
  await mkdir(runRoot, { recursive: true });
  const root = input.rebase || existsSync(join(runRoot, "db.sqlite")) ? await mkdtemp(join(runRoot, "rebase-")) : runRoot;
  const dataDir = join(root, "data");
  const paths = new Map<string, string>();
  for (const file of snapshot.files) {
    input.signal.throwIfAborted();
    const cached = await input.download(file, input.signal);
    const path = join(projectDir(dataDir, run.projectId), file.name);
    await mkdir(dirname(path), { recursive: true });
    try {
      await link(cached, path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        if (!["EXDEV", "EPERM", "ENOTSUP", "EACCES"].includes(code ?? "")) throw error;
        await copyFile(cached, path);
      }
    }
    paths.set(file.name, path);
  }
  input.signal.throwIfAborted();
  const databasePath = join(root, "db.sqlite");
  const database = openDatabase(databasePath);
  try {
    migrateDatabase(database.db);
    importProjectSnapshot(database.sqlite, snapshot, (file) => paths.get(file.name)!);
    return { ...database, dataDir, databasePath, snapshot };
  } catch (error) {
    database.sqlite.close();
    throw error;
  }
}

type OpenedRun = Awaited<ReturnType<typeof openProjectRun>>;
type WarmRun = Pick<OpenedRun, "databasePath" | "dataDir"> & { baseVersion: string; expires: number };

/** A warm DB already contains the accepted outputs. Reconcile only the fresh
 * control stage markers and project row after checking all materialized inputs. */
export class WarmProjectRuns {
  private readonly entries = new Map<string, WarmRun>();

  constructor(private readonly ttlMs = 30 * 60_000, private readonly now = Date.now) {}

  /** Run only while the project worker is idle, including after a node restart. */
  prune(nodeDataDir: string): void {
    const at = this.now();
    for (const [id, entry] of this.entries) if (entry.expires <= at) this.entries.delete(id);
    const parent = join(nodeDataDir, "runs");
    if (!existsSync(parent) || lstatSync(parent).isSymbolicLink()) return;
    const root = realpathSync(parent);
    const dataRoot = realpathSync(nodeDataDir);
    if (relative(dataRoot, root) !== "runs") return;
    for (const dir of readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.isSymbolicLink() || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(dir.name)) continue;
      const path = join(root, dir.name);
      const actual = realpathSync(path);
      if (relative(root, actual) !== dir.name || at - statSync(actual).mtimeMs < this.ttlMs) continue;
      const retained = [...this.entries.values()].some(({ databasePath }) => {
        const rel = relative(actual, databasePath);
        return rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel);
      });
      if (!retained) rmSync(actual, { recursive: true, force: true });
    }
  }

  keep(projectId: string, opened: OpenedRun): void {
    const { sqlite, dataDir, databasePath } = opened;
    try {
      const baseVersion = projectRunBaseVersion(new StageInputVersions(sqlite, dataDir), projectId);
      this.entries.set(projectId, { dataDir, databasePath, baseVersion, expires: this.now() + this.ttlMs });
    } catch {
      this.entries.delete(projectId);
    }
  }

  take(run: ProjectRun, snapshot: ProjectSnapshot): OpenedRun | undefined {
    const cached = this.entries.get(run.projectId);
    this.entries.delete(run.projectId);
    if (!cached || cached.expires <= this.now() || cached.baseVersion !== run.baseVersion
      || snapshot.projectId !== run.projectId || snapshot.schemaHash !== projectSchemaHash()) return;
    let database: ReturnType<typeof openDatabase> | undefined;
    try {
      if (!existsSync(cached.databasePath)) return;
      database = openDatabase(cached.databasePath);
      const { sqlite } = database;
      const local = exportProjectSnapshot(sqlite, cached.dataDir, run.projectId);
      const previous = projectSnapshotCursor(local);
      const incoming = projectSnapshotCursor(snapshot);
      if (previous.context !== incoming.context || previous.files !== incoming.files
        || Object.entries(incoming.tables).some(([table, hash]) => table !== "projects" && previous.tables[table] !== hash)
        || projectRunBaseVersion(new StageInputVersions(database.sqlite, cached.dataDir), run.projectId) !== run.baseVersion) {
        database.sqlite.close();
        return;
      }
      const row = snapshot.tables.projects?.[0];
      if (!row) { database.sqlite.close(); return; }
      sqlite.transaction(() => {
        sqlite.prepare("DELETE FROM jobs WHERE project_id=?").run(run.projectId);
        sqlite.prepare("UPDATE projects SET status=?,stage=?,run_mode=?,settings=?,updated_at=?,version=? WHERE id=?")
          .run(row.status, row.stage, row.run_mode, row.settings, row.updated_at, row.version, run.projectId);
        const stage = sqlite.prepare("UPDATE project_stages SET state=?,input_version=?,updated_at=?,progress=?,message=NULL,error=NULL,job_id=NULL WHERE project_id=? AND stage=?");
        for (const item of snapshot.stages) stage.run(item.state, item.inputVersion, item.updatedAt, item.state === "DONE" ? 100 : 0, run.projectId, item.stage);
      }).immediate();
      return { ...database, databasePath: cached.databasePath, dataDir: cached.dataDir, snapshot };
    } catch {
      if (database?.sqlite.open) database.sqlite.close();
      return;
    }
  }
}

export type SegmentResult = {
  reason: "DONE" | "BOUNDARY" | "BUDGET" | "FAILED" | "CANCELLED";
  lastSeq: number;
  costUsd: number;
  blockedGate?: PipelineStage;
};

type FinishReason = Exclude<SegmentResult["reason"], "CANCELLED"> | "PAUSED";

export type ProjectRunnerTransport = {
  snapshot(signal: AbortSignal): Promise<ProjectSnapshot>;
  download: Parameters<typeof openProjectRun>[0]["download"];
  commands(after: number, signal: AbortSignal): Promise<RunCommand[]>;
  checkpoint(checkpoint: RunCheckpoint, files: StageFile[], signal: AbortSignal): Promise<void>;
  finish(reason: FinishReason, lastSeq: number, signal: AbortSignal, blockedGate?: PipelineStage): Promise<void>;
};

/** Drive the lease using the same runtime on each snapshot generation. Only
 * acknowledgements advance the sequence saved for the next generation. */
export async function runProjectLease(input: {
  nodeDataDir: string;
  run: ProjectRun;
  transport: ProjectRunnerTransport;
  signal: AbortSignal;
  warm?: WarmProjectRuns;
  buildRuntime(opened: Awaited<ReturnType<typeof openProjectRun>>, stopBefore: ProjectRun["stopBefore"], signal: AbortSignal): Runtime;
}): Promise<void> {
  const { run, transport, signal } = input;
  const commandAbort = new AbortController();
  const sessionSignal = AbortSignal.any([signal, commandAbort.signal]);
  let epoch = new AbortController();
  let budget = run.budgetCapUsd;
  let stopBefore = run.stopBefore;
  let lastSeq = run.lastSeq;
  let spent = 0;
  let cursor = 0;
  let requested: "PAUSED" | "CANCELLED" | "REBASE" | undefined;
  let commandError: unknown;
  const poll = async () => {
    while (!sessionSignal.aborted) {
      const commands = await transport.commands(cursor, sessionSignal);
      for (const command of commands) {
        if (command.sequence <= cursor) continue;
        cursor = command.sequence;
        if (command.kind === "budget") { budget = command.capUsd; continue; }
        if (command.kind === "stopBefore") stopBefore = command.stages;
        requested = command.kind === "cancel" ? "CANCELLED" : command.kind === "pause" ? "PAUSED" : "REBASE";
        epoch.abort();
        if (requested !== "REBASE") return;
      }
    }
  };
  const polling = poll().catch((error: unknown) => {
    if (sessionSignal.aborted) return;
    if (error instanceof AppError && error.code === "LEASE_STALE") requested = "CANCELLED";
    else commandError = error;
    epoch.abort();
  });
  try {
    let snapshot = await transport.snapshot(signal);
    let rebase = false;
    while (!signal.aborted) {
      if (commandError) throw commandError;
      if (requested === "CANCELLED") return;
      if (requested === "PAUSED") { await transport.finish("PAUSED", lastSeq, signal); return; }
      if (requested === "REBASE") {
        requested = undefined;
        epoch = new AbortController();
        snapshot = await transport.snapshot(signal);
        rebase = true;
      }
      const generationSignal = AbortSignal.any([signal, epoch.signal]);
      let opened: Awaited<ReturnType<typeof openProjectRun>> | undefined;
      try {
        opened = (!rebase ? input.warm?.take(run, snapshot) : undefined)
          ?? await openProjectRun({ ...input, snapshot, download: transport.download, signal: generationSignal, rebase });
        const previousSpend = spent;
        const result = await executeProjectSegment({
          runtime: input.buildRuntime(opened, stopBefore, generationSignal), run: { ...run, lastSeq, stopBefore }, dataDir: opened.dataDir,
          cursor: projectSnapshotCursor(snapshot), signal: generationSignal,
          budgetCapUsd: () => Math.max(0, budget - previousSpend),
          send: async (checkpoint, files) => {
            await transport.checkpoint(checkpoint, files, generationSignal);
            lastSeq = checkpoint.seq;
            spent += checkpoint.costs.reduce((total, cost) => total + cost.amountUsd, 0);
          },
        });
        if (generationSignal.aborted) continue;
        if (result.reason !== "CANCELLED") await transport.finish(result.reason, result.lastSeq, signal, result.blockedGate);
        if (result.reason === "BOUNDARY") input.warm?.keep(run.projectId, opened);
        return;
      } catch (error) {
        if (generationSignal.aborted) continue;
        if (!(error instanceof AppError) || error.code !== "RUN_REBASE") throw error;
        const { delta } = error.details as { delta: ProjectSnapshotDelta };
        snapshot = applyProjectSnapshotDelta(snapshot, delta);
        rebase = true;
        epoch = new AbortController();
      } finally {
        opened?.sqlite.close();
      }
    }
  } finally {
    commandAbort.abort();
    await polling;
  }
}

/** Execute one imported snapshot. A caller can open a fresh runtime when control asks for a rebase. */
export async function executeProjectSegment(input: {
  runtime: Runtime;
  run: ProjectRun;
  dataDir: string;
  cursor: ProjectSnapshotCursor;
  signal: AbortSignal;
  send: (checkpoint: RunCheckpoint, files: StageFile[]) => Promise<void>;
  budgetCapUsd?: () => number;
  now?: () => Date;
}): Promise<SegmentResult> {
  const { runtime, run, signal } = input;
  const now = input.now ?? (() => new Date());
  const records: StageRecord[] = [];
  let lastSeq = run.lastSeq;
  let costUsd = 0;
  const stop = () => {
    for (const job of runtime.repository.getActiveJobs(run.projectId)) runtime.worker.abort(job.id);
  };
  const unsubscribe = runtime.events.subscribe(run.projectId, (event) => {
    if (event.type === "stage.updated" && ["DONE", "SKIPPED", "FAILED"].includes(event.data.state)) records.push(event.data);
  });
  const result = (reason: SegmentResult["reason"]): SegmentResult => ({ reason, lastSeq, costUsd });
  signal.addEventListener("abort", stop, { once: true });
  try {
    if (signal.aborted) return result("CANCELLED");
    runtime.orchestrator.runAll(run.projectId);
    while (!signal.aborted) {
      for (const record of records.splice(0)) {
        const job = record.jobId ? runtime.repository.getJob(record.jobId) : undefined;
        const usage = job?.usage;
        const costs: RunCheckpoint["costs"] = usage?.costUsd ? [{
          kind: record.stage === "VOICE" ? "tts" : "llm",
          provider: usage.provider ?? "unknown",
          amountUsd: usage.costUsd,
        }] : [];
        const settings = runtime.repository.getProject(run.projectId)?.settings;
        const state = record.state as RunCheckpoint["state"];
        const { tables, files } = state === "DONE" ? exportProjectRows(runtime.repository.sqlite, input.dataDir, run.projectId, record.stage)
          : { tables: {}, files: [] };
        const inputVersion = record.inputVersion ?? job?.inputVersion ?? runtime.orchestrator.inputVersions.inputVersion(run.projectId, record.stage);
        await input.send({
          leaseId: run.leaseId, seq: lastSeq + 1, stage: record.stage, inputVersion, tables, costs,
          snapshotCursor: input.cursor, state, summary: redactExportText(record.message ?? "").slice(0, 500),
          ...(record.error ? { error: { ...record.error, message: redactExportText(record.error.message).slice(0, 500) } } : {}),
          ...(state === "DONE" && record.stage === "SCRIPT" && settings ? {
            projectSettings: { format: settings.format, formatReason: settings.formatReason, treatment: settings.treatment },
          } : {}),
        }, files);
        lastSeq++;
        costUsd += costs.reduce((sum, cost) => sum + cost.amountUsd, 0);
        if (signal.aborted) return result("CANCELLED");
      }
      const stages = runtime.repository.getStages(run.projectId);
      if (stages.some(({ state }) => state === "FAILED")) return result("FAILED");
      if (stages.every(({ state }) => state === "DONE" || state === "SKIPPED")) return result("DONE");
      if (costUsd >= (input.budgetCapUsd?.() ?? run.budgetCapUsd)) return result("BUDGET");
      const pending = runtime.repository.getActiveJobs(run.projectId).filter((job) => runtime.mayRun(job.stage));
      if (!pending.length) {
        const gate = stages.find(({ stage, state }) => state === "WAITING_USER" && isGate(stage));
        return { ...result("BOUNDARY"), ...(gate ? { blockedGate: gate.stage } : {}) };
      }
      await runtime.worker.tick();
      if (!records.length) {
        const waitMs = Math.max(10, Math.min(1000, ...pending.map((job) => Date.parse(job.runAfter) - now().getTime())));
        await delay(waitMs, undefined, { signal }).catch((error: unknown) => { if (!signal.aborted) throw error; });
      }
    }
    return result("CANCELLED");
  } finally {
    signal.removeEventListener("abort", stop);
    unsubscribe();
    await runtime.worker.stop();
  }
}
