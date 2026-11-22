import type { FastifyBaseLogger } from "fastify";
import type { Job, JobUsage, PipelineStage, Project } from "@vg/shared";

export interface StageContext {
  project: Project;
  job: Job;
  signal: AbortSignal;
  /** TASK-146: true only when the runner forwards `StageResult.waitForUser` to the orchestrator (the worker does). */
  canPark?: boolean;
  reportProgress(pct: number, message?: string): void;
  recordUsage(usage: Partial<JobUsage>): void;
  /** TASK-125: optional facts for the overdue checker (child process alive, LLM call in flight, quota wait). */
  reportActivity?(activity: { childAlive?: boolean | null; childNote?: string | null; llmInFlight?: boolean | null; quotaWait?: boolean | null }): void;
  logger: FastifyBaseLogger;
}

/** `waitForUser`: the executor parked the stage for the user (TASK-146 outline mode); the orchestrator holds the job open. */
export type StageResult = { outputHash?: string; message?: string; renderId?: string; waitForUser?: string };

export interface StageExecutor {
  stage: PipelineStage;
  run(context: StageContext): Promise<StageResult>;
}

export class StageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly retryAt?: string,
  ) {
    super(message);
    this.name = "StageError";
  }
}
