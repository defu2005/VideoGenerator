import type { StageContext, StageExecutor } from "../../pipeline/stageExecutor.js";
import type { ClipService } from "../../services/clipService.js";

/** Side job that renders one proposed short. Not part of STAGE_ORDER. */
export class ClipExecutor implements StageExecutor {
  readonly stage = "CLIP" as const;

  constructor(private readonly clips: ClipService) {}

  async run(context: StageContext) {
    context.reportProgress(1, "Chuẩn bị cắt Short");
    const message = await this.clips.runClip({
      projectId: context.project.id,
      scope: context.job.scope,
      signal: context.signal,
      reportProgress: (pct, note) => context.reportProgress(Math.max(1, Math.min(99, pct)), note),
    });
    return { message };
  }
}
