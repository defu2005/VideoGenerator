import type Database from "better-sqlite3";
import type { Readable } from "node:stream";
import { realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { AppConfig } from "../lib/config.js";
import { projectDir } from "../storage/paths.js";
import { searchKnowledge } from "../retrieval/search.js";
import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import { ArtifactService } from "./artifactService.js";
import type { NodeRow } from "./nodeService.js";
import type { ProjectRunService } from "./runService.js";
import { NodeUploadStore, type OutputUpload } from "./uploadStore.js";
import { exportProjectSnapshot } from "./projectSnapshot.js";
import { RunCheckpointService, type RunCheckpoint } from "./runCheckpoint.js";
import { RunCommands } from "./runCommands.js";
import type { ProjectRun, SealedSecret } from "@vg/shared";

const filename = z.string().regex(/^files\/([a-f0-9]{64})(?:\.[a-z0-9]{1,7})?$/);
const retrieveInput = z.object({ query: z.string().trim().min(1).max(5000), kinds: z.array(z.string().max(40)).max(12).optional(), limit: z.number().int().min(1).max(20).default(8), tokenBudget: z.number().int().min(0).max(8000).default(2000) }).strict();

/** HTTP-independent transport core. Run artifacts reuse 134's upload implementation with a separate durable owner. */
export class RunTransportService {
  readonly checkpoints: RunCheckpointService;
  readonly commands: RunCommands;
  onBoundary?: (projectId: string) => void;
  onAccepted?: (run: ProjectRun) => void;
  lend?: (run: ProjectRun, scopes: string[], publicKey: string) => SealedSecret[];

  providerSecrets(node: Pick<NodeRow, "id">, runId: string, leaseId: string, scopes: string[], publicKey: string) {
    const run = this.runs.holding(node, runId, leaseId);
    return this.lend?.(run, scopes, publicKey) ?? [];
  }

  pendingFor(node: Pick<NodeRow, "id">) {
    return this.runs.pendingFor(node);
  }

  finish(node: Pick<NodeRow, "id">, runId: string, input: Parameters<ProjectRunService["finish"]>[2]) {
    const run = this.runs.finish(node, runId, input);
    if (input.reason === "BOUNDARY") this.onBoundary?.(run.projectId);
    return run;
  }
  private readonly artifacts: ArtifactService;
  private readonly uploads: NodeUploadStore;
  private readonly rates = new Map<string, { start: number; count: number }>();

  constructor(private readonly db: Database.Database, private readonly config: AppConfig, private readonly runs: ProjectRunService,
    orchestrator: PipelineOrchestrator, afterCommit: (run: ProjectRun, checkpoint: RunCheckpoint) => void,
    private readonly now: () => Date = () => new Date()) {
    this.artifacts = new ArtifactService(db, now);
    this.commands = new RunCommands(db, runs, now);
    this.uploads = new NodeUploadStore(db, this.artifacts, config.NODE_MAX_UPLOAD_MB * 1024 * 1024, now, "run");
    this.checkpoints = new RunCheckpointService(db, runs, orchestrator, config.DATA_DIR, (run, name) => {
      const file = this.uploads.ready(run.id, run.leaseId).get(name);
      if (!file) throw new AppError(409, "RUN_FILE_NOT_READY", "Tệp checkpoint chưa được tải lên đầy đủ.");
      let actual: ReturnType<ArtifactService["registerSync"]>;
      try { actual = this.artifacts.registerSync(file.path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") throw new AppError(409, "RUN_FILE_CHANGED", "Tệp checkpoint đã thay đổi hoặc ngoài phạm vi dự án.");
        throw error;
      }
      if (actual.sha256 !== file.sha256 || actual.size !== file.size || !this.insideProject(run.projectId, file.path)) throw new AppError(409, "RUN_FILE_CHANGED", "Tệp checkpoint đã thay đổi hoặc ngoài phạm vi dự án.");
      return file.path;
    }, (run, checkpoint) => {
      this.onAccepted?.(run);
      afterCommit(run, checkpoint);
    }, now);
  }

  private insideProject(projectId: string, path: string): boolean {
    try {
      const root = realpathSync.native(projectDir(this.config.DATA_DIR, projectId));
      const rel = relative(root, realpathSync.native(path));
      return rel !== ".." && !rel.startsWith("..\\") && !rel.startsWith("../") && !isAbsolute(rel);
    } catch { return false; }
  }

  snapshot(node: Pick<NodeRow, "id">, runId: string, leaseId: string) {
    const run = this.runs.holding(node, runId, leaseId);
    return exportProjectSnapshot(this.db, this.config.DATA_DIR, run.projectId);
  }

  artifact(node: Pick<NodeRow, "id">, runId: string, leaseId: string, sha256: string) {
    const snapshot = this.snapshot(node, runId, leaseId);
    if (!snapshot.files.some((file) => file.sha256 === sha256)) throw new AppError(404, "ARTIFACT_NOT_FOUND", "Tệp không thuộc snapshot của lần chạy.");
    const found = this.artifacts.locate(sha256);
    if (!found || this.artifacts.registerSync(found.path).sha256 !== sha256) throw new AppError(404, "ARTIFACT_NOT_FOUND", "Tệp đầu vào đã thay đổi.");
    return found;
  }

  private output(node: Pick<NodeRow, "id">, output: OutputUpload): ProjectRun {
    filename.parse(output.name);
    if (!output.name.startsWith(`files/${output.sha256}`)) throw new AppError(400, "RUN_FILE_INVALID", "Tên tệp không khớp SHA-256.");
    return this.runs.holding(node, output.jobId, output.leaseId);
  }

  have(node: Pick<NodeRow, "id">, runId: string, leaseId: string, files: Array<{ name: string; sha256: string; size: number }>): string[] {
    return files.filter((file) => {
      const output = { ...file, jobId: runId, leaseId }, run = this.output(node, output);
      return this.uploads.linkKnown(output, (path) => this.insideProject(run.projectId, path));
    }).map(({ name }) => name);
  }

  offset(node: Pick<NodeRow, "id">, runId: string, leaseId: string, name: string) {
    filename.parse(name); this.runs.holding(node, runId, leaseId);
    return this.uploads.offset(runId, leaseId, name);
  }

  append(node: Pick<NodeRow, "id">, output: OutputUpload, offset: number, stream: Readable) {
    const run = this.output(node, output);
    const path = join(projectDir(this.config.DATA_DIR, run.projectId), ".node-runs", run.id, run.leaseId, output.name);
    return this.uploads.append(output, path, offset, stream, () => { this.runs.holding(node, run.id, run.leaseId); });
  }

  context(node: Pick<NodeRow, "id">, runId: string, leaseId: string, kind: string, input: unknown) {
    const run = this.runs.holding(node, runId, leaseId);
    if (kind !== "retrieve") throw new AppError(404, "RUN_CONTEXT_UNKNOWN", "Loại ngữ cảnh chưa được cho phép.");
    const body = retrieveInput.parse(input), at = this.now().getTime();
    // Per-node and per-run limits prevent a newly granted run from resetting the node's budget.
    for (const key of [`node:${node.id}`, `run:${run.id}`]) {
      let rate = this.rates.get(key);
      if (!rate || at - rate.start >= 60_000) { rate = { start: at, count: 0 }; this.rates.set(key, rate); }
      if (rate.count >= 60) throw new AppError(429, "RUN_CONTEXT_RATE_LIMITED", "Đã vượt giới hạn đọc ngữ cảnh. Chờ một phút.");
      rate.count++;
    }
    if (this.rates.size > 2048) for (const [key, rate] of this.rates) if (at - rate.start >= 60_000) this.rates.delete(key);
    const project = this.db.prepare("SELECT profile_id FROM projects WHERE id=?").get(run.projectId) as { profile_id: string | null };
    if (project.profile_id && !this.db.prepare("SELECT 1 FROM profiles WHERE id=? AND workspace_id=?").get(project.profile_id, run.workspaceId)) throw new AppError(409, "RUN_CONTEXT_SCOPE", "Hồ sơ không thuộc workspace của lần chạy.");
    return searchKnowledge(this.db, { ...body, projectId: run.projectId, workspaceId: run.workspaceId, profileId: project.profile_id, mode: "text" });
  }
}
