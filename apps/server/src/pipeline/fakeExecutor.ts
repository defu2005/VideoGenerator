import type { PipelineStage } from "@vg/shared";
import { StageError, type StageContext, type StageExecutor, type StageResult } from "./stageExecutor.js";

export type FakeFailure = "once" | "always" | "non_retryable" | "hang";

export class FakeExecutor implements StageExecutor {
  private failuresRemaining: number;

  constructor(
    public readonly stage: PipelineStage,
    private readonly delayMs: number,
    private readonly failure?: FakeFailure,
  ) {
    this.failuresRemaining = failure === "once" ? 1 : Number.POSITIVE_INFINITY;
  }

  async run(context: StageContext): Promise<StageResult> {
    if (this.failure === "hang") {
      await new Promise<void>((_resolve, reject) => {
        const abort = () => reject(new StageError("Stage execution was aborted", "STAGE_ABORTED", false));
        context.signal.addEventListener("abort", abort, { once: true });
        if (context.signal.aborted) abort();
      });
    }

    const ticks = 10;
    const tickDelay = this.delayMs / ticks;
    for (let tick = 0; tick <= ticks; tick += 1) {
      if (context.signal.aborted) {
        throw new StageError("Stage execution was aborted", "STAGE_ABORTED", false);
      }
      if (tick > 0) await wait(tickDelay, context.signal);
      context.reportProgress(tick * 10, tick === ticks ? `${this.stage} complete` : `${this.stage}: ${tick * 10}%`);
    }

    if (this.failure && this.failuresRemaining > 0) {
      if (this.failure === "once") this.failuresRemaining -= 1;
      throw new StageError(
        `Fake ${this.stage} stage failure`,
        "FAKE_STAGE_FAILURE",
        this.failure !== "non_retryable",
      );
    }
    return { message: `${this.stage} completed by fake executor` };
  }
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new StageError("Stage execution was aborted", "STAGE_ABORTED", false));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new StageError("Stage execution was aborted", "STAGE_ABORTED", false));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
