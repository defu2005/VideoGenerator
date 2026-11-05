import type { FastifyBaseLogger } from "fastify";
import type { Job, JobError, PipelineStage } from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { StageError } from "../pipeline/stageExecutor.js";
import type { StageExecutor } from "../pipeline/stageExecutor.js";
import { ImageDownloadError } from "../services/imageStore.js";
import { LlmError } from "../providers/llm/types.js";
import { isRetryableDownloadError } from "../services/visualService.js";
import { JobRepository } from "./jobRepository.js";
import { PipelineOrchestrator } from "../pipeline/orchestrator.js";

type Clock = () => Date;
type RunningTask = { controller: AbortController; promise: Promise<void> };

/** Map thrown stage errors to JobError; 401/403/404/410 image downloads are never retryable. */
export function jobErrorFromCaught(error: unknown): JobError {
  if (error instanceof StageError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.retryAt ? { retryAt: error.retryAt } : {}),
    };
  }
  if (error instanceof LlmError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.retryAt ? { retryAt: error.retryAt } : {}),
    };
  }
  if (error instanceof AppError && error.code === "IMAGE_DOWNLOAD_FAILED") {
    return {
      code: error.code,
      message: error.message,
      retryable: isRetryableDownloadError(error),
    };
  }
  if (error instanceof ImageDownloadError) {
    return {
      code: "IMAGE_DOWNLOAD_FAILED",
      message: error.message,
      retryable: isRetryableDownloadError(error),
    };
  }
  return {
    code: "STAGE_EXECUTION_FAILED",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

export class JobWorker {
  private readonly running = new Map<string, RunningTask>();
  private timer: NodeJS.Timeout | undefined;
  private started = false;
  private stopping = false;
  private wakeQueued = false;

  constructor(
    private readonly repository: JobRepository,
    private readonly orchestrator: PipelineOrchestrator,
    private readonly executors: Map<PipelineStage, StageExecutor>,
    private readonly config: AppConfig,
    private readonly logger: FastifyBaseLogger,
    private readonly now: Clock = () => new Date(),
  ) {
    this.orchestrator.setAbortJobHandler((jobId) => this.abort(jobId));
    this.orchestrator.setWakeHandler(() => this.wake());
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.orchestrator.resumeRunningJobs();
    if (this.config.WORKER_ENABLED) this.wake();
  }

  async tick(): Promise<void> {
    if (this.stopping) return;
    const started: Promise<void>[] = [];
    while (this.running.size < this.config.WORKER_CONCURRENCY) {
      const job = this.repository.getNextQueuedJob(this.now());
      if (!job) break;
      const claimed = this.orchestrator.startJob(job.id);
      if (!claimed) continue;
      const controller = new AbortController();
      const promise = this.run(claimed, controller).finally(() => {
        this.running.delete(claimed.id);
        if (!this.stopping && this.config.WORKER_ENABLED) this.wake();
      });
      this.running.set(claimed.id, { controller, promise });
      started.push(promise);
    }
    if (started.length === 0 && this.config.WORKER_ENABLED && !this.timer) this.schedule(1_000);
    await Promise.all(started);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (const task of this.running.values()) task.controller.abort();
    this.orchestrator.requeueRunningJobs();
    await Promise.all([...this.running.values()].map(({ promise }) => promise));
    this.started = false;
  }

  abort(jobId: string): void {
    this.running.get(jobId)?.controller.abort();
  }

  listenerCount(): number {
    return this.running.size;
  }

  private wake(): void {
    if (!this.started || this.stopping || !this.config.WORKER_ENABLED || this.wakeQueued) return;
    this.wakeQueued = true;
    if (this.timer) clearTimeout(this.timer);
    this.schedule(0);
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.wakeQueued = false;
      void this.tick();
    }, delay);
  }

  private async run(job: Job, controller: AbortController): Promise<void> {
    const project = this.repository.getProject(job.projectId);
    const executor = this.executors.get(job.stage);
    if (!project || !executor) {
      this.orchestrator.failJob(job.id, {
        code: project ? "STAGE_EXECUTOR_NOT_FOUND" : "PROJECT_NOT_FOUND",
        message: project ? `No executor registered for ${job.stage}` : "Project was deleted before the job started",
        retryable: false,
      });
      return;
    }

    let timedOut = false;
    const startedAt = this.now().getTime();
    let lastProgressAt = 0;
    let lastProgress = -5;
    const logger = this.logger.child({ jobId: job.id, projectId: job.projectId, stage: job.stage });
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new StageError(`Stage timed out after ${this.config.STAGE_TIMEOUT_MS}ms`, "STAGE_TIMEOUT", true));
      }, this.config.STAGE_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([
        executor.run({
          project,
          job,
          signal: controller.signal,
          logger,
          reportProgress: (progress, message) => {
            const timestamp = this.now().getTime();
            if (progress < 100 && timestamp - lastProgressAt < 250 && progress - lastProgress < 5) return;
            lastProgressAt = timestamp;
            lastProgress = progress;
            this.orchestrator.reportProgress(job.id, progress, message);
          },
          recordUsage: (usage) => this.orchestrator.recordUsage(job.id, usage),
        }),
        timeoutPromise,
      ]);
      if (this.stopping) return;
      this.orchestrator.completeJob(job.id, result.message);
    } catch (error) {
      if (this.stopping) return;
      if (timedOut) {
        this.orchestrator.failJob(job.id, {
          code: "STAGE_TIMEOUT",
          message: `Stage timed out after ${this.config.STAGE_TIMEOUT_MS}ms`,
          retryable: true,
        });
      } else {
        this.orchestrator.failJob(job.id, jobErrorFromCaught(error));
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const durationMs = this.now().getTime() - startedAt;
      logger.debug({ attempt: job.attempt, durationMs }, "Pipeline worker execution completed");
    }
  }
}
