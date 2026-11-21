import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  ExecuteReportSchema,
  MediaReportSchema,
  NODE_MEDIA_OUTPUT_NAME,
  NODE_OUTPUT_NAME,
  NODE_VOICE_OUTPUT_NAME,
  PROTECTED_PROJECT_ID,
  VoiceResultSchema,
  parseRenderJobScope,
  type ArtifactRef,
  type AspectRatio,
  type Job,
  type JobError,
  type LeaseResponse,
  type NodeCompleteRequest,
  type Project,
  type Render,
  type SealedSecret,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import type { StageContext } from "../pipeline/stageExecutor.js";
import type { PreparedRender } from "../render/types.js";
import type { RemoteVoiceScene, VoiceExecutor } from "../stages/voice/voiceExecutor.js";
import { ttsCatalogEntry } from "@vg/shared";
import { jobErrorFromCaught } from "../jobs/worker.js";
import { readDrain } from "../operator/autopilot.js";
import { sha256File, type ArtifactService } from "./artifactService.js";
import type { LeaseSecretService } from "./leaseSecrets.js";
import { MediaFetchService, parseMediaScope } from "./mediaFetch.js";
import { buildRemoteBundle, buildTtsBundle, mediaTargetName, RemoteBundleError } from "./remoteBundle.js";
import type { NodeRow, NodeService } from "./nodeService.js";
import { NodeUploadStore, type OutputUpload, type StoredUpload } from "./uploadStore.js";
import { projectDir } from "../storage/paths.js";
import type { BlobStore } from "../storage/blobStore.js";
import { recordStorageHealth } from "../storage/health.js";
import { getRemoteStagesSettings } from "./settings.js";
import { isBoxPublicKey } from "./secretBox.js";
import { defaultWorkspaceId } from "../auth/workspaces.js";

/** The slice of RenderService the lease flow needs. Small so tests can mock it. */
export type RenderPort = {
  renderDir(projectId: string): string;
  versionDir(projectId: string, renderId: string): string;
  prepare(project: Project, signal: AbortSignal, onProgress?: (pct: number, message: string) => void, options?: { aspectRatio?: AspectRatio }): Promise<
    | { reused: { render: Render; reused: true }; prepared?: undefined }
    | { reused?: undefined; prepared: PreparedRender & { local: { resolvePath: (path: string) => string } } }
  >;
  finalize(
    project: Project,
    prepared: PreparedRender,
    outputPath: string,
    executed: ReturnType<typeof ExecuteReportSchema.parse>,
    signal: AbortSignal,
  ): Promise<{ render: Render; reused: boolean }>;
};

export type AfterRender = (
  project: Project,
  signal: AbortSignal,
  aspectRatio: ReturnType<typeof parseRenderJobScope> | undefined,
  render: Render,
  reused: boolean,
) => Promise<{ message: string }>;

/** TASK-120: what the lease flow needs for VOICE and MEDIA_FETCH. Absent in older tests: then only RENDER is leased. */
export type RemoteStageDeps = {
  secrets: LeaseSecretService;
  voice: Pick<VoiceExecutor, "collectWork" | "runWithRemote">;
  /** Which provider a project's voice would use. Sync, no network. */
  planProvider: (project: Project) => string;
  media: MediaFetchService;
};

type RenderPending = { kind?: "render"; prepared: PreparedRender; files: ArtifactRef[] };
type VoicePending = { kind: "voice"; provider: string; scenes: Array<{ sceneId: string; hash: string }>; files: ArtifactRef[] };
type MediaPending = { kind: "media"; targets: string[]; files: ArtifactRef[] };
type Pending = (RenderPending | VoicePending | MediaPending) & { directCompletion?: NodeCompleteRequest };
type UploadRecord = { name: string; sha256: string; size: number; path: string };

function stale(): AppError {
  return new AppError(409, "LEASE_STALE", "Lease không còn hiệu lực (job đã giao lại hoặc bị hủy).");
}

const ANY_OUTPUT = [NODE_OUTPUT_NAME, NODE_VOICE_OUTPUT_NAME, NODE_MEDIA_OUTPUT_NAME];

function outputNameOk(kind: Pending["kind"], name: string): boolean {
  if (kind === "voice") return NODE_VOICE_OUTPUT_NAME.test(name);
  if (kind === "media") return NODE_MEDIA_OUTPUT_NAME.test(name);
  return NODE_OUTPUT_NAME.test(name);
}

/** Does a key have to travel to the node for this provider? Only the HTTP providers use one. */
export function providerNeedsKey(providerId: string): boolean {
  return ttsCatalogEntry(providerId)?.kind === "http";
}

export class LeaseService {
  private readonly uploads: NodeUploadStore;
  private readonly finalizing = new Set<string>();
  private diskBlocks: (stage: Job["stage"]) => boolean = () => false;

  setDiskGuard(guard: (stage: Job["stage"]) => boolean): void {
    this.diskBlocks = guard;
  }

  constructor(
    private readonly sqlite: import("better-sqlite3").Database,
    private readonly config: AppConfig,
    private readonly repository: JobRepository,
    private readonly orchestrator: PipelineOrchestrator,
    private readonly nodes: NodeService,
    private readonly renders: RenderPort,
    private readonly artifacts: ArtifactService,
    private readonly after: AfterRender,
    private readonly now: () => Date = () => new Date(),
    private readonly logger?: { warn: (obj: unknown, msg?: string) => void },
    private readonly remote?: RemoteStageDeps,
    private readonly blobs?: BlobStore,
  ) {
    this.uploads = new NodeUploadStore(sqlite, artifacts, config.NODE_MAX_UPLOAD_MB * 1024 * 1024, this.now);
    nodes.onReleased = (jobId) => this.discard(jobId, "released");
    nodes.onCancelled = (_jobId, leaseId) => this.remote?.secrets.revokeLease(leaseId, "cancelled");
  }

