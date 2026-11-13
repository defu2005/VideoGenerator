import { runIndexJob } from "../retrieval/service.js";
import type { FastifyBaseLogger } from "fastify";
import { PROTECTED_PROJECT_ID, STAGE_TIMEOUT_LABELS_VI, isPlannedTimeoutStage, resolveStageTimeoutMs, retryStageTimeoutMs, stageTimeoutCapMs, timeoutBriefFromSettings, type Job, type JobError, type PipelineStage, type Project } from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { StageError } from "../pipeline/stageExecutor.js";
import type { StageExecutor } from "../pipeline/stageExecutor.js";
import { ImageDownloadError } from "../services/imageStore.js";
import { LlmError } from "../providers/llm/types.js";
import { isRetryableDownloadError } from "../services/visualService.js";
import { JobRepository } from "./jobRepository.js";
import { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import { effectiveAutonomy } from "../operator/autonomy.js";
import { readDrain } from "../operator/autopilot.js";
import { autonomyBudgetStatus, hasAutonomySpendLimit, recordBudgetFindings, runWithAutonomyBudget } from "../operator/autonomyBudget.js";
import type { UsageService } from "../services/usageService.js";
import { ActivityTracker, clearOverdue } from "./overdueStore.js";
import type { ResourceGovernor } from "./resourceGovernor.js";
import { OverdueRun, type DecideInput, type DecideResult, type OverdueAbortKind, type OverdueDeps } from "./overdueRun.js";

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

export function overdueAbortError(kind: OverdueAbortKind, reason: string): JobError {
  return kind === "abort_retry"
    ? { code: "STAGE_TIMEOUT", message: `Bước chạy quá lâu, đã dừng để thử lại. ${reason}`, retryable: true }
    : { code: "STAGE_OVERDUE_ABORTED", message: `Bước chạy quá lâu, đã dừng hẳn. ${reason}`, retryable: false };
}

export class JobWorker {
  private indexTask: Promise<void> | undefined;
  private readonly indexAbort = new AbortController();
  private readonly running = new Map<string, RunningTask>();
  private timer: NodeJS.Timeout | undefined;
  private started = false;
  private stopping = false;
  private wakeQueued = false;
  private lastClaim: string | null = null;
  private startedAt: string | null = null;
  private sweep: (() => void) | undefined;
  private sweepTimer: NodeJS.Timeout | undefined;
  private placement: ((job: Job, now: Date) => boolean) | undefined;
  private governor: ResourceGovernor | undefined;
  private overdueDeps: Omit<OverdueDeps, "now" | "notify"> | undefined;
  private readonly overdueRuns = new Map<string, OverdueRun>();

  constructor(
    private readonly repository: JobRepository,
    private readonly orchestrator: PipelineOrchestrator,
    private readonly executors: Map<PipelineStage, StageExecutor>,
    private readonly config: AppConfig,
    private readonly logger: FastifyBaseLogger,
    private readonly now: Clock = () => new Date(),
    private readonly planTimeouts?: (project: Project, signal: AbortSignal) => Promise<void>,
    private readonly usageService?: UsageService,
  ) {
    this.orchestrator.setAbortJobHandler((jobId) => this.abort(jobId));
    this.orchestrator.setWakeHandler(() => this.wake());
    this.orchestrator.setOverdueDecider((jobId, input) => this.decideOverdue(jobId, input));
  }

  /** Runs every 10 s, also when the local worker is off: expires worker-node leases. */
  setSweep(fn: () => void): void {
    this.sweep = fn;
  }

  /** Says whether this machine may take a queued job now (false: leave it for a worker node). */
  setPlacement(fn: (job: Job, now: Date) => boolean): void {
    this.placement = fn;
  }

  /** TASK-129b: a class slot is needed to start a job; WORKER_CONCURRENCY stays the total upper bound. */
  setGovernor(governor: ResourceGovernor): void {
    this.governor = governor;
  }

  /** The governor calls this when a slot limit grows or shrinks. */
  onGovernorChange(): void {
    this.wake();
  }

  private hasClassSlot(job: Job): boolean {
    return !this.governor || this.governor.hasSlot(this.governor.classOf(job.stage));
  }

  /** TASK-125: wires the overdue checker (LLM registry, work dir, budget). Without it a stage past its limit is stopped as before. */
  setOverdue(deps: Omit<OverdueDeps, "now" | "notify">): void {
    this.overdueDeps = deps;
  }

  private deps(): OverdueDeps | null {
    return this.overdueDeps
      ? { ...this.overdueDeps, now: this.now, notify: (job, message) => this.orchestrator.notifyOverdue(job, message) }
      : null;
  }

  /** Hermes and the user both decide through here. Refuses when the job is no longer overdue. */
  decideOverdue(jobId: string, input: DecideInput): DecideResult {
    const run = this.overdueRuns.get(jobId);
    if (!run || run.isStopped) return { ok: false, message: "Bước này không còn quá thời gian dự kiến, không cần quyết định." };
    return run.decide(input);
  }

  /** Remote jobs (worker-node leases): same checker, facts from the heartbeat. Never a clock kill. */
  private sweepRemote(): void {
    const deps = this.deps();
    if (!deps) return;
    const db = this.repository.sqlite;
    const now = this.now().getTime();
    for (const [jobId, run] of this.overdueRuns) {
      if (this.running.has(jobId)) continue;
      const row = db.prepare("SELECT status, lease_id FROM jobs WHERE id = ?").get(jobId) as { status: string; lease_id: string | null } | undefined;
      if (!row || row.status !== "RUNNING" || !row.lease_id) {
        run.stop();
        this.overdueRuns.delete(jobId);
        clearOverdue(db, jobId);
      }
    }
    const rows = db.prepare("SELECT id FROM jobs WHERE status = 'RUNNING' AND lease_id IS NOT NULL AND started_at IS NOT NULL").all() as { id: string }[];
    for (const { id } of rows) {
      if (this.running.has(id) || this.overdueRuns.has(id)) continue;
      const job = this.repository.getJob(id);
      const project = job ? this.repository.getProject(job.projectId) : undefined;
      if (!job || !project || !job.startedAt) continue;
      const brief = timeoutBriefFromSettings(project.settings, project.topic);
      const limitMs = resolveStageTimeoutMs({ ...brief, stageTimeouts: project.settings.stageTimeouts }, job.stage, this.config.STAGE_TIMEOUT_MS);
      if (now - Date.parse(job.startedAt) < limitMs) continue;
      const entry = project.settings.stageTimeouts?.stages?.[job.stage];
      const run = new OverdueRun({
        deps, job, project, onOverdue: project.settings.onOverdue === "notify_only" ? "notify_only" : "check",
        tracker: new ActivityTracker(Date.parse(job.startedAt)),
        startedAtMs: Date.parse(job.startedAt), expectedMs: entry?.expectedMs ?? Math.round(limitMs / 2), limitMs,
        maxAttempts: job.maxAttempts, historyNote: null, remote: true,
        remoteFacts: () => {
          const r = db.prepare("SELECT heartbeat_at, progress, message FROM jobs WHERE id = ?").get(id) as
            { heartbeat_at: string | null; progress: number; message: string | null } | undefined;
          return { heartbeatAgeMs: r?.heartbeat_at ? Math.max(0, this.now().getTime() - Date.parse(r.heartbeat_at)) : null, progress: r?.progress ?? 0, message: r?.message ?? null };
        },
        abort: (kind, reason) => {
          this.orchestrator.failJob(id, overdueAbortError(kind, reason));
          this.repository.setJobLease(id, null);
          this.overdueRuns.delete(id);
        },
      });
      this.overdueRuns.set(id, run);
      run.start();
    }
  }

  private localMayTake(job: Job, now: Date): boolean {
    return !this.placement || this.placement(job, now);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.startedAt = this.now().toISOString();
    this.stopping = false;
    this.orchestrator.resumeRunningJobs();
    if (this.sweep && !this.sweepTimer) {
      const run = this.sweep;
      this.sweepTimer = setInterval(() => {
        try {
          run();
          this.sweepRemote();
          if (this.config.WORKER_ENABLED) this.wake();
        } catch (error) {
          this.logger.error({ err: error }, "node sweep failed");
        }
      }, 10_000);
      this.sweepTimer.unref();
    }
    if (this.config.WORKER_ENABLED) this.wake();
  }

  async tick(): Promise<void> {
    if (this.stopping) return;
    void import("../events/webhooks.js").then(({ deliverBoundWebhooks }) => deliverBoundWebhooks(this.repository.sqlite)).catch(() => undefined);
    if (readDrain(this.repository.sqlite).draining) return;
    if (!this.indexTask) this.indexTask = runIndexJob(this.repository.sqlite,this.indexAbort.signal).finally(()=>{this.indexTask=undefined;});
    const started: Promise<void>[] = [];
    const skipped = new Set<string>();
    while (this.running.size < this.config.WORKER_CONCURRENCY) {
      const now = this.now();
      const job = this.repository.getNextQueuedJob(now, (candidate) =>
        !skipped.has(candidate.id) && this.hasClassSlot(candidate) && this.localMayTake(candidate, now) && this.orchestrator.canStartQueuedJob(candidate, now));
      if (!job) break;
      const claimed = this.orchestrator.startJob(job.id);
      if (!claimed) {
        skipped.add(job.id);
        continue;
      }
      this.lastClaim = claimed.startedAt;
      this.governor?.acquire(claimed.id, this.governor.classOf(claimed.stage));
      const controller = new AbortController();
      const promise = this.runBudgeted(claimed, controller).finally(() => {
        this.running.delete(claimed.id);
        this.governor?.release(claimed.id);
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
    this.indexAbort.abort();
    await this.indexTask;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    for (const task of this.running.values()) task.controller.abort();
    for (const run of this.overdueRuns.values()) run.stop();
    this.overdueRuns.clear();
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

  lastClaimAt(): string | null {
    return this.lastClaim ?? this.startedAt;
  }

  readySince(now: Date): string | null {
    if (this.stopping || this.running.size >= this.config.WORKER_CONCURRENCY) return null;
    const job = this.repository.getNextQueuedJob(now, (candidate) =>
      candidate.projectId !== PROTECTED_PROJECT_ID && this.hasClassSlot(candidate) && this.localMayTake(candidate, now) && this.orchestrator.canStartQueuedJob(candidate, now));
    return job ? (job.runAfter > job.createdAt ? job.runAfter : job.createdAt) : null;
  }

  nudge(): void {
    this.wakeQueued = false;
    this.wake();
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

  private async runBudgeted(job: Job, controller: AbortController): Promise<void> {
    const usage = this.usageService;
    if (!usage) return this.run(job, controller);
    const db = this.repository.sqlite;
    const profileId = this.repository.getProject(job.projectId)?.profileId ?? undefined;
    const read = () => {
      const now = this.now();
      const status = autonomyBudgetStatus(db, usage, profileId, now);
      for (const finding of recordBudgetFindings(db, status, now)) this.orchestrator.notifyBudgetFinding(finding);
      return status;
    };
    try {
      if (!hasAutonomySpendLimit(db, profileId)) return this.run(job, controller);
      const { level } = effectiveAutonomy(db, { profileId });
      if (level !== "supervised" && level !== "autonomous") return this.run(job, controller);
      read();
    } catch (error) {
      this.logger.error({ err: error, jobId: job.id }, "Cannot evaluate autonomy budget");
      this.orchestrator.failJob(job.id, {
        code: "AUTONOMY_BUDGET_UNAVAILABLE",
        message: "Không xác định được ngân sách tự vận hành. Kiểm tra cấu hình rồi thử lại.",
        retryable: false,
      });
      return;
    }
    return runWithAutonomyBudget(read, () => this.run(job, controller));
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
    let overdueRun: OverdueRun | undefined;
    const startedAt = this.now().getTime();
    const tracker = new ActivityTracker(startedAt);
    clearOverdue(this.repository.sqlite, job.id);
    const logger = this.logger.child({ jobId: job.id, projectId: job.projectId, stage: job.stage });
    if (this.planTimeouts) {
      try {
        await this.planTimeouts(project, controller.signal);
      } catch (error) {
        logger.warn({ err: error }, "stage timeout plan failed");
      }
    }
    const fresh = this.repository.getProject(job.projectId) ?? project;
    const brief = timeoutBriefFromSettings(fresh.settings, fresh.topic);
    const plannedMs = resolveStageTimeoutMs(
      { ...brief, stageTimeouts: fresh.settings.stageTimeouts },
      job.stage,
      this.config.STAGE_TIMEOUT_MS,
    );
    const priorTimeouts = job.error?.code === "STAGE_TIMEOUT" ? Math.max(0, job.attempt - 1) : 0;
    let timeoutMs = isPlannedTimeoutStage(job.stage) ? retryStageTimeoutMs(job.stage, plannedMs, priorTimeouts) : plannedMs;
    logger.info({ plannedMs, timeoutMs, priorTimeouts }, "stage timeout");
    const sceneDuration = brief.sceneDurationSec > 0 ? brief.sceneDurationSec : 7;
    const sceneCount = Math.max(1, Math.ceil(brief.targetDurationSec / sceneDuration));
    const timeoutText = (limitMs: number) => {
      const label = isPlannedTimeoutStage(job.stage) ? STAGE_TIMEOUT_LABELS_VI[job.stage] : job.stage;
      const minutes = Math.max(1, Math.round(limitMs / 60_000));
      return `Bước ${label} chạy quá ${minutes} phút (dự án ${sceneCount} cảnh, lần ${job.attempt}/${job.maxAttempts}). Có thể tăng thời gian chờ ở mục "Thời gian chờ" của dự án.`;
    };
    let lastProgressAt = 0;
    let lastReportedAt = 0;
    let lastProgress = -5;
    let extended = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    const onOverdue = fresh.settings.onOverdue ?? "check";
    const overdueDeps = onOverdue === "abort" ? null : this.deps();
    const planEntry = fresh.settings.stageTimeouts?.stages?.[job.stage];
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      const arm = (waitMs: number) => {
        timeoutHandle = setTimeout(() => {
          const moving = lastProgressAt > 0 && this.now().getTime() - lastProgressAt < 60_000 && lastProgress < 100;
          if (moving && !extended && isPlannedTimeoutStage(job.stage)) {
            const room = stageTimeoutCapMs(job.stage) - timeoutMs;
            const extra = Math.min(room, Math.round(timeoutMs * 0.5));
            if (extra > 0) {
              extended = true;
              timeoutMs += extra;
              const minutes = Math.max(1, Math.round(extra / 60_000));
              this.orchestrator.reportProgress(job.id, Math.max(0, lastProgress), `Còn đang chạy, gia hạn thêm ${minutes} phút`);
              arm(extra);
              return;
            }
          }
          if (overdueDeps && !controller.signal.aborted) {
            // TASK-125: past the limit the stage keeps running; the checker and Hermes decide.
            overdueRun = new OverdueRun({
              deps: overdueDeps, job, project: fresh, onOverdue, tracker, startedAtMs: startedAt,
              expectedMs: planEntry?.expectedMs ?? Math.round(plannedMs / 2), limitMs: timeoutMs,
              maxAttempts: job.maxAttempts, historyNote: planEntry?.reason ?? null, remote: false,
              abort: (kind, reason) => {
                const failure = overdueAbortError(kind, reason);
                reject(new StageError(failure.message, failure.code, failure.retryable));
                controller.abort();
              },
            });
            this.overdueRuns.set(job.id, overdueRun);
            overdueRun.start();
            return;
          }
          timedOut = true;
          controller.abort();
          reject(new StageError(timeoutText(timeoutMs), "STAGE_TIMEOUT", true));
        }, waitMs);
      };
      arm(timeoutMs);
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
            lastProgressAt = timestamp;
            tracker.note(progress, message, timestamp);
            if (progress < 100 && timestamp - lastReportedAt < 250 && progress - lastProgress < 5) return;
            lastReportedAt = timestamp;
            lastProgress = progress;
            this.orchestrator.reportProgress(job.id, progress, message);
          },
          recordUsage: (usage) => this.orchestrator.recordUsage(job.id, usage),
          reportActivity: (activity) => {
            tracker.setActivity({
              ...(activity.childAlive !== undefined ? { childAlive: activity.childAlive } : {}),
              ...(activity.childNote !== undefined ? { childNote: activity.childNote } : {}),
              ...(activity.llmInFlight !== undefined ? { llmInFlight: activity.llmInFlight } : {}),
              ...(activity.quotaWait !== undefined ? { quotaWait: activity.quotaWait } : {}),
            });
            tracker.markSignal(this.now().getTime());
          },
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
          message: timeoutText(timeoutMs),
          retryable: true,
        });
      } else {
        this.orchestrator.failJob(job.id, jobErrorFromCaught(error));
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (overdueRun) {
        overdueRun.stop();
        if (this.overdueRuns.get(job.id) === overdueRun) this.overdueRuns.delete(job.id);
        if (!this.stopping) clearOverdue(this.repository.sqlite, job.id);
      }
      const durationMs = this.now().getTime() - startedAt;
      logger.debug({ attempt: job.attempt, durationMs }, "Pipeline worker execution completed");
    }
  }
}
