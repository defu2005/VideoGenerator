import { GATES, STAGE_ORDER, type PipelineStage } from "@vg/shared";
import { FakeExecutor, type FakeFailure } from "./fakeExecutor.js";
import type { StageExecutor } from "./stageExecutor.js";

export type ExecutorOptions = {
  delayMs: number;
  failures?: Partial<Record<PipelineStage, FakeFailure>>;
};

export function createExecutorRegistry(
  options: ExecutorOptions,
  overrides: Partial<Record<PipelineStage, StageExecutor>> = {},
): Map<PipelineStage, StageExecutor> {
  const registry = new Map<PipelineStage, StageExecutor>();
  for (const stage of STAGE_ORDER) {
    if (GATES.includes(stage)) continue;
    registry.set(stage, overrides[stage] ?? new FakeExecutor(stage, options.delayMs, options.failures?.[stage]));
  }
  if (overrides.PUBLISH) registry.set("PUBLISH", overrides.PUBLISH);
  return registry;
}
