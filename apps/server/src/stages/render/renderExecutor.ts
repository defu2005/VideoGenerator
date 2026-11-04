import type { StageContext, StageExecutor } from "../../pipeline/stageExecutor.js";
import type { RenderService } from "../../services/renderService.js";

/** RENDER stage: FFmpeg only, 0 LLM calls. */
export class RenderExecutor implements StageExecutor {
  readonly stage = "RENDER" as const;

  constructor(private readonly renders: RenderService) {}

  async run(context: StageContext) {
    context.reportProgress(1, "Chuẩn bị render");
    const { render, reused } = await this.renders.render(context.project, context.signal, (pct, message) => {
      context.reportProgress(Math.max(1, Math.min(99, pct)), message);
    });
    const minutes = Math.floor(render.durationSec / 60);
    const seconds = Math.round(render.durationSec % 60).toString().padStart(2, "0");
    const mb = (render.sizeBytes / 1024 / 1024).toFixed(1);
    const issues = render.report.issues.length ? ` · ${render.report.issues.length} cảnh báo` : "";
    return {
      outputHash: render.inputHash,
      message: `${reused ? "Dùng lại video" : "Video"} ${minutes}:${seconds} · ${render.width}×${render.height} · ${mb} MB${issues}`,
    };
  }
}
