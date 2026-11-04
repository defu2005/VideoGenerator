import type { StageContext, StageExecutor } from "../../pipeline/stageExecutor.js";
import type { TimelineService } from "../../services/timelineService.js";
import type { GuidelineService } from "../../guidelines/service.js";
import type { MetadataService } from "../../services/metadataService.js";

/** TIMELINE stage: pure code for the timeline; optional metadata LLM after success. */
export class TimelineExecutor implements StageExecutor {
  readonly stage = "TIMELINE" as const;

  constructor(
    private readonly timelines: TimelineService,
    private readonly guidelines?: GuidelineService,
    private readonly metadata?: MetadataService,
  ) {}

  async run(context: StageContext) {
    context.reportProgress(10, "Đang dựng timeline");
    const { timeline, inputHash, reused } = this.timelines.build(context.project);
    if (this.guidelines?.strictness(context.project) === "FILTER") {
      this.guidelines.runCodeChecks(context.project, "TIMELINE");
    }

    let metadataNote = "";
    if (this.metadata) {
      try {
        context.reportProgress(80, "Đang tạo thông tin đăng tải");
        const result = await this.metadata.generate(context.project, {
          signal: context.signal,
          warn: (message, extra) => context.logger.warn(extra ?? {}, message),
          logger: context.logger,
          recordUsage: (usage) => context.recordUsage(usage),
        });
        metadataNote = result.source === "LLM" ? " · metadata AI" : " · metadata code";
      } catch (error) {
        if (context.signal.aborted) throw error;
        context.logger.warn({ err: error }, "Publishing metadata skipped after timeline");
        metadataNote = " · metadata bỏ qua";
      }
    }

    const minutes = Math.floor(timeline.totalDurationSec / 60);
    const seconds = Math.round(timeline.totalDurationSec % 60).toString().padStart(2, "0");
    const warn = timeline.warnings.length ? ` · ${timeline.warnings.length} cảnh báo` : "";
    return {
      outputHash: inputHash,
      message: `${reused ? "Dùng lại timeline" : "Timeline"} ${minutes}:${seconds} · ${timeline.scenes.length} cảnh${warn}${metadataNote}`,
    };
  }
}
