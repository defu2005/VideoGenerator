import type { StageContext, StageExecutor, StageResult } from "../../pipeline/stageExecutor.js";
import type { LlmProviderRegistry } from "../../providers/llm/registry.js";
import type { VisualService } from "../../services/visualService.js";

export class VisualSearchExecutor implements StageExecutor {
  readonly stage = "VISUAL_SEARCH" as const;

  constructor(
    private readonly visuals: VisualService,
    private readonly llmProviders: LlmProviderRegistry,
  ) {}

  async run(context: StageContext): Promise<StageResult> {
    const result = await this.visuals.executeStage(context, this.llmProviders);
    if (context.project.mode === "AUTO") {
      await this.visuals.approveAll(context.project.id, context.signal);
      await this.visuals.autoResolve(context.project.id, context.signal);
    }
    try {
      await this.visuals.checkContinuity(context.project.id, { registry: this.llmProviders, context });
    } catch (error) {
      if (context.signal.aborted) throw error;
      context.logger.warn({ err: error }, "Continuity check unavailable; visual review continues");
    }
    return result;
  }
}
