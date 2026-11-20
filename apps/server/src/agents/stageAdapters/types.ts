import type { Job, PipelineStage } from "@vg/shared";

export type StageAgentAdapter = {
  stage: PipelineStage;
  role: string;
  buildContext(job: Job): unknown;
  validateComplete(job: Job): void | Promise<void>;
  /** Runs after validation and before the job completes, outside the fence. App-side post-steps (e.g. AUTO pick). */
  prepareComplete?(job: Job): void | Promise<void>;
  openReason?(job: Pick<Job, "projectId" | "stage">): string | null;
  handoffErrors: readonly string[];
};
