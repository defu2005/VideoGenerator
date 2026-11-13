import type { PipelineStage, Project } from "@vg/shared";

type ReviewHooks = {
  applyRawProposal: (
    project: Project,
    proposal: unknown,
    source: "assistant" | "mcp",
  ) => Promise<{ result: unknown; staleStages: PipelineStage[] }>;
  undoTimeline: (projectId: string) => Promise<{ result: unknown; staleStages: PipelineStage[] }>;
  loadProject: (projectId: string) => Promise<Project | undefined>;
};

let hooks: ReviewHooks | null = null;

export function setReviewHooks(next: ReviewHooks): void {
  hooks = next;
}

export function reviewHooks(): ReviewHooks | null {
  return hooks;
}
