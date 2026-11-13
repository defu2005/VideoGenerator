import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
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
import type { ArtifactService } from "./artifactService.js";
import type { LeaseSecretService } from "./leaseSecrets.js";
import { MediaFetchService, parseMediaScope } from "./mediaFetch.js";
import { buildRemoteBundle, buildTtsBundle, mediaTargetName, RemoteBundleError } from "./remoteBundle.js";
import type { NodeRow, NodeService } from "./nodeService.js";
import { getRemoteStagesSettings } from "./settings.js";
import { isBoxPublicKey } from "./secretBox.js";

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
type Pending = RenderPending | VoicePending | MediaPending;
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
  private readonly uploads = new Map<string, Map<string, UploadRecord>>();

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
  ) {
    nodes.onReleased = (jobId) => this.discard(jobId, "released");
    nodes.onCancelled = (_jobId, leaseId) => this.remote?.secrets.revokeLease(leaseId, "cancelled");
  }

  private pendingPath(projectId: string, jobId: string): string {
    return join(this.renders.renderDir(projectId), "pending", `${jobId}.json`);
  }

  private uploadsDir(projectId: string, jobId: string): string {
    return join(this.renders.renderDir(projectId), "pending", `${jobId}.uploads`);
  }

  /** Forget a job's pending bundle and uploads, and take back every key it was lent. Never throws. */
  discard(jobId: string, reason = "released"): void {
    try {
      this.remote?.secrets.revokeJob(jobId, reason);
    } catch {
      /* best effort */
    }
    try {
      const job = this.repository.getJob(jobId);
      this.uploads.delete(jobId);
      if (!job) return;
      rmSync(this.pendingPath(job.projectId, jobId), { force: true });
      rmSync(this.uploadsDir(job.projectId, jobId), { recursive: true, force: true });
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
  async lease(node: NodeRow, freeSlots: number, publicKey?: string): Promise<LeaseResponse | undefined> {
    const desired = this.nodes.desiredOf(node);
    if (freeSlots < 1 || desired.drain) return undefined;
    if (node.status === "version_mismatch" || node.status === "offline") return undefined;
    if (this.nodes.runningCount(node.id) >= desired.concurrency) return undefined;
    if (readDrain(this.sqlite).draining) return undefined;
    if (desired.capabilities.includes("render") && !this.nodes.renderProbeFailed(node)) {
      for (const candidate of this.candidates("RENDER")) {
        const claimed = this.orchestrator.startJob(candidate.id);
        if (!claimed) continue;
        try {
          const response = await this.prepareLease(node, claimed);
          if (response) return response;
        } catch (error) {
          this.orchestrator.failJob(claimed.id, errorToJob(error));
        }
      }
    }
    const remote = this.remote;
    if (!remote) return undefined;
    const modes = getRemoteStagesSettings(this.sqlite);
    if (modes.VOICE !== "off" && desired.capabilities.some((item) => item.startsWith("tts:"))) {
      const usable = (job: Job): boolean => this.voiceJobFits(remote, desired.capabilities, publicKey, job);
      for (const candidate of this.candidates("VOICE", usable)) {
        const claimed = this.orchestrator.startJob(candidate.id);
        if (!claimed) continue;
        try {
          const response = await this.prepareVoiceLease(remote, node, claimed, publicKey);
          if (response) return response;
        } catch (error) {
          this.orchestrator.failJob(claimed.id, errorToJob(error));
        }
      }
    }
    if (modes.MEDIA_FETCH !== "off" && desired.capabilities.includes("media_fetch")) {
      for (const candidate of this.candidates("MEDIA_FETCH", (job) => job.attempt <= 1)) {
        const claimed = this.orchestrator.startJob(candidate.id);
        if (!claimed) continue;
        try {
          const response = this.prepareMediaLease(remote, node, claimed);
          if (response) return response;
        } catch (error) {
          this.orchestrator.failJob(claimed.id, errorToJob(error));
        }
      }
    }
    return undefined;
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
    writeFileSync(path, JSON.stringify(pending));
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

  private async prepareLease(node: NodeRow, job: Job): Promise<LeaseResponse | undefined> {
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
      this.orchestrator.completeJob(job.id, done.message);
      return undefined;
    }
    const { local, ...plain } = prepared.prepared;
    const remote = await buildRemoteBundle(plain.bundle, local.resolvePath, this.artifacts).catch((error: unknown) => {
      if (error instanceof RemoteBundleError) {
        throw new AppError(500, "NODE_BUNDLE_FAILED", `Không đóng gói được dữ liệu cho máy worker: ${error.message}`);
      }
      throw error;
    });
    const current = this.repository.getJob(job.id);
    if (!current || current.status !== "RUNNING") return undefined;
    const leaseId = randomUUID();
    const at = this.now();
    const leaseUntil = new Date(at.getTime() + this.config.NODE_LEASE_SEC * 1000).toISOString();
    const pending: Pending = { prepared: plain as PreparedRender, files: remote.files };
    this.writePending(job, pending);
    this.repository.setJobLease(job.id, { nodeId: node.id, leaseId, leaseUntil, heartbeatAt: at.toISOString() });
    this.orchestrator.reportProgress(job.id, 5, `Đang dựng trên máy ${node.name}`);
    return { jobId: job.id, leaseId, leaseUntil, stage: "RENDER", bundle: remote.bundle, manifest: remote.files };
  }

  /** Check a request really holds the job's current lease. */
  private holding(node: { id: string }, jobId: string, leaseId: string | undefined): { job: Job } {
    const job = this.repository.getJob(jobId);
    const lease = this.repository.getJobLease(jobId);
    if (!job || job.status !== "RUNNING" || !lease || lease.nodeId !== node.id || !leaseId || lease.leaseId !== leaseId) throw stale();
    return { job };
  }

  /**
   * The node lost its in-memory key (it restarted its process) and asks again with a fresh public key.
   * 410 when the key expired or was revoked; 409 when the lease is no longer this node's; never a longer expiry.
   */
  refetchSecret(node: NodeRow, jobId: string, leaseId: string | undefined, publicKey: string | undefined): SealedSecret {
    const secrets = this.remote?.secrets;
    if (!secrets) throw new AppError(404, "SECRET_NOT_FOUND", "Không có khoá cho lease này.");
    if (leaseId && secrets.isGone(jobId, leaseId, node.id)) throw new AppError(410, "SECRET_GONE", "Khoá đã hết hạn hoặc đã bị thu hồi.");
    this.holding(node, jobId, leaseId);
    return secrets.regrant(node, jobId, leaseId!, publicKey);
  }

  private readPending(job: Job): Pending {
    const path = this.pendingPath(job.projectId, job.id);
    if (!existsSync(path)) throw stale();
    return JSON.parse(readFileSync(path, "utf8")) as Pending;
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
    const dir = this.uploadsDir(job.projectId, job.id);
    const target = join(dir, name.replace(/\//g, "__"));
    const temp = `${target}.${randomUUID()}.tmp`;
    mkdirSync(dir, { recursive: true });
    const max = this.config.NODE_MAX_UPLOAD_MB * 1024 * 1024;
    const hash = createHash("sha256");
    let size = 0;
    let tooBig = false;
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(temp);
      body.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > max) {
          tooBig = true;
          body.unpipe(out);
          out.destroy();
          body.resume();
          resolve();
          return;
        }
        hash.update(chunk);
      });
      body.on("error", reject);
      out.on("error", reject);
      out.on("finish", () => resolve());
      body.pipe(out);
    });
    if (tooBig) {
      rmSync(temp, { force: true });
      throw new AppError(422, "UPLOAD_TOO_LARGE", "Tệp tải lên vượt giới hạn.");
    }
    const sha256 = hash.digest("hex");
    if (sha256 !== expectedSha) {
      rmSync(temp, { force: true });
      throw new AppError(422, "SHA256_MISMATCH", "Mã sha256 của tệp không khớp.");
    }
    renameSync(temp, target);
    const records = this.uploads.get(job.id) ?? new Map<string, UploadRecord>();
    records.set(name, { name, sha256, size, path: target });
    this.uploads.set(job.id, records);
    return { name, sha256, size };
  }

  /** Finish a job: verify outputs, finalize on the control plane, complete the job. */
  async complete(node: NodeRow, jobId: string, body: { leaseId: string; outputs: Array<{ name: string; sha256: string }> }): Promise<{ message: string }> {
    let job: Job;
    try {
      job = this.holding(node, jobId, body.leaseId).job;
    } catch (error) {
      this.discard(jobId, "stale");
      throw error;
    }
    const pending = this.readPending(job);
    const records = this.uploads.get(job.id) ?? new Map<string, UploadRecord>();
    if (pending.kind === "voice") return this.completeVoice(job, pending, records, body);
    if (pending.kind === "media") return this.completeMedia(job, pending, records, body);
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
    const { state } = (pending as RenderPending).prepared;
    const versionDir = this.renders.versionDir(job.projectId, state.renderId);
    mkdirSync(versionDir, { recursive: true });
    const outputPath = join(versionDir, "output.mp4");
    renameSync(final.path, outputPath);
    const controller = new AbortController();
    try {
      const { render, reused } = await this.renders.finalize(project, (pending as RenderPending).prepared, outputPath, report, controller.signal);
      const aspectRatio = parseRenderJobScope(job.scope) ?? undefined;
      const done = await this.after(project, controller.signal, aspectRatio, render, reused);
      // The lease may have been taken away while finalize ran.
      this.holding(node, jobId, body.leaseId);
      this.orchestrator.completeJob(job.id, done.message);
      this.repository.setJobLease(job.id, null);
      this.discard(job.id, "completed");
      return { message: done.message };
    } catch (error) {
      if (error instanceof AppError && error.code === "LEASE_STALE") {
        this.discard(job.id, "stale");
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
    const controller = new AbortController();
    try {
      const done = await remote.voice.runWithRemote(this.contextFor(project, job, controller.signal), results);
      this.holding({ id: this.repository.getJobLease(job.id)?.nodeId ?? "" }, job.id, body.leaseId);
      this.orchestrator.completeJob(job.id, done.message ?? "");
      this.repository.setJobLease(job.id, null);
      this.discard(job.id, "completed");
      return { message: done.message ?? "" };
    } catch (error) {
      if (error instanceof AppError && error.code === "LEASE_STALE") {
        this.discard(job.id, "stale");
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
  ): Promise<{ message: string }> {
    const remote = this.remote;
    const reportRecord = records.get("report.json");
    if (!remote || !reportRecord) throw new AppError(422, "OUTPUTS_INCOMPLETE", "Thiếu report.json.");
    this.checkDeclared(records, body.outputs);
    const report = this.parseReport(MediaReportSchema, reportRecord.path, "report.json");
    const allowed = new Set(pending.targets);
    let placed = 0;
    try {
      for (const item of report.fetched) {
        if (!allowed.has(item.target)) throw new AppError(422, "MEDIA_TARGET_UNKNOWN", `Clip ${item.target} không có trong yêu cầu.`);
        const record = records.get(item.target);
        if (!record) throw new AppError(422, "OUTPUTS_INCOMPLETE", `Thiếu tệp ${item.target}.`);
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

  /** The node says it gave up. A stale lease gets 409 and its uploads are deleted. */
  fail(node: NodeRow, jobId: string, body: { leaseId: string; code: string; message: string; retryable: boolean }): void {
    try {
      this.holding(node, jobId, body.leaseId);
    } catch (error) {
      this.discard(jobId, "stale");
      throw error;
    }
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
