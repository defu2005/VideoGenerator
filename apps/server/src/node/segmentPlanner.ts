import { GATES, STAGE_DEPENDS, STAGE_ORDER, type PipelineStage, type StageState } from "@vg/shared";

export type SegmentPlanInput = {
  states: Partial<Record<PipelineStage, StageState>>;
  automaticGates: ReadonlySet<PipelineStage>;
  executors: Partial<Record<PipelineStage, "app" | "USER" | "agent" | "app_then_agent">>;
  capabilities: ReadonlySet<string>;
  stageNeeds: Partial<Record<PipelineStage, readonly string[]>>;
};

export type SegmentPlan = {
  fromStage: PipelineStage | null;
  stages: PipelineStage[];
  stopBefore: PipelineStage[];
  needs: string[];
  blockedBy: Partial<Record<PipelineStage, "human_gate" | "executor" | "capability" | "state">>;
};

/** Follow the dependency graph. A boundary on one branch need not stop a ready stage on another. */
export function planProjectSegment(input: SegmentPlanInput): SegmentPlan {
  const stages: PipelineStage[] = [];
  const stopBefore: PipelineStage[] = [];
  const blockedBy: SegmentPlan["blockedBy"] = {};
  const needs = new Set<string>(["project"]);
  const reachable = new Set<PipelineStage>();

  for (const stage of STAGE_ORDER) {
    const state = input.states[stage] ?? "PENDING";
    if (state === "DONE" || state === "SKIPPED") { reachable.add(stage); continue; }
    if (!STAGE_DEPENDS[stage].every((dependency) => reachable.has(dependency))) continue;

    const executor = input.executors[stage] ?? "app";
    const required = input.stageNeeds[stage] ?? [];
    let block: SegmentPlan["blockedBy"][PipelineStage];
    if (GATES.includes(stage) && !input.automaticGates.has(stage)) block = "human_gate";
    else if (executor === "USER" || executor === "agent") block = "executor";
    else if (state !== "PENDING" && state !== "STALE") block = "state";
    else if (!input.capabilities.has("project") || required.some((capability) => !input.capabilities.has(capability))) block = "capability";
    if (block) {
      blockedBy[stage] = block;
      stopBefore.push(stage);
      continue;
    }
    stages.push(stage);
    reachable.add(stage);
    for (const capability of required) needs.add(capability);
  }

  return { fromStage: stages[0] ?? null, stages, stopBefore, needs: [...needs].sort(), blockedBy };
}
