import { publishAgentEvent } from "../events/agentBus.js";
import {
  GATES,
  STAGE_DEPENDS,
  STAGE_ORDER,
  isGate,
  isPublishStage,
  isSideJobStage,
  jobLane,
  renderJobScope,
  stageLane,
  type Job,
  type JobError,
  type JobUsage,
  type PipelineStage,
  type PipelineState,
  type Project,
  type ProjectStatus,
  type RenderVariantAspect,
  type StageRecord,
  type StageState,
  storyModeForProject,
} from "@vg/shared";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { JobRepository } from "../jobs/jobRepository.js";
import { safeNotify, type NotificationService } from "../notifications/notificationService.js";
import { markStaleFrom } from "./invalidation.js";
import { effectiveAutonomy } from "../operator/autonomy.js";
import { breakerAllowsStart, claimBreakerTrial, recordBreakerOutcome } from "../operator/circuitBreaker.js";
import { jobWithinAutonomyLimit, reserveAutonomyJob } from "../operator/autonomyJobLimits.js";

export type ApprovalCheck = (project: Project, gate: PipelineStage) => { allowed: true } | { allowed: false; message: string };
type Clock = () => Date;

function mergeFeatureUsage(
  previous: Record<string, number> | undefined,
  next: Record<string, number> | undefined,
): Record<string, number> {
  const merged: Record<string, number> = { ...previous };
  for (const [feature, calls] of Object.entries(next ?? {})) {
    merged[feature] = (merged[feature] ?? 0) + calls;
  }
  return merged;
}

export const LANE_CANCELLED_MESSAGE = "Đã hủy làn này";

export function deriveProjectStatus(input: {
  activeJob: Pick<Job, "stage"> | null;
  stages: Pick<StageRecord, "state">[];
  projectStage: PipelineStage;
}): ProjectStatus {
  const pipelineJob = input.activeJob && !isSideJobStage(input.activeJob.stage) ? input.activeJob : null;
  if (pipelineJob?.stage === "RENDER") return "RENDERING";
  if (input.stages.some((stage) => stage.state === "WAITING_USER")) return "REVIEW";
  if (pipelineJob) return "GENERATING";
  if (input.stages.some((stage) => stage.state === "FAILED")) return "FAILED";
  if (input.projectStage === "DONE") return "COMPLETED";
  return "DRAFT";
}

export class PipelineOrchestrator {
  private abortJob: (jobId: string) => void = () => undefined;
  private wakeWorker: () => void = () => undefined;
  private notifications: NotificationService | null = null;

  constructor(
    readonly repository: JobRepository,
    private readonly config: AppConfig,
    private readonly logger: FastifyBaseLogger,
    private readonly now: Clock = () => new Date(),
    private readonly canApprove: ApprovalCheck = () => ({ allowed: true }),
    private readonly autoBlock: (project: Project, gate: PipelineStage) => string | null = () => null,
  ) {}

  setAbortJobHandler(handler: (jobId: string) => void): void {
    this.abortJob = handler;
  }

  setWakeHandler(handler: () => void): void {
    this.wakeWorker = handler;
  }

  setNotificationService(service: NotificationService | null): void {
    this.notifications = service;
  }

  notifyBudgetFinding(finding: { id: string; profileId: string | null; message: string }): void {
    const profile = finding.profileId
      ? this.repository.sqlite.prepare("SELECT name FROM profiles WHERE id = ?").get(finding.profileId) as { name: string } | undefined
      : undefined;
    safeNotify(this.notifications, { kind: "automation_warning", profileId: finding.profileId, profile: profile?.name ?? "Toàn app",
      message: finding.message, logId: finding.id });
  }

  private overdueDecider: ((jobId: string, input: import("../jobs/overdueRun.js").DecideInput) => import("../jobs/overdueRun.js").DecideResult) | undefined;

  /** TASK-125: the worker registers itself here so tools, API and the web all decide through one path. */
  setOverdueDecider(fn: NonNullable<PipelineOrchestrator["overdueDecider"]>): void {
    this.overdueDecider = fn;
  }

  decideOverdue(jobId: string, input: import("../jobs/overdueRun.js").DecideInput): import("../jobs/overdueRun.js").DecideResult {
    if (!this.overdueDecider) return { ok: false, message: "Bộ kiểm tra quá giờ chưa chạy." };
    return this.overdueDecider(jobId, input);
  }

  /** TASK-125: one overdue notice for a job. The dedup key uses the message start, so it carries the minutes. */
  notifyOverdue(job: Job, message: string): void {
    const profileId = this.repository.getProject(job.projectId)?.profileId ?? null;
    const profile = profileId
      ? this.repository.sqlite.prepare("SELECT name FROM profiles WHERE id = ?").get(profileId) as { name: string } | undefined
      : undefined;
    safeNotify(this.notifications, { kind: "automation_warning", profileId, profile: profile?.name ?? "Toàn app", message });
  }

  private webBaseUrl(): string {
    return (this.config.WEB_BASE_URL || this.config.CORS_ORIGIN || "http://localhost:5180").replace(/\/$/, "");
  }

