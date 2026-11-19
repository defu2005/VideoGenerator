import { z } from "zod";
import { PipelineStageSchema, type PipelineStage } from "../enums.js";

export const StageExecutionModeSchema = z.enum(["app", "agent", "app_then_agent"]);
export type StageExecutionMode = z.infer<typeof StageExecutionModeSchema>;
export const StageExecutionSettingsSchema = z.partialRecord(PipelineStageSchema, StageExecutionModeSchema).superRefine((settings, ctx) => {
  for (const [stage, mode] of Object.entries(settings)) {
    if (stage !== "VISUAL_SEARCH" && mode !== "app") ctx.addIssue({ code: "custom", path: [stage], message: "Hiện chỉ bước tìm ảnh hỗ trợ agent ngoài; các bước khác dùng app." });
  }
});
export type StageExecutionSettings = z.infer<typeof StageExecutionSettingsSchema>;
export const AgentWaitMinutesSchema = z.number().int().min(1).max(1440);
export type StageExecutionBrief = { stageExecution?: StageExecutionSettings; agentWaitMinutes?: number };

/** Project overrides win; no default is materialised into a project and accidentally masks its profile. */
export function resolveStageExecution(stage: PipelineStage, project: StageExecutionBrief, profile?: StageExecutionBrief): StageExecutionMode {
  return project.stageExecution?.[stage] ?? profile?.stageExecution?.[stage] ?? (stage === "VISUAL_SEARCH" ? "app_then_agent" : "app");
}
export function resolveAgentWaitMinutes(project: StageExecutionBrief, profile?: StageExecutionBrief) {
  return project.agentWaitMinutes ?? profile?.agentWaitMinutes ?? 30;
}
