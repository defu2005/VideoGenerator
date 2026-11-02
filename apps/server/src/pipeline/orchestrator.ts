import {
  GATES,
  STAGE_ORDER,
  isGate,
  type Job,
  type JobError,
  type JobUsage,
  type PipelineStage,
  type PipelineState,
  type Project,
  type ProjectStatus,
  type StageRecord,
  type StageState,
} from "@vg/shared";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { JobRepository } from "../jobs/jobRepository.js";
import { markStaleFrom } from "./invalidation.js";

export type ApprovalCheck = (project: Project, gate: PipelineStage) => { allowed: true } | { allowed: false; message: string };
type Clock = () => Date;

export function deriveProjectStatus(input: {
  activeJob: Pick<Job, "stage"> | null;
  stages: Pick<StageRecord, "state">[];
  projectStage: PipelineStage;
}): ProjectStatus {
  if (input.activeJob?.stage === "RENDER") return "RENDERING";
  if (input.activeJob) return "GENERATING";
  if (input.stages.some((stage) => stage.state === "WAITING_USER")) return "REVIEW";
  if (input.stages.some((stage) => stage.state === "FAILED")) return "FAILED";
  if (input.projectStage === "DONE") return "COMPLETED";
  return "DRAFT";
}

export class PipelineOrchestrator {
  private abortJob: (jobId: string) => void = () => undefined;
  private wakeWorker: () => void = () => undefined;

  constructor(
    readonly repository: JobRepository,
    private readonly config: AppConfig,
    private readonly logger: FastifyBaseLogger,
    private readonly now: Clock = () => new Date(),
    private readonly canApprove: ApprovalCheck = () => ({ allowed: true }),
  ) {}

  setAbortJobHandler(handler: (jobId: string) => void): void {
    this.abortJob = handler;
  }

  setWakeHandler(handler: () => void): void {
    this.wakeWorker = handler;
  }

  getPipeline(projectId: string): PipelineState {
    return this.requirePipeline(projectId);
  }

  runAll(projectId: string): PipelineState {
    this.repository.atomic(() => {
      this.requireProject(projectId);
      this.repository.ensureStages(projectId);
      this.assertNoActiveJob(projectId);
      this.repository.setRunMode(projectId, "ALL");
      this.continueAll(projectId, -1);
    });
    return this.requirePipeline(projectId);
  }

