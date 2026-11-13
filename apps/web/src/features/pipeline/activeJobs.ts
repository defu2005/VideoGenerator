import { activeJobsBlockStage, type PipelineStage, type PipelineState } from "@vg/shared";

export function pipelineJobs(state: Pick<PipelineState, "activeJob" | "activeJobs"> | undefined) {
  if (!state) return [];
  const jobs = state.activeJobs ?? (state.activeJob ? [state.activeJob] : []);
  return jobs.filter((job) => job.status === "QUEUED" || job.status === "RUNNING");
}

export function stageBlocked(
  stage: PipelineStage,
  state: Pick<PipelineState, "activeJob" | "activeJobs"> | undefined,
): boolean {
  return activeJobsBlockStage(stage, pipelineJobs(state));
}
