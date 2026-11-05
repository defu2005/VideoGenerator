import { parseRenderJobScope } from "@vg/shared";
import type { StageContext, StageExecutor } from "../../pipeline/stageExecutor.js";
import type { RenderService } from "../../services/renderService.js";
import type { ThumbnailService } from "../../services/thumbnailService.js";

/** RENDER stage. Job scope may carry an aspect-ratio variant. Thumbnails run after a successful render. */
export class RenderExecutor implements StageExecutor {
  readonly stage = "RENDER" as const;

  constructor(
    private readonly renders: RenderService,
    private readonly thumbnails?: ThumbnailService,
  ) {}

  async run(context: StageContext) {
    context.reportProgress(1, "Chuẩn bị render");
    const aspectRatio = parseRenderJobScope(context.job.scope) ?? undefined;
    const { render, reused } = await this.renders.render(
      context.project,
      context.signal,
      (pct, message) => {
        context.reportProgress(Math.max(1, Math.min(99, pct)), message);
      },
      aspectRatio ? { aspectRatio } : undefined,
    );
    let thumbNote = "";
    if (this.thumbnails) {
      try {
        await this.thumbnails.ensureAuto(context.project, context.signal, {
          variant: Boolean(aspectRatio),
        });
      } catch (error) {
        if (context.signal.aborted) throw error;
        thumbNote = " · thumbnail lỗi";
      }
    }
    const minutes = Math.floor(render.durationSec / 60);
    const seconds = Math.round(render.durationSec % 60).toString().padStart(2, "0");
    const mb = (render.sizeBytes / 1024 / 1024).toFixed(1);
    const issues = render.report.issues.length ? ` · ${render.report.issues.length} cảnh báo` : "";
    const variant = render.aspectRatio ? ` · ${render.aspectRatio}` : "";
    return {
      outputHash: render.inputHash,
      message: `${reused ? "Dùng lại video" : "Video"} ${minutes}:${seconds} · ${render.width}×${render.height}${variant} · ${mb} MB${issues}${thumbNote}`,
    };
  }
}