  getPipeline(projectId: string): PipelineState {
    return this.requirePipeline(projectId);
  }

  runAll(projectId: string): PipelineState {
    this.repository.atomic(() => {
      const project = this.requireProject(projectId);
      if (project.kind === "clip") this.invalid("Dự án clip không chạy pipeline.");
      this.repository.ensureStages(projectId);
      this.assertCanStart(projectId, "RESEARCH");
      this.repository.setRunMode(projectId, "ALL");
      this.clearLaneCancels(projectId);
      this.continueAll(projectId);
    });
    return this.requirePipeline(projectId);
  }

  runStage(projectId: string, stage: PipelineStage): PipelineState {
    this.repository.atomic(() => {
      const project = this.requireProject(projectId);
      if (project.kind === "clip") this.invalid("Dự án clip không chạy pipeline.");
      this.repository.ensureStages(projectId);
      this.assertCanStart(projectId, stage);
      const position = STAGE_ORDER.indexOf(stage);
      if (position < 0) this.invalid(`${stage} is not a runnable pipeline stage.`);
      if (isGate(stage)) this.invalid(`Review stage ${stage} must be approved, not run.`);
      const researchMode = storyModeForProject(project);
      if (stage === "RESEARCH" && researchMode === "off" && project.settings.stageExecutors.script !== "USER") {
        this.skipResearch(projectId, "Skipped (research mode is off)");
        this.repository.setRunMode(projectId, null);
        this.updateProjectStatus(projectId, "RESEARCH");
        return;
      }
      if (stage === "SCRIPT" && researchMode === "off") {
        this.skipResearch(projectId, "Skipped (research mode is off)");
      }
      if ((stage === "RESEARCH" || stage === "SCRIPT") && project.settings.stageExecutors.script === "USER") {
        this.waitForUser(projectId, stage);
        return;
      }
      const unmet = this.unmetDependency(projectId, stage);
      if (unmet) this.invalid(`Complete ${unmet} before running ${stage}.`);
      if (stage === "VOICE" && project.settings.stageExecutors.voice === "USER") {
        if (!this.hasAllUserVoiceTracks(projectId)) {
          this.waitForUser(projectId, stage, "Upload a voice track for every narrated scene, then continue.");
          return;
        }
        if (this.repository.getStage(projectId, stage).state === "DONE") markStaleFrom(this.repository, projectId, stage);
        this.repository.updateStage(projectId, stage, {
          state: "DONE",
          progress: 100,
          message: "Provided by user",
          jobId: null,
          error: null,
        });
        if (this.repository.getRunMode(projectId) === "ALL") {
          this.repository.updateProject(projectId, { stage });
          this.continueAll(projectId);
          return;
        }
        this.repository.setRunMode(projectId, "SINGLE");
        this.updateProjectStatus(projectId, stage);
        return;
      }
      if (this.repository.getStage(projectId, stage).state === "DONE") {
        markStaleFrom(this.repository, projectId, stage);
      }
      if (this.repository.getRunMode(projectId) !== "ALL") this.repository.setRunMode(projectId, "SINGLE");
      this.enqueue(projectId, stage);
      this.updateProjectStatus(projectId, stage);
    });
    return this.requirePipeline(projectId);
  }

  /** TASK-121: rerun one stage, then let ALL mode carry on to the next gate (used by the quality repair loop). */
  runStageThenContinue(projectId: string, stage: PipelineStage): PipelineState {
    const state = this.runStage(projectId, stage);
    this.repository.setRunMode(projectId, "ALL");
    return state;
  }

  /**
   * Queue a RENDER job, optionally as an aspect-ratio variant.
   * Does not mark earlier stages stale — variants reuse the same timeline/assets.
   */
  runRender(projectId: string, aspectRatio?: RenderVariantAspect): PipelineState {
    this.repository.atomic(() => {
      this.requireProject(projectId);
      this.assertCanStart(projectId, "RENDER");
      this.repository.ensureStages(projectId);
      const unmet = this.unmetDependency(projectId, "RENDER");
      if (unmet) this.invalid(`Complete ${unmet} before running RENDER.`);
      const previousState = this.repository.getStage(projectId, "RENDER").state;
      this.repository.setRunMode(projectId, "SINGLE");
      const job = this.repository.createJob({
        projectId,
        stage: "RENDER",
        scope: renderJobScope(aspectRatio),
        maxAttempts: this.config.JOB_MAX_ATTEMPTS,
        previousState: previousState === "DONE" || previousState === "STALE" ? previousState : previousState,
        runAfter: this.now(),
      });
      this.repository.updateStage(projectId, "RENDER", {
        state: "QUEUED",
        progress: 0,
        message: "Waiting for a worker",
        jobId: job.id,
        error: null,
      });
      this.wakeWorker();
      this.updateProjectStatus(projectId, "RENDER");
    });
    return this.requirePipeline(projectId);
  }

