import { dependentStages, type PipelineStage } from "@vg/shared";
import type { JobRepository } from "../jobs/jobRepository.js";

export function markStaleFrom(repository: JobRepository, projectId: string, stage: PipelineStage): void {
  for (const laterStage of dependentStages(stage)) {
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
