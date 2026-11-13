import { parseRenderJobScope, type AspectRatio, type Project, type Render } from "@vg/shared";
import type { StageContext, StageExecutor } from "../../pipeline/stageExecutor.js";
import type { RenderService } from "../../services/renderService.js";
import type { ThumbnailService } from "../../services/thumbnailService.js";
import type { ClipService } from "../../services/clipService.js";

/** RENDER stage. Job scope may carry an aspect-ratio variant. Thumbnails run after a successful render. */
export class RenderExecutor implements StageExecutor {
  readonly stage = "RENDER" as const;

  constructor(
    private readonly renders: RenderService,
    private readonly thumbnails?: ThumbnailService,
    private readonly clips?: ClipService,
  ) {}

  async run(context: StageContext) {
    context.reportProgress(1, "Chuẩn bị render");
    const aspectRatio = parseRenderJobScope(context.job.scope) ?? undefined;
    const { render, reused, usage } = await this.renders.render(
      context.project,
      context.signal,
      (pct, message) => {
        context.reportProgress(Math.max(1, Math.min(99, pct)), message);
      },
      aspectRatio ? { aspectRatio } : undefined,
    );
    if (usage && usage.llmCalls > 0) context.recordUsage(usage);
    return this.afterRender(context.project, context.signal, aspectRatio, render, reused);
  }

  /** Thumbnails, auto shorts and the result message. Shared by a local render and one finished by a worker node. */
  async afterRender(
    project: Project,
    signal: AbortSignal,
    aspectRatio: AspectRatio | undefined,
    render: Render,
    reused: boolean,
  ): Promise<{ outputHash: string; message: string }> {
    let thumbNote = "";
    if (this.thumbnails) {
      try {
        await this.thumbnails.ensureAuto(project, signal, { variant: Boolean(aspectRatio) });
      } catch (error) {
        if (signal.aborted) throw error;
        thumbNote = " · thumbnail lỗi";
      }
    }
    if (this.clips && !aspectRatio) {
      try {
        await this.clips.maybeAutoShorts(project, signal);
      } catch (error) {
        if (signal.aborted) throw error;
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
