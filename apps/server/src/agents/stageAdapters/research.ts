import type { Job } from "@vg/shared";
import type { StageAgentAdapter } from "./types.js";
import { RESEARCH_HANDOFF_ERRORS, type AgentResearchToolkit } from "../researchToolkit.js";

export type ResearchAdapterDeps = {
  research: Pick<AgentResearchToolkit, "context" | "validateComplete">;
};

export function createResearchAdapter(deps: ResearchAdapterDeps): StageAgentAdapter {
  return {
    stage: "RESEARCH",
    role: "research_scout",
    handoffErrors: RESEARCH_HANDOFF_ERRORS,
    buildContext: (job: Job) => deps.research.context(job),
    validateComplete: (job: Job) => {
      deps.research.validateComplete(job);
    },
  };
}
