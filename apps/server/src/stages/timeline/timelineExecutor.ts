import type { StageContext, StageExecutor } from "../../pipeline/stageExecutor.js";
import type { TimelineService } from "../../services/timelineService.js";

/** TIMELINE stage: pure code, 0 LLM calls. */
export class TimelineExecutor implements StageExecutor {
  readonly stage = "TIMELINE" as const;

  constructor(private readonly timelines: TimelineService) {}

  async run(context: StageContext) {
    context.reportProgress(10, "Đang dựng timeline");
    const { timeline, inputHash, reused } = this.timelines.build(context.project);
    const minutes = Math.floor(timeline.totalDurationSec / 60);
    const seconds = Math.round(timeline.totalDurationSec % 60).toString().padStart(2, "0");
    const warn = timeline.warnings.length ? ` · ${timeline.warnings.length} cảnh báo` : "";
    return {
      outputHash: inputHash,
      message: `${reused ? "Dùng lại timeline" : "Timeline"} ${minutes}:${seconds} · ${timeline.scenes.length} cảnh${warn}`,
    };
  }
}
