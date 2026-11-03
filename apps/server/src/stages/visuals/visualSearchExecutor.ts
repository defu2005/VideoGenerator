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
    if (context.project.mode === "AUTO") await this.visuals.approveAll(context.project.id, context.signal);
    return result;
  }
}