  private pendingPath(projectId: string, jobId: string): string {
    return join(this.renders.renderDir(projectId), "pending", `${jobId}.json`);
  }

  private uploadsDir(projectId: string, jobId: string): string {
    return join(this.renders.renderDir(projectId), "pending", `${jobId}.uploads`);
  }

  /** Forget the pending bundle and take back keys. The terminal upload sweep handles file retention. */
  discard(jobId: string, reason = "released"): void {
    try {
      this.remote?.secrets.revokeJob(jobId, reason);
    } catch {
      /* best effort */
    }
    try {
      const job = this.repository.getJob(jobId);
      if (!job) return;
      rmSync(this.pendingPath(job.projectId, jobId), { force: true });
    } catch {
      /* best effort */
    }
  }

  /** The jobs a node could take now: queued jobs of one stage, in queue order. `accept` narrows further (capability, key). */
  private candidates(stage: "RENDER" | "VOICE" | "MEDIA_FETCH", accept: (job: Job) => boolean = () => true): Job[] {
    const now = this.now();
    const skipped = new Set<string>();
    const out: Job[] = [];
    for (let i = 0; i < 20; i += 1) {
      const job = this.repository.getNextQueuedJob(now, (candidate) =>
        !skipped.has(candidate.id)
        && candidate.stage === stage
        && candidate.projectId !== PROTECTED_PROJECT_ID
        && accept(candidate)
        && this.orchestrator.canStartQueuedJob(candidate, now));
      if (!job) break;
      skipped.add(job.id);
      out.push(job);
    }
    return out;
  }

  /** Give the node a job it can do, or undefined when there is nothing. RENDER first, then VOICE, then MEDIA_FETCH. */
  async lease(node: NodeRow, freeSlots: number, publicKey?: string, storageUrls = false): Promise<LeaseResponse | undefined> {
    const allowed = (job: Job) => this.nodeMayAccessProject(node.id, job.projectId);
    const desired = this.nodes.desiredOf(node);
    if (freeSlots < 1 || desired.drain) return undefined;
    if (node.status === "version_mismatch" || node.status === "offline") return undefined;
    if (this.nodes.runningCount(node.id) >= desired.concurrency) return undefined;
    if (readDrain(this.sqlite).draining) return undefined;
    if (!this.diskBlocks("RENDER") && desired.capabilities.includes("render") && !this.nodes.renderProbeFailed(node)) {
      for (const candidate of this.candidates("RENDER", allowed)) {
        const claimed = this.orchestrator.startJob(candidate.id);
        if (!claimed) continue;
        try {
          const response = await this.prepareLease(node, claimed, storageUrls);
          if (response) return this.withStorageUpload(response, claimed.projectId, storageUrls);
        } catch (error) {
          this.orchestrator.failJob(claimed.id, errorToJob(error));
        }
      }
    }
    const remote = this.remote;
    if (!remote) return undefined;
    const modes = getRemoteStagesSettings(this.sqlite);
    if (modes.VOICE !== "off" && desired.capabilities.some((item) => item.startsWith("tts:"))) {
      const usable = (job: Job): boolean => allowed(job) && this.voiceJobFits(remote, desired.capabilities, publicKey, job);
      for (const candidate of this.candidates("VOICE", usable)) {
        const claimed = this.orchestrator.startJob(candidate.id);
        if (!claimed) continue;
        try {
          const response = await this.prepareVoiceLease(remote, node, claimed, publicKey);
          if (response) return this.withStorageUpload(response, claimed.projectId, storageUrls);
        } catch (error) {
          this.orchestrator.failJob(claimed.id, errorToJob(error));
        }
      }
    }
    if (!this.diskBlocks("MEDIA_FETCH") && modes.MEDIA_FETCH !== "off" && desired.capabilities.includes("media_fetch")) {
      for (const candidate of this.candidates("MEDIA_FETCH", (job) => allowed(job) && job.attempt <= 1)) {
        const claimed = this.orchestrator.startJob(candidate.id);
        if (!claimed) continue;
        try {
          const response = this.prepareMediaLease(remote, node, claimed);
          if (response) return this.withStorageUpload(response, claimed.projectId, storageUrls);
        } catch (error) {
          this.orchestrator.failJob(claimed.id, errorToJob(error));
        }
      }
    }
    return undefined;
  }

  private withStorageUpload(response: LeaseResponse, projectId: string, compatible: boolean): LeaseResponse {
    return compatible && this.blobs?.supportsDirect(projectId) ? { ...response, storageUpload: true } : response;
  }

  /** A VOICE job fits a node when the node declares the planned provider and, for a keyed one, the key may be sent to it. */
  private voiceJobFits(remote: RemoteStageDeps, capabilities: string[], publicKey: string | undefined, job: Job): boolean {
    if (job.attempt > 1) return false; // a retry after a remote failure runs on the main machine
    const project = this.repository.getProject(job.projectId);
    if (!project) return false;
    const provider = remote.planProvider(project);
    if (!capabilities.includes(`tts:${provider}`)) return false;
    if (!providerNeedsKey(provider)) return true;
    return Boolean(publicKey && isBoxPublicKey(publicKey)) && remote.secrets.blockedReason(provider) === null;
  }