  runStage(projectId: string, stage: PipelineStage): PipelineState {
    this.repository.atomic(() => {
      this.requireProject(projectId);
      this.repository.ensureStages(projectId);
      this.assertNoActiveJob(projectId);
      const position = STAGE_ORDER.indexOf(stage);
      if (position < 0) this.invalid(`${stage} is not a runnable pipeline stage.`);
      if (isGate(stage)) this.invalid(`Review stage ${stage} must be approved, not run.`);
      const stages = this.repository.getStages(projectId);
      const incomplete = stages.find((item, index) => index < position && item.state !== "DONE" && item.state !== "SKIPPED");
      if (incomplete) this.invalid(`Complete ${incomplete.stage} before running ${stage}.`);
      if (this.repository.getStage(projectId, stage).state === "DONE") {
        markStaleFrom(this.repository, projectId, stage);
      }
      this.repository.setRunMode(projectId, "SINGLE");
      this.enqueue(projectId, stage);
      this.updateProjectStatus(projectId, stage);
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
        this.continueAll(projectId, STAGE_ORDER.indexOf(gate));
      } else {
        this.repository.setRunMode(projectId, null);
        this.updateProjectStatus(projectId, gate);
      }
    });
    return this.requirePipeline(projectId);
  }

  cancel(projectId: string): PipelineState {
    const activeJob = this.repository.getActiveJob(projectId);
    if (!activeJob) this.invalid("There is no active job to cancel.");
    if (activeJob.status === "RUNNING") this.abortJob(activeJob.id);
    this.repository.atomic(() => {
      const job = this.repository.getJob(activeJob.id);
      if (!job || (job.status !== "QUEUED" && job.status !== "RUNNING")) this.invalid("The active job has already finished.");
      const previousState = this.repository.getPreviousState(job.id);
      this.repository.updateJob(job.id, {
        status: "CANCELLED",
        finishedAt: this.now().toISOString(),
        error: null,
      });
      this.repository.updateStage(projectId, job.stage, {
        state: previousState === "DONE" ? "STALE" : previousState,
        progress: 0,
        message: null,
        jobId: null,
        error: null,
      });
      this.repository.setRunMode(projectId, null);
      const stages = this.repository.getStages(projectId);
      const previousStage = this.previousCompletedStage(stages, job.stage);
      this.updateProjectStatus(projectId, previousStage);
    });
    return this.requirePipeline(projectId);
  }

  retry(projectId: string, stage: PipelineStage): PipelineState {
    this.repository.atomic(() => {
      this.requireProject(projectId);
      this.repository.ensureStages(projectId);
      this.assertNoActiveJob(projectId);
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

  startJob(jobId: string): Job | undefined {
    return this.repository.atomic(() => {
      const job = this.repository.getJob(jobId);
      if (!job || job.status !== "QUEUED") return undefined;
      const running = this.repository.updateJob(jobId, {
        status: "RUNNING",
        startedAt: this.now().toISOString(),
        finishedAt: null,
        error: null,
        message: "Stage started",
      });
      this.repository.updateStage(job.projectId, job.stage, {
        state: "RUNNING",
        progress: 0,
        message: "Stage started",
        jobId,
        error: null,
      });
      this.updateProjectStatus(job.projectId, job.stage);
      this.logger.info({ jobId, projectId: job.projectId, stage: job.stage, attempt: job.attempt }, "Pipeline job started");
      return running;
    });
  }

  reportProgress(jobId: string, progress: number, message?: string): void {
    this.repository.atomic(() => {
      const job = this.repository.getJob(jobId);
      if (!job || job.status !== "RUNNING") return;
      const next = this.repository.updateJob(jobId, { progress, message: message ?? job.message });
      this.repository.updateStage(job.projectId, job.stage, {
        progress,
        message: message ?? job.message,
        jobId,
      });
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
        },
      });
    });
  }

  completeJob(jobId: string, message?: string): void {
    this.repository.atomic(() => {
      const job = this.repository.getJob(jobId);
      if (!job || job.status !== "RUNNING") return;
      const finishedAt = this.now().toISOString();
      this.repository.updateJob(jobId, {
        status: "SUCCEEDED",
        progress: 100,
        message: message ?? `${job.stage} completed`,
        finishedAt,
      });
      this.repository.updateStage(job.projectId, job.stage, {
        state: "DONE",
        progress: 100,
        message: message ?? `${job.stage} completed`,
        error: null,
      });
      const runMode = this.repository.getRunMode(job.projectId);
      if (runMode === "ALL") {
        this.repository.updateProject(job.projectId, { stage: job.stage });
        this.continueAll(job.projectId, STAGE_ORDER.indexOf(job.stage));
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
      if (error.retryable && job.attempt < job.maxAttempts) {
        const delay = this.config.JOB_RETRY_BASE_MS * 2 ** (job.attempt - 1);
        const runAfter = new Date(this.now().getTime() + delay);
        this.repository.updateJob(jobId, {
          status: "QUEUED",
          attempt: job.attempt + 1,
          runAfter: runAfter.toISOString(),
          startedAt: null,
          finishedAt: null,
          message: `Retry scheduled: ${error.message}`,
          error,
        });
        this.repository.updateStage(job.projectId, job.stage, {
          state: "QUEUED",
          progress: 0,
          message: `Retry scheduled: ${error.message}`,
          jobId,
          error,
        });
        this.logger.warn({ jobId, projectId: job.projectId, stage: job.stage, attempt: job.attempt, durationMs, error }, "Pipeline job retry scheduled");
        return;
      }
      this.repository.updateJob(jobId, { status: "FAILED", error, finishedAt, message: error.message });
      this.repository.updateStage(job.projectId, job.stage, {
        state: "FAILED",
        progress: job.progress,
        message: error.message,
        error,
      });
      const stages = this.repository.getStages(job.projectId);
      this.repository.updateProject(job.projectId, {
        status: deriveProjectStatus({ activeJob: null, stages, projectStage: job.stage }),
        stage: job.stage,
      });
      this.logger.error({ jobId, projectId: job.projectId, stage: job.stage, attempt: job.attempt, durationMs, error }, "Pipeline job failed");
    });
  }

  resumeRunningJobs(): void {
    this.repository.atomic(() => {
      for (const job of this.repository.getRunningJobs()) {
        this.repository.updateJob(job.id, {
          status: "QUEUED",
          startedAt: null,
          finishedAt: null,
          message: "Resuming after server restart",
        });
        this.repository.updateStage(job.projectId, job.stage, {
          state: "QUEUED",
          progress: 0,
          message: "Resuming after server restart",
          jobId: job.id,
        });
        this.updateProjectStatus(job.projectId, job.stage);
      }
    });
  }

  requeueRunningJobs(): void {
    this.repository.atomic(() => {
      for (const job of this.repository.getRunningJobs()) {
        this.repository.updateJob(job.id, {
          status: "QUEUED",
          startedAt: null,
          finishedAt: null,
          message: "Queued for resume after shutdown",
        });
        this.repository.updateStage(job.projectId, job.stage, {
          state: "QUEUED",
          progress: 0,
          message: "Queued for resume after shutdown",
          jobId: job.id,
        });
        this.updateProjectStatus(job.projectId, job.stage);
      }
    });
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

  private continueAll(projectId: string, afterIndex: number): void {
    const stages = this.repository.getStages(projectId);
    const next = STAGE_ORDER.find((stage, index) => index > afterIndex && !["DONE", "SKIPPED"].includes(stages[index]?.state ?? "PENDING"));
    if (!next) {
      this.repository.updateProject(projectId, { stage: "DONE", status: "COMPLETED", runMode: null });
      return;
    }
    if (isGate(next)) {
      const project = this.requireProject(projectId);
      const autoApprove = project.mode === "AUTO"
        && (next !== "FINAL_APPROVAL" || project.settings.autoRender);
      if (autoApprove) {
        this.repository.updateStage(projectId, next, {
          state: "DONE",
          progress: 100,
          message: "Auto-approved (AUTO mode)",
          jobId: null,
          error: null,
        });
        this.repository.updateProject(projectId, { stage: next });
        this.continueAll(projectId, STAGE_ORDER.indexOf(next));
        return;
      }
      this.repository.updateStage(projectId, next, {
        state: "WAITING_USER",
        progress: 0,
        message: "Waiting for your approval",
        jobId: null,
        error: null,
      });
      this.repository.updateProject(projectId, { stage: next, status: "REVIEW" });
      return;
    }
    this.enqueue(projectId, next);
    this.updateProjectStatus(projectId, next);
  }

  private updateProjectStatus(projectId: string, projectStage: PipelineStage): void {
    const activeJob = this.repository.getActiveJob(projectId);
    const stages = this.repository.getStages(projectId);
    const status = deriveProjectStatus({ activeJob, stages, projectStage });
    this.repository.updateProject(projectId, { status, stage: projectStage });
  }

  private previousCompletedStage(stages: StageRecord[], canceledStage: PipelineStage): PipelineStage {
    const canceledIndex = STAGE_ORDER.indexOf(canceledStage);
    for (let index = canceledIndex - 1; index >= 0; index -= 1) {
      const prior = stages.find((stage) => stage.stage === STAGE_ORDER[index]);
      if (prior?.state === "DONE" || prior?.state === "SKIPPED") return prior.stage;
    }
    return "TOPIC";
  }

  private assertNoActiveJob(projectId: string): void {
    if (this.repository.getActiveJob(projectId)) this.invalid("A job is already active for this project.");
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