  completeByUser(
    projectId: string,
    stage: PipelineStage,
    options: { skip?: PipelineStage[]; invalidate?: boolean } = {},
  ): PipelineState {
    this.repository.atomic(() => {
      this.requireProject(projectId);
      this.assertCanStart(projectId, stage);
      this.repository.ensureStages(projectId);
      const position = STAGE_ORDER.indexOf(stage);
      if (position < 0 || isGate(stage)) this.invalid(`${stage} cannot be completed by user input.`);
      for (const skippedStage of options.skip ?? []) {
        const skipIndex = STAGE_ORDER.indexOf(skippedStage);
        if (skipIndex < 0 || skipIndex >= position) this.invalid(`${skippedStage} must be an earlier pipeline stage to skip.`);
        if (this.repository.getStage(projectId, skippedStage).state !== "DONE") {
          this.repository.updateStage(projectId, skippedStage, {
            state: "SKIPPED",
            progress: 100,
            message: "Skipped by user",
            jobId: null,
            error: null,
          });
        }
      }
      this.repository.updateStage(projectId, stage, {
        state: "DONE",
        progress: 100,
        message: "Provided by user",
        jobId: null,
        error: null,
      });
      if (options.invalidate !== false) markStaleFrom(this.repository, projectId, stage);
      if (this.repository.getRunMode(projectId) === "ALL") {
        this.repository.updateProject(projectId, { stage });
        this.continueAll(projectId);
      } else {
        this.repository.setRunMode(projectId, null);
        this.updateProjectStatus(projectId, stage);
      }
    });
    return this.requirePipeline(projectId);
  }

  approveGate(projectId: string, gate: PipelineStage): PipelineState {
    this.repository.atomic(() => {
      const project = this.requireProject(projectId);
      if (!GATES.includes(gate) || this.repository.getStage(projectId, gate).state !== "WAITING_USER") {
        this.invalid(`${gate} is not waiting for approval.`);
      }
      const approval = this.canApprove(project, gate);
      if (!approval.allowed) this.invalid(approval.message);
      this.repository.updateStage(projectId, gate, {
        state: "DONE",
        progress: 100,
        message: "Approved by user",
        error: null,
      });
      if (project.mode !== "MANUAL") {
        this.repository.setRunMode(projectId, "ALL");
        this.continueAll(projectId);
      } else {
        this.repository.setRunMode(projectId, null);
        this.updateProjectStatus(projectId, gate);
      }
    });
    return this.requirePipeline(projectId);
  }

  cancel(projectId: string, stage?: PipelineStage): PipelineState {
    const jobs = this.repository.getActiveJobs(projectId);
    const targets = stage ? jobs.filter((job) => job.stage === stage) : jobs;
    if (targets.length === 0) this.invalid("There is no active job to cancel.");
    for (const job of targets) {
      if (job.status === "RUNNING") this.abortJob(job.id);
    }
    this.repository.atomic(() => {
      let cancelled = 0;
      for (const target of targets) {
        const job = this.repository.getJob(target.id);
        if (!job || (job.status !== "QUEUED" && job.status !== "RUNNING")) continue;
        const previousState = this.repository.getPreviousState(job.id);
        this.repository.updateJob(job.id, {
          status: "CANCELLED",
          finishedAt: this.now().toISOString(),
          error: null,
        });
        if (!isSideJobStage(job.stage)) {
          this.repository.updateStage(projectId, job.stage, {
            state: previousState === "DONE" ? "STALE" : previousState,
            progress: 0,
            message: LANE_CANCELLED_MESSAGE,
            jobId: null,
            error: null,
          });
        }
        cancelled += 1;
      }
      if (cancelled === 0) this.invalid("The active job has already finished.");
      const remaining = this.repository.getActiveJobs(projectId).filter((job) => !isSideJobStage(job.stage));
      if (!stage || remaining.length === 0) this.repository.setRunMode(projectId, null);
      const stages = this.repository.getStages(projectId);
      const focus = remaining[0]?.stage ?? this.previousCompletedStage(stages, targets[0]?.stage ?? "RESEARCH");
      this.updateProjectStatus(projectId, focus);
    });
    return this.requirePipeline(projectId);
  }

  retry(projectId: string, stage: PipelineStage): PipelineState {
    this.repository.atomic(() => {
      this.requireProject(projectId);
      this.repository.ensureStages(projectId);
      this.assertCanStart(projectId, stage);
      if (!STAGE_ORDER.includes(stage)) this.invalid(`${stage} is not a retryable pipeline stage.`);
      if (isGate(stage)) this.invalid(`Review stage ${stage} cannot be retried as a job.`);
      const record = this.repository.getStage(projectId, stage);
      if (record.state !== "FAILED") this.invalid(`${stage} can only be retried after it fails.`);
      const runMode = this.repository.getRunMode(projectId);
      this.enqueue(projectId, stage);
      this.repository.setRunMode(projectId, runMode);
      this.updateProjectStatus(projectId, stage);
    });
    return this.requirePipeline(projectId);
  }

  private breakerProfile(job: Job): string | undefined {
    const row = this.repository.sqlite.prepare("SELECT profile_id FROM projects WHERE id = ?").get(job.projectId) as
      { profile_id: string | null } | undefined;
    const profileId = row?.profile_id;
    if (!profileId) return undefined;
    const { level } = effectiveAutonomy(this.repository.sqlite, { profileId });
    return level === "supervised" || level === "autonomous" ? profileId : undefined;
  }

