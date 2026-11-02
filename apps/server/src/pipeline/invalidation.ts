import { STAGE_ORDER, type PipelineStage } from "@vg/shared";
import type { JobRepository } from "../jobs/jobRepository.js";

export function markStaleFrom(repository: JobRepository, projectId: string, stage: PipelineStage): void {
  const index = STAGE_ORDER.indexOf(stage);
  if (index < 0) return;
  for (const laterStage of STAGE_ORDER.slice(index + 1)) {
    const record = repository.getStage(projectId, laterStage);
    if (record.state === "DONE") {
      repository.updateStage(projectId, laterStage, {
        state: "STALE",
        progress: 0,
        message: null,
        jobId: null,
        error: null,
      });
    }
  }
}
