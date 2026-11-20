import type { Job } from "@vg/shared";
import type { StageAgentAdapter } from "./types.js";
import type { AgentVisualToolkit } from "../visualToolkit.js";
import type { VisualService } from "../../services/visualService.js";

export const VISUAL_HANDOFF_ERRORS: readonly string[] = [
  "LLM_ALL_PROVIDERS_EXHAUSTED",
  "LLM_QUOTA_EXHAUSTED",
  "VISION_PROVIDER_REQUIRED",
  "VISION_UNAVAILABLE",
  "VISUAL_NEEDS_USER",
] as const;

export type VisualSearchAdapterDeps = {
  visuals: Pick<AgentVisualToolkit, "context" | "validateComplete">;
  visualService: Pick<VisualService, "agentOpenScenes">;
};

export function createVisualSearchAdapter(deps: VisualSearchAdapterDeps): StageAgentAdapter {
  return {
    stage: "VISUAL_SEARCH",
    role: "visual_scout",
    handoffErrors: VISUAL_HANDOFF_ERRORS,
    buildContext: (job: Job) => deps.visuals.context(job),
    validateComplete: (job: Job) => {
      deps.visuals.validateComplete(job);
    },
    openReason: (job: Pick<Job, "projectId" | "stage">) => {
      if (job.stage !== "VISUAL_SEARCH") return null;
      const open = deps.visualService.agentOpenScenes(job.projectId);
      return open.length
        ? `${open.length} cảnh còn mở: ${open.map((scene) => `${scene.order + 1} (${scene.attentionReason ?? (scene.selectedCandidate ? "ảnh chưa qua cổng" : "chưa có ảnh")})`).join(", ")}`
        : null;
    },
  };
}