  breakerAllowsJob(job: Job, now: Date): boolean {
    const profileId = this.breakerProfile(job);
    return !profileId || breakerAllowsStart(this.repository.sqlite, profileId, job.stage, now);
  }

  canStartQueuedJob(job: Job, now: Date): boolean {
    return this.breakerAllowsJob(job, now) && !this.holdsRenderForDisk(job) && !this.renderSlotsFull(job) && jobWithinAutonomyLimit(this.repository.sqlite, job, now);
  }

  private holdsRenderForDisk(job: Job): boolean {
    if (job.stage !== "RENDER" || !this.breakerProfile(job)) return false;
    return Boolean(this.repository.sqlite.prepare(
      "SELECT 1 FROM supervisor_findings WHERE dedupe_key = 'disk_low:app' AND status != 'resolved'",
    ).get());
  }

  private recordBreakerResult(profileId: string, job: Job, succeeded: boolean): void {
    const retryAt = recordBreakerOutcome(this.repository.sqlite, profileId, job.stage, job.id, succeeded, this.now());
    if (retryAt) {
      const profile = this.repository.sqlite.prepare("SELECT name FROM profiles WHERE id = ?").get(profileId) as { name: string } | undefined;
      safeNotify(this.notifications, {
        kind: "automation_warning", profileId, profile: profile?.name ?? "Hồ sơ",
        logId: `breaker:${profileId}:${job.stage}:${retryAt}`,
        message: `Tạm dừng bước ${job.stage} sau nhiều lần lỗi. Lượt thử sớm nhất: ${retryAt}.`,
      });
    }
  }

  startJob(jobId: string): Job | undefined {
    return this.repository.atomic(() => {
      const job = this.repository.getJob(jobId);
      if (!job || job.status !== "QUEUED") return undefined;
      const now = this.now();
      const profileId = this.breakerProfile(job);
      if (profileId && !breakerAllowsStart(this.repository.sqlite, profileId, job.stage, now)) return undefined;
      if (this.holdsRenderForDisk(job)) return undefined;
      if (this.renderSlotsFull(job)) return undefined;
      if (!reserveAutonomyJob(this.repository.sqlite, job, now)) return undefined;
      if (profileId) claimBreakerTrial(this.repository.sqlite, profileId, job.stage, job.id, now);
      const resumeMessage = job.message ?? "";
      const resumed = resumeMessage.startsWith("Resuming after server restart")
        || resumeMessage.startsWith("Queued for resume after shutdown");
      const running = this.repository.updateJob(jobId, {
        status: "RUNNING",
        startedAt: now.toISOString(),
        finishedAt: null,
        error: null,
        message: resumed
          ? resumeMessage
          : isPublishStage(job.stage) ? "Publish started" : job.stage === "CLIP" ? "Đang cắt Short" : "Stage started",
      });
      publishAgentEvent({ type: "stage_started", projectId: job.projectId, stage: job.stage, summary: `Bắt đầu ${job.stage}` });
      if (!isSideJobStage(job.stage)) {
        this.repository.updateStage(job.projectId, job.stage, {
          state: "RUNNING",
          progress: resumed ? job.progress : 0,
          message: resumed ? resumeMessage : "Stage started",
          jobId,
          error: null,
        });
        this.updateProjectStatus(job.projectId, job.stage);
      }
      this.logger.info({ jobId, projectId: job.projectId, stage: job.stage, attempt: job.attempt }, "Pipeline job started");
      return running;
    }, "immediate");
  }

  reportProgress(jobId: string, progress: number, message?: string): void {
    this.repository.atomic(() => {
      const job = this.repository.getJob(jobId);
      if (!job || job.status !== "RUNNING") return;
      const next = this.repository.updateJob(jobId, { progress, message: message ?? job.message });
      if (!isSideJobStage(job.stage)) {
        this.repository.updateStage(job.projectId, job.stage, {
          progress,
          message: message ?? job.message,
          jobId,
        });
      }
      void next;
    });
  }