  private grantLease(node: NodeRow, job: Job, at: Date): { leaseId: string; leaseUntil: string } {
    return { leaseId: randomUUID(), leaseUntil: new Date(at.getTime() + this.config.NODE_LEASE_SEC * 1000).toISOString() };
  }

  private writePending(job: Job, pending: Pending): void {
    const path = this.pendingPath(job.projectId, job.id);
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify(pending));
      renameSync(temp, path);
    } finally {
      rmSync(temp, { force: true });
    }
  }

  private async prepareVoiceLease(remote: RemoteStageDeps, node: NodeRow, job: Job, publicKey: string | undefined): Promise<LeaseResponse | undefined> {
    const project = this.repository.getProject(job.projectId);
    if (!project) {
      this.orchestrator.failJob(job.id, { code: "PROJECT_NOT_FOUND", message: "Dự án đã bị xóa trước khi tạo giọng.", retryable: false });
      return undefined;
    }
    const work = await remote.voice.collectWork(project, this.quietLogger());
    if (work.scenes.length === 0) {
      // Nothing to synthesize: finish here, no node needed.
      const done = await remote.voice.runWithRemote(this.contextFor(project, job, new AbortController().signal), new Map());
      this.orchestrator.completeJob(job.id, done.message);
      return undefined;
    }
    const current = this.repository.getJob(job.id);
    if (!current || current.status !== "RUNNING") return undefined;
    const at = this.now();
    const { leaseId, leaseUntil } = this.grantLease(node, job, at);
    let secret: SealedSecret | null = null;
    if (providerNeedsKey(work.provider)) {
      secret = remote.secrets.grant({ node, leaseId, jobId: job.id, stage: "VOICE", providerId: work.provider, nodePublicKey: publicKey });
      if (!secret) {
        this.orchestrator.failJob(job.id, { code: "NODE_SECRET_UNAVAILABLE", message: "Không gửi được khoá TTS cho node, bước tạo giọng chạy lại trên máy chính.", retryable: true });
        return undefined;
      }
    }
    const bundle = buildTtsBundle({
      provider: work.provider,
      voice: work.voice,
      rate: work.rate,
      ...(work.model ? { model: work.model } : {}),
      ...(work.style ? { style: work.style } : {}),
      language: work.language,
      wordTimings: work.wordTimings,
      scenes: work.scenes,
    });
    this.writePending(job, { kind: "voice", provider: work.provider, scenes: work.scenes.map((scene) => ({ sceneId: scene.sceneId, hash: scene.hash })), files: [] });
    this.repository.setJobLease(job.id, { nodeId: node.id, leaseId, leaseUntil, heartbeatAt: at.toISOString() });
    this.orchestrator.reportProgress(job.id, 5, `Đang tạo giọng trên máy ${node.name}`);
    return { jobId: job.id, leaseId, leaseUntil, stage: "VOICE", bundle, manifest: [], ...(secret ? { secret } : {}) };
  }

  private prepareMediaLease(remote: RemoteStageDeps, node: NodeRow, job: Job): LeaseResponse | undefined {
    const scope = parseMediaScope(job.scope);
    if (!scope) {
      this.orchestrator.failJob(job.id, { code: "MEDIA_SCOPE_INVALID", message: "Job tải clip thiếu danh sách clip.", retryable: false });
      return undefined;
    }
    const needed = remote.media.missing(scope);
    if (needed.length === 0) {
      this.orchestrator.completeJob(job.id, "Mọi clip đã có trong kho.");
      return undefined;
    }
    const bundle = remote.media.bundleFor({ ...scope, items: needed });
    const at = this.now();
    const { leaseId, leaseUntil } = this.grantLease(node, job, at);
    this.writePending(job, { kind: "media", targets: needed.map((item) => mediaTargetName(item)), files: [] });
    this.repository.setJobLease(job.id, { nodeId: node.id, leaseId, leaseUntil, heartbeatAt: at.toISOString() });
    this.orchestrator.reportProgress(job.id, 5, `Đang tải clip trên máy ${node.name}`);
    return { jobId: job.id, leaseId, leaseUntil, stage: "MEDIA_FETCH", bundle, manifest: [] };
  }

  private quietLogger(): StageContext["logger"] {
    const warn = (obj: unknown, msg?: string) => this.logger?.warn(obj, msg);
    return { warn, info: () => undefined, error: warn, debug: () => undefined } as unknown as StageContext["logger"];
  }

  private contextFor(project: Project, job: Job, signal: AbortSignal): StageContext {
    return {
      project,
      job,
      signal,
      reportProgress: (pct, message) => this.orchestrator.reportProgress(job.id, pct, message),
      recordUsage: (usage) => this.orchestrator.recordUsage(job.id, usage),
      logger: this.quietLogger(),
    };
  }

  private async prepareLease(node: NodeRow, job: Job, storageUrls: boolean): Promise<LeaseResponse | undefined> {
    const project = this.repository.getProject(job.projectId);
    if (!project) {
      this.orchestrator.failJob(job.id, { code: "PROJECT_NOT_FOUND", message: "Dự án đã bị xóa trước khi dựng.", retryable: false });
      return undefined;
    }
    const aspectRatio = parseRenderJobScope(job.scope) ?? undefined;
    const controller = new AbortController();
    const prepared = await this.renders.prepare(project, controller.signal, () => undefined, aspectRatio ? { aspectRatio } : undefined);
    if (prepared.reused) {
      const done = await this.after(project, controller.signal, aspectRatio, prepared.reused.render, true);
      this.orchestrator.completeJob(job.id, done.message, prepared.reused.render.id);
      return undefined;
    }
    const { local, ...plain } = prepared.prepared;
    const blobStore = this.blobs;
    const inputs: Array<{ path: string; sha256: string; size: number }> = [];
    const remote = await buildRemoteBundle(plain.bundle, local.resolvePath, this.artifacts, (input) => inputs.push(input)).catch((error: unknown) => {
      if (error instanceof RemoteBundleError) {
        throw new AppError(500, "NODE_BUNDLE_FAILED", `Không đóng gói được dữ liệu cho máy worker: ${error.message}`);
      }
      throw error;
    });
    const manifest = !storageUrls ? remote.files : await Promise.all(remote.files.map(async (file) => {
      const preferredUrl = await blobStore?.preferredUrl(job.projectId, file.sha256, file.size, this.config.NODE_LEASE_SEC + 300).catch(() => null);
      const fallbackUrl = `/api/nodes/agent/artifacts/${file.sha256}?jobId=${encodeURIComponent(job.id)}`;
      return { ...file, artifactUrls: { ...(preferredUrl ? { preferredUrl } : {}), fallbackUrl } };
    }));
    const current = this.repository.getJob(job.id);
    if (!current || current.status !== "RUNNING") return undefined;
    const leaseId = randomUUID();
    const at = this.now();
    const leaseUntil = new Date(at.getTime() + this.config.NODE_LEASE_SEC * 1000).toISOString();
    const pending: Pending = { prepared: plain as PreparedRender, files: remote.files };
    this.writePending(job, pending);
    this.repository.setJobLease(job.id, { nodeId: node.id, leaseId, leaseUntil, heartbeatAt: at.toISOString() });
    for (const input of inputs) {
      void Promise.resolve().then(() => blobStore?.mirror(job.projectId, input)).catch(() => undefined);
    }
    this.orchestrator.reportProgress(job.id, 5, `Đang dựng trên máy ${node.name}`);
    return { jobId: job.id, leaseId, leaseUntil, stage: "RENDER", bundle: remote.bundle, manifest };
  }

  /** Check a request really holds the job's current lease. */
  private nodeMayAccessProject(nodeId: string, projectId: string, finalizing = false): boolean {
    const node = this.sqlite.prepare(`SELECT workspace_id FROM nodes WHERE id=?${finalizing ? "" : " AND revoked_at IS NULL"}`).get(nodeId) as { workspace_id: string | null } | undefined;
    const project = this.sqlite.prepare("SELECT workspace_id FROM projects WHERE id=?").get(projectId) as { workspace_id: string | null } | undefined;
    // A persisted finalize claim is control's recovery work; its authorization was
    // checked before the claim. Revocation or a later move must not strand it.
    return !!node && !!project && (finalizing || !node.workspace_id || node.workspace_id === (project.workspace_id ?? defaultWorkspaceId(this.sqlite)));
  }

  private holding(node: { id: string }, jobId: string, leaseId: string | undefined, mode: "live" | "finalizing" | "secret-grace" = "live"): { job: Job } {
    const job = this.repository.getJob(jobId);
    const lease = this.repository.getJobLease(jobId);
    if (!job || job.status !== "RUNNING" || !lease || lease.nodeId !== node.id || !leaseId || lease.leaseId !== leaseId
      || !this.nodeMayAccessProject(node.id, job.projectId, mode === "finalizing")) throw stale();
    const row = this.sqlite.prepare("SELECT finalizing_at FROM jobs WHERE id=?").get(jobId) as { finalizing_at: string | null };
    if (mode === "finalizing" ? !row.finalizing_at : !!row.finalizing_at || (mode === "live" && lease.leaseUntil <= this.now().toISOString())) throw stale();
    return { job };
  }

  private claimFinalization(nodeId: string, jobId: string, leaseId: string, recovery: boolean) {
    if (recovery) { this.holding({ id: nodeId }, jobId, leaseId, "finalizing"); return; }
    const now = this.now().toISOString();
    const changed = this.sqlite.prepare(`UPDATE jobs SET finalizing_at=? WHERE id=? AND status='RUNNING'
      AND node_id=? AND lease_id=? AND lease_until>? AND finalizing_at IS NULL`).run(now, jobId, nodeId, leaseId, now);
    if (!changed.changes) throw stale();
  }

  async recoverFinalizing(): Promise<void> {
    const rows = this.sqlite.prepare(`SELECT id,node_id,lease_id FROM jobs WHERE status='RUNNING' AND finalizing_at IS NOT NULL
      AND node_id IS NOT NULL AND lease_id IS NOT NULL`).all() as Array<{ id: string; node_id: string; lease_id: string }>;
    for (const row of rows) {
      if (this.finalizing.has(row.id)) continue;
      try {
        const node = { id: row.node_id };
        const { job } = this.holding(node, row.id, row.lease_id, "finalizing");
        const pending = this.readPending(job);
        const outputs = [...this.uploads.ready(row.id, row.lease_id).values()].map(({ name, sha256 }) => ({ name, sha256 }));
        const body = pending.directCompletion?.leaseId === row.lease_id ? pending.directCompletion : { leaseId: row.lease_id, outputs };
        await this.finalize(node, row.id, body, true);
      }
      catch (error) { this.logger?.warn({ jobId: row.id, err: error }, "recover node finalize failed"); }
    }
  }

  cleanupFinishedUploads(): void {
    const cutoff = new Date(this.now().getTime() - 86_400_000).toISOString();
    const rows = this.sqlite.prepare(`SELECT u.job_id,u.lease_id,u.name,u.path,u.status,j.project_id FROM node_uploads u JOIN jobs j ON j.id=u.job_id
      WHERE j.status IN ('SUCCEEDED','FAILED','CANCELLED') AND j.finished_at<=? AND j.finalizing_at IS NULL LIMIT 1000`)
      .all(cutoff) as Array<{ job_id: string; lease_id: string; name: string; path: string; status: string; project_id: string }>;
    for (const row of rows) {
      if (row.status !== "linked" && /^[a-f0-9-]{36}$/i.test(row.lease_id) && ANY_OUTPUT.some((pattern) => pattern.test(row.name))) {
        const expected = join(this.uploadsDir(row.project_id, row.job_id), row.lease_id, row.name.replaceAll("/", "__"));
        if (expected !== row.path) continue;
        // TASK-166: a file that an unfinished job still links stays, with its row, so a later pass can reclaim it.
        if (this.linkedByUnfinishedJob(expected)) continue;
        try { rmSync(expected, { force: true }); } catch { continue; }
      }
      this.sqlite.prepare("DELETE FROM node_uploads WHERE job_id=? AND lease_id=? AND name=?").run(row.job_id, row.lease_id, row.name);
    }
  }

  /** True when a linked row of a job that has not finished points at this file. Matches both path forms: the owner row stores the joined path, the linked row stores the realpath (uploadStore.ts:54, references.ts:170). */
  private linkedByUnfinishedJob(file: string): boolean {
    const paths = new Set([file]);
    try { paths.add(realpathSync.native(file)); } catch { /* file already gone: the joined path is enough */ }
    const list = [...paths];
    const marks = list.map(() => "?").join(",");
    const hit = this.sqlite.prepare(`SELECT 1 FROM node_uploads u JOIN jobs j ON j.id=u.job_id
      WHERE u.status='linked' AND u.path IN (${marks}) AND j.status NOT IN ('SUCCEEDED','FAILED','CANCELLED') LIMIT 1`).get(...list);
    return hit !== undefined;
  }

  /**
   * The node lost its in-memory key (it restarted its process) and asks again with a fresh public key.
   * 410 when the key expired or was revoked; 409 when the lease is no longer this node's; never a longer expiry.
   */
  refetchSecret(node: NodeRow, jobId: string, leaseId: string | undefined, publicKey: string | undefined): SealedSecret {
    const secrets = this.remote?.secrets;
    if (!secrets) throw new AppError(404, "SECRET_NOT_FOUND", "Không có khoá cho lease này.");
    if (leaseId && secrets.isGone(jobId, leaseId, node.id)) throw new AppError(410, "SECRET_GONE", "Khoá đã hết hạn hoặc đã bị thu hồi.");
    this.holding(node, jobId, leaseId, "secret-grace");
    return secrets.regrant(node, jobId, leaseId!, publicKey);
  }

  private readPending(job: Job): Pending {
    const path = this.pendingPath(job.projectId, job.id);
    if (!existsSync(path)) throw stale();
    return JSON.parse(readFileSync(path, "utf8")) as Pending;
  }

  private uploadJob(node: NodeRow, jobId: string, leaseId: string | undefined, name: string) {
    const { job } = this.holding(node, jobId, leaseId);
    if (!outputNameOk(this.readPending(job).kind, name)) throw new AppError(400, "OUTPUT_NAME_REFUSED", "Tên tệp kết quả không được phép.");
    return job;
  }

  private outputPath(job: Job, leaseId: string, name: string): string {
    return join(this.uploadsDir(job.projectId, job.id), leaseId, name.replaceAll("/", "__"));
  }

  async outputTarget(node: NodeRow, output: OutputUpload) {
    const job = this.uploadJob(node, output.jobId, output.leaseId, output.name);
    if (!this.blobs || output.size > this.config.NODE_MAX_UPLOAD_MB * 1024 * 1024) return null;
    const until = Date.parse(this.repository.getJobLease(job.id)?.leaseUntil ?? "");
    const seconds = Math.ceil((until - this.now().getTime()) / 1000);
    if (!Number.isFinite(seconds) || seconds < 1) throw stale();
    return this.blobs.outputTarget(job.projectId, output, Math.min(seconds, 604800));
  }

  async uploadOffset(node: NodeRow, jobId: string, leaseId: string | undefined, name: string) {
    this.uploadJob(node, jobId, leaseId, name);
    return this.uploads.offset(jobId, leaseId!, name);
  }

  async appendOutput(node: NodeRow, output: OutputUpload, offset: number, body: Readable): Promise<StoredUpload> {
    const job = this.uploadJob(node, output.jobId, output.leaseId, output.name);
    return this.uploads.append(output, this.outputPath(job, output.leaseId, output.name), offset, body,
      () => { this.holding(node, output.jobId, output.leaseId); });
  }

  haveOutputs(node: NodeRow, jobId: string, leaseId: string, values: Array<Omit<OutputUpload, "jobId" | "leaseId">>): string[] {
    return this.sqlite.transaction(() => {
      const { job } = this.holding(node, jobId, leaseId);
      const directory = projectDir(this.config.DATA_DIR, job.projectId);
      const have: string[] = [];
      for (const output of values) {
        this.uploadJob(node, jobId, leaseId, output.name);
        if (this.uploads.linkKnown({ ...output, jobId, leaseId }, (path) => {
          if (!existsSync(directory)) return false;
          const subpath = relative(realpathSync(directory), realpathSync(path));
          return !isAbsolute(subpath) && subpath !== ".." && !subpath.startsWith("../") && !subpath.startsWith("..\\");
        })) have.push(output.name);
      }
      return have;
    }).immediate();
  }

  /** A file the job's manifest lists, for a download. 404 for anything else. */
  artifactFor(node: NodeRow, jobId: string, leaseId: string | undefined, sha256: string): { path: string; size: number } {
    const notFound = new AppError(404, "ARTIFACT_NOT_FOUND", "Không thấy tệp.");
    let job: Job;
    try {
      job = this.holding(node, jobId, leaseId).job;
    } catch {
      throw notFound;
    }
    const pending = this.readPending(job);
    if (!pending.files.some((file) => file.sha256 === sha256)) throw notFound;
    const found = this.artifacts.locate(sha256);
    if (!found) throw notFound;
    return found;
  }

  /** Stream an output into a temp file while hashing it. 422 on size or hash problems. */
  async receiveOutput(
    node: NodeRow,
    jobId: string,
    leaseId: string | undefined,
    name: string,
    expectedSha: string | undefined,
    body: Readable,
  ): Promise<{ name: string; sha256: string; size: number }> {
    if (!ANY_OUTPUT.some((pattern) => pattern.test(name))) throw new AppError(400, "OUTPUT_NAME_REFUSED", "Tên tệp kết quả không được phép.");
    if (!expectedSha || !/^[0-9a-f]{64}$/.test(expectedSha)) throw new AppError(400, "SHA256_REQUIRED", "Thiếu x-sha256 hợp lệ.");
    const { job } = this.holding(node, jobId, leaseId);
    if (!outputNameOk(this.readPending(job).kind, name)) throw new AppError(400, "OUTPUT_NAME_REFUSED", "Tên tệp kết quả không được phép.");
    const target = this.outputPath(job, leaseId!, name);
    const temp = `${target}.${randomUUID()}.tmp`;
    mkdirSync(dirname(target), { recursive: true });
    const max = this.config.NODE_MAX_UPLOAD_MB * 1024 * 1024;
    const hash = createHash("sha256");
    let size = 0;
    try {
      await pipeline(body, new Transform({ transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > max) return done(new AppError(422, "UPLOAD_TOO_LARGE", "Tệp tải lên vượt giới hạn."));
        hash.update(chunk);
        done(null, chunk);
      } }), createWriteStream(temp));
      const sha256 = hash.digest("hex");
      if (sha256 !== expectedSha) throw new AppError(422, "SHA256_MISMATCH", "Mã sha256 của tệp không khớp.");
      this.holding(node, jobId, leaseId);
      this.uploads.saveVerified({ jobId, leaseId: leaseId!, name, sha256, size }, target, () => renameSync(temp, target));
      return { name, sha256, size };
    } finally { rmSync(temp, { force: true }); }
  }

  /** Finish a job: verify outputs, finalize on the control plane, complete the job. */
  async complete(node: NodeRow, jobId: string, body: NodeCompleteRequest): Promise<{ message: string }> {
    const stats = body.storageTransfers;
    const { job } = this.holding(node, jobId, body.leaseId);
    const track = stats?.length && this.blobs?.supportsDirect(job.projectId) &&
      stats.reduce((total, stat) => total + stat.count, 0) <= this.readPending(job).files.length + body.outputs.length;
    const result = await this.finalize(node, jobId, body, false);
    if (track && stats) {
      try { recordStorageHealth(this.sqlite, stats, this.now()); }
      catch { this.logger?.warn({ jobId }, "could not save storage transfer statistics"); }
    }
    return result;
  }

  private async finalize(node: { id: string }, jobId: string, body: NodeCompleteRequest, recovery: boolean): Promise<{ message: string }> {
    const { job } = this.holding(node, jobId, body.leaseId, recovery ? "finalizing" : "live");
    if (this.finalizing.has(jobId)) throw stale();
    this.finalizing.add(jobId);
    let directClaimed = false;
    try {
      const direct = body.outputs.filter((output) => "provider" in output);
      if (direct.length) {
        const pending = this.readPending(job);
        if (!this.blobs || job.projectId === PROTECTED_PROJECT_ID || new Set(body.outputs.map((output) => output.name)).size !== body.outputs.length ||
          direct.some((output) => !outputNameOk(pending.kind, output.name) || output.size > this.config.NODE_MAX_UPLOAD_MB * 1024 * 1024)) {
          throw new AppError(422, "STORAGE_OUTPUT_REFUSED", "Khai báo tệp S3 không hợp lệ.");
        }
        if (!recovery) this.writePending(job, { ...pending, directCompletion: body });
        this.claimFinalization(node.id, job.id, body.leaseId, recovery);
        directClaimed = true;
        for (const output of direct) {
          const existing = this.uploads.ready(job.id, body.leaseId).get(output.name);
          if (existing?.sha256 === output.sha256 && existing.size === output.size) continue;
          const target = this.outputPath(job, body.leaseId, output.name);
          const temp = `${target}.${randomUUID()}.tmp`;
          const value = { ...output, jobId: job.id, leaseId: body.leaseId };
          mkdirSync(dirname(target), { recursive: true });
          try {
            await this.blobs.pullOutput(job.projectId, value, temp);
            this.holding(node, job.id, body.leaseId, "finalizing");
            this.uploads.saveVerified(value, target, () => renameSync(temp, target));
          } finally { rmSync(temp, { force: true }); }
        }
      }
      return await this.finalizeHeld(node.id, job, body, recovery || directClaimed);
    } catch (error) {
      if (directClaimed && !(error instanceof AppError && error.code === "LEASE_STALE") &&
        this.repository.getJob(job.id)?.status === "RUNNING") {
        this.holding(node, job.id, body.leaseId, "finalizing");
        const mismatch = error instanceof AppError && error.code === "STORAGE_HASH_MISMATCH";
        this.orchestrator.failJob(job.id, {
          code: mismatch ? "STORAGE_HASH_MISMATCH" : "STORAGE_FINALIZE_FAILED",
          message: mismatch ? error.message : "Không xác minh hoặc hoàn tất được tệp kết quả từ S3.",
          retryable: job.attempt <= 1,
        });
        this.repository.setJobLease(job.id, null);
        this.discard(job.id, "failed");
      }
      throw error;
    } finally { this.finalizing.delete(jobId); }
  }

  private async finalizeHeld(nodeId: string, job: Job, body: { leaseId: string; outputs: Array<{ name: string; sha256: string }> }, recovery: boolean): Promise<{ message: string }> {
    const pending = this.readPending(job);
    const records = this.uploads.ready(job.id, body.leaseId);
    for (const record of records.values()) {
      if (record.status === "linked" && await sha256File(record.path) !== record.sha256) {
        throw new AppError(422, "SHA256_MISMATCH", `Tệp ${record.name} trong kho đã thay đổi.`);
      }
    }
    const claim = () => this.claimFinalization(nodeId, job.id, body.leaseId, recovery);
    if (pending.kind === "voice") return this.completeVoice(job, pending, records, body, claim, nodeId);
    if (pending.kind === "media") return this.completeMedia(job, pending, records, body, claim);
    const declared = new Map(body.outputs.map((item) => [item.name, item.sha256]));
    const final = records.get("final.mp4");
    const reportRecord = records.get("report.json");
    if (!final || declared.get("final.mp4") !== final.sha256 || !reportRecord || declared.get("report.json") !== reportRecord.sha256) {
      throw new AppError(422, "OUTPUTS_INCOMPLETE", "Thiếu final.mp4 hoặc report.json, hoặc mã sha256 không khớp.");
    }
    for (const [name, sha] of declared) {
      const record = records.get(name);
      if (!record || record.sha256 !== sha) throw new AppError(422, "SHA256_MISMATCH", `Tệp ${name} không khớp mã sha256.`);
    }
    const project = this.repository.getProject(job.projectId);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Dự án đã bị xóa.");
    const report = ExecuteReportSchema.parse(JSON.parse(readFileSync(reportRecord.path, "utf8")));
    claim();
    const { state } = (pending as RenderPending).prepared;
    const versionDir = this.renders.versionDir(job.projectId, state.renderId);
    const outputPath = join(versionDir, "output.mp4");
    const controller = new AbortController();
    try {
      mkdirSync(versionDir, { recursive: true });
      const incoming = `${outputPath}.node-part`;
      await copyFile(final.path, incoming);
      this.holding({ id: nodeId }, job.id, body.leaseId, "finalizing");
      renameSync(incoming, outputPath);
      const { render, reused } = await this.renders.finalize(project, (pending as RenderPending).prepared, outputPath, report, controller.signal);
      const aspectRatio = parseRenderJobScope(job.scope) ?? undefined;
      const done = await this.after(project, controller.signal, aspectRatio, render, reused);
      // The lease may have been taken away while finalize ran.
      this.holding({ id: nodeId }, job.id, body.leaseId, "finalizing");
      this.orchestrator.completeJob(job.id, done.message, render.id);
      this.repository.setJobLease(job.id, null);
      this.discard(job.id, "completed");
      return { message: done.message };
    } catch (error) {
      if (error instanceof AppError && error.code === "LEASE_STALE") {
        throw error;
      }
      this.logger?.warn({ jobId: job.id, err: error }, "node finalize failed");
      this.orchestrator.failJob(job.id, errorToJob(error));
      this.repository.setJobLease(job.id, null);
      this.discard(job.id, "failed");
      throw new AppError(500, "FINALIZE_FAILED", "Không hoàn tất được bước dựng trên máy chính.");
    }
  }

  /** The declared outputs must be exactly what was uploaded (name and sha256). */
  private checkDeclared(records: Map<string, UploadRecord>, outputs: Array<{ name: string; sha256: string }>): void {
    for (const { name, sha256 } of outputs) {
      const record = records.get(name);
      if (!record || record.sha256 !== sha256) throw new AppError(422, "SHA256_MISMATCH", `Tệp ${name} không khớp mã sha256.`);
    }
  }

  /** A node-written JSON file that does not parse or does not match its schema is the node's fault: 422, never a 500. */
  private parseReport<T>(schema: { parse: (value: unknown) => T }, path: string, name: string): T {
    try {
      return schema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      throw new AppError(422, "OUTPUT_INVALID", `${name} không hợp lệ.`);
    }
  }

  private async completeVoice(
    job: Job,
    pending: VoicePending,
    records: Map<string, UploadRecord>,
    body: { leaseId: string; outputs: Array<{ name: string; sha256: string }> },
    claim: () => void,
    nodeId: string,
  ): Promise<{ message: string }> {
    const remote = this.remote;
    const resultRecord = records.get("result.json");
    if (!remote || !resultRecord) throw new AppError(422, "OUTPUTS_INCOMPLETE", "Thiếu result.json.");
    this.checkDeclared(records, body.outputs);
    if (!body.outputs.some((item) => item.name === "result.json" && item.sha256 === resultRecord.sha256)) {
      throw new AppError(422, "OUTPUTS_INCOMPLETE", "result.json chưa được khai báo.");
    }
    const project = this.repository.getProject(job.projectId);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Dự án đã bị xóa.");
    const result = this.parseReport(VoiceResultSchema, resultRecord.path, "result.json");
    const wanted = new Map(pending.scenes.map((scene) => [scene.hash, scene.sceneId]));
    const results = new Map<string, RemoteVoiceScene>();
    for (const scene of result.scenes) {
      if (wanted.get(scene.hash) !== scene.sceneId) throw new AppError(422, "VOICE_SCENE_UNKNOWN", `Cảnh ${scene.sceneId} không có trong yêu cầu.`);
      if (scene.provider !== pending.provider) throw new AppError(422, "VOICE_PROVIDER_MISMATCH", "Node dùng sai nhà cung cấp giọng.");
      const record = records.get(scene.file);
      if (!record || !NODE_VOICE_OUTPUT_NAME.test(scene.file) || scene.file === "result.json") {
        throw new AppError(422, "OUTPUTS_INCOMPLETE", `Thiếu tệp âm thanh ${scene.file}.`);
      }
      if (record.size <= 0 || scene.durationSec <= 0) throw new AppError(422, "VOICE_AUDIO_EMPTY", `Âm thanh cảnh ${scene.sceneId} rỗng.`);
      results.set(scene.hash, {
        hash: scene.hash,
        audioPath: record.path,
        provider: scene.provider,
        voice: scene.voice,
        rate: scene.rate,
        durationSec: scene.durationSec,
        cues: scene.cues,
        ...(scene.words ? { words: scene.words } : {}),
        timingSource: scene.timingSource,
        characters: scene.characters,
        ...(scene.costUsd !== undefined ? { costUsd: scene.costUsd } : {}),
      });
    }
    claim();
    const controller = new AbortController();
    try {
      const done = await remote.voice.runWithRemote(this.contextFor(project, job, controller.signal), results);
      this.holding({ id: nodeId }, job.id, body.leaseId, "finalizing");
      this.orchestrator.completeJob(job.id, done.message ?? "");
      this.repository.setJobLease(job.id, null);
      this.discard(job.id, "completed");
      return { message: done.message ?? "" };
    } catch (error) {
      if (error instanceof AppError && error.code === "LEASE_STALE") {
        throw error;
      }
      this.logger?.warn({ jobId: job.id, err: error }, "node voice finalize failed");
      this.orchestrator.failJob(job.id, errorToJob(error));
      this.repository.setJobLease(job.id, null);
      this.discard(job.id, "failed");
      throw new AppError(500, "FINALIZE_FAILED", "Không hoàn tất được bước tạo giọng trên máy chính.");
    }
  }

  private async completeMedia(
    job: Job,
    pending: MediaPending,
    records: Map<string, UploadRecord>,
    body: { leaseId: string; outputs: Array<{ name: string; sha256: string }> },
    claim: () => void,
  ): Promise<{ message: string }> {
    const remote = this.remote;
    const reportRecord = records.get("report.json");
    if (!remote || !reportRecord) throw new AppError(422, "OUTPUTS_INCOMPLETE", "Thiếu report.json.");
    this.checkDeclared(records, body.outputs);
    const report = this.parseReport(MediaReportSchema, reportRecord.path, "report.json");
    const allowed = new Set(pending.targets);
    const files = report.fetched.map((item) => {
      if (!allowed.has(item.target)) throw new AppError(422, "MEDIA_TARGET_UNKNOWN", `Clip ${item.target} không có trong yêu cầu.`);
      const record = records.get(item.target);
      if (!record) throw new AppError(422, "OUTPUTS_INCOMPLETE", `Thiếu tệp ${item.target}.`);
      if (record.sha256 !== item.sha256 || record.size !== item.size) throw new AppError(422, "MEDIA_VERIFY_FAILED", `Clip ${item.target} không khớp báo cáo.`);
      return { item, record };
    });
    claim();
    let placed = 0;
    try {
      for (const { item, record } of files) {
        try {
          remote.media.place(item.target, record.path, { sha256: item.sha256, size: item.size });
        } catch (error) {
          throw new AppError(422, "MEDIA_VERIFY_FAILED", error instanceof Error ? error.message : "Clip không hợp lệ.");
        }
        placed += 1;
      }
      const message = `${placed} clip đã tải về qua máy worker, ${report.skipped.length} bỏ qua`;
      this.orchestrator.completeJob(job.id, message);
      this.repository.setJobLease(job.id, null);
      this.discard(job.id, "completed");
      return { message };
    } catch (error) {
      this.orchestrator.failJob(job.id, errorToJob(error));
      this.repository.setJobLease(job.id, null);
      this.discard(job.id, "failed");
      throw error;
    }
  }

  /** The node says it gave up. A stale lease has no effect on the current holder. */
  fail(node: NodeRow, jobId: string, body: { leaseId: string; code: string; message: string; retryable: boolean }): void {
    this.holding(node, jobId, body.leaseId);
    this.orchestrator.failJob(jobId, { code: body.code || "NODE_RENDER_FAILED", message: body.message, retryable: body.retryable });
    this.repository.setJobLease(jobId, null);
    this.discard(jobId, "failed");
  }
}

function errorToJob(error: unknown): JobError {
  if (error instanceof AppError && (error.code === "NODE_BUNDLE_FAILED" || error.code.startsWith("MEDIA_") || error.code.startsWith("VOICE_"))) {
    return { code: error.code, message: error.message, retryable: true };
  }
  return jobErrorFromCaught(error);
}
