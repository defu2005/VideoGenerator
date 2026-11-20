import { GATES, PROTECTED_PROJECT_ID, STAGE_ORDER, type PipelineStage } from "@vg/shared";
import type Database from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";
import { PipelineEventBus } from "../jobs/eventBus.js";
import { JobRepository } from "../jobs/jobRepository.js";
import { JobWorker } from "../jobs/worker.js";
import type { AppConfig } from "../lib/config.js";
import { PipelineOrchestrator, type ApprovalCheck } from "../pipeline/orchestrator.js";
import type { StageExecutor } from "../pipeline/stageExecutor.js";

export type RuntimeRole = "control" | "node-runner";

/** The runner owns a local job bus only. The control app owns notifications and outbound delivery. */
export function createRunnerRuntime(input: {
  sqlite: Database.Database;
  config: AppConfig;
  logger: FastifyBaseLogger;
  executors: ReadonlyMap<PipelineStage, StageExecutor> | ((repository: JobRepository) => ReadonlyMap<PipelineStage, StageExecutor>);
  projectId: string;
  stopBefore: readonly PipelineStage[];
  canApprove: ApprovalCheck;
  now?: () => Date;
}) {
  if (input.projectId === PROTECTED_PROJECT_ID) throw new Error("Protected project cannot run on a node");
  const events = new PipelineEventBus();
  const repository = new JobRepository(input.sqlite, events, input.now);
  const executors = typeof input.executors === "function" ? input.executors(repository) : input.executors;
  const localStages = new Set<PipelineStage>(STAGE_ORDER);
  const stages = new Map([...executors].filter(([stage]) => localStages.has(stage) || stage === "CLIP" || stage === "MEDIA_FETCH"));
  let stopBefore = new Set(input.stopBefore);
  const allowed = (stage: PipelineStage) => !stopBefore.has(stage) && (stages.has(stage) || GATES.includes(stage));
  const config = { ...input.config, WORKER_ENABLED: false };
  const orchestrator = new PipelineOrchestrator(repository, config, input.logger, input.now, input.canApprove, undefined, {
    allowedStage: (project, stage) => project.id === input.projectId && allowed(stage),
    publishEvent: () => undefined,
  });
  const worker = new JobWorker(repository, orchestrator, stages, config, input.logger, input.now, undefined, undefined, false);
  worker.setPlacement((job) => job.projectId === input.projectId && allowed(job.stage));
  return {
    role: "node-runner" as const satisfies RuntimeRole,
    repository, orchestrator, worker, events, mayRun: allowed,
    setStopBefore(stages: readonly PipelineStage[]) {
      stopBefore = new Set(stages);
    },
  };
}