  recordUsage(jobId: string, usage: Partial<JobUsage>): void {
    this.repository.atomic(() => {
      const job = this.repository.getJob(jobId);
      if (!job || job.status !== "RUNNING") return;
      const previous = job.usage ?? { llmCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      this.repository.updateJob(jobId, {
        usage: {
          llmCalls: previous.llmCalls + (usage.llmCalls ?? 0),
          inputTokens: previous.inputTokens + (usage.inputTokens ?? 0),
          outputTokens: previous.outputTokens + (usage.outputTokens ?? 0),
          costUsd: previous.costUsd + (usage.costUsd ?? 0),
          ...(usage.provider ?? previous.provider ? { provider: usage.provider ?? previous.provider } : {}),
          ...(usage.model ?? previous.model ? { model: usage.model ?? previous.model } : {}),
          ...(usage.tokensUnknown || previous.tokensUnknown ? { tokensUnknown: true } : {}),
          ...((usage.features || previous.features) ? {
            features: mergeFeatureUsage(previous.features, usage.features),
          } : {}),
          ...((usage.calls || previous.calls) ? {
            calls: [...(previous.calls ?? []), ...(usage.calls ?? [])],
          } : {}),
        },
      });
    });
  }

  completeJob(jobId: string, message?: string): void {
    this.repository.atomic(() => {
      const job = this.repository.getJob(jobId);
      if (!job || job.status !== "RUNNING") return;
      const finishedAt = this.now().toISOString();
      const profileId = this.breakerProfile(job);
      if (profileId) this.recordBreakerResult(profileId, job, true);
      this.repository.updateJob(jobId, {
        status: "SUCCEEDED",
        progress: 100,
        message: message ?? `${job.stage} completed`,
        finishedAt,
      });
      publishAgentEvent({
        type: job.stage === "RENDER" ? "render_finished" : isPublishStage(job.stage) ? "published" : "stage_finished",
        projectId: job.projectId, stage: job.stage, summary: `${job.stage} xong`,
      });
      if (isSideJobStage(job.stage)) {
        const durationMs = job.startedAt ? Date.parse(finishedAt) - Date.parse(job.startedAt) : 0;
        this.logger.info({ jobId, projectId: job.projectId, stage: job.stage, attempt: job.attempt, durationMs }, isPublishStage(job.stage) ? "Publish job finished" : "Clip job finished");
        return;
      }
      this.repository.updateStage(job.projectId, job.stage, {
        state: "DONE",
        progress: 100,
        message: message ?? `${job.stage} completed`,
        error: null,
      });
      const runMode = this.repository.getRunMode(job.projectId);
      if (runMode === "ALL") {
        this.repository.updateProject(job.projectId, { stage: job.stage });
        this.continueAll(job.projectId);
      } else {
        this.repository.setRunMode(job.projectId, null);
        this.updateProjectStatus(job.projectId, job.stage);
      }
      const durationMs = job.startedAt ? Date.parse(finishedAt) - Date.parse(job.startedAt) : 0;
      this.logger.info({ jobId, projectId: job.projectId, stage: job.stage, attempt: job.attempt, durationMs }, "Pipeline job finished");
    });
  }

  failJob(jobId: string, error: JobError): void {
    this.repository.atomic(() => {
      const job = this.repository.getJob(jobId);
      if (!job || job.status !== "RUNNING") return;
      const finishedAt = this.now().toISOString();
      const durationMs = job.startedAt ? Date.parse(finishedAt) - Date.parse(job.startedAt) : 0;
      if ((error.code === "LLM_QUOTA_WAIT" || error.code === "AUTONOMY_BUDGET_WAIT") && error.retryAt) {
        this.repository.updateJob(jobId, {
          status: "QUEUED",
          attempt: job.attempt,
          runAfter: error.retryAt,
          startedAt: null,
          finishedAt: null,
          message: error.message,
          error,
        });
        if (!isSideJobStage(job.stage)) {
          this.repository.updateStage(job.projectId, job.stage, {
            state: "QUEUED",
            progress: 0,
            message: error.message,
            jobId,
            error,
          });
        }
        this.logger.warn({ jobId, projectId: job.projectId, stage: job.stage, attempt: job.attempt, runAfter: error.retryAt }, "Pipeline job waiting for quota reset");
        return;
      }
      const profileId = this.breakerProfile(job);
      if (profileId) this.recordBreakerResult(profileId, job, false);
      if (error.retryable && job.attempt < job.maxAttempts) {
        const baseDelay = this.config.JOB_RETRY_BASE_MS * 2 ** (job.attempt - 1);
        const retryDelay = error.retryAt ? Math.max(0, Date.parse(error.retryAt) - this.now().getTime()) : 0;
        const delay = Math.max(baseDelay, retryDelay);
        const runAfter = new Date(this.now().getTime() + delay);
        const retryMessage = error.code === "TTS_NETWORK"
          ? `Lỗi mạng giọng đọc, tự chạy lại lúc ${runAfter.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} (lần ${job.attempt + 1}/${job.maxAttempts})`
          : `Retry scheduled: ${error.message}`;
        this.repository.updateJob(jobId, {
          status: "QUEUED",
          attempt: job.attempt + 1,
          runAfter: runAfter.toISOString(),
          startedAt: null,
          finishedAt: null,
          message: retryMessage,
          error,
        });
        if (!isSideJobStage(job.stage)) {
          this.repository.updateStage(job.projectId, job.stage, {
            state: "QUEUED",
            progress: 0,
            message: retryMessage,
            jobId,
            error,
          });
        }
        this.logger.warn({ jobId, projectId: job.projectId, stage: job.stage, attempt: job.attempt, durationMs, error }, "Pipeline job retry scheduled");
        return;
      }
      this.repository.updateJob(jobId, { status: "FAILED", error, finishedAt, message: error.message });
      publishAgentEvent({
        type: isPublishStage(job.stage) ? "publish_failed" : "stage_failed",
        projectId: job.projectId, stage: job.stage, summary: error.message,
      });
      if (isSideJobStage(job.stage)) {
        if (job.stage === "CLIP") {
          this.repository.updateProject(job.projectId, { status: "FAILED", stage: "RENDER" });
        }
        this.logger.error({ jobId, projectId: job.projectId, stage: job.stage, attempt: job.attempt, durationMs, error }, isPublishStage(job.stage) ? "Publish job failed" : "Clip job failed");
        return;
      }
      this.repository.updateStage(job.projectId, job.stage, {
        state: "FAILED",
        progress: job.progress,
        message: error.message,
        error,
      });
      this.updateProjectStatus(job.projectId, job.stage);
      this.logger.error({ jobId, projectId: job.projectId, stage: job.stage, attempt: job.attempt, durationMs, error }, "Pipeline job failed");
      const project = this.repository.getProject(job.projectId);
      if (project) {
        if (job.stage === "RENDER") {
          safeNotify(this.notifications, {
            kind: "render_failed",
            projectId: job.projectId,
            project: project.title,
            error: error.message,
          });
        } else {
          safeNotify(this.notifications, {
            kind: "stage_failed",
            projectId: job.projectId,
            project: project.title,
            stage: job.stage,
            error: error.message,
          });
        }
      }
    });
  }

  resumeRunningJobs(): void {
    this.repository.atomic(() => {
      for (const job of this.repository.getRunningJobs()) {
        if (this.heldByNode(job)) continue;
        this.requeueInterruptedJob(job, "Resuming after server restart");
      }
    });
  }

  requeueRunningJobs(): void {
    this.repository.atomic(() => {
      for (const job of this.repository.getRunningJobs()) {
        if (this.heldByNode(job)) continue;
        this.requeueInterruptedJob(job, "Queued for resume after shutdown");
      }
    });
  }

  /** A job leased to a worker node with a live lease keeps running when this server restarts. */
  private heldByNode(job: Job): boolean {
    const lease = this.repository.getJobLease(job.id);
    return Boolean(lease && Date.parse(lease.leaseUntil) > this.now().getTime());
  }

  private requeueInterruptedJob(job: Job, prefix: string): void {
    const progress = this.checkpointProgress(job);
    const previous = this.progressDetail(job);
    const message = previous ? `${prefix} · ${previous}` : prefix;
    this.repository.updateJob(job.id, {
      status: "QUEUED",
      startedAt: null,
      finishedAt: null,
      progress,
      message,
    });
    if (isSideJobStage(job.stage)) return;
    this.repository.updateStage(job.projectId, job.stage, {
      state: "QUEUED",
      progress,
      message,
      jobId: job.id,
    });
    this.updateProjectStatus(job.projectId, job.stage);
  }

  private progressDetail(job: Job): string {
    const stage = isSideJobStage(job.stage) ? null : this.repository.getStage(job.projectId, job.stage);
    const previous = (stage?.message || job.message || "").trim();
    if (!previous) return "";
    if (
      previous === "Stage started"
      || previous === "Waiting for a worker"
      || previous.startsWith("Resuming after server restart")
      || previous.startsWith("Queued for resume after shutdown")
    ) return "";
    return previous;
  }

  private checkpointProgress(job: Job): number {
    const stage = isSideJobStage(job.stage) ? null : this.repository.getStage(job.projectId, job.stage);
    let progress = Math.max(job.progress ?? 0, stage?.progress ?? 0);
    if (job.stage !== "VISUAL_SEARCH") return progress;
    const checkpointCount = (this.repository.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM visual_search_checkpoints WHERE project_id = ?",
    ).get(job.projectId) as { count: number }).count;
    const sceneCount = (this.repository.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM scenes WHERE project_id = ?",
    ).get(job.projectId) as { count: number }).count;
    const denom = Math.max(sceneCount, checkpointCount);
    if (checkpointCount > 0 && denom > 0) {
      progress = Math.max(progress, Math.min(55, Math.round((checkpointCount / denom) * 55)));
    }
    return progress;
  }

  private enqueue(projectId: string, stage: PipelineStage): Job {
    const previousState = this.repository.getStage(projectId, stage).state;
    const previous = previousState === "DONE" ? "STALE" : previousState;
    const job = this.repository.createJob({
      projectId,
      stage,
      maxAttempts: this.config.JOB_MAX_ATTEMPTS,
      previousState: previous,
      runAfter: this.now(),
    });
    this.repository.updateStage(projectId, stage, {
      state: "QUEUED",
      progress: 0,
      message: "Waiting for a worker",
      jobId: job.id,
      error: null,
    });
    this.wakeWorker();
    return job;
  }

  private continueAll(projectId: string, _afterIndex?: number): void {
    void _afterIndex;
    for (let guard = 0; guard < 24; guard += 1) {
      if (!this.advanceLanes(projectId)) break;
    }
    this.refreshLaneStatus(projectId);
  }

  private advanceLanes(projectId: string): boolean {
    const project = this.requireProject(projectId);
    const stages = this.repository.getStages(projectId);
    const byStage = new Map(stages.map((stage) => [stage.stage, stage]));
    const satisfied = (stage: PipelineStage) => {
      const state = byStage.get(stage)?.state;
      return state === "DONE" || state === "SKIPPED";
    };
    const active = this.repository.getActiveJobs(projectId).filter((job) => !isSideJobStage(job.stage));
    const laneBusy = (lane: "visual" | "audio" | null) => {
      if (lane === null) return active.length > 0;
      return active.some((job) => {
        const other = jobLane(job.stage);
        return other === null || other === lane;
      });
    };
    const picked = new Set<"visual" | "audio" | "main">();
    const candidates: PipelineStage[] = [];
    for (const stage of STAGE_ORDER) {
      const record = byStage.get(stage);
      const state = record?.state ?? "PENDING";
      if (state === "DONE" || state === "SKIPPED" || state === "QUEUED" || state === "RUNNING" || state === "WAITING_USER" || state === "FAILED") continue;
      if (record?.message === LANE_CANCELLED_MESSAGE) continue;
      if (!STAGE_DEPENDS[stage].every((dep) => satisfied(dep))) continue;
      if (!this.earlierLaneSettled(stage, byStage)) continue;
      const lane = stageLane(stage) ?? "main";
      if (picked.has(lane)) continue;
      if (lane === "main" && (picked.has("visual") || picked.has("audio"))) continue;
      if (lane !== "main" && picked.has("main")) continue;
      if (laneBusy(lane === "main" ? null : lane)) continue;
      picked.add(lane);
      candidates.push(stage);
    }
    if (candidates.length === 0) return false;
    for (const stage of candidates) this.startReadyStage(projectId, project, stage);
    return true;
  }

  private earlierLaneSettled(stage: PipelineStage, byStage: Map<PipelineStage, StageRecord>): boolean {
    const lane = stageLane(stage);
    if (lane === null) return true;
    for (const earlier of STAGE_ORDER) {
      if (earlier === stage) break;
      if (stageLane(earlier) !== lane) continue;
      const state = byStage.get(earlier)?.state;
      if (state !== "DONE" && state !== "SKIPPED") return false;
    }
    return true;
  }

  private startReadyStage(projectId: string, project: Project, stage: PipelineStage): void {
    if (stage === "VOICE" && project.settings.stageExecutors.voice === "USER") {
      if (!this.hasAllUserVoiceTracks(projectId)) {
        this.waitForUser(projectId, stage, "Upload a voice track for every narrated scene, then continue.");
        return;
      }
      this.repository.updateStage(projectId, "VOICE", {
        state: "DONE",
        progress: 100,
        message: "Provided by user",
        jobId: null,
        error: null,
      });
      return;
    }
    if ((stage === "RESEARCH" || stage === "SCRIPT") && project.settings.stageExecutors.script === "USER") {
      const script = this.repository.getScriptOrigin(projectId);
      const userScriptExists = script !== undefined && (script.origin === "USER" || script.edited);
      if (stage === "RESEARCH" && userScriptExists) {
        this.repository.updateStage(projectId, "RESEARCH", {
          state: "SKIPPED",
          progress: 100,
          message: "Skipped for user-provided script",
          jobId: null,
          error: null,
        });
        return;
      }
      if (stage === "SCRIPT" && userScriptExists) {
        this.repository.updateStage(projectId, "SCRIPT", {
          state: "DONE",
          progress: 100,
          message: "Provided by user",
          jobId: null,
          error: null,
        });
        return;
      }
      this.waitForUser(projectId, stage);
      return;
    }
    if (stage === "RESEARCH" && storyModeForProject(project) === "off") {
      this.skipResearch(projectId, "Skipped (research mode is off)");
      return;
    }
    if (isGate(stage)) {
      const autoApprove = project.mode === "AUTO" && (stage !== "FINAL_APPROVAL" || project.settings.autoRender);
      const approval = this.canApprove(project, stage);
      const blockReason = autoApprove && approval.allowed ? this.autoBlock(project, stage) : null;
      if (blockReason) this.logger.warn({ projectId, gate: stage, reason: blockReason }, "AUTO approval paused");
      if (autoApprove && approval.allowed && !blockReason) {
        this.repository.updateStage(projectId, stage, {
          state: "DONE",
          progress: 100,
          message: "Auto-approved (AUTO mode)",
          jobId: null,
          error: null,
        });
        return;
      }
      this.repository.updateStage(projectId, stage, {
        state: "WAITING_USER",
        progress: 0,
        message: blockReason ?? (approval.allowed ? "Waiting for your approval" : approval.message),
        jobId: null,
        error: null,
      });
      this.emitWaitingApproval(project, stage);
      return;
    }
    this.enqueue(projectId, stage);
  }

  private refreshLaneStatus(projectId: string): void {
    const stages = this.repository.getStages(projectId);
    const waiting = STAGE_ORDER.find((stage) => stages.find((item) => item.stage === stage)?.state === "WAITING_USER");
    const active = this.repository.getActiveJobs(projectId).find((job) => !isSideJobStage(job.stage));
    const unfinished = STAGE_ORDER.find((stage) => {
      const state = stages.find((item) => item.stage === stage)?.state;
      return state !== "DONE" && state !== "SKIPPED";
    });
    if (!waiting && !active && !unfinished) {
      this.repository.updateProject(projectId, { stage: "DONE", status: "COMPLETED", runMode: null });
      return;
    }
    this.updateProjectStatus(projectId, waiting ?? active?.stage ?? unfinished ?? "TOPIC");
  }

  private unmetDependency(projectId: string, stage: PipelineStage): PipelineStage | undefined {
    return STAGE_DEPENDS[stage].find((dep) => {
      const state = this.repository.getStage(projectId, dep).state;
      return state !== "DONE" && state !== "SKIPPED";
    });
  }

  private clearLaneCancels(projectId: string): void {
    for (const stage of STAGE_ORDER) {
      const record = this.repository.getStage(projectId, stage);
      if (record.message === LANE_CANCELLED_MESSAGE && (record.state === "PENDING" || record.state === "STALE")) {
        this.repository.updateStage(projectId, stage, { message: null });
      }
    }
  }

  private assertCanStart(projectId: string, stage: PipelineStage): void {
    const active = this.repository.getActiveJobs(projectId).filter((job) => !isSideJobStage(job.stage));
    if (active.length === 0) return;
    const lane = jobLane(stage);
    if (lane === null || active.some((job) => jobLane(job.stage) === null || jobLane(job.stage) === lane)) {
      this.invalid("A job is already active for this project.");
    }
  }

  private waitForUser(projectId: string, stage: PipelineStage, message = "Write or paste your script in the Script tab"): void {
    this.repository.updateStage(projectId, stage, {
      state: "WAITING_USER",
      progress: 0,
      message,
      jobId: null,
      error: null,
    });
    this.repository.updateProject(projectId, { stage, status: "REVIEW" });
    const project = this.repository.getProject(projectId);
    if (project) this.emitWaitingApproval(project, stage);
  }

  /**
   * waiting_approval only when a person must act.
   * AUTO / automation projects: no approval notify; unexpected stuck gate → attention.
   */
  private emitWaitingApproval(project: Project, gate: PipelineStage): void {
    const link = `${this.webBaseUrl()}/projects/${project.id}`;
    const isAuto = project.mode === "AUTO" || Boolean(project.settings.autoRender);
    const detail = this.repository.getStage(project.id, gate).message ?? undefined;
    if (isAuto) {
      safeNotify(this.notifications, {
        kind: "waiting_approval",
        projectId: project.id,
        project: project.title,
        gate,
        link,
        unexpectedAutoStop: true,
        ...(detail ? { detail } : {}),
      });
      return;
    }
    safeNotify(this.notifications, {
      kind: "waiting_approval",
      projectId: project.id,
      project: project.title,
      gate,
      link,
    });
    publishAgentEvent({
      type: "waiting_approval", projectId: project.id, projectTitle: project.title, gate, link, summary: `Chờ duyệt ${gate}`,
    });
  }

  private hasAllUserVoiceTracks(projectId: string): boolean {
    const missing = this.repository.sqlite.prepare(
      `SELECT COUNT(*) AS count
       FROM scenes s
       LEFT JOIN voice_tracks v ON v.scene_id = s.id
       WHERE s.project_id = ? AND length(trim(s.narration)) > 0 AND v.id IS NULL`,
    ).get(projectId) as { count: number };
    return missing.count === 0;
  }

  private skipResearch(projectId: string, message: string): void {
    this.repository.updateStage(projectId, "RESEARCH", {
      state: "SKIPPED",
      progress: 100,
      message,
      jobId: null,
      error: null,
    });
  }

  private updateProjectStatus(projectId: string, projectStage: PipelineStage): void {
    const activeJob = this.repository.getActiveJobs(projectId).find((job) => !isSideJobStage(job.stage)) ?? null;
    const stages = this.repository.getStages(projectId);
    const waiting = STAGE_ORDER.find((stage) => stages.find((item) => item.stage === stage)?.state === "WAITING_USER");
    const stage = waiting ?? projectStage;
    const status = deriveProjectStatus({ activeJob, stages, projectStage: stage });
    this.repository.updateProject(projectId, { status, stage });
  }

  private renderSlotsFull(job: Job): boolean {
    if (job.stage !== "RENDER") return false;
    const running = (this.repository.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM jobs WHERE stage = 'RENDER' AND status = 'RUNNING'",
    ).get() as { count: number }).count;
    return running >= this.config.RENDER_CONCURRENCY;
  }

  private previousCompletedStage(stages: StageRecord[], canceledStage: PipelineStage): PipelineStage {
    const canceledIndex = STAGE_ORDER.indexOf(canceledStage);
    for (let index = canceledIndex - 1; index >= 0; index -= 1) {
      const prior = stages.find((stage) => stage.stage === STAGE_ORDER[index]);
      if (prior?.state === "DONE" || prior?.state === "SKIPPED") return prior.stage;
    }
    return "TOPIC";
  }

  private requireProject(projectId: string): Project {
    const project = this.repository.getProject(projectId);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return project;
  }

  private requirePipeline(projectId: string): PipelineState {
    const state = this.repository.getPipeline(projectId);
    if (!state) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return state;
  }

  private invalid(message: string): never {
    throw new AppError(409, "INVALID_PIPELINE_STATE", message);
  }
}
